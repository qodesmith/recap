# Decoding imported audio/video to PCM

**Question:** How should Recap decode user-imported audio and video files into raw PCM (16 kHz mono, Whisper-style) for the ASR model — ffmpeg sidecar, AVFoundation, or Rust-native (symphonia)?

**Researched:** 2026-07-19 - **Target:** macOS 26+, Apple Silicon only, Tauri v2 + Rust
**Issue:** #4

> Much of this document is backed by **measurements taken on this machine** (macOS 26.5.2, build 25F84, arm64) rather than by documentation alone. Measured results are marked **[MEASURED]**. A minimal FFmpeg 8.0 was actually built and a 21-file test corpus was actually decoded through both FFmpeg and AVFoundation. Symphonia could **not** be tested — no Rust toolchain is installed on this machine — so all Symphonia claims are documentation-based and marked accordingly.

---

## Recommendation

**Ship a minimal, decode-only, LGPL FFmpeg binary as a Tauri sidecar. Use it as the single decode path.**

**The deciding tradeoff:** AVFoundation is free (zero bytes, zero licensing, and measurably *faster* — 2.2 s vs 3.5 s to decode a 2-hour AAC file **[MEASURED]**), but it **cannot open Matroska, WebM, or WMA at all**. Those files don't degrade, they hard-fail with `Cannot Open` **[MEASURED]**. OBS records to `.mkv` by default and browser `MediaRecorder` produces `.webm`, so this is a real slice of "conversation recordings," not an exotic tail. The cost of closing that gap with FFmpeg is **2.14 MiB uncompressed / 0.85 MiB in an xz-compressed DMG [MEASURED]** plus an LGPL source-offer page. That is a small, bounded, one-time cost to buy total format coverage and a single code path.

**Why not the hybrid (AVFoundation primary + FFmpeg fallback)?** It's tempting and it is a legitimate *later* optimization, but it should not be the starting point. You would still ship the FFmpeg binary (so you pay the full size and licensing cost anyway), you would still do the LGPL compliance work, and in exchange you'd maintain **two** decoders, two progress-reporting implementations, and two resampling paths that must produce bit-comparable PCM or your transcripts will differ depending on input format. The hybrid only pays off if decode latency becomes a user-visible bottleneck — and at 3.5 s for a 2-hour file **[MEASURED]**, it is not. Revisit only if that changes.

