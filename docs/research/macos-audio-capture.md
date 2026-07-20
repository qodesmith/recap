# macOS multi-source audio capture — API landscape

**Question:** How does an app on macOS 26 (Tahoe), Apple Silicon, enumerate and simultaneously capture multiple independent audio sources, keeping each as a **separate track** (OBS-style)?

**Date:** 2026-07-19
**Issue:** https://github.com/qodesmith/recap/issues/3
**Scope constraints:** macOS 26+ only, Apple Silicon only, Tauri/Rust app, signed + notarized **Developer ID** distribution (not App Store), small-circle audience.

**Method note:** Apple's documentation pages are JS-rendered and return an empty body to fetchers. Every availability claim below was read from the backing DocC JSON (`https://developer.apple.com/tutorials/data/documentation/<path>.json`), which is the same primary source in machine-readable form. Human-readable URL is cited; the `.json` suffix reproduces the fetch.

**Environment reality check:** as of today macOS **27 is in beta** — several ScreenCaptureKit symbols report `introducedAt: 27.0, beta: true`. macOS 26 is the current shipping release. Nothing in this document depends on 27.

---

## Bottom line

**Recommended architecture: Core Audio process taps for everything except the mic; AVFoundation for the mic. Do not use ScreenCaptureKit unless you also need video.**

