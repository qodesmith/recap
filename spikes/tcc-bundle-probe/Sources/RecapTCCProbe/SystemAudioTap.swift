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

    // While the TCC prompt is PENDING, the tap hands over buffers whose
    // claimed mDataByteSize exceeds what is actually mapped readable — a
    // direct read is a SIGBUS (observed on macOS 26.5.2, crash in the first
    // callbacks after the prompt fired; #9's CLI spike never hit this because
    // its responsible app was pre-granted, so the pending state never
    // existed). Every read below therefore goes through a defensive
    // mach_vm_read_overwrite copy, which returns an error code instead of a
    // bus error; unreadable callbacks are counted as their own outcome.
    private let scratch = ScratchBuffer()

    func start() throws {
        let bytesPerFrame = Int(format.mBytesPerFrame)
        let writer = self.writer
        let diag = self.diag
        let scratch = self.scratch
        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, aggID, nil) {
            (_, inInputData, inInputTime, _, _) in
            let abl = inInputData.pointee
            // Header memory (the ABL struct itself) is safe; buffer CONTENTS
            // are not necessarily. Cap the count in case of a garbage header.
            let bufCount = min(Int(abl.mNumberBuffers), 8)
            guard bufCount > 0 else { return }
            let buffers = withUnsafePointer(to: inInputData.pointee.mBuffers) {
                UnsafeBufferPointer(start: $0, count: bufCount)
            }
            diag.observeShape(buffers)

            for (i, b) in buffers.enumerated() {
                guard let data = b.mData, b.mDataByteSize > 0 else { continue }
                let size = Int(b.mDataByteSize)
                guard let copy = scratch.copyIn(data, size) else {
                    diag.notedProtected()
                    continue
                }
                let floats = copy.bindMemory(to: Float.self, capacity: size / 4)
                diag.observePeak(bufferIndex: i, floats: floats, count: size / 4)
                if i == 0 && bytesPerFrame > 0 {
                    let raw = UnsafeRawBufferPointer(start: copy, count: size)
                    writer.append(raw, frames: size / bytesPerFrame, hostTime: inInputTime.pointee.mHostTime)
                }
            }
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

/// Reusable scratch buffer for the IO thread. copyIn() uses
/// mach_vm_read_overwrite so an unreadable source region reports failure
/// instead of raising SIGBUS. Single-threaded (IO callbacks are serialized),
/// so no lock.
final class ScratchBuffer {
    private var ptr: UnsafeMutableRawPointer?
    private var capacity = 0

    func copyIn(_ src: UnsafeRawPointer, _ len: Int) -> UnsafeMutableRawPointer? {
        guard len > 0 else { return nil }
        if capacity < len {
            ptr?.deallocate()
            ptr = .allocate(byteCount: len, alignment: 16)
            capacity = len
        }
        guard let dst = ptr else { return nil }
        var outSize: mach_vm_size_t = 0
        let kr = mach_vm_read_overwrite(
            mach_task_self_,
            mach_vm_address_t(UInt(bitPattern: src)),
            mach_vm_size_t(len),
            mach_vm_address_t(UInt(bitPattern: dst)),
            &outSize)
        guard kr == KERN_SUCCESS, outSize == mach_vm_size_t(len) else { return nil }
        return dst
    }

    deinit { ptr?.deallocate() }
}

/// Spike diagnostics: buffer-list shape, peak per buffer, and how many
/// callbacks handed us protected (unreadable) buffers — the pending-prompt
/// state. All reads/writes under one lock; peak scans happen outside it.
final class TapDiag {
    private let lock = NSLock()
    private var shape = ""
    private var peakPerBuffer: [Float] = []
    private var protectedCallbacks = 0

    func observeShape(_ buffers: UnsafeBufferPointer<AudioBuffer>) {
        lock.lock(); defer { lock.unlock() }
        if shape.isEmpty {
            shape = buffers.enumerated().map { "buf\($0.offset)[ch:\($0.element.mNumberChannels) bytes:\($0.element.mDataByteSize)]" }.joined(separator: " ")
        }
    }

    func observePeak(bufferIndex: Int, floats: UnsafePointer<Float>, count: Int) {
        var p: Float = 0
        for j in 0..<count { let a = abs(floats[j]); if a > p { p = a } }
        lock.lock(); defer { lock.unlock() }
        if peakPerBuffer.count <= bufferIndex {
            peakPerBuffer.append(contentsOf: Array(repeating: 0, count: bufferIndex - peakPerBuffer.count + 1))
        }
        if p > peakPerBuffer[bufferIndex] { peakPerBuffer[bufferIndex] = p }
    }

    func notedProtected() {
        lock.lock(); defer { lock.unlock() }
        protectedCallbacks += 1
    }

    func snapshot() -> (peak: Float, protectedCallbacks: Int, shape: String) {
        lock.lock(); defer { lock.unlock() }
        return (peakPerBuffer.max() ?? 0, protectedCallbacks, shape)
    }
}

extension SystemAudioTap {
    func printDiagnostics() {
        let s = diag.snapshot()
        print("  [tap diag] input buffer shape: \(s.shape.isEmpty ? "(no callbacks)" : s.shape)")
        print("  [tap diag] peak \(String(format: "%.4f", s.peak)), protected callbacks \(s.protectedCallbacks)")
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