**Why not symphonia?** It is disqualified on capability, not on principle. **Symphonia has no Opus decoder** — the README lists Opus status as `-`, meaning "in work or not started yet," despite the feature being on by default. It also cannot resample (you'd add `rubato`), has no WMA or AMR support at all, and its MP4/AAC/ALAC/MP3 support is all behind non-default patent-gated flags — so you end up enabling the encumbered codecs anyway, forfeiting the royalty-free posture that is its main selling point. Opus alone is fatal: `.opus`/`.ogg` is a common recording format, and (see below) it is one that macOS handles natively for free.

---

## Option 1 — FFmpeg as a Tauri sidecar (recommended)

### Format coverage — **[MEASURED]** 21/21

A minimal FFmpeg 8.0 was configured, built, and run against the full corpus. Every file decoded to 16 kHz mono `s16le` with exit code 0:

```
3gp ok  aac ok  aiff ok  caf ok  flac ok  m4a/aac ok  m4a/alac ok  mkv ok
mp3 ok  oga ok  opus ok  wav ok  webm ok  wma ok  mov ok  mp4 ok  ogg/vorbis ok
mp4 w/ 2 audio tracks ok  file with NO extension ok
```

Two notes from the measurements:

- Opus-in-Matroska emits a benign `Error parsing Opus packet header.` line on stderr but decodes correctly (`0 decode errors`, full 96000 bytes written, exit 0) **[MEASURED]**. **Do not treat non-empty stderr as failure** — check the exit code. This exact mistake produced a false "mkv/webm unsupported" result during this research.
- FFmpeg content-sniffs, so a file with no extension decodes fine **[MEASURED]**. AVFoundation does not (see below).

### Bundle size — **[MEASURED]** 2.14 MiB

Configure line used (FFmpeg 8.0, `--disable-postproc` was removed in 8.0 and must be dropped):

```
--disable-everything --disable-autodetect --disable-doc --disable-network
--disable-debug --enable-small --disable-avdevice --disable-swscale
--disable-programs --enable-ffmpeg
--disable-gpl --disable-nonfree --disable-version3
--enable-decoder=aac,aac_latm,aac_fixed,mp3,mp3float,mp2,mp1,flac,alac,opus,
  vorbis,wmav1,wmav2,amrnb,amrwb,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,
  pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,pcm_alaw,pcm_mulaw,adpcm_ima_qt,
  adpcm_ms,ac3,eac3
--enable-demuxer=mov,mp3,wav,aiff,flac,ogg,matroska,aac,caf,amr,asf,w64,
  mpegts,avi,mpegps,ac3,eac3,webm_dash_manifest
--enable-parser=mpegaudio,aac,flac,opus,vorbis,ac3
--enable-protocol=file,pipe
--enable-filter=aresample,aformat,anull,amix,aselect,atrim,format
--enable-muxer=wav,pcm_s16le,pcm_f32le --enable-encoder=pcm_s16le,pcm_f32le
--enable-swresample --arch=arm64 --enable-neon
```

| | Size |
|---|---|
| Raw binary (stripped) | **2.14 MiB** (2,244,952 bytes) |
| gzip -9 | 1.08 MiB |
| xz -9 (≈ DMG compression) | **0.85 MiB** |
| Homebrew's full GPL build, dylibs only, for contrast | ~16 MiB |

The binary is **fully self-contained** — `otool -L` shows it links only `libSystem`, `CoreFoundation`, `CoreVideo`, `CoreMedia` **[MEASURED]**. No dylibs to bundle, no `@rpath` fixups.

`configure` reports `License: LGPL version 2.1 or later` **[MEASURED]** — see the licensing section for why this matters and why it costs you nothing.

### Multi-track and resampling

- **Resampling:** built in via `swresample`. `-ar 16000 -ac 1` does sample-rate conversion and downmix in one pass. Verified across all 21 files **[MEASURED]**. Quality is tunable (`-af aresample=resampler=soxr` for a higher-quality path if you enable soxr, though soxr was *not* enabled in the build above and is not needed — the default resampler is fine for 16 kHz ASR input).
- **Multi-track:** by default FFmpeg picks one "best" audio stream. To mix all audio tracks, use `-filter_complex "[0:a:0][0:a:1]amix=inputs=2[a]" -map "[a]"` — verified working on a 2-track MP4 **[MEASURED]**. The `amix` filter must be explicitly enabled in the build (it is, above). You'll need to probe stream count first to build the filter string.

### Progress reporting — **[MEASURED]**

`-progress pipe:1` writes machine-readable key/value blocks to stdout:

```
bitrate= 256.0kbits/s
total_size=3840024
out_time_us=120000750
out_time_ms=120000750
out_time=00:02:00.000750
progress=continue        # or "end" on the final block
```

Progress % = `out_time_us / total_duration_us`. You need duration up front — get it from a fast `ffprobe`-style pass or from the `Duration:` line FFmpeg prints on stderr at startup.

**Granularity caveat [MEASURED]:** decoding a 2-hour AAC file took 3.5 s wall and emitted only **8** progress blocks (default `-stats_period` is 0.5 s of *wall* time, not media time), i.e. ~12.5% jumps. Adding **`-stats_period 0.1`** raises that to **34 blocks** **[MEASURED]** — do this. Even so, progress on short files will be chunky simply because decoding is so fast; consider not showing a decode progress bar for files under ~10 minutes.

### Tauri v2 integration

Verified against v2.tauri.app on 2026-07-19. Current crates: **`tauri` 2.11.5** (2026-07-01), **`tauri-plugin-shell` 2.3.5** (2026-02-03) — Tauri v2 is still current, there is no v3.

`src-tauri/tauri.conf.json`:
```json
{ "bundle": { "externalBin": ["binaries/ffmpeg"] } }
```

The file on disk must be named with the target-triple suffix — for this project, **`binaries/ffmpeg-aarch64-apple-darwin`**. Get the triple with `rustc --print host-tuple`.

`src-tauri/capabilities/default.json`:
```json
{ "permissions": ["core:default",
  { "identifier": "shell:allow-execute",
    "allow": [{ "name": "binaries/ffmpeg", "sidecar": true }] }] }
```

Rust side — note this is the **v2** API (`app.shell().sidecar()`), not v1's `Command::new_sidecar`:
```rust
use tauri_plugin_shell::{ShellExt, process::CommandEvent};

let cmd = app.shell().sidecar("ffmpeg")?;
let (mut rx, mut _child) = cmd.args([...]).spawn()?;
tauri::async_runtime::spawn(async move {
  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => { /* parse -progress k=v lines */ }
      CommandEvent::Stderr(bytes) => { /* log only — see benign-warning note */ }
      _ => {}
    }
  }
});
```

`sidecar()` takes the bare filename, not the `externalBin` path, and Tauri resolves the triple suffix for you.

### Notarization / hardened runtime

Apple's requirements ([notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), accessed 2026-07-19) that bite here:

- **"Enable code-signing for all of the executables you distribute."** The nested `ffmpeg` binary must be signed with your **Developer ID Application** certificate, **before** you sign the outer `.app` (inside-out order). Tauri's bundler signs `externalBin` contents, but verify with `codesign -vvv --deep --strict Recap.app`.
- **Hardened runtime is required** on executables — including command-line targets. Apply `--options=runtime` to the sidecar too. (Apple: hardened runtime opt-in is needed for *executables*, not for dylibs/frameworks — the sidecar is an executable.)
- **Secure timestamp required** (`--timestamp`); needs network access at signing time to `timestamp.apple.com`.
- Do **not** ship `com.apple.security.get-task-allow`.

**Entitlements:** the minimal build needs none beyond the defaults — it does no JIT and loads no plugins. If a future build dynamically loads codec plugins you'd need `com.apple.security.cs.disable-library-validation`; the static build above avoids that entirely. This is a real argument for keeping the build static and minimal.

---

## Option 2 — AVFoundation

### Format coverage — **[MEASURED]** 17/21, with 3 hard failures

Tested via `AVURLAsset` → `AVAssetReader` → `AVAssetReaderTrackOutput` with output settings `kAudioFormatLinearPCM / 16000 Hz / 1 ch / Float32`:

| Result | Formats |
|---|---|
| Decoded | 3gp, aac(ADTS), aiff, caf, flac, m4a (AAC **and** ALAC), mp3, mov, mp4, wav, **ogg (Vorbis)**, **oga/opus (Opus)** |
| Failed (`Cannot Open`) | **mkv**, **webm**, **wma** |
| Gotcha | file with **no extension** → `Cannot Open` |

**Surprise finding — Ogg/Opus/Vorbis is native on macOS 26.** This contradicts the widespread belief that Apple doesn't handle Ogg. Confirmed three independent ways:
1. `AVAssetReader` fully decoded `.opus`, `.oga`, and `.ogg`(Vorbis) files **[MEASURED]**.
2. `afconvert -hf` — a pure AudioToolbox tool — lists `'Oggf' = Ogg (.opus, .ogg, .oga)` with `data_formats: 'opus' 'flac' 'vorb'` **[MEASURED]**.
3. `afinfo` reports `File type ID: Oggf` for both files, and `/Library/Audio/Plug-Ins/Components` is **empty**, so no third-party codec is responsible **[MEASURED]**.

**Caveat on `AVURLAsset.audiovisualTypes()`:** it returned 103 UTIs on this machine, but several are `io.iina.*` — declared by the installed **IINA.app**, not by macOS. **This API reflects UTIs registered by installed apps and is not a reliable portability oracle.** Do not use it to decide what your app supports; the empirical decode test above is the trustworthy signal. (macOS also supports third-party **Media Extensions**, which can add formats on a user's machine but not on a clean one — so coverage can legitimately vary per machine.)

**The no-extension gotcha is fixable [MEASURED]:** passing `AVURLAssetOutOfBandMIMETypeKey: "audio/mp4"` in the `AVURLAsset` options dictionary made the extensionless file open and decode correctly. If you go this route you'd need your own content-sniffing to guess the MIME type — which is work FFmpeg does for you.

### Bundle size and licensing

**Zero and zero.** First-party system framework, no bundled bytes, no license obligations, no attribution, no source offer. This is AVFoundation's strongest card by a wide margin.

### Multi-track and resampling — **[MEASURED]** both excellent

- **Resampling:** done by the framework as part of `AVAssetReaderTrackOutput`'s `outputSettings` — you declare 16 kHz mono Float32 and sample buffers arrive already converted. No separate resampler, no `rubato`. Verified: a 48 kHz stereo source produced exactly 47,994 frames ≈ 3.00 s at 16 kHz **[MEASURED]**. (`AVAudioConverter` / `AudioConverter` are the lower-level equivalents if you need standalone conversion.)
- **Multi-track:** `AVAssetReaderAudioMixOutput(audioTracks:audioSettings:)` mixes N audio tracks into one stream. Verified on a 2-audio-track MP4 and a 2-audio-track MOV — both mixed to a single 16 kHz mono stream **[MEASURED]**. This is cleaner than FFmpeg's `amix` filter-string construction.

### Progress reporting — **[MEASURED]** best of the three

Pull-based loop: `copyNextSampleBuffer()` until it returns `nil`, then check `reader.status == .completed`. Duration is known up front from `asset.load(.duration)`, and each buffer carries a presentation timestamp, so:

```
progress = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb)) / durationSeconds
```

**Granularity is excellent:** a 2-hour file produced **14,066 sample buffers** **[MEASURED]** — roughly one progress tick per 0.5 s of media. Far finer than FFmpeg's wall-clock-driven blocks. Progress is *near*-monotonic; on multi-track mixed output it occasionally repeats a value (observed `31, 31, 32, 33`), so clamp with `max(previous, current)`.

### Performance — **[MEASURED]** fastest

2-hour AAC → 16 kHz mono: **2.2 s wall** (vs FFmpeg's 3.5 s). Uses fewer cores too (131% CPU vs 301%), likely hitting the hardware AAC decoder.

### Rust integration — the real cost

Binding crates (checked on crates.io, 2026-07-19):

| Crate | Version | Released | Notes |
|---|---|---|---|
| `objc2` | 0.6.4 | 2026-02-26 | core runtime, very active (repo commits 2026-07-14) |
| `objc2-av-foundation` | 0.3.2 | 2025-10-04 | **exposes `AVAssetReader`, `AVAssetReaderTrackOutput`, `AVAssetReaderAudioMixOutput`** — verified in docs.rs index |
| `objc2-core-media` | 0.3.2 | 2025-10-04 | `CMSampleBuffer`, `CMBlockBuffer`, `CMTime` all present |
| `objc2-avf-audio` | 0.3.2 | 2025-10-04 | `AVAudioConverter` etc. |
| `cidre` | 0.16.1 | 2026-07-10 | alternative bindings, active, but far smaller user base (170k vs 821k downloads) |

Licensing on all objc2 crates: `Zlib OR Apache-2.0 OR MIT` — permissive, no obligations.

**Honest assessment of the FFI burden:** this is the option's real cost. The framework crates were last published **October 2025** — the parent `objc2` repo is actively maintained (commits within the last week), but the framework wrappers are cut in batches and lag. More importantly, the work itself is genuinely fiddly: you must drive an Objective-C object graph from Rust, then for every sample buffer call `CMSampleBufferGetDataBuffer` → `CMBlockBufferGetDataPointer`/`CMBlockBufferCopyDataBytes` and copy raw bytes out, managing CoreFoundation retain/release correctly across a hot loop that runs 14,000+ times for a 2-hour file. All of it `unsafe`. Realistically ~200–300 lines of unsafe FFI that must be leak-free and panic-free. Compare with the sidecar: spawn a process, parse `key=value` lines off stdout. That asymmetry is a large part of why the recommendation goes to FFmpeg.

---

## Option 3 — symphonia (Rust-native) (not viable)

> **Not empirically verified.** No Rust toolchain (`cargo`/`rustc`/`rustup`) is installed on this machine, so unlike the other two options, none of this was tested. Claims are from the repo README and docs.rs, accessed 2026-07-19.

### Maintenance status — healthy

Actively maintained, contrary to its reputation for quiet periods. **v0.6.0 released 2026-05-15** (crates.io), after a long gap following 0.5.4 (Feb 2024) and 0.5.5 (Oct 2025). Repo commits as recent as **2026-07-17**. 8.5M lifetime downloads. Note 0.6 is a **breaking API change** from 0.5.

### Format coverage — the disqualifier

From the README's own tables. Status `-` means "In work or not started yet."

**Demuxers:** AIFF `Great`(non-default), CAF `Good`(non-default), ISO/MP4 `Great`(**non-default**), MKV/WebM `Good`(default), OGG `Great`(default), Wave `Excellent`(default).

**Decoders:** AAC-LC `Great`(**non-default**), ADPCM `Good`, ALAC `Great`(**non-default**), HE-AAC `-`, FLAC `Excellent`, MP1/MP2/MP3 `Great`/`Excellent`(**all non-default**), **Opus `-`**, PCM `Excellent`, Vorbis `Excellent`, **WavPack `-`**.

The blockers:
1. **No Opus decoder.** Status `-`. The `opus` feature defaults to *on*, which is misleading — the decoder isn't implemented. `.opus`/`.ogg` conversation recordings would fail. Meanwhile macOS decodes Opus natively for free.
2. **No WMA, no AMR, no AC-3** — not in the matrix at all.
3. **No video-container support beyond MP4/MKV demuxing** — no MOV-specific quirks handling, no MPEG-TS, no AVI.
4. **Cannot resample.** Nothing in the README or docs.rs mentions resampling. You must add `rubato` (v4.0.0, 2026-07-09, MIT OR Apache-2.0, actively maintained, aarch64 NEON SIMD, supports arbitrary ratios incl. 48k→16k) and write the glue yourself, including the channel-downmix, which rubato does not do either.

### Licensing — MPL 2.0

Symphonia is **MPL 2.0**. Per Mozilla's official FAQ, MPL 2.0 is **file-level copyleft**: obligations attach only to files containing MPL code. New files with no MPL code are not "Modifications." So linking symphonia into a proprietary Rust binary is fine; if you distribute unmodified builds you need only inform recipients where the source is available and preserve notices. **This is the lightest licensing burden of any third-party option** — genuinely less onerous than LGPL. It just doesn't matter, because the crate can't do the job.

The non-default gating is explicitly a patent decision. README: *"By default, Symphonia only enables support royalty-free open standard codecs and formats, but others may be enabled using feature flags."* The catch: for a real-world conversation-recording app you must enable `aac`, `isomp4`, `mp3`, and `alac` — i.e. exactly the patent-encumbered set — so you inherit the same MPEG-LA exposure as FFmpeg while getting worse coverage. The royalty-free posture is illusory for this use case.

### Progress reporting

Workable. `FormatReader::next_packet() -> Result<Option<Packet>>` (verified signature, docs.rs, 0.6 API) with `Packet::ts()` timestamps, and `Track::num_frames` + `time_base` give total duration. **But duration is not guaranteed known up front for all containers** — `num_frames` is `Option`, and streamed/truncated Ogg and MKV files commonly lack it, in which case you'd have to fall back to a byte-offset-based progress estimate. Granularity would be per-packet, i.e. fine.

---

## Format coverage comparison

Legend: **Yes** = works - **No** = fails - **Partial** = conditional. Measured unless noted.

| Format | FFmpeg (minimal LGPL build) | AVFoundation (macOS 26.5.2) | symphonia *(unverified — docs only)* |
|---|---|---|---|
| **wav** (PCM) | Yes | Yes | Yes - default |
| **mp3** | Yes | Yes | Partial - non-default (`mp3`) |
| **m4a** (AAC) | Yes | Yes | Partial - non-default (`aac`+`isomp4`) |
| **m4a** (ALAC) | Yes | Yes | Partial - non-default (`alac`+`isomp4`) |
| **aac** (ADTS) | Yes | Yes | Partial - non-default, ADTS demux unclear |
| **mp4** (video) | Yes | Yes | Partial - non-default `isomp4` |
| **mov** | Yes | Yes | No - not listed |
| **flac** | Yes | Yes | Yes - default |
| **ogg** (Vorbis) | Yes | Yes - **native** | Yes - default |
| **opus / oga** | Yes | Yes - **native** | No - **decoder not implemented** |
| **caf** | Yes | Yes | Partial - non-default (`caf`) |
| **aiff** | Yes | Yes | Partial - non-default (`aiff`) |
| **3gp** | Yes | Yes | No |
| **amr** | Yes - native LGPL decoder | Partial - UTI present, untested† | No |
| **mkv** | Yes | No - **Cannot Open** | Partial - demuxer default, but codec support is the limit |
| **webm** | Yes | No - **Cannot Open** | Partial - same — Opus-in-WebM unusable |
| **wma** | Yes | No - **Cannot Open** | No |
| **no file extension** | Yes | No - unless `OutOfBandMIMEType` set | Partial - probe hint is optional |
| **multi-track mixing** | Yes - `amix` filter | Yes - `AVAssetReaderAudioMixOutput` | No - manual |
| **resampling to 16 kHz** | Yes - `swresample` | Yes - built into output settings | No - needs `rubato` |
| **Totals (corpus of 21)** | **21/21** | **17/21** | not testable here |

† `org.3gpp.adaptive-multi-rate-audio` is in `audiovisualTypes()` and `afconvert` lists an `amrf` file format, but no AMR encoder was available locally to generate a test file, so AVFoundation AMR decoding is **unverified**.

---

## Licensing

### FFmpeg: the GPL / LGPL split

FFmpeg is **LGPL v2.1-or-later by default**; some optional parts are **GPL v2-or-later**, and per [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html): *"If those parts get used the GPL applies to all of FFmpeg."*

Three flags change the license:

| Flag | Effect | Pulls in |
|---|---|---|
| `--enable-gpl` | whole build becomes **GPL v2+** | avisynth, frei0r, libcdio, libdavs2, libdvdnav, libdvdread, librubberband, libvidstab, **libx264**, **libx265**, libxavs, libxavs2, libxvid |
| `--enable-version3` | upgrades to **LGPL v3 / GPL v3** | gmp, libaribb24, liblensfun, **libopencore_amrnb**, **libopencore_amrwb**, libvo_amrwbenc, mbedtls, rkmpp *(+ libsmbclient → GPLv3)* |
| `--enable-nonfree` | **non-redistributable** | **libfdk_aac**, decklink, libtls, cuda_nvcc, cuda_sdk, libnpp |

*(Lists extracted verbatim from `EXTERNAL_LIBRARY_GPL_LIST`, `EXTERNAL_LIBRARY_VERSION3_LIST`, `EXTERNAL_LIBRARY_GPLV3_LIST`, `EXTERNAL_LIBRARY_NONFREE_LIST`, `HWACCEL_LIBRARY_NONFREE_LIST` in FFmpeg 8.0's `configure` **[MEASURED]**.)*

**What does an LGPL-only build lose for *decoding*? Nothing.** This is the key finding and it is verifiable directly from the source:

- Every GPL-gated external library is an **encoder** (x264, x265, xvid, xavs) or a **video filter/input** (frei0r, vidstab, dvdread, avisynth). None decodes audio.
- Grepping `configure` for internal components requiring `gpl` yields **33 hits, all of them video filters** (`blackframe`, `boxblur`, `cropdetect`, `delogo`, `hqdn3d`, `spp`, `pullup`, …). **[MEASURED]**
- Grepping specifically for `*_decoder_deps=...gpl` / `*_decoder_select=...gpl` returns **zero results** — **no decoder of any kind, audio or video, requires GPL.** **[MEASURED]**
- AMR is the one case worth flagging: `libopencore_amrnb/wb` are `version3`-gated, but FFmpeg's **native** `amrnb`/`amrwb` decoders are LGPL and were confirmed present and working in the minimal build **[MEASURED]**. Don't reach for libopencore.
- Likewise AAC: FFmpeg's native `aac` decoder is LGPL. Only `libfdk_aac` is nonfree, and it's an encoder-quality play you don't need.

**Conclusion: build with `--disable-gpl --disable-nonfree --disable-version3`. You lose nothing you need, and `configure` confirms `License: LGPL version 2.1 or later` [MEASURED].**

### LGPL obligations for a bundled *sidecar*

**Distribution to a few people is still distribution.** LGPL obligations trigger on conveying the binary to anyone else; "small circle" and "direct download" provide no exemption. (Running it only on your own machines would not be distribution — but that isn't the plan.)

**The subprocess distinction matters, and it works in your favour.** FFmpeg's official [compliance checklist](https://ffmpeg.org/legal.html) is written for the case of *linking against the FFmpeg libraries* — it talks about dynamic linking, not renaming DLLs, and so on. That is LGPL §5/§6 territory: your program becomes "a work that uses the Library," and §6 imposes the relinking/replacement obligation (ship object files or use a shared-library mechanism so the user can swap in a modified FFmpeg).

Recap does **not** do that. It ships FFmpeg's own CLI program as a **separate executable** and communicates over **pipes and command-line arguments**. There is no linking, so:

- Your Rust/React source is **unaffected** — it never becomes a "work that uses the Library."
- **§6's relinking obligation does not apply to your app.** The user's ability to replace the decoder is trivially satisfied anyway: they can swap the `ffmpeg` file.
- What *does* apply is **LGPL §4** — you are distributing FFmpeg itself in executable form, so you must accompany it with *"the complete corresponding machine-readable source code."*
- The static-vs-dynamic question is moot here for the same reason: the statically-linked libav\* code inside the sidecar is all FFmpeg's own code, not a combination with a separate work.

**Caution: this is my reading, not legal advice, and it is only partially backed by primary sources.** FFmpeg's published checklist does not explicitly address the "ship the CLI as a subprocess" case; I am applying the LGPL 2.1 text ([gnu.org](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)) to a scenario the checklist doesn't cover. It is a widely-relied-upon reading, but it is a reading.

**Practical compliance checklist for Recap** (cheap — an afternoon):
1. Build with `--disable-gpl --disable-nonfree --disable-version3`. Keep the exact configure line.
2. Host the **exact** FFmpeg source tarball you built from (`ffmpeg-8.0.tar.xz`) on the **same server** as the app download.
3. Include a text file with the configure line, plus `git diff > changes.diff` if you patched anything.
4. Add to the download page: *"This software uses code of FFmpeg licensed under the LGPLv2.1 and its source can be downloaded [here]."*
5. Add *"This software uses libraries from the FFmpeg project under the LGPLv2.1"* to Recap's About box.
6. Ship a copy of `COPYING.LGPLv2.1`.
7. Don't misspell FFmpeg (two capital Fs, lowercase "mpeg") — this is explicitly on FFmpeg's checklist.

### AVFoundation

Zero obligations. Apple system framework under the standard macOS SDK/developer agreement. No attribution, no source offer, no bundled bytes. Rust bindings (`objc2-*`) are `Zlib OR Apache-2.0 OR MIT` — permissive, attribution-only.

### symphonia

**MPL 2.0** — file-level copyleft. You may link it into proprietary code freely; only files containing MPL code carry obligations, and unmodified redistribution requires only a source-availability notice. Lightest burden of the three third-party options. The README's patent posture (*"only enables support royalty-free open standard codecs and formats"*) is a **codec-selection default, not a legal indemnity** — there is no patent-grant or royalty disclaimer beyond MPL 2.0's own §2.1 patent grant, which covers contributors' patents, **not** third-party MPEG-LA patents. Enabling `aac`/`mp3` leaves you in the same patent position as FFmpeg.

### Patents (applies to all three)

FFmpeg's legal page notes standards *"contain vague hints that any conforming implementation might be subject to some patent rights"* and that *"MPEG LA is vigilant and diligent about collecting for MPEG-related technologies."* For a few-user, non-commercial distribution the practical exposure is negligible, and it is **identical across all three options** — decoding AAC/MP3 is decoding AAC/MP3 regardless of implementation. Note that AVFoundation is the one case where the decoder ships with the OS and any licensing is Apple's problem, not yours. That is a genuine (if minor) point in AVFoundation's favour.

---

## Open questions / unverified

1. **Symphonia was never executed.** No `cargo`/`rustc`/`rustup` on this machine. All symphonia claims come from the README and docs.rs. In particular the "Opus decoder not implemented" conclusion is inferred from the README status table (`-` = "In work or not started yet") — **not** from a failed decode. Worth a 20-minute confirmation before fully closing the door.
2. **AVFoundation AMR decoding** — untested; no AMR encoder available locally to generate a fixture (`libopencore_amrnb`/`amr_nb` both absent from the Homebrew build). UTI and `afconvert` entry both suggest support.
3. **Clean-machine AVFoundation coverage.** All AVFoundation results were measured on a machine with **IINA.app installed**, which pollutes `audiovisualTypes()`. The *decode* results should be unaffected (no third-party codecs in `/Library/Audio/Plug-Ins/Components`, and Ogg was confirmed native via `afinfo`/`afconvert`), but coverage was not verified on a clean macOS 26 install. Media Extensions mean per-machine variation is possible in principle.
4. **The LGPL subprocess analysis is a reading, not a citation.** FFmpeg's compliance checklist addresses library linking, not shipping the CLI as a separate process. No primary source directly blesses the subprocess case. Get a second opinion if this ever moves beyond small-circle distribution.
5. **`--enable-small` cost.** The 2.14 MiB figure includes `--enable-small`, which trades some decode speed for size. The 3.5 s/2 h measurement was taken *with* that flag, so it's a fair number, but a non-`--enable-small` build might close some of the gap to AVFoundation's 2.2 s. Not measured.
6. **`AVURLAssetOutOfBandMIMETypeKey`** is not a formally documented constant in the AVFoundation reference pages I could retrieve — it was used as a raw string key and empirically worked **[MEASURED]**. Confirm the supported spelling/constant before relying on it.
7. **FFmpeg 8.0 vs 8.1.x.** The minimal build used 8.0 (current release tarball fetched 2026-07-19); Homebrew ships 8.1.2. No functional difference expected for decoding, but the shipped version should be pinned deliberately.
8. **Opus-in-Matroska stderr warning.** `Error parsing Opus packet header.` appears on every mkv/webm Opus decode despite `0 decode errors` and correct output. Cause not root-caused — possibly a probe-phase artifact of the native Opus decoder. Harmless, but it means stderr can't be used as an error signal.
9. **Whisper input contract not confirmed.** This document assumes 16 kHz mono. Float32 vs Int16 and any required normalization depend on the ASR binding Recap ends up using — not investigated here.

---

## Sources

All accessed **2026-07-19**.

**FFmpeg**
- https://ffmpeg.org/legal.html — LGPL/GPL split, compliance checklist, patent statement
- https://ffmpeg.org/releases/ffmpeg-8.0.tar.xz — source built and measured
- FFmpeg 8.0 `configure` (local, from tarball) — `EXTERNAL_LIBRARY_GPL_LIST`, `EXTERNAL_LIBRARY_VERSION3_LIST`, `EXTERNAL_LIBRARY_GPLV3_LIST`, `EXTERNAL_LIBRARY_NONFREE_LIST`, `HWACCEL_LIBRARY_NONFREE_LIST`, and the `*_deps="gpl"` grep
- Note: `ffmpeg.org/license.html` returns **HTTP 404**; `legal.html` is the live page.

**Apple**
- https://developer.apple.com/documentation/avfoundation/avassetreader
- https://developer.apple.com/documentation/avfoundation/avassetreaderaudiomixoutput — *"reads audio samples that result from mixing audio from one or more tracks"*
- https://developer.apple.com/documentation/avfaudio/avaudioconverter
- https://developer.apple.com/documentation/avfoundation/avurlasset
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- https://developer.apple.com/documentation/security/resolving-common-notarization-issues
- Local system tools as primary evidence: `afconvert -hf`, `afinfo`, `sw_vers` (macOS 26.5.2 / 25F84 / arm64)

**Symphonia**
- https://github.com/pdeljanov/Symphonia — README codec/format matrices, MPL 2.0, royalty-free default statement
- https://docs.rs/symphonia-core/latest/symphonia_core/formats/trait.FormatReader.html — `next_packet() -> Result<Option<Packet>>`
- GitHub API: commits (latest 2026-07-17), releases (v0.6.0, 2026-05-15)
- crates.io API: symphonia 0.6.0

**Tauri**
- https://v2.tauri.app/develop/sidecar/ — `externalBin`, target-triple suffix, `shell:allow-execute`, `app.shell().sidecar()`, `CommandEvent::Stdout`
- crates.io API: `tauri` 2.11.5 (2026-07-01), `tauri-plugin-shell` 2.3.5 (2026-02-03)

**Rust bindings**
- crates.io / docs.rs: `objc2` 0.6.4, `objc2-av-foundation` 0.3.2, `objc2-core-media` 0.3.2, `objc2-avf-audio` 0.3.2, `cidre` 0.16.1
- https://docs.rs/rubato — v4.0.0 (2026-07-09), MIT OR Apache-2.0, arbitrary ratios, aarch64 NEON
- GitHub API: madsmtm/objc2 commit activity (2026-07-14)

**Licenses**
- https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html — §4, §5, §6
- https://www.mozilla.org/en-US/MPL/2.0/FAQ/ — file-level copyleft, proprietary combination, unmodified redistribution
