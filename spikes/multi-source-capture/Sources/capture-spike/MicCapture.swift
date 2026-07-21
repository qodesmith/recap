// THROWAWAY SPIKE. Microphone capture via AVAudioEngine — the independent
// second clock domain we measure drift against. Triggers the Microphone TCC
// prompt on first start.
import Foundation
import AVFoundation

final class MicCapture {
    private let engine = AVAudioEngine()
    let writer: WavWriter
    let format: AVAudioFormat

    init() {
        let input = engine.inputNode
        let fmt = input.inputFormat(forBus: 0)
        self.format = fmt
        self.writer = WavWriter(sampleRate: fmt.sampleRate, channels: fmt.channelCount)
    }

    func start() throws {
        let writer = self.writer
        engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, when in
            guard let ch = buffer.floatChannelData else { return }
            let frames = Int(buffer.frameLength)
            let channels = Int(buffer.format.channelCount)
            // AVAudioEngine hands non-interleaved float; flatten to interleaved
            // so the WAV writer (interleaved) stays uniform across sources.
            var interleaved = [Float](repeating: 0, count: frames * channels)
            for f in 0..<frames {
                for c in 0..<channels {
                    interleaved[f * channels + c] = ch[c][f]
                }
            }
            interleaved.withUnsafeBytes { raw in
                writer.append(raw, frames: frames, hostTime: when.hostTime)
            }
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
