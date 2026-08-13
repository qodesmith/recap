// THROWAWAY SPIKE — TCC signed-bundle probe (#27). See README.md.
// Two modes in one binary:
//   (default)           AppKit app — buttons fire the probes, results on screen.
//   --tap-probe [secs]  headless child — runs the system tap and prints one
//                       JSON line to stdout. The app spawns its own bundled
//                       copy (recap-probe-helper) to test that a child process
//                       attributes to the bundle (#7's sidecar shape).
//   --selfcheck         prints signing + build info and exits (safe smoke test;
//                       touches no audio, fires no TCC prompt).
import AppKit

let cliArgs = CommandLine.arguments

if cliArgs.contains("--selfcheck") {
    print(SigningInfo.summary())
    print("build: \(BuildInfo.summary)")
    exit(0)
}

if let i = cliArgs.firstIndex(of: "--tap-probe") {
    let secs = cliArgs.count > i + 1 ? (Int(cliArgs[i + 1]) ?? 10) : 10
    TapProbe.runChildAndPrint(seconds: max(1, secs))
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
