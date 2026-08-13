// THROWAWAY SPIKE. A single Core Audio process tap over all system audio,
// wrapped in its own private aggregate device, feeding a WavWriter.
// This is the risky path the ticket exists to prove: does a process tap
// actually deliver audio on macOS 26, and how much does its clock drift?
import Foundation
import CoreAudio
import AudioToolbox

final class SystemAudioTap {
    private(set) var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(0)
    private var procID: AudioDeviceIOProcID?
    let writer: WavWriter
    let format: AudioStreamBasicDescription

    /// Creates the tap + aggregate device. Throws a readable error on any
    /// OSStatus failure so `main` can report where the path broke.
    init(excluding excluded: [AudioObjectID] = []) throws {
        // Global tap over all output, minus any excluded processes.
        let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
        tapDesc.name = "Recap Spike System Tap"
        tapDesc.isPrivate = true

        var tap = AudioObjectID(kAudioObjectUnknown)
        try osCheck(AudioHardwareCreateProcessTap(tapDesc, &tap), "AudioHardwareCreateProcessTap")
        self.tapID = tap

        // Read the tap's native stream format (read-only — the ticket asks
        // what format we get and whether it needs resampling for ASR).
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var fmtAddr = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        try osCheck(AudioObjectGetPropertyData(tap, &fmtAddr, 0, nil, &size, &asbd), "read kAudioTapPropertyFormat")
        self.format = asbd
        self.writer = WavWriter(sampleRate: asbd.mSampleRate, channels: asbd.mChannelsPerFrame)

        // The tap needs a real output device to clock and feed it — a tap-only
        // aggregate runs but delivers silence. Attach the current default
        // output device as the aggregate's main sub-device.
        let outputUID = try Self.defaultOutputDeviceUID()

        // Wrap the tap in a private aggregate device we can run an IOProc on.
        let aggUID = "com.qodesmith.recap.spike.agg.\(UUID().uuidString)"
        let desc: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "Recap Spike Aggregate",
            kAudioAggregateDeviceUIDKey as String: aggUID,
            kAudioAggregateDeviceMainSubDeviceKey as String: outputUID,
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceIsStackedKey as String: false,
            kAudioAggregateDeviceTapAutoStartKey as String: true,
            kAudioAggregateDeviceSubDeviceListKey as String: [
                [kAudioSubDeviceUIDKey as String: outputUID]
            ],
            kAudioAggregateDeviceTapListKey as String: [
                [
                    kAudioSubTapUIDKey as String: tapDesc.uuid.uuidString,
                    kAudioSubTapDriftCompensationKey as String: true,
                ]
            ],
        ]
        var agg = AudioObjectID(0)
        try osCheck(AudioHardwareCreateAggregateDevice(desc as CFDictionary, &agg), "AudioHardwareCreateAggregateDevice")
        self.aggID = agg
    }

    /// UID of the current default output device — the aggregate's main sub-device.
    static func defaultOutputDeviceUID() throws -> String {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var deviceID = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        try osCheck(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &deviceID),
                    "read kAudioHardwarePropertyDefaultOutputDevice")

        var uidAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var uid: CFString? = nil
        var uidSize = UInt32(MemoryLayout<CFString?>.size)
        let status = withUnsafeMutablePointer(to: &uid) {
            AudioObjectGetPropertyData(deviceID, &uidAddr, 0, nil, &uidSize, $0)
        }
        try osCheck(status, "read kAudioDevicePropertyDeviceUID")
        guard let uid else { throw OSStatusError(status: -1, label: "default output UID was nil") }
        return uid as String
    }

    // Diagnostics (spike only): peak sample seen and whether we've logged shape.
    let diag = TapDiag()

    func start() throws {
        let bytesPerFrame = Int(format.mBytesPerFrame)
        let writer = self.writer
        let diag = self.diag
        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, aggID, nil) {
            (_, inInputData, inInputTime, _, _) in
            let abl = inInputData.pointee
            guard abl.mNumberBuffers > 0 else { return }
            let buffers = withUnsafePointer(to: inInputData.pointee.mBuffers) {
                UnsafeBufferPointer(start: $0, count: Int(abl.mNumberBuffers))
            }
            // Log the buffer-list shape once, and scan EVERY buffer for signal.
            diag.observe(buffers)

            let buf = buffers[0]
            guard let data = buf.mData, bytesPerFrame > 0 else { return }
            let frames = Int(buf.mDataByteSize) / bytesPerFrame
            let raw = UnsafeRawBufferPointer(start: data, count: Int(buf.mDataByteSize))
            writer.append(raw, frames: frames, hostTime: inInputTime.pointee.mHostTime)
        }
        try osCheck(status, "AudioDeviceCreateIOProcIDWithBlock")
        self.procID = proc
        try osCheck(AudioDeviceStart(aggID, proc), "AudioDeviceStart")
    }

    func stop() {
        if let procID {
            AudioDeviceStop(aggID, procID)
            AudioDeviceDestroyIOProcID(aggID, procID)
        }
        // Cleanup matters: orphaned aggregate devices pollute Audio MIDI Setup
        // and survive crashes (#3 risk note).
        if aggID != 0 { AudioHardwareDestroyAggregateDevice(aggID) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    }
}

