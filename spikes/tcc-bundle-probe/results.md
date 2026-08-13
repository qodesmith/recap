
# TCC probe run — Thu Aug 13 09:02:58 EDT 2026

    ProductName:		macOS
    ProductVersion:		26.5.2
    BuildVersion:		25F84

## Phase A — ad-hoc signature

Build 1 (ad-hoc):
    Identifier=com.qodesmith.recap.tcc-probe
    Signature=adhoc
    TeamIdentifier=not set
- M1 · prompt on first tap IO (ad-hoc bundle): The app opened, I clicked 1 - system tap, then got this error - "Recap TCC Probe quit unexpectedly."
- M1 · first-probe verdict (grant arrived mid-probe): ERROR
- M3 · post-grant, same process, no relaunch: The app is closed, it errored out
- M3 · relaunch not needed (signal without restarting the app)
- M2 · Privacy-pane entry (ad-hoc): Listed by the name "Recap TCC Probe.app" in the "System Audio Recording Only" section, toggle state is on
- M7 · child-process (sidecar) attribution: I can't click, the app errored out
- M6 · mic preflight without prompt: app is closed errored out
- M6 · mic grant → capture, same process: app is closed errored out
Build 2 (ad-hoc, rebuilt — note the changed CDHash):
    Identifier=com.qodesmith.recap.tcc-probe
    Signature=adhoc
    TeamIdentifier=not set
- M4a · ad-hoc rebuild, same grant: App errors out and closed
- M4a · Privacy pane after ad-hoc rebuild: app errors out and closed
- Self-signed arm: SKIPPED by choice
