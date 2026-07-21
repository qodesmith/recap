// THROWAWAY SPIKE — multi-source audio capture on macOS 26. See README.md.
// Answers ticket #9: does simultaneous multi-source capture work as separate,
// time-aligned tracks, what do the permission prompts look like, and what
// format do we get?
//
// Usage:
//   swift run capture-spike enumerate        # list sources + metadata
//   swift run capture-spike capture [secs]   # mic + system audio, 2 files, drift
import Foundation
import AVFoundation

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "capture"

switch mode {
case "enumerate":
    Enumerate.run()

case "capture":
    let seconds = args.count > 2 ? (Double(args[2]) ?? 10) : 10
    runCapture(seconds: seconds)

default:
    print("Unknown mode '\(mode)'. Use 'enumerate' or 'capture [seconds]'.")
    exit(2)
}

func requestMicPermission() -> Bool {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    print("Microphone TCC status (pre-request): \(describe(status))")
    if status == .authorized { return true }
    if status == .denied || status == .restricted {
        print("  ⚠️  Microphone previously DENIED. Grant it in System Settings > Privacy & Security > Microphone.")
        return false
    }
    // .notDetermined — this call fires the visible prompt.
    print("  → Requesting microphone access (a system prompt should appear now)…")
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { ok in granted = ok; sem.signal() }
    sem.wait()
    print("  Microphone access \(granted ? "GRANTED" : "DENIED") by user.")
    return granted
}

func describe(_ s: AVAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
}

func runCapture(seconds: Double) {
    print("=== Recap multi-source capture spike — \(seconds)s ===\n")

    let micOK = requestMicPermission()

    // System-audio tap has NO preflight permission API (#3): the prompt fires
    // implicitly on first IO from the tap-bearing aggregate device.
    print("\nCreating system-audio process tap (audio-capture prompt fires on first IO)…")
    let tap: SystemAudioTap
    do {
        tap = try SystemAudioTap()
    } catch {
        print("  ❌ tap setup failed: \(error)")
        print("     (If this is a permission error, the audio-capture prompt path is broken for unsigned CLI binaries.)")
        return
    }
    print("  System tap format: \(describe(tap.format))")

    let mic = micOK ? MicCapture() : nil
    if let mic { print("  Mic format: \(describe(mic.format.streamDescription.pointee))") }

    // Start both as close together as possible, note the wall clock.
    let wallStart = HostTime.now()
    do {
        try tap.start()
        try mic?.start()
    } catch {
        print("  ❌ start failed: \(error)")
        tap.stop(); mic?.stop()
        return
    }
    print("\n▶️  Capturing for \(seconds)s — PLAY SOME SYSTEM AUDIO and SPEAK into the mic now…")

    Thread.sleep(forTimeInterval: seconds)

    tap.stop()
    mic?.stop()
    let wallStop = HostTime.now()
    let wallDuration = HostTime.seconds(wallStop - wallStart)

    // Write files to a temp dir (throwaway — no persistence in the repo).
    let outDir = FileManager.default.temporaryDirectory.appendingPathComponent("recap-capture-spike", isDirectory: true)
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    let sysURL = outDir.appendingPathComponent("system.wav")
    let micURL = outDir.appendingPathComponent("mic.wav")
    try? tap.writer.write(to: sysURL)
    if let mic { try? mic.writer.write(to: micURL) }

    print("\n=== RESULTS ===")
    print("Wall-clock capture window: \(fmt(wallDuration))s")
    tap.printDiagnostics()
    report(name: "System audio (tap)", w: tap.writer, wall: wallDuration, url: sysURL)
    if let mic {
        report(name: "Microphone (AVAudioEngine)", w: mic.writer, wall: wallDuration, url: micURL)
        driftReport(sys: tap.writer, mic: mic.writer)
    } else {
        print("\n(Mic skipped — no permission. Cross-source drift needs both tracks.)")
    }
    print("\nFiles written to: \(outDir.path)")
    print("  Listen to both and confirm NO BLEED (mic shouldn't contain the system audio and vice-versa).")
}