/// Spike diagnostics: capture the input buffer-list shape and the peak sample
/// found across ALL buffers, so we can tell whether the tap is delivering audio
/// somewhere we're not reading vs delivering nothing at all.
final class TapDiag {
    private let lock = NSLock()
    private(set) var shape = ""
    private(set) var peakPerBuffer: [Float] = []

    func observe(_ buffers: UnsafeBufferPointer<AudioBuffer>) {
        var peaks = [Float](repeating: 0, count: buffers.count)
        for (i, b) in buffers.enumerated() {
            guard let d = b.mData else { continue }
            let n = Int(b.mDataByteSize) / MemoryLayout<Float>.size
            let fp = d.bindMemory(to: Float.self, capacity: n)
            var p: Float = 0
            for j in 0..<n { let a = abs(fp[j]); if a > p { p = a } }
            peaks[i] = p
        }
        lock.lock(); defer { lock.unlock() }
        if shape.isEmpty {
            shape = buffers.enumerated().map { "buf\($0.offset)[ch:\($0.element.mNumberChannels) bytes:\($0.element.mDataByteSize)]" }.joined(separator: " ")
        }
        if peakPerBuffer.count < peaks.count { peakPerBuffer = Array(repeating: 0, count: peaks.count) }
        for i in 0..<peaks.count where peaks[i] > peakPerBuffer[i] { peakPerBuffer[i] = peaks[i] }
    }
}

extension SystemAudioTap {
    func printDiagnostics() {
        print("  [tap diag] input buffer shape: \(diag.shape.isEmpty ? "(no callbacks)" : diag.shape)")
        let peaks = diag.peakPerBuffer.enumerated().map { "buf\($0.offset) peak \(String(format: "%.4f", $0.element))" }.joined(separator: ", ")
        print("  [tap diag] peak per buffer: \(peaks.isEmpty ? "n/a" : peaks)")
    }
}

struct OSStatusError: Error, CustomStringConvertible {
    let status: OSStatus
    let label: String
    var description: String { "\(label) failed: OSStatus \(status) (\(fourCC(status)))" }
}

func osCheck(_ status: OSStatus, _ label: String) throws {
    if status != noErr { throw OSStatusError(status: status, label: label) }
}

func fourCC(_ status: OSStatus) -> String {
    let n = UInt32(bitPattern: status)
    let bytes = [UInt8((n >> 24) & 0xff), UInt8((n >> 16) & 0xff), UInt8((n >> 8) & 0xff), UInt8(n & 0xff)]
    let ascii = bytes.allSatisfy { $0 >= 32 && $0 < 127 }
    return ascii ? "'" + String(bytes: bytes, encoding: .ascii)! + "'" : "\(status)"
}
