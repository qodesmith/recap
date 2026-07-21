# THROWAWAY SPIKE — multi-source audio capture (#9)

Disposable Swift program proving simultaneous mic + system-audio capture on
macOS 26. **Not production code.** Findings: `docs/spikes/multi-source-capture.md`.

## Run

```sh
swift run capture-spike enumerate       # list sources + picker metadata
swift run capture-spike capture 20      # capture mic + system audio for 20s
```

Writes `system.wav` + `mic.wav` to `$TMPDIR/recap-capture-spike/` and prints a
drift report.

## Requires

- The **TCC-responsible app** (your terminal) must have **Screen & System Audio
  Recording** granted in System Settings, then be **restarted** — otherwise the
  tap returns pure silence with no error. See the findings doc.
- `Info.plist` is embedded into the binary via a linker `-sectcreate` flag
  (`Package.swift`) so TCC can show the mic / audio-capture usage strings.
