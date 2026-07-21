// THROWAWAY SPIKE. A minimal, thread-safe Float32 WAV sink.
// Accumulates PCM in memory and writes a WAVE_FORMAT_IEEE_FLOAT file on close.
// Not realtime-safe (takes a lock, grows a buffer) — fine for a 10-second spike.
import Foundation

final class WavWriter {
    private let lock = NSLock()
    private var pcm = Data()
    let sampleRate: Double
    let channels: UInt32

    // Drift bookkeeping, all under `lock`.
    private(set) var frameCount: Int = 0
    private(set) var firstHostTime: UInt64 = 0
    private(set) var lastHostTime: UInt64 = 0
    private(set) var lastBufferFrames: Int = 0
    private(set) var callbackCount: Int = 0

    // Frames whose host time falls in [firstHostTime, lastHostTime]: the last
    // buffer's frames start AT lastHostTime, so they're excluded. Dividing
    // these frames by the host span gives the true clock rate (no off-by-one).
    var framesInHostSpan: Int { max(0, frameCount - lastBufferFrames) }

    init(sampleRate: Double, channels: UInt32) {
        self.sampleRate = sampleRate
        self.channels = channels
    }

    /// Append interleaved Float32 frames. `hostTime` is the CoreAudio/AV host
    /// timestamp of this buffer, used later to reconstruct the capture window.
    func append(_ bytes: UnsafeRawBufferPointer, frames: Int, hostTime: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        pcm.append(bytes.bindMemory(to: UInt8.self))
        frameCount += frames
        if firstHostTime == 0 { firstHostTime = hostTime }
        lastHostTime = hostTime
        lastBufferFrames = frames
        callbackCount += 1
    }

    func write(to url: URL) throws {
        lock.lock()
        let body = pcm
        lock.unlock()

        var data = Data()
        func u32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        func u16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }

        let byteRate = UInt32(sampleRate) * channels * 4
        let blockAlign = UInt16(channels * 4)

        data.append("RIFF".data(using: .ascii)!)
        data.append(u32(UInt32(36 + body.count)))
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        data.append(u32(16))
        data.append(u16(3)) // 3 = IEEE float
        data.append(u16(UInt16(channels)))
        data.append(u32(UInt32(sampleRate)))
        data.append(u32(byteRate))
        data.append(u16(blockAlign))
        data.append(u16(32)) // bits per sample
        data.append("data".data(using: .ascii)!)
        data.append(u32(UInt32(body.count)))
        data.append(body)
        try data.write(to: url)
    }
}
