# Spike: multi-source audio capture on macOS 26

**Ticket:** [#9](https://github.com/qodesmith/recap/issues/9) · **Branch:** `spike/multi-source-capture` · **Throwaway code:** `spikes/multi-source-capture/` (Swift SPM executable)

Verdict: **PROVEN** on real hardware (macOS 26.5.2, Apple Silicon). Mic + system audio captured **simultaneously as separate, time-aligned tracks** with first-party APIs, exactly as #3 predicted. The one surprise is a **permission trap**: a denied audio-capture tap returns *silence, not an error*, and the prompt did not auto-fire in a CLI/terminal context.

## What was built

A small Swift program (Core Audio process tap for system audio, `AVAudioEngine` for the mic — the #3-recommended split). Two modes: `enumerate` (source list + picker metadata) and `capture [secs]` (both sources → two WAV files + a drift report). Chosen over the #3-recommended Rust `objc2` path only because no Rust toolchain was installed and the deliverable is the *finding*; the OS-level result is identical.

## Findings, against the ticket's five points

### 1. Enumerate — ✅
- **Mics** via `AVCaptureDevice.DiscoverySession` — name + UID, no permission needed.
- **Audio processes** via `kAudioHardwarePropertyProcessObjectList` — each yields bundle ID + PID. GUI apps (Brave, Control Center) resolve to a localized name **and icon** via `NSRunningApplication`; daemons give **bundle-ID only, no icon**. That's the exact picker-metadata split a source picker must handle.

### 2. Simultaneous capture to separate files, no bleed — ✅
- Mic + a global system-audio tap ran at once, each to its own WAV. Both confirmed to carry real signal (system −3.2 dB peak, mic −7.5 dB peak) and were listened to.
- **No digital cross-bleed** is structural: the tap is a pure digital capture of app output (can't contain mic input); the mic is a pure input capture. The only bleed is **acoustic** (speakers → mic), which vanishes with headphones — not a routing bug.

### 3. Time alignment / drift — ✅ (and *far* better than feared)
Measured with per-buffer host timestamps (`mach_absolute_time` — the **same clock** backs both Core Audio `mHostTime` and `AVAudioTime.hostTime`, so the two streams are directly comparable).
- **Relative clock drift ≈ 0 ppm** (mic and tap both measured 48000.12 Hz, ~+2.6 ppm vs nominal — identical, so ~0 *relative*). Projected drift over 1 hour: **~0 ms**. `kAudioSubTapDriftCompensationKey` locks each aggregate to the host clock, which is the shared reference.
- **Start skew is the real alignment issue, not drift.** The two streams' first samples landed **54–168 ms apart**, and the gap *varied run to run* — so it is **not** a fixed offset to calibrate once. Because each stream's first-sample host time is recorded on the shared clock, the merge step aligns exactly per-capture regardless of skew magnitude. **Design rule: timestamp every track with host time; align on those, don't assume streams start together.**
- Drift-measurement gotcha worth remembering: naive `frames / (lastCallbackHostTime − firstCallbackHostTime)` overstates the rate by ~one buffer, which reads as false drift *scaled by buffer size* (mic's 100 ms buffer → a fake +3300 ppm; the tap's 10.7 ms buffer → a fake +350 ppm). Exclude the last buffer's frames from the span.

### 4. Permissions — ✅ tested, with the spike's headline surprise
- **Mic:** `AVCaptureDevice.requestAccess` fires the standard prompt; grant/deny is returned synchronously. Clean.
- **Audio-capture tap:** matches #3's warning that there's **no preflight/status API** — and is worse in practice. In the CLI/terminal context the **prompt never auto-fired**, and the tap **silently returned digital zeros** (proven: IOProc delivered a valid 2-ch buffer every callback with peak `0.0000`). No error, no exception — just silence.
- **Fix that worked:** manually add the TCC-responsible app to **System Settings → Privacy & Security → Screen & System Audio Recording**, then **restart it**. TCC attributes to the *responsible* process — here the terminal (Warp), **not** "Recap" — so an unsigned/embedded-plist CLI is a poor proxy for the shipped `.app`.
- **Two design consequences:**
  1. **Denial must be detected heuristically** (capture runs but is pure silence) — there is no status to query. First-run onboarding must be a *test capture that checks for signal*, not a permission checklist (reinforces #3 and the map's onboarding fog).
  2. Granting the permission **requires an app restart** to take effect — onboarding has to account for a relaunch.

### 5. Format — ✅
- Both sources: **48 kHz, Float32**; system tap **stereo**, mic **mono**. Tap format is **read-only** (`kAudioTapPropertyFormat`).
- ASR (Parakeet) wants **16 kHz mono**, so every track needs a **downsample (48→16 k)** and the system track a **downmix to mono** — a resample step regardless of drift. (Drift here is ~0, so resampling is driven by *format*, not drift, contrary to the #3 emphasis — but the resample seam is needed either way.)

## Configuration that mattered

- The aggregate device needs the **default output device as its main sub-device** (`kAudioAggregateDeviceMainSubDeviceKey` + `kAudioAggregateDeviceSubDeviceListKey`). A **tap-only** private aggregate runs and fires callbacks but delivers **silence** — this cost real debugging time and is the non-obvious part of the recipe.
- Always destroy the tap and aggregate on exit (`AudioHardwareDestroyProcessTap` / `…DestroyAggregateDevice`) — orphans pollute Audio MIDI Setup (#3 note).

## Not proven here (carried forward)

- **The 3-source case (mic + system + a *specific app*), i.e. N simultaneous taps in N aggregate devices.** This spike used one global tap + mic. Cross-*tap* drift (#3's original fear) is untested — but the ~0 relative drift seen here, and the fact that drift compensation locks each aggregate to the shared host clock, are strong evidence it will also be small. Low-priority verification.
- **Per-app targeting** via `CATapDescription.bundleIDs` (macOS 26) — enumerated the metadata but did not capture a single named app in isolation.
