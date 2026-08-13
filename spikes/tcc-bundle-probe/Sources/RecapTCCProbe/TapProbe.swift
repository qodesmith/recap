// THROWAWAY SPIKE. Runs the #9 system tap for a fixed window and reduces it to
// one verdict: SIGNAL, SILENCE, or ERROR. Used in-process (button 1) and as a
// headless child process (button 2 / --tap-probe).
import Foundation

struct TapProbeResult: Codable {
    var ok: Bool
    var error: String?
    var callbacks: Int
    var frames: Int
    var peak: Float
    var protectedCallbacks: Int
    var verdict: String
}

extension SystemAudioTap {
    var peakSample: Float { diag.snapshot().peak }
}

enum TapProbe {
    // A granted tap with music playing peaks well above this; a denied tap is
    // exactly 0 (#9's headline). The floor only guards against dither noise.
    static let signalFloor: Float = 0.001

    static func run(seconds: Int, tick: ((Int, Float) -> Void)? = nil) -> TapProbeResult {
        let tap: SystemAudioTap
        do {
            tap = try SystemAudioTap()
        } catch {
            return TapProbeResult(ok: false, error: "\(error)", callbacks: 0, frames: 0, peak: 0,
                                  protectedCallbacks: 0, verdict: "ERROR — tap creation failed: \(error)")
        }
        do {
            try tap.start()
        } catch {
            tap.stop()
            return TapProbeResult(ok: false, error: "\(error)", callbacks: 0, frames: 0, peak: 0,
                                  protectedCallbacks: 0, verdict: "ERROR — tap start failed: \(error)")
        }
        for s in 1...seconds {
            Thread.sleep(forTimeInterval: 1)
            tick?(s, tap.peakSample)
        }
        tap.stop()

        let callbacks = tap.writer.callbackCount
        let frames = tap.writer.frameCount
        let snap = tap.diag.snapshot()
        let peak = snap.peak
        let verdict: String
        if callbacks == 0 && snap.protectedCallbacks > 0 {
            verdict = "PROTECTED — \(snap.protectedCallbacks) callbacks delivered unreadable buffers and none were readable. This is the pending-prompt state; answer the prompt and probe again."
        } else if callbacks == 0 {
            verdict = "NO CALLBACKS — the aggregate device delivered nothing at all"
        } else if peak < signalFloor {
            verdict = "SILENCE — tap ran (\(callbacks) callbacks, \(frames) frames) but delivered only zeros. Either the tap is denied, or nothing was playing."
        } else {
            verdict = String(format: "SIGNAL — peak %.4f over %d frames", peak, frames)
        }
        let suffix = snap.protectedCallbacks > 0 && callbacks > 0
            ? " (+\(snap.protectedCallbacks) unreadable callbacks while the prompt was pending)" : ""
        return TapProbeResult(ok: true, error: nil, callbacks: callbacks, frames: frames, peak: peak,
                              protectedCallbacks: snap.protectedCallbacks, verdict: verdict + suffix)
    }

    static func runChildAndPrint(seconds: Int) {
        let r = run(seconds: seconds)
        let data = (try? JSONEncoder().encode(r)) ?? Data("{}".utf8)
        print(String(decoding: data, as: UTF8.self))
    }
}