func report(name: String, w: WavWriter, wall: Double, url: URL) {
    let audioDur = Double(w.frameCount) / w.sampleRate
    // Host-clock span the callbacks actually covered — independent of the
    // sleep window and of when each stream was start/stopped. `lastHostTime`
    // is the last buffer's *start*, so this undercounts by ~one buffer.
    let hostSpan = HostTime.seconds(w.lastHostTime - w.firstHostTime)
    let measuredSR = hostSpan > 0 ? Double(w.framesInHostSpan) / hostSpan : 0
    let ppm = (measuredSR / w.sampleRate - 1) * 1_000_000
    print("""

    \(name)
      format:    \(Int(w.sampleRate)) Hz, \(w.channels) ch, Float32
      frames:    \(w.frameCount)  (\(w.callbackCount) callbacks)
      audio dur: \(fmt(audioDur))s   vs wall \(fmt(wall))s
      host span: \(fmt(hostSpan))s  →  measured rate \(fmt(measuredSR)) Hz  (\(fmtSigned(ppm)) ppm vs nominal)
      captured:  \(w.frameCount > 0 ? "✅ audio received" : "❌ NO AUDIO (permission denied or silent source)")
    """)
}

func driftReport(sys: WavWriter, mic: WavWriter) {
    // Absolute start skew: both timestamps are the same mach host clock, so
    // this is the real gap between when each stream's first sample landed.
    let startSkewMs = HostTime.seconds(abs(Int64(bitPattern: mic.firstHostTime) - Int64(bitPattern: sys.firstHostTime)).magnitude) * 1000
    let leader = mic.firstHostTime < sys.firstHostTime ? "mic" : "system"

    // True clock drift: compare each stream's measured rate over its own host
    // span. This is immune to start/stop skew (the flaw in a raw frame diff).
    let sysSpan = HostTime.seconds(sys.lastHostTime - sys.firstHostTime)
    let micSpan = HostTime.seconds(mic.lastHostTime - mic.firstHostTime)
    let sysSR = Double(sys.framesInHostSpan) / sysSpan
    let micSR = Double(mic.framesInHostSpan) / micSpan
    // Relative drift between the two device clocks, in ppm and projected to 1h.
    let sysPPM = (sysSR / sys.sampleRate - 1) * 1_000_000
    let micPPM = (micSR / mic.sampleRate - 1) * 1_000_000
    let relDriftPPM = sysPPM - micPPM
    let msPerHour = relDriftPPM / 1_000_000 * 3600 * 1000

    print("""

    --- CROSS-SOURCE DRIFT (host-clock method) ---
      start skew:        \(fmt(startSkewMs)) ms  (\(leader) started first)
      system clock:      \(fmtSigned(sysPPM)) ppm vs nominal 48000 Hz
      mic clock:         \(fmtSigned(micPPM)) ppm vs nominal 48000 Hz
      RELATIVE drift:    \(fmtSigned(relDriftPPM)) ppm  →  ~\(fmtSigned(msPerHour)) ms over 1 hour
      → Start skew is a fixed offset (align once). Relative drift is the part
        that accumulates and mandates per-track resampling (#3 prediction).
    """)
}

func fmtSigned(_ v: Double) -> String { String(format: "%+.1f", v) }

func describe(_ asbd: AudioStreamBasicDescription) -> String {
    "\(Int(asbd.mSampleRate)) Hz, \(asbd.mChannelsPerFrame) ch, \(asbd.mBitsPerChannel)-bit, \(asbd.mBytesPerFrame) B/frame"
}

func fmt(_ v: Double) -> String { String(format: "%.3f", v) }
func fmt4(_ v: Double) -> String { String(format: "%.5f", v) }
