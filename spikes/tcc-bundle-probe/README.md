# THROWAWAY SPIKE — TCC signed-bundle probe (#27)

Disposable experiment answering [issue #27](https://github.com/qodesmith/recap/issues/27):
does a real `.app` bundle get the system-audio TCC prompt (unlike #9's
terminal-launched CLI), and does the grant survive a rebuild under each signing
identity (ad-hoc / self-signed / free Apple Development)? **Not production
code.**

## Run

```sh
bash wizard.sh
```

The wizard builds and signs the app, resets TCC between phases, and walks you
through every launch, prompt, and System Settings check. Your observations are
appended to `results.md`; the app itself logs every verdict to
`~/Library/Logs/RecapTCCProbe.log`. Safe to Ctrl-C and re-run — phases are
independent.

## Pieces

- `Sources/RecapTCCProbe/` — one binary, three modes: AppKit probe app
  (default), `--tap-probe` headless child (the #7 sidecar shape), `--selfcheck`
  (prints signing info, touches no audio). `SystemAudioTap` / `WavWriter` /
  `MicCapture` are copied from `spike/multi-source-capture` (#9's proven code).
- `build.sh adhoc|selfsigned|dev` — builds `dist/Recap TCC Probe.app` and signs
  it. Every build bakes a fresh nonce so the CDHash always changes: a rebuild
  must look like a "different program" to TCC or the experiment measures
  nothing.
- `wizard.sh` — the guided experiment; the ordered measurements map to the
  ticket's list 1–7.

## Requires

- macOS 26, Apple Silicon, Xcode CLT (build) — plus full Xcode only for the
  free-certificate arm.
- Music playing during every tap probe: a denied tap returns pure silence, so
  a silent system is indistinguishable from a denial.