- **Per-app audio and system audio → Core Audio process taps** (`AudioHardwareCreateProcessTap` + a tap-bearing aggregate device, macOS 14.2+). One tap per selected source gives you genuinely independent streams — that is the whole point of the API, and it is the only first-party way to get *two different apps* as *two different tracks*. As of macOS 26 you can target processes **by bundle ID** and have taps **survive app restarts** (`CATapDescription.bundleIDs`, `isProcessRestoreEnabled`) — this removes the single biggest practical wart of the 14.2/15 API. Permission cost: one `NSAudioCaptureUsageDescription` TCC prompt, no Screen Recording TCC.
- **Microphone → AVFoundation** (`AVCaptureSession` + `AVCaptureDeviceInput` + `AVCaptureAudioDataOutput`). Separate `NSMicrophoneUsageDescription` TCC prompt. Taps **cannot** capture input — confirmed, see §2.
- **Skip ScreenCaptureKit.** Its audio surface delivers exactly two audio buckets per stream (`.audio` = the filtered content's audio, `.microphone`), it drags in Screen Recording TCC (a heavier, scarier, historically re-prompting permission with no purpose-string key), and there is no documented way to get N independent per-app audio tracks from it. It is the right tool if and only if you later add screen video.
- **No virtual audio driver needed.** BlackHole-class workarounds existed because pre-14.2 there was no first-party per-process capture. There now is. Apple additionally states outright that AudioDriverKit "only supports physical audio devices" and that virtual devices should use an Audio Server Driver Plug-in — and DriverKit entitlements are gated on you supplying a **hardware vendor ID** and transport (USB/PCI/HID/networking/serial). A virtual-driver route is effectively closed for Developer ID distribution. See §4.
- **Rust:** no Swift/ObjC helper is required. `objc2-core-audio` 0.3.2 binds `AudioHardwareCreateProcessTap`, `CATapDescription`, `AudioHardwareCreateAggregateDevice`, and `kAudioHardwarePropertyProcessObjectList`; `objc2-av-foundation` 0.3.2 covers the mic path. See §5.

---

## 1. ScreenCaptureKit — version/availability table

All rows verified individually. Framework introduced macOS 12.3.

| Symbol | macOS | Source |
|---|---|---|
| `SCStream`, `SCStreamConfiguration`, `SCContentFilter`, `SCShareableContent`, `SCStreamOutput`, `SCStreamDelegate`, `SCRunningApplication`, `SCWindow`, `SCDisplay`, `SCStreamOutputType` | **12.3** | [SCStream](https://developer.apple.com/documentation/screencapturekit/scstream), [SCShareableContent](https://developer.apple.com/documentation/screencapturekit/scshareablecontent) |
| `SCStream.addStreamOutput(_:type:sampleHandlerQueue:)` | 12.3 | [doc](https://developer.apple.com/documentation/screencapturekit/scstream/addstreamoutput(_:type:samplehandlerqueue:)) |
| `SCStreamConfiguration.capturesAudio` | **13.0** | [doc](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio) |
| `.sampleRate`, `.channelCount`, `.excludesCurrentProcessAudio` | 13.0 | [sampleRate](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/samplerate), [channelCount](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/channelcount), [excludesCurrentProcessAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/excludescurrentprocessaudio) |
| `SCStreamOutputType.audio` | 13.0 | [doc](https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype/audio) |
| `SCContentSharingPicker`, `SCContentSharingPickerConfiguration`, `SCContentSharingPickerMode`, `SCContentSharingPickerObserver` | **14.0** — *not 15.0* | [doc](https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker) |
| `SCScreenshotManager`, `SCShareableContentInfo` | 14.0 | [doc](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager) |
| `SCContentFilter.includeMenuBar` | 14.2 | [doc](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/includemenubar) |
| `SCShareableContent.getCurrentProcessShareableContent(completionHandler:)` | 14.4 | [doc](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getcurrentprocessshareablecontent(completionhandler:)) |
| `SCStreamConfiguration.captureMicrophone` | **15.0** | [doc](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturemicrophone) |
| `SCStreamConfiguration.microphoneCaptureDeviceID` | 15.0 | [doc](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/microphonecapturedeviceid) |
| `SCStreamOutputType.microphone` | 15.0 | [doc](https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype/microphone) |
| `SCRecordingOutput`, `SCRecordingOutputConfiguration`, `SCRecordingOutputDelegate`, `SCStream.addRecordingOutput(_:)` | 15.0 | [doc](https://developer.apple.com/documentation/screencapturekit/screcordingoutput) |
| `SCStreamConfiguration.preset`, `.captureDynamicRange`, `.showMouseClicks` | 15.0 | [preset](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/preset) |
| `SCScreenshotConfiguration`, `SCScreenshotOutput` | **26.0** | [doc](https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration) |
| `SCClipBufferingOutput`, `SCRecordingEditor` (+ delegates) | 27.0 BETA | [doc](https://developer.apple.com/documentation/screencapturekit/scclipbufferingoutput) |

### What macOS 26 changed in ScreenCaptureKit: nothing audio-related

The only macOS 26 additions are `SCScreenshotConfiguration` / `SCScreenshotOutput` — still-image capture. The framework's own [Updates page](https://developer.apple.com/documentation/updates/screencapturekit) has entries for **June 2023** and **June 2024** and no entry for 2025 or 2026. The [macOS 26 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-26-release-notes) contain no ScreenCaptureKit or Core Audio audio-capture entries (searched for `ScreenCaptureKit`, `screen recording`, `process tap`, `Core Audio`, `audio capture`, `TCC`, `NSAudioCapture` — zero hits).

**Correcting a common claim:** `SCContentSharingPicker` is **macOS 14.0**, not 15.0. The 15.0 ScreenCaptureKit release is microphone capture + `SCRecordingOutput`.

### The audio shape of an SCStream

The June 2024 entry on the [Updates page](https://developer.apple.com/documentation/updates/screencapturekit) states it directly: *"Capture microphone audio by streaming output with the [`.microphone`] type to a sample handler queue that the framework processes and returns audio samples in buffers to the client via the stream's [`didOutputSampleBuffer`] delegate method."*

[WWDC24 session 10088](https://developer.apple.com/videos/play/wwdc2024/10088/) shows the canonical shape — one stream, three output types:

```swift
config.captureMicrophone = true
config.microphoneCaptureDeviceID = AVCaptureDevice.default(for: .audio)?.uniqueID
try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: nil)

func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    switch type { case .screen: …; case .audio: …; case .microphone: … }
}
```

So a single `SCStream` yields **at most two audio tracks**: `.audio` (the audio of whatever the `SCContentFilter` selects) and `.microphone`. There is no N-way per-app audio fan-out. Getting three apps as three tracks would require three `SCStream`s — see "Unconfirmed" for whether that is supported.

`SCContentFilter` does support app-scoped filters (`init(display:including:exceptingWindows:)`, `init(display:excludingApplications:exceptingWindows:)`, both 12.3), so per-app audio via SCK is *conceptually* available, but Apple's abstract for `capturesAudio` says only "whether to capture audio" and does not document per-app audio semantics.

---

## 2. Core Audio process taps — version/availability table

| Symbol | macOS | Source |
|---|---|---|
| `AudioHardwareCreateProcessTap(_:_:)` | **14.2** | [doc](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)) |
| `AudioHardwareDestroyProcessTap(_:)` | 14.2 | [doc](https://developer.apple.com/documentation/coreaudio/audiohardwaredestroyprocesstap(_:)) |
| `CATapDescription` (class) — header `<CoreAudio/AudioHardwareTapping.h>`, framework Core Audio | **14.2 in practice** (docs say 12.0 — see conflict below) | [doc](https://developer.apple.com/documentation/coreaudio/catapdescription) |
| `CATapDescription` inits: `init(processes:deviceUID:stream:)`, `init(excludingProcesses:deviceUID:stream:)`, `init(monoMixdownOfProcesses:)`, `init(stereoMixdownOfProcesses:)`, `init(monoGlobalTapButExcludeProcesses:)`, `init(stereoGlobalTapButExcludeProcesses:)` | docs say 14.0 | [doc](https://developer.apple.com/documentation/coreaudio/catapdescription/init(stereomixdownofprocesses:)) |
| `CATapMuteBehavior` (`unmuted` / `muted` / `mutedWhenTapped`) | docs say 13.0 (artifact) | [doc](https://developer.apple.com/documentation/coreaudio/catapmutebehavior) |
| `AudioHardwareCreateAggregateDevice`, `kAudioAggregateDeviceTapListKey`, `kAudioSubTapUIDKey`, `kAudioAggregateDevicePropertyTapList`, `kAudioTapPropertyUID`, `kAudioTapPropertyFormat` | **no version annotation on Apple's C-constant pages** — inferred 14.2 | [kAudioAggregateDeviceTapListKey](https://developer.apple.com/documentation/coreaudio/kaudioaggregatedevicetaplistkey), [kAudioSubTapUIDKey](https://developer.apple.com/documentation/coreaudio/kaudiosubtapuidkey) |
| `kAudioHardwarePropertyProcessObjectList`, `kAudioHardwarePropertyTranslatePIDToProcessObject`, `kAudioProcessPropertyPID`, `kAudioProcessPropertyBundleID`, `kAudioProcessPropertyIsRunningInput/Output` | no version annotation | [doc](https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertyprocessobjectlist) |
| Swift wrappers `AudioHardwareTap`, `AudioHardwareProcess`, `AudioHardwareAggregateDevice` | **15.0** | [AudioHardwareTap](https://developer.apple.com/documentation/coreaudio/audiohardwaretap), [AudioHardwareProcess](https://developer.apple.com/documentation/coreaudio/audiohardwareprocess), [AudioHardwareAggregateDevice](https://developer.apple.com/documentation/coreaudio/audiohardwareaggregatedevice) |
| `CATapDescription.bundleIDs` | **26.0** | [doc](https://developer.apple.com/documentation/coreaudio/catapdescription/bundleids) |
| `CATapDescription.isProcessRestoreEnabled` | **26.0** | [doc](https://developer.apple.com/documentation/coreaudio/catapdescription/isprocessrestoreenabled) |
| `NSAudioCaptureUsageDescription` | **14.2** | [doc](https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription) |

> ⚠️ **Documentation conflict — the biggest trap in this API.** The DocC availability metadata on `CATapDescription`, `CATapMuteBehavior`, and several members is self-inconsistent and wrong: the class page reports **iOS 15.0 / macOS 12.0**, `CATapMuteBehavior` reports iOS 16.0 / macOS 13.0, and the initializers report macOS 14.0. There is no iOS process-tap API at all. The authoritative floor is Apple's own sample article: *"Before you run the sample code project in Xcode, ensure that you're using macOS 14.2 or later"* ([source](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps)), which matches the two C functions at 14.2 and the Info.plist key at 14.2. **Treat 14.2 as the real minimum. Ignore the 12.0 / iOS badges.** Irrelevant for us (we target 26+) but it explains why web sources disagree.

### What macOS 26 changed: bundle-ID targeting and tap persistence

This is the material improvement for a recorder app. Pre-26 a `CATapDescription` could only reference live `AudioObjectID`s, so a tap on Chrome died when Chrome quit and had to be rebuilt.

- `bundleIDs: [String]` — *"An Array of Strings where each String holds the bundle ID of a process to tap or exclude."* ([doc](https://developer.apple.com/documentation/coreaudio/catapdescription/bundleids))
- `isProcessRestoreEnabled: Bool` — *"True if this tap should save tapped processes by bundle ID when they exit, and restore them to the tap when they start up again."* ([doc](https://developer.apple.com/documentation/coreaudio/catapdescription/isprocessrestoreenabled))

Also worth noting: the Apple article [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps) itself carries `introducedAt: 26.0` in its page metadata, even though its body says macOS 14.2+. Read that as the article being (re)published for 26, not a version requirement.

### Mechanics (from Apple's sample)

Create the tap, create an aggregate device, then join them by tap UID:

```swift
let description = CATapDescription()
description.processes = [...]           // or .bundleIDs on macOS 26
description.isPrivate = true            // visible only inside your process
description.muteBehavior = .unmuted
description.isMixdown = true; description.isMono = false   // stereo mixdown
var tapID = AudioObjectID(kAudioObjectUnknown)
AudioHardwareCreateProcessTap(description, &tapID)

var id: AudioObjectID = 0
AudioHardwareCreateAggregateDevice([kAudioAggregateDeviceNameKey: "…",
                                    kAudioAggregateDeviceUIDKey: UUID().uuidString] as CFDictionary, &id)
// read kAudioTapPropertyUID from tapID, then AudioObjectSetPropertyData it
// onto kAudioAggregateDevicePropertyTapList of the aggregate device
```

Note the sample uses the **runtime property path** (create a minimal aggregate, then set `kAudioAggregateDevicePropertyTapList`) rather than stuffing `kAudioAggregateDeviceTapListKey` into the creation dictionary. Prefer the sample's path.

### Mute behavior — taps can suppress normal playback

| Case | Documented behavior |
|---|---|
| `unmuted` | "Audio is captured by the tap and also sent to the audio hardware." |
| `muted` | "Audio is captured by the tap but no audio is sent from the process to the audio hardware." |
| `mutedWhenTapped` | "Audio is captured by the tap and also sent to the audio hardware **until the tap is read by another audio client**. For the duration of the read activity on the tap, no audio is sent to the audio hardware." |

([CATapMuteBehavior](https://developer.apple.com/documentation/coreaudio/catapmutebehavior)) — For a recorder you want `unmuted` (user keeps hearing the app). `mutedWhenTapped` is the "record silently" mode.

### Taps capture output only — never the microphone

Confirmed three ways: `CATapDescription` abstract — *"a mix of all of the specified processes **output** audio"*; `AudioHardwareTap` — *"capture **outgoing** audio"*; the sample article — *"capture outgoing audio from a process or group of processes."*

`kAudioProcessPropertyIsRunningInput` / `AudioHardwareProcess.isRunningInput` is **metadata only** — it tells you a process has an active input stream; it does not let you tap that input. The name is misleading.

### Format control and latency

`AudioHardwareTap.format` is a **read-only** `AudioStreamBasicDescription` ([doc](https://developer.apple.com/documentation/coreaudio/audiohardwaretap)); there is no `setFormat`. You influence format only indirectly via `CATapDescription.isMixdown` / `isMono` (mono → 1ch, stereo mixdown → 2ch, non-mixdown → follows the tapped streams) and `deviceUID`/`stream` (inherits that stream's format). Sample rate follows the underlying device. Contrast SCK, where `SCStreamConfiguration.sampleRate` and `.channelCount` are settable.

**Latency: no Apple documentation exists.** No tap latency property, no discussion text, no WWDC session. Marked unconfirmed.

### No WWDC session covers process taps

Checked. [WWDC25 session 251 "Enhance your app's audio recording capabilities"](https://developer.apple.com/videos/play/wwdc2025/251/) covers `AVInputPickerInteraction`, AirPods high-quality recording, spatial capture and Cinematic mix — not taps or system audio capture. The API shipped in a 14.2 point release with documentation only. Practical consequence: **the sample project is the only substantive primary source**, and web material about taps is disproportionately blog-tier.

---

## 3. AVFoundation / AVCaptureSession

| Symbol | macOS | Source |
|---|---|---|
| `AVCaptureSession`, `AVCaptureDevice`, `AVCaptureDeviceInput`, `AVCaptureAudioDataOutput`, `AVCaptureDevice.uniqueID`, `.localizedName` | 10.7 | [AVCaptureSession](https://developer.apple.com/documentation/avfoundation/avcapturesession) |
| `AVCaptureDevice.DiscoverySession`, `AVCaptureDevice.DeviceType` | 10.15 | [doc](https://developer.apple.com/documentation/avfoundation/avcapturedevice/discoverysession) |
| `AVCaptureDevice.requestAccess(for:completionHandler:)`, `.authorizationStatus(for:)` | 10.14 | [doc](https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess(for:completionhandler:)) |
| `AVCaptureMultiCamSession` | **unavailable on macOS** | [doc](https://developer.apple.com/documentation/avfoundation/avcapturemulticamsession) |

**Shape recommendation: one `AVCaptureSession` per microphone, not one session with many inputs.** Reasoning:

- `AVCaptureMultiCamSession` — the "multiple inputs of the same media type" session — is **iOS-only** (macOS `unavailable`, verified). Its existence on iOS is the evidence that plain `AVCaptureSession` is not designed for N same-type inputs.
- `AVCaptureSession`'s [overview](https://developer.apple.com/documentation/avfoundation/avcapturesession) only demonstrates the single-device case and gives no multi-audio-input guidance. `canAddInput(_:)` exists (10.7) as the runtime gate, so a multi-input session is *testable* but not *documented* on macOS.
- In practice the mic is one track. Anything beyond one mic is better served by a Core Audio **aggregate device** (`AudioHardwareCreateAggregateDevice`) with multiple input sub-devices, which is exactly what the taps path already builds.

Anything about multiple concurrent `AVCaptureSession`s on macOS is **unconfirmed** — Apple documents neither support nor prohibition.

---

## 4. Is a virtual audio driver still necessary? — No, and it's largely closed off anyway

**Not necessary.** BlackHole-class virtual devices exist because before macOS 14.2 there was no first-party per-process output capture. `AudioHardwareCreateProcessTap` covers that case, and macOS 26's `bundleIDs` + `isProcessRestoreEnabled` cover the "target survives an app restart" case that previously pushed people back to a virtual device.

**And the DriverKit route is impractical for us regardless:**

- Apple, in its own AudioDriverKit sample: *"When creating a virtual device, best practice is to use an Audio Server Driver Plug-in instead… **AudioDriverKit only supports physical audio devices.**"* ([Creating an audio device driver](https://developer.apple.com/documentation/audiodriverkit/creating-an-audio-device-driver))
- Requesting DriverKit entitlements requires you to supply *"The transport mechanism for your hardware. DriverKit supports USB, PCI, HID, networking, and serial devices"* and *"Your company's hardware vendor ID"* ([Requesting Entitlements for DriverKit Development](https://developer.apple.com/documentation/driverkit/requesting-entitlements-for-driverkit-development)). There is no virtual transport, and entitlements are Apple-approved per-team and bound into a provisioning profile.
- The remaining legal-ish route is an **AudioServerPlugIn** (the HAL plug-in mechanism BlackHole actually uses, not DriverKit). That drags in an installer, admin privileges, `coreaudiod` restarts, and a user-visible system-wide fake device — all of which we get to skip.

**Conclusion for this project: first-party APIs fully cover the requirement. No driver, no kext, no dext, no installer.**

---

## 5. Answers to the five questions

### Q1 — Can mic + system audio + a specific app's audio be captured simultaneously as separate streams, first-party only, on macOS 26?

**Yes.** Recommended composition:

| Track | API | Independence |
|---|---|---|
| Microphone | `AVCaptureSession` + `AVCaptureDeviceInput(device:)` + `AVCaptureAudioDataOutput` | Fully independent |
| Specific app (e.g. Zoom) | Tap A: `CATapDescription(bundleIDs: ["us.zoom.xos"])` → aggregate device A | Fully independent |
| Everything else / "system" | Tap B: `init(stereoGlobalTapButExcludeProcesses:)` excluding Zoom **and** your own recorder | Fully independent |

Each tap is its own `AudioObjectID` in its own aggregate device with its own IOProc, so the tracks never mix and are trivially routed to separate `AVAssetWriterInput`s / separate files. Add an Nth app by adding an Nth tap.

Note the self-exclusion detail: build the "system" tap with an *exclude* initializer that excludes your own process, or you'll capture your own monitoring output. (The SCK equivalent is `excludesCurrentProcessAudio`.)

The SCK-only alternative gets you at most **two** audio tracks per stream (`.audio` + `.microphone`), so it does not satisfy "a specific app AND system audio AND mic as three tracks" from a single stream.

### Q2 — Permissions per path

| Path | TCC bucket | Info.plist key | How requested | What the user sees |
|---|---|---|---|---|
| Core Audio process tap | **System Audio Recording** | `NSAudioCaptureUsageDescription` (macOS 14.2+) | No explicit API. The prompt fires implicitly: *"The first time you start recording from an aggregate device that contains a tap, the system prompts you to grant the app system audio recording permission."* ([source](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps)) | A modal alert containing your purpose string. Managed under **System Settings → Privacy & Security → Screen & System Audio Recording** ([Apple Support](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)) |
| Microphone (AVFoundation, or SCK `captureMicrophone`) | **Microphone** | `NSMicrophoneUsageDescription` (macOS 10.14+) | `AVCaptureDevice.requestAccess(for: .audio)`; check with `.authorizationStatus(for:)` | Modal alert with purpose string; **Privacy & Security → Microphone** |
| ScreenCaptureKit (any use, incl. audio-only) | **Screen Recording** | **None — there is no screen-recording purpose-string key.** Verified: no such key exists in Apple's [Protected resources](https://developer.apple.com/documentation/bundleresources/protected-resources) index | `CGRequestScreenCaptureAccess()` / `CGPreflightScreenCaptureAccess()` (10.15+) | Modal alert with a **system-authored** string you cannot customise. Apple's own SCK sample warns: *"The first time you run this sample, the system prompts you to grant the app Screen Recording permission. After you grant permission, **you need to restart the app** to enable capture."* ([source](https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos)) |

Three points that matter for UX design:

1. **The tap path has no preflight/request API.** You cannot check status or ask ahead of time — you start IO and the prompt happens. Design the onboarding around a deliberate "test capture" step rather than a permissions checklist. Tap *creation* appears to succeed before authorization; only IO triggers the prompt.
2. **Screen Recording's prompt is uncustomisable and requires an app restart.** This is a real reason to avoid SCK when you don't need video: you cannot explain yourself in the dialog, and you have to relaunch.
3. **It's 14.2, not 14.4.** `NSAudioCaptureUsageDescription` is annotated `introducedAt: "14.2"` — same release as the tap API. Claims that Audio Capture TCC arrived in 14.4 are wrong.

**Re-prompt / expiry behaviour — the honest answer:** the macOS 15 periodic screen-recording re-consent is **not documented in any Apple primary source I could find.** It is absent from the [macOS 15 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes) (whose only ScreenCaptureKit entries are the `SCRecordingOutputConfiguration` "Stop Recording This Window" menu item and the `CGDisplayStream`/`CGWindowListCreateImage` deprecation alert), absent from the [macOS 26 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-26-release-notes), and absent from the [Apple Support privacy guide](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac) — which explicitly covers macOS 26 and says nothing about periodic re-approval. The only evidence is **Apple Developer Forums user posts** from the Sequoia beta period ([thread 760112](https://developer.apple.com/forums/thread/760112), [thread 760483](https://developer.apple.com/forums/thread/760483)) describing per-launch prompting in beta 4 relaxed to roughly weekly in beta 5. **Its state in macOS 26 is unconfirmed.** This is a further argument for the taps path, which has never been reported to re-prompt.

### Q3 — Enumerable sources and available metadata

| Enumeration API | Returns | Metadata available |
|---|---|---|
| `kAudioHardwarePropertyProcessObjectList` → `AudioHardwareProcess` (macOS 15 typed wrapper) | Audio-active processes | `pid: pid_t`, `bundleID: String?`, `devices: [AudioHardwareDevice]` ("devices currently used by the process for output"), `isRunning`, `isRunningInput`, `isRunningOutput` ([doc](https://developer.apple.com/documentation/coreaudio/audiohardwareprocess)) — **no display name, no icon** |
| `SCShareableContent` (12.3) | `.applications: [SCRunningApplication]`, `.windows: [SCWindow]`, `.displays: [SCDisplay]` ([doc](https://developer.apple.com/documentation/screencapturekit/scshareablecontent)) | `SCRunningApplication.applicationName` ("The display name of the app"), `.bundleIdentifier`, `.processID` — all 12.3. **No icon property.** |
| `AVCaptureDevice.DiscoverySession` (10.15) | Input devices | `uniqueID`, `localizedName`, `deviceType`, `modelID` |
| `SCContentSharingPicker` (14.0) | System-provided picker UI | Apple renders the UI; you receive an `SCContentFilter` |

**Practical picker recipe.** The Core Audio process list gives you PID + bundle ID and nothing pretty. To build an OBS-style picker with names and icons:

1. Enumerate with `kAudioHardwarePropertyProcessObjectList`, filtering on `isRunningOutput` so you only offer processes actually producing audio.
2. Read `kAudioProcessPropertyBundleID` (and/or `kAudioProcessPropertyPID`).
3. Resolve display name + icon yourself via AppKit: `NSRunningApplication(processIdentifier:)` → `.localizedName`, `.icon`; or `NSWorkspace.shared.urlForApplication(withBundleIdentifier:)` → `NSWorkspace.shared.icon(forFile:)`.

That AppKit resolution step is the one place a Rust app touches a Cocoa API for cosmetics — trivially done through `objc2-app-kit`, no helper binary needed.

`SCShareableContent` is *nicer* metadata (it hands you `applicationName` directly) but you must hold Screen Recording TCC to call it, which defeats the purpose of choosing the taps path.

**No icon is available from any of the three enumeration APIs.** Icons always come from AppKit.

### Q4 — Entitlements, Info.plist, signing, notarization

**Info.plist (both required for our architecture):**

```xml
<key>NSAudioCaptureUsageDescription</key>
<string>Recap records audio from the apps you choose so you can review the session later.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Recap records your microphone as a separate track.</string>
```

Both strings are user-visible in the TCC dialogs; write them for the user, not for the reviewer. No Info.plist key exists (or is needed) for Screen Recording.

**Entitlements:**

- **App Sandbox (`com.apple.security.app-sandbox`) — do not enable.** It is not required for Developer ID distribution (only for the Mac App Store). Enabling it means you additionally need `com.apple.security.device.audio-input` for mic access ([doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)), and **whether the sandbox permits Core Audio process taps at all is undocumented and unconfirmed** — no Apple page ties any sandbox entitlement to taps. Given we're not shipping to the App Store, leaving the sandbox off removes an entire class of unknowns.
- **Hardened Runtime — required for notarization.** Enable it. With Hardened Runtime on and the sandbox off, the microphone is governed by TCC alone; you do not need `com.apple.security.device.audio-input`. See [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime).
- **Tauri-specific:** if the bundle ends up loading unsigned/third-party dylibs, you may need `com.apple.security.cs.disable-library-validation` ([doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)). Add it only if signing/launch actually fails — it weakens the binary.
- **No DriverKit entitlements** (see §4). No `com.apple.developer.persistent-content-capture` — that one is macOS 14.4+ and scoped to VNC apps ([doc](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.persistent-content-capture)).

**Signing/notarization implications:** Developer ID certificate → Hardened Runtime → notarize → staple ([Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)). Nothing in the recommended architecture requires an Apple-approved entitlement, a provisioning profile, or a special App ID capability. This is the payoff of avoiding DriverKit: the whole capture stack is TCC-gated at runtime, not entitlement-gated at signing time, so the notarization story is the boring default one.

One caveat worth designing around: **TCC grants are keyed to signing identity + bundle ID.** Re-signing with a different identity, or changing the bundle ID, resets the user's grants. Apple's guidance for resetting during development is [Resetting access to protected resources in macOS](https://developer.apple.com/documentation/bundleresources/protected-resources) (`tccutil`). Pick the bundle ID once and don't churn it.

### Q5 — Rust / Tauri surface, and is a Swift/ObjC helper unavoidable?

**No, a Swift or Objective-C helper is not unavoidable.** Everything needed is reachable from Rust today:

- The tap API is **C functions taking one ObjC object**. `AudioHardwareCreateProcessTap`, `AudioHardwareCreateAggregateDevice`, `AudioObjectGetPropertyData`/`SetPropertyData` are plain C. The only ObjC class is `CATapDescription`, which is a property bag — no protocols to implement, no delegates, no subclassing. This is the easiest possible ObjC-from-Rust case.
- The mic path via `AVCaptureSession` requires implementing `AVCaptureAudioDataOutputSampleBufferDelegate`, which `objc2`'s `define_class!` handles ([doc](https://docs.rs/objc2/latest/objc2/macro.define_class.html)).
- Had we chosen ScreenCaptureKit, we'd need to implement the `SCStreamOutput` / `SCStreamDelegate` protocols from Rust — also supported by `define_class!`, but strictly more ObjC surface. Another point for the taps path.

**Crate assessment (verified against crates.io API and docs.rs, 2026-07-19):**

| Crate | Version | Published | Verdict |
|---|---|---|---|
| **`objc2`** | 0.6.4 | 2026-02-26 | ✅ Foundation. [crates.io](https://crates.io/crates/objc2) |
| **`objc2-core-audio`** | 0.3.2 | 2025-10-04 | ✅ **The key crate.** Binds [`AudioHardwareCreateProcessTap`](https://docs.rs/objc2-core-audio/latest/objc2_core_audio/fn.AudioHardwareCreateProcessTap.html), [`AudioHardwareCreateAggregateDevice`](https://docs.rs/objc2-core-audio/latest/objc2_core_audio/fn.AudioHardwareCreateAggregateDevice.html), [`kAudioHardwarePropertyProcessObjectList`](https://docs.rs/objc2-core-audio/latest/objc2_core_audio/constant.kAudioHardwarePropertyProcessObjectList.html), and **`CATapDescription` lives here** ([doc](https://docs.rs/objc2-core-audio/latest/objc2_core_audio/struct.CATapDescription.html)) with all init variants + `UUID`/`processes`/`isMono`/`isExclusive`/`isMixdown`/`isPrivate`/`deviceUID`/`stream`. Feature-gate `AudioHardware` + `objc2`. |
| **`objc2-av-foundation`** | 0.3.2 | 2025-10-04 | ✅ `AVCaptureSession`, `AVCaptureDevice`, `AVCaptureDeviceInput`, `AVCaptureAudioDataOutput` ([docs.rs](https://docs.rs/objc2-av-foundation/latest/objc2_av_foundation/)) |
| **`objc2-core-media`** | 0.3.2 | 2025-10-04 | ✅ `CMSampleBuffer` handling |
| **`objc2-screen-capture-kit`** | 0.3.2 | 2025-10-04 | ✅ Complete if we ever need SCK: `SCStream`, `SCStreamConfiguration` (incl. `captureMicrophone`, `microphoneCaptureDeviceID`, `capturesAudio`, `sampleRate`, `channelCount`), `SCContentSharingPicker`, `SCShareableContent`; `SCStreamOutput` is an implementable protocol trait ([docs.rs](https://docs.rs/objc2-screen-capture-kit/latest/objc2_screen_capture_kit/trait.SCStreamOutput.html)) |
| `objc2-avf-audio` | 0.3.2 | 2025-10-04 | Note: crate is `objc2-avf-audio`, **not** `objc2-av-f-audio` (doesn't exist) |
| **`screencapturekit`** | 8.0.1 | 2026-07-18 | ⚠️ Most ergonomic SCK wrapper, very actively maintained — but **3 major versions in 2 months** (7.0.0 06-02 → 8.0.0 06-19 → 8.0.1 07-18), **no tap support**, and it does **not** depend on `objc2` (uses its own `apple-cf`/`apple-metal`). Mixing it with `objc2-core-audio` means two disjoint binding stacks. [crates.io](https://crates.io/crates/screencapturekit) |
| **`cidre`** | 0.16.1 | 2026-07-10 | ⚠️ The only other crate covering **both** SCK and taps in one place (`core_audio/hardware_tapping.rs`, `core_audio/tap_description.rs` — [source](https://github.com/yury/cidre/tree/main/cidre/src/core_audio)). Active, MIT. But its README self-describes as *"a personal research project"* with no stability guarantee. Not a dependency I'd want under a shipping recorder. |
| **`cpal`** | 0.18.1 | 2026-06-07 | ⚠️ Interesting: **0.18.0 added macOS loopback** — *"CoreAudio: Support for loopback recording (recording system audio output) on macOS > 14.6"* ([CHANGELOG](https://github.com/RustAudio/cpal/blob/master/CHANGELOG.md)), i.e. it now uses taps + aggregate devices internally. But it's **whole-system loopback only** — no public per-process API. Insufficient for our multi-track requirement. |
| `coreaudio-rs` | 0.14.2 | 2026-04-29 | ❌ Exposes only `audio_unit` + `error`. No hardware/device enumeration, no taps. |
| `coreaudio-sys` | 0.2.18 | 2026-06-04 | ❌ C-only bindgen — **cannot express `CATapDescription`** (an ObjC class). docs.rs build failed for 0.2.18. |
| `flexaudio-os-macos` 0.2.0, `corti-coreaudio` 0.5.1 | 2026-07 / 2026-06 | ⚠️ New third-party crates explicitly advertising process-tap capture. Young, single-vendor, API surface unverified. Worth watching, not adopting. |
| `rust-media/apple-media-rs` family (`screen-capture-kit` 0.7.1, `core-audio` 0.1.0) | 2026-06 | ⚠️ A second binding family, *more recently released* than the objc2 framework crates. `core-audio` at 0.1.0 — coverage unverified. |

**Recommendation: the `objc2` family.** One coherent type system across Core Audio, AVFoundation, Core Media, and AppKit (for icons). Watch item: the framework crates have been frozen at 0.3.2 since 2025-10-04 (~9 months) while core `objc2` shipped 0.6.4 in Feb 2026 — not alarming for stable Apple APIs, but if a macOS 27 symbol is needed later there may be a lag.

**Availability gating in objc2:** Cargo features are **per C header file**, not per class or per OS version ([doc](https://docs.rs/objc2/latest/objc2/topics/about_generated/cargo_features/index.html)). There is no compile-time macOS-version scheme. For `@available`-style checks objc2 provides a **runtime** macro, `available!(macos = 14.2)` ([doc](https://docs.rs/objc2/latest/objc2/macro.available.html)). Since we target macOS 26+ unconditionally, this mostly doesn't bite — but use `available!` if you ever want to soft-gate the macOS 26 `bundleIDs` path against a 15.x fallback.

**Tauri integration shape:** run capture on a dedicated non-Tokio thread (Core Audio IOProcs are real-time — no allocation, no locks, no logging in the callback), ring-buffer out to an encoder thread, and expose start/stop/enumerate to the webview as Tauri commands. Emit level meters to the UI as throttled events, not per-buffer.

---

## API-possible but practically painful

1. **The tap permission prompt is unpreflightable.** No `requestAccess` equivalent, no `authorizationStatus`. You cannot show a permissions checklist that says "System Audio: not yet granted". You learn the answer by starting IO. Budget UX time for a "run a 2-second test capture" onboarding step.
2. **Aggregate device lifecycle is your problem.** Each tap needs an aggregate device; if you crash, orphaned aggregate devices can linger in the HAL and pollute the user's Audio MIDI Setup. `cpal` 0.18 shipped fixes for exactly this ("Fix loopback aggregate device UID collisions between concurrent instances **and after crashes**"). Use `kAudioAggregateDeviceIsPrivateKey` / `CATapDescription.isPrivate` and implement aggressive cleanup on launch.
3. **N taps = N aggregate devices = N IOProcs = N clock domains.** Each aggregate device has its own clock; separate tracks will drift relative to each other and to the mic. You need a common timebase (host time from the sample buffers) and per-track resampling or timestamp-based alignment at write time. This is the single largest piece of real engineering in the whole project. `kAudioSubTapDriftCompensationKey` exists for drift *within* an aggregate device but does not solve cross-device alignment.
4. **You cannot request a tap format.** Read-only. If the user's output device is at 48 kHz and the mic at 44.1 kHz, you resample. Contrast SCK where `sampleRate`/`channelCount` are settable — a genuine SCK advantage you're trading away.
5. **Process metadata is bare.** No app name, no icon from Core Audio; you resolve those through AppKit yourself (§Q3).
6. **Documentation is thin and its version metadata is actively wrong** (§2). There is no WWDC session on taps. Apple's sample project is essentially the entire corpus. Expect to read headers.
7. **SCK's Screen Recording prompt requires an app restart** before capture works (Apple's own sample says so) — a rough first-run experience, avoided entirely by not using SCK.
8. **Screen Recording TCC may re-prompt periodically** (unconfirmed for 26, §Q2). For a recorder that users leave running, a surprise mid-session dialog would be bad. Another reason to stay off SCK.

---

## Unconfirmed / open questions

1. **Whether multiple concurrent `SCStream` instances are supported in one process.** Necessary if you ever want N per-app audio tracks via SCK. Apple documents neither support nor prohibition. *(Not blocking — the recommendation avoids SCK.)*
2. **State of the macOS 15 periodic screen-recording re-consent in macOS 26.** Never documented by Apple in the first place; absent from macOS 15 release notes, macOS 26 release notes, and the current Apple Support privacy guide. Only evidence is Apple Developer Forums *user* posts from the Sequoia beta ([760112](https://developer.apple.com/forums/thread/760112), [760483](https://developer.apple.com/forums/thread/760483)). **Not confirmed either way.**
3. **Whether Core Audio process taps work inside the App Sandbox**, and whether `com.apple.security.device.audio-input` is required/sufficient. No Apple page connects any sandbox entitlement to taps. *(Mitigated: we don't sandbox for Developer ID.)*
4. **Tap latency characteristics.** No Apple documentation of any kind — no latency property, no discussion text, no session. Anything found on the web is blog-tier. Needs empirical measurement.
5. **Availability versions for every `kAudio*` C constant** in the tap/aggregate/process-object API. Apple's C-constant DocC pages carry a platform list with **no `introducedAt` field at all**. 14.2 is inferred by association with the functions, not confirmed.
6. **`CATapDescription`'s true availability floor.** Docs say macOS 12.0 / iOS 15.0, which is impossible. 14.2 is taken from the sample article's prose and the C functions. Confirmed-by-inference, not by badge.
7. **Whether `SCStreamConfiguration.capturesAudio` with an app-scoped `SCContentFilter` actually yields only that app's audio.** Apple's abstract says only "whether to capture audio". Never documented.
8. **Whether the macOS 26 `bundleIDs` and `processes` properties can be combined** on one `CATapDescription`, and precedence if both are set. Both property pages have empty discussion text.
9. **Whether `coreaudio-sys` 0.2.18 transitively emits `AudioHardwareCreateProcessTap`** via `CoreAudio.h`. Plausible (no bindgen allowlist) but the docs.rs build failure blocked verification. *(Moot — it can't express `CATapDescription` regardless.)*
10. **API coverage of `flexaudio-os-macos`, `corti-coreaudio`, and `rust-media`'s `core-audio` 0.1.0.** Existence and self-description verified; surface not audited.
11. **`AVCaptureSession` multi-audio-input behaviour on macOS**, and whether multiple concurrent `AVCaptureSession`s are supported. Undocumented; `AVCaptureMultiCamSession` being iOS-only is suggestive but not dispositive.

---

## Sources

**ScreenCaptureKit**
- https://developer.apple.com/documentation/screencapturekit
- https://developer.apple.com/documentation/updates/screencapturekit
- https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration (+ `/capturesaudio`, `/samplerate`, `/channelcount`, `/excludescurrentprocessaudio`, `/capturemicrophone`, `/microphonecapturedeviceid`, `/preset`)
- https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype (+ `/audio`, `/microphone`, `/screen`)
- https://developer.apple.com/documentation/screencapturekit/scshareablecontent
- https://developer.apple.com/documentation/screencapturekit/scrunningapplication (+ `/applicationname`, `/bundleidentifier`, `/processid`)
- https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker
- https://developer.apple.com/documentation/screencapturekit/screcordingoutput
- https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration
- https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos
- https://developer.apple.com/videos/play/wwdc2024/10088/ — "Capture HDR content with ScreenCaptureKit"

**Core Audio taps**
- https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps — Apple sample project, the primary source for this API
- https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)
- https://developer.apple.com/documentation/coreaudio/audiohardwaredestroyprocesstap(_:)
- https://developer.apple.com/documentation/coreaudio/catapdescription (+ `/bundleids`, `/isprocessrestoreenabled`)
- https://developer.apple.com/documentation/coreaudio/catapmutebehavior
- https://developer.apple.com/documentation/coreaudio/audiohardwaretap
- https://developer.apple.com/documentation/coreaudio/audiohardwareprocess
- https://developer.apple.com/documentation/coreaudio/audiohardwareaggregatedevice
- https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertyprocessobjectlist
- https://developer.apple.com/documentation/coreaudio/kaudioaggregatedevicetaplistkey
- https://developer.apple.com/documentation/coreaudio/kaudiosubtapuidkey
- https://developer.apple.com/documentation/coreaudio/kaudiotappropertyformat

**AVFoundation**
- https://developer.apple.com/documentation/avfoundation/avcapturesession
- https://developer.apple.com/documentation/avfoundation/avcapturedevice/discoverysession
- https://developer.apple.com/documentation/avfoundation/avcapturemulticamsession
- https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess(for:completionhandler:)

**Permissions / signing**
- https://developer.apple.com/documentation/bundleresources/protected-resources
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.app-sandbox
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.persistent-content-capture
- https://developer.apple.com/documentation/security/hardened-runtime
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess()
- https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac
- https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes
- https://developer.apple.com/documentation/macos-release-notes/macos-26-release-notes

**Virtual drivers**
- https://developer.apple.com/documentation/audiodriverkit/creating-an-audio-device-driver
- https://developer.apple.com/documentation/driverkit/requesting-entitlements-for-driverkit-development

**Rust crates**
- https://crates.io/crates/objc2 · https://docs.rs/objc2/latest/objc2/macro.define_class.html · https://docs.rs/objc2/latest/objc2/macro.available.html · https://docs.rs/objc2/latest/objc2/topics/about_generated/cargo_features/index.html
- https://docs.rs/objc2-core-audio/latest/objc2_core_audio/ (fn `AudioHardwareCreateProcessTap`, fn `AudioHardwareCreateAggregateDevice`, struct `CATapDescription`, const `kAudioHardwarePropertyProcessObjectList`)
- https://docs.rs/objc2-screen-capture-kit/latest/objc2_screen_capture_kit/
- https://docs.rs/objc2-av-foundation/latest/objc2_av_foundation/
- https://crates.io/crates/screencapturekit · https://github.com/doom-fish/screencapturekit-rs
- https://crates.io/crates/cidre · https://github.com/yury/cidre/tree/main/cidre/src/core_audio
- https://crates.io/crates/cpal · https://github.com/RustAudio/cpal/blob/master/CHANGELOG.md
- https://docs.rs/coreaudio-rs/latest/coreaudio/ · https://crates.io/crates/coreaudio-sys
- https://github.com/rust-media/apple-media-rs

**Secondary sources (flagged as such, not relied on for version facts)**
- https://developer.apple.com/forums/thread/760112 — Sequoia beta screen-recording re-prompt reports (user posts)
- https://developer.apple.com/forums/thread/760483 — screen recording TCC overview thread (user posts)
