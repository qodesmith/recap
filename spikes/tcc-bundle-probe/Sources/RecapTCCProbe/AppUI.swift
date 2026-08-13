// THROWAWAY SPIKE. Minimal programmatic AppKit shell: four probe buttons and a
// log pane. Every line also lands in ~/Library/Logs/RecapTCCProbe.log. The tap
// is created only when a button is clicked — never at launch — so the human
// can observe the exact moment the TCC prompt does (or does not) fire.
import AppKit
import AVFoundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let logView = NSTextView()
    private var busy = false

    func applicationDidFinishLaunching(_ note: Notification) {
        buildWindow()
        log("Recap TCC Probe — launched")
        log("build:   \(BuildInfo.summary)   nonce \(buildNonce.prefix(8))")
        log(SigningInfo.summary())
        log("bundle:  \(Bundle.main.bundleURL.path)")
        log("log:     \(Log.fileURL.path)")
        log(String(repeating: "─", count: 72))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // MARK: - Probes

    @objc func tapInProcess() {
        guard claimBusy() else { return }
        log("▶ IN-PROCESS TAP PROBE — the tap is created NOW; if a system-audio prompt is going to fire, it fires here.")
        log("  Keep music playing for the whole 10 s.")
        DispatchQueue.global().async {
            let r = TapProbe.run(seconds: 10) { s, p, inv in
                self.log(String(format: "  t=%2ds  ioProc invocations %d, cumulative peak %.4f", s, inv, p))
            }
            if let setup = r.setup { self.log("  \(setup)") }
            self.log("  callbacks=\(r.callbacks) frames=\(r.frames) invocations=\(r.ioInvocations) emptyABLs=\(r.emptyBufferLists) nilBufs=\(r.nilBuffers) protected=\(r.protectedCallbacks) aggRunning=\(r.aggregateRunning)")
            self.log("■ VERDICT (in-process tap): \(r.verdict)")
            self.releaseBusy()
        }
    }

    @objc func tapChild() {
        guard claimBusy() else { return }
        let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/recap-probe-helper")
        log("▶ CHILD-PROCESS TAP PROBE — spawning \(helper.lastPathComponent) (the #7 sidecar shape).")
        log("  Keep music playing for the whole 10 s. Watch for any NEW prompt — there should be none.")
        DispatchQueue.global().async {
            let p = Process()
            p.executableURL = helper
            p.arguments = ["--tap-probe", "10"]
            let out = Pipe()
            p.standardOutput = out
            p.standardError = FileHandle.nullDevice
            do {
                try p.run()
                p.waitUntilExit()
                let data = out.fileHandleForReading.readDataToEndOfFile()
                if let r = try? JSONDecoder().decode(TapProbeResult.self, from: data) {
                    if let setup = r.setup { self.log("  \(setup)") }
                    self.log("  child exit=\(p.terminationStatus)  callbacks=\(r.callbacks) frames=\(r.frames) invocations=\(r.ioInvocations) emptyABLs=\(r.emptyBufferLists) nilBufs=\(r.nilBuffers) protected=\(r.protectedCallbacks) aggRunning=\(r.aggregateRunning)")
                    self.log("■ VERDICT (child-process tap): \(r.verdict)")
                } else {
                    self.log("■ VERDICT (child-process tap): ERROR — unparseable child output: \(String(decoding: data, as: UTF8.self))")
                }
            } catch {
                self.log("■ VERDICT (child-process tap): ERROR — spawn failed: \(error)")
            }
            self.releaseBusy()
        }
    }

    @objc func micStatus() {
        let st = AVCaptureDevice.authorizationStatus(for: .audio)
        log("▶ MIC PREFLIGHT — authorizationStatus(for: .audio) = \(describe(st))")
        log("  (No prompt should have appeared just now — preflight must be silent.)")
    }

    @objc func micRequest() {
        guard claimBusy() else { return }
        log("▶ MIC REQUEST — requestAccess(for: .audio); if status was notDetermined, the mic prompt fires NOW.")
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            self.log("  mic access \(granted ? "GRANTED" : "DENIED")")
            guard granted else { self.releaseBusy(); return }
            DispatchQueue.global().async {
                self.log("  capturing 3 s from the mic in this same process (no relaunch) — say something…")
                let mic = MicCapture()
                do {
                    try mic.start()
                } catch {
                    self.log("■ VERDICT (mic): ERROR — engine start failed: \(error)")
                    self.releaseBusy()
                    return
                }
                Thread.sleep(forTimeInterval: 3)
                mic.stop()
                let w = mic.writer
                self.log("  frames=\(w.frameCount) callbacks=\(w.callbackCount)")
                let verdict = w.peak > 0.001
                    ? String(format: "SIGNAL — peak %.4f, captured with no relaunch", w.peak)
                    : "SILENCE — mic granted but delivered zeros (muted mic, or a relaunch is required)"
                self.log("■ VERDICT (mic): \(verdict)")
                self.releaseBusy()
            }
        }
    }

    // MARK: - Plumbing

    private func claimBusy() -> Bool {
        if busy { log("  (busy — wait for the running probe to finish)"); return false }
        busy = true
        return true
    }

    private func releaseBusy() {
        DispatchQueue.main.async { self.busy = false }
    }

    private func describe(_ s: AVAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private func log(_ line: String) {
        Log.append(line)
        DispatchQueue.main.async {
            let s = NSAttributedString(string: line + "\n", attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
                .foregroundColor: NSColor.textColor,
            ])
            self.logView.textStorage?.append(s)
            self.logView.scrollToEndOfDocument(nil)
        }
    }

    private func buildWindow() {
        let header = NSTextField(wrappingLabelWithString:
            "build: \(BuildInfo.summary)\n\(SigningInfo.summary())")
        header.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        header.isSelectable = true

        let buttons: [(String, Selector)] = [
            ("1 · System tap — in-process (10 s)", #selector(tapInProcess)),
            ("2 · System tap — child process (10 s)", #selector(tapChild)),
            ("3 · Mic — preflight status", #selector(micStatus)),
            ("4 · Mic — request + capture 3 s", #selector(micRequest)),
        ]
        let buttonViews = buttons.map { title, sel -> NSButton in
            let b = NSButton(title: title, target: self, action: sel)
            b.bezelStyle = .rounded
            return b
        }
        let row1 = NSStackView(views: Array(buttonViews[0...1]))
        let row2 = NSStackView(views: Array(buttonViews[2...3]))

        logView.isEditable = false
        logView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        logView.minSize = NSSize(width: 0, height: 0)
        logView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        logView.isVerticallyResizable = true
        logView.isHorizontallyResizable = false
        logView.autoresizingMask = [.width]
        logView.textContainer?.widthTracksTextView = true

        let scroll = NSScrollView()
        scroll.documentView = logView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [header, row1, row2, scroll])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 560),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Recap TCC Probe"
        window.contentView = stack
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: stack.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: stack.trailingAnchor, constant: -12),
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
    }
}
