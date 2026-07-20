# Local ASR + Speaker Diarization for Recap (Apple Silicon, macOS 26+)

**Date:** 2026-07-19
**Issue:** qodesmith/recap#2
**Constraints assumed:** macOS 26+, Apple Silicon only, fully on-device, word-level timestamps mandatory, small-circle (non-App-Store) redistribution, separate mic/system-audio tracks.

## Bottom line up front

Use **FluidAudio** (Swift, Apache-2.0) as the single engine for both jobs, driven from Rust via a **Swift sidecar binary** — not via the official `fluidaudio-rs` crate, whose FFI struct silently drops timing data. Transcription is **NVIDIA Parakeet TDT 0.6B v3** in Core ML, which emits *true model-native* per-token timings from the TDT decoder that FluidAudio aggregates into `WordTiming` (`word`, `startTime`, `endTime`) — no DTW, no forced alignment, no second alignment model. Diarization for the hard case (system-audio mixdown, unknown speaker count) is FluidAudio's **offline VBx pipeline** (pyannote segmentation + WeSpeaker embeddings + PLDA + VBx clustering), self-reported at **12.0% DER on a 4-meeting AMI SDM subset** and **10.62% DER on the full 16-meeting set**. Everything runs on the ANE, ships as ~500 MB (ASR — the single Core ML variant actually fetched; the HF repo totals 2.99 GB only because it holds every variant) + ~129 MB (diarization) downloaded at first run, and carries CC-BY-4.0 / Apache-2.0 / MIT licensing with **no HF-gated weights** — FluidAudio re-hosts converted copies, which sidesteps pyannote's gating problem entirely. The fallback, if you want zero disk cost and zero model management, is Apple's **`SpeechTranscriber`** (macOS 26+) for the mic track only — it has real word-level timings via `.audioTimeRange` but *no diarization whatsoever*, so it cannot solve the system-audio track alone.

---

## Recommendation

### FIRST CHOICE

| Layer | Choice |
|---|---|
| Runtime | **FluidAudio** ≥0.13, Swift 6, Apache-2.0 ([repo](https://github.com/FluidInference/FluidAudio)) |
| ASR model | **Parakeet TDT 0.6B v3** Core ML ([FluidInference/parakeet-tdt-0.6b-v3-coreml](https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml)) |
| Diarization | **FluidAudio offline VBx** = pyannote segmentation + WeSpeaker + PLDA + VBx ([FluidInference/speaker-diarization-coreml](https://huggingface.co/FluidInference/speaker-diarization-coreml)) |
| VAD (optional) | Silero VAD, MIT, ~2 MB ([repo](https://github.com/snakers4/silero-vad)) |
| Binding path | **Swift sidecar binary** invoked as a subprocess from the Rust/Tauri backend, JSON over stdout |

### FALLBACK

| Layer | Choice |
|---|---|
| ASR | **Apple `SpeechTranscriber`** (Speech framework, macOS 26+), word timings via `.audioTimeRange` |
| Diarization | still FluidAudio offline VBx, or **sherpa-onnx** diarization (Apache-2.0, native Rust bindings) |
| Binding path | Swift sidecar (Apple) / pure-Rust crate (sherpa-onnx) |

### The one sentence that separates them

**Parakeet TDT emits word timings the model actually computed and ships diarization in the same package; Apple's `SpeechTranscriber` gives you free, zero-disk word timings but the Speech framework contains no speaker-diarization symbol at all, so it can never handle Recap's hard case — the multi-voice system-audio mixdown.**

Secondary separators worth knowing:

- **Disk:** Apple = 0 bytes you ship (OS-managed assets). FluidAudio = ~500 MB ASR + ~129 MB diarization, downloaded at first run (see §1 "Disk" — the 2.99 GB repo total is all variants, not one download; confirm by measuring the cache).
- **Control:** Apple's model version, locale availability, and accuracy are OS-controlled and can change under you across point releases. Parakeet is pinned and reproducible.
- **Speed:** Parakeet v3 is self-reported at **207.4× RTFx on English** (M4 Pro). Apple publishes no RTFx figure — unsourceable, flagged below.
- **Languages:** Parakeet v3 = 25 European languages free. Apple = whatever locales the OS has installed (`installedLocales` vs `supportedLocales`).

### Explicitly NOT recommended

- **`fluidaudio-rs`** — see the disqualifying detail in its section. Tempting (it's the "official Rust crate"), but its `AsrResult` has no timing field.
- **whisper.cpp / WhisperKit** — both work and both can produce word timings, but only via DTW/cross-attention alignment, which is a *derived* timing, and both are ~2-10× slower than Parakeet TDT for the same job. Neither ships diarization you'd want (see `tinydiarize` caveat).
- **pyannote.audio directly** — Python runtime in a Tauri app is a packaging disaster, and the weights are HF-gated.

---

## Comparison table

| Candidate | 1. Word timestamps | 2. Apple Silicon accel + RTFx | 3. Diarization quality | 4. Composes? | 5. License (code / weights) | 6. Disk | 7. Languages |
|---|---|---|---|---|---|---|---|
| **FluidAudio + Parakeet TDT v3** | **YES — native** TDT token timings → `WordTiming` | ANE (Core ML). **207.4× RTFx EN, 209.8× median** on M4 Pro (self-reported) | Offline VBx **12.0% DER** AMI SDM subset, **10.62%** full-16, **15.07%** VoxConverse (self-reported) | **Both in one package** | Apache-2.0 / CC-BY-4.0 | ~500 MB fetched (2.99 GB repo = all variants) + 129 MB | 25 European + JP variant |
| **Apple `SpeechTranscriber`** | **YES** — `.audioTimeRange` attribute on attributed-string runs | ANE, OS-managed. **No published RTFx** | **NONE** — no diarization symbol in Speech framework | Transcription only; needs external diarizer | OS / N/A | **0 (OS assets)** | OS-installed locales |
| **whisper.cpp** | YES — derived (DTW `dtw_token_timestamps`, or `-ml 1`) | Metal + Core ML ANE encoder, ">x3 faster" (no hardware named) | `tinydiarize` (`-tdrz`) = experimental turn segmentation, **not** real diarization; no DER | Two projects; wire yourself | MIT / MIT (Whisper) | tiny→large-v3-turbo; base ≈142 MiB | 99 (Whisper) |
| **WhisperKit (Argmax OSS)** | YES — derived; `WordTiming{word,tokens,start,end,probability}` | ANE. 8.4→4.6 ms decoder fwd pass on M3 ANE; **2.2% WER @ 0.46 s latency** | Via **SpeakerKit** (pyannote v4 / community-1) | **Both, same SPM package** | MIT / mixed; **Pro tier is `argmax-fmod-license` (paid)** | large-v3-turbo ≈626 MB | 99 |
| **sherpa-onnx** | Partial — **token**-level `float *timestamps`, merge to words yourself | Core ML EP available; no published Apple RTFx | pyannote-segmentation-3.0 + 3D-Speaker/NeMo/WeSpeaker embeddings; no published DER | **Both, one project** | Apache-2.0 / per-model | per-model | many |
| **NeMo Sortformer (streaming 4spk-v2)** | N/A (diarization only) | Via FluidAudio Core ML port | **6.57% DER** CALLHOME 2spk, **13.24%** DIHARD III 1-4spk; **42.56%** at 5-9 spk | diarization only | CC-BY-4.0, **not gated** | 117M params | N/A |
| **pyannote community-1** | N/A | Python/torch (or Core ML via FluidAudio/SpeakerKit) | **AMI-IHM 17.0%, CALLHOME 26.7%, DIHARD3 20.2%, VoxConverse 11.2%** | diarization only | MIT (code) / **CC-BY-4.0 but HF-GATED** | ~129 MB as Core ML | N/A |
| **Silero VAD** | N/A | CPU, trivial | N/A (VAD only, explicitly not diarization) | supporting role | MIT / MIT | **~2 MB** | lang-agnostic |
| **`fluidaudio-rs`** | **NO — FFI drops timings** | inherits FluidAudio | segment-level only | — | MIT | — | — |

---

## Per-candidate detail

### 1. FluidAudio + Parakeet TDT v3 — FIRST CHOICE

**Word timestamps — verified in source, not README.** The public API in `Sources/FluidAudio/ASR/Parakeet/AsrTypes.swift` defines:

```swift
public struct TokenTiming: Codable, Sendable {
    public let token: String
    public let tokenId: Int
    public let startTime: TimeInterval
    public let endTime: TimeInterval
    public let confidence: Float
}

/// Word-level timing, aggregated from a sequence of `TokenTiming`s by grouping
/// SentencePiece sub-word tokens on their word-boundary markers (`▁` / leading space).
public struct WordTiming: Codable, Sendable {
    public let word: String
    public let startTime: TimeInterval
    public let endTime: TimeInterval
}

public func buildWordTimings(from tokenTimings: [TokenTiming]) -> [WordTiming]
```

`ASRResult` exposes `public let tokenTimings: [TokenTiming]?`. This is **category (a) — true model-native timings**: the TDT (Token-and-Duration Transducer) decoder predicts a duration per token as part of decoding, so the timings fall out of the forward pass. There is no DTW, no cross-attention heuristic, no forced-alignment second model. The only derived step is the sub-word→word grouping on SentencePiece boundary markers, which is deterministic string work, not estimation. Source: [`AsrTypes.swift`](https://github.com/FluidInference/FluidAudio/blob/main/Sources/FluidAudio/ASR/Parakeet/AsrTypes.swift).

The upstream model card independently confirms "accurate word-level and segment-level timestamps" with a `timestamp['word']` field ([HF card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)).

The CLI already exposes this: `TranscribeCommand` parses `--word-timestamps` and `--output-json`, emitting `TranscriptionJSONOutput { audioFile, mode, modelVersion, text, durationSeconds, processingTimeSeconds, rtfx, confidence, wordTimings, timingsConfirmed }` ([TranscribeCommand.swift](https://github.com/FluidInference/FluidAudio/blob/main/Sources/FluidAudioCLI/Commands/ASR/Parakeet/SlidingWindow/TranscribeCommand.swift)). **This is your sidecar contract, ready-made.**

**Acceleration + speed.** FluidAudio runs models on the ANE and states it avoids GPU/MPS entirely. Self-reported ([Benchmarks.md](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Benchmarks.md)), on a **2024 MacBook Pro, M4 Pro, 48 GB**:

- Parakeet TDT v3, FLEURS 24 languages: **14.7% avg WER, 209.8 median RTFx**; English **5.4% WER, 207.4 RTFx**
- Parakeet v2, LibriSpeech test-clean: **2.1% WER, 145.8× RTFx**

These are the project's own numbers, on its own harness. Treat as directionally right, not audited.

**Diarization.** `Documentation/Diarization/BenchmarkAMISubset.md` states hardware (**M4 Pro, 48 GB, macOS Tahoe 26.0**) and scoring config (**collar=0.25 s, ignoreOverlap=true** — note: overlap is *excluded* from scoring, so these DER numbers do not measure overlap handling):

| System | Avg DER | Avg RTFx | Mode |
|---|---|---|---|
| Offline VBx | **12.0%** | 60.4× | Offline |
| LS-EEND (AMI) | 25.7% | 53.9× | Streaming |
| Streaming 5s/0.8 | 29.9% | 96.2× | Streaming |
| Sortformer (high-lat) | 34.3% | 120.3× | Streaming |

Full 16-meeting AMI SDM: **10.62% DER, 69.8× RTFx, 12/16 meetings with correct speaker count**. Full VoxConverse (232 clips): **15.07% DER, 122× RTFx**.

The **offline VBx path is the right one for Recap** — Recap records to a file and processes afterward, so the 3× DER penalty of streaming is pure loss. FluidAudio's own guidance calls offline VBx "the best offline-quality option when you want a full batch pipeline" ([Diarization/GettingStarted.md](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Diarization/GettingStarted.md)). It estimates speaker count rather than requiring it (12/16 correct on AMI) — essential for an unknown-participant Zoom mixdown.

If you later want streaming/live diarization, `Documentation/Diarization/GettingStarted.md` has an unusually honest capability matrix: Sortformer is best for noise and speaker-identity stability but caps at 4 speakers and misses quiet speech; LS-EEND handles up to 10 speakers and high overlap best but false-alarms more.

**Licensing.** SDK Apache-2.0. Parakeet weights CC-BY-4.0 (upstream NVIDIA). Diarization conversion repo labelled CC-BY-4.0 with the SDK Apache-2.0. **Crucially, none of the FluidInference HF repos are gated** — no token, no accepted-terms wall. CC-BY-4.0 requires attribution, so ship a notices/credits screen naming NVIDIA Parakeet, pyannote, and WeSpeaker. All fine for small-circle distribution. *(Discrepancy flagged below: the v3 CoreML README text says "Apache 2.0" while the repo's HF metadata says `cc-by-4.0`.)*

**Disk.** `FluidInference/parakeet-tdt-0.6b-v3-coreml` is **2.99 GB total**, but that includes many variants (`EncoderInt4`, `ParakeetEncoder_15s`, `JointDecisionv1/2/3`, `.mlpackage` duplicates). `fluidaudio-rs` says first-init downloads **~500 MB in 20-30 s**, which is the realistic single-variant figure. Diarization repo is **129 MB** (`Segmentation.mlmodelc`, `wespeaker_int8.mlmodelc`, `wespeaker_v2.mlmodelc`, `PLDA.mlmodelc`, `FBank.mlmodelc`, plus JSON params). **Download at first run — do not bundle.** Even at 500 MB this dwarfs a reasonable app binary.

**Languages.** 25 European languages incl. English, German, French, Spanish, Italian, Dutch, Polish, Portuguese, Russian, Ukrainian. A separate `parakeet-0.6b-ja-coreml` covers Japanese.

---

### 2. `fluidaudio-rs` — DISQUALIFIED (and this is the trap)

The obvious move for a Tauri app is the official Rust crate. **Do not take it.** From [`src/ffi/bridge.rs`](https://github.com/FluidInference/fluidaudio-rs/blob/main/src/ffi/bridge.rs):

```rust
pub struct AsrResult {
    pub text: String,
    pub confidence: f32,
    pub duration: f64,
    pub processing_time: f64,
    pub rtfx: f32,
}
```

No `token_timings`, no `word_timings`. Grepping the whole crate — `src/*.rs`, `swift/FluidAudioBridge.swift` (1,564 lines), `src/ffi/bridge.rs` (961 lines) — for `WordTiming|word_timing|TokenTiming|token_timing|word_timestamps` returns **zero matches**. The Swift bridge never reads `ASRResult.tokenTimings`, so the data is discarded at the FFI boundary. Diarization fares better: `DiarizationSegment { speaker_id, start_time, end_time, quality_score }` is exposed via `diarize_file()`.

So the crate gives you diarization but **not the hard requirement**. Options: (a) run the FluidAudio Swift CLI as a sidecar — recommended, the JSON contract already exists; (b) fork the bridge and add ~40 lines of `@_cdecl` to marshal `tokenTimings`; (c) write your own minimal Swift sidecar against the FluidAudio SPM package. Option (a) costs nothing and is what the recommendation assumes.

Also note the crate is at **0.1.x**, MIT, and has a known version-skew issue between its pinned `Package.swift` (FluidAudio 0.12.6) and its Qwen3 bindings (needs 0.13.6) — [issue #9](https://github.com/FluidInference/fluidaudio-rs/issues/9). Immature. Reinforces the sidecar decision.

---

### 3. Apple `SpeechAnalyzer` / `SpeechTranscriber` — FALLBACK

**Availability:** iOS/iPadOS/macOS/tvOS/visionOS/Mac Catalyst **26.0+**. Perfectly aligned with Recap's floor. ([docs](https://developer.apple.com/documentation/speech/speechtranscriber))

**Word timestamps: YES.** `SpeechTranscriber.ResultAttributeOption` has exactly two cases: **`.audioTimeRange`** ("Includes time-code attributes in a transcription's attributed string"; discussion: "These are `Foundation/AttributeScopes/SpeechAttributes/TimeRangeAttribute` attributes") and `.transcriptionConfidence`. ([docs](https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption/audiotimerange))

The mechanism: results come back as an `AttributedString`, and the time-range attribute is carried on its **runs**. You iterate runs and compare each run's `audioTimeRange` against playback position — which is exactly Recap's highlighting use case. Configuration:

```swift
SpeechTranscriber(locale: locale,
                  transcriptionOptions: [],
                  reportingOptions: [.volatileResults],
                  attributeOptions: [.audioTimeRange])
```

**Caveat worth stating plainly:** Apple's reference docs never explicitly say the runs are *word*-granular. WWDC25 session 277 ("Bring advanced speech-to-text to your app with SpeechAnalyzer") demonstrates per-word highlighting from these attributes, and that's the strongest primary evidence available, but I could not extract a normative sentence from Apple's written docs stating the granularity contract. See open questions.

**Diarization: NO.** The Speech framework's complete top-level symbol list is `SpeechAnalyzer`, `AssetInventory`, `AnalysisContext`, `SpeechTranscriber`, `DictationTranscriber`, `SpeechDetector`, `AssetInputSequenceProvider`, `CaptureInputSequenceProvider`, `AnalyzerInputConverter`, `SFSpeechLanguageModel`, `SFCustomLanguageModelData`, `AnalyzerInput`, `AssetInstallationRequest`, `SpeechModels`, `SpeechModule`, `LocaleDependentSpeechModule`, `SpeechModuleResult`. **There is no speaker/diarization/segmentation symbol.** `SpeechDetector` is VAD, not diarization. ([framework index](https://developer.apple.com/documentation/speech))

This is the disqualifier for using it alone. It's a great mic-track transcriber and a zero-cost hedge; it is not a solution to Recap's stated hard case.

**Other notes:** on-device (models are OS assets, managed via `AssetInventory` / `AssetInstallationRequest`); **zero bytes** in your bundle; locale coverage is `supportedLocales` vs `installedLocales` — you must handle "supported but not installed" by triggering a download. Rust/Tauri path: **Swift sidecar** (Speech is Swift/ObjC-only). Cost: free, OS-provided, no license concerns.

---

### 4. whisper.cpp

**Word timestamps: YES, but derived (category b).** Two mechanisms, both in [`include/whisper.h`](https://github.com/ggml-org/whisper.cpp/blob/master/include/whisper.h):

```c
// [EXPERIMENTAL] Token-level timestamps with DTW
bool dtw_token_timestamps;
enum whisper_alignment_heads_preset dtw_aheads_preset;
int  dtw_n_top;
struct whisper_aheads dtw_aheads;
size_t dtw_mem_size;
...
bool token_timestamps; // enable token-level timestamps
int  max_len;          // max segment length in characters
bool split_on_word;    // split on word rather than on token (when used with max_len)
```

The DTW path aligns decoder cross-attention weights to audio frames — accurate but marked **`[EXPERIMENTAL]`** in the header itself, and it requires per-model alignment-head presets. The `-ml 1` / `--max-len 1` path forces one-token segments and reads Whisper's own timestamp-token predictions; this is the weaker mechanism, since Whisper was never trained to emit meaningful timestamps after every word. Recap should not depend on it.

**Acceleration:** ARM NEON, Accelerate, Metal, and a Core ML ANE encoder claimed ">x3 faster" than CPU-only. **The README names no hardware for that figure — unsourced, flagged.**

**Diarization:** `tinydiarize` via `-tdrz`, described as experimental *speaker segmentation* (turn detection). It is not embedding-based diarization, cannot count speakers, and has no published DER. **Not viable for a Zoom mixdown.**

**License:** MIT (code); Whisper weights MIT. Cleanest licensing of any candidate.

**Disk:** base ≈142 MiB unquantized; quantized ggml sizes not tabulated in the README.

**Rust path:** good — C API, mature `whisper-rs` ecosystem. If binding ergonomics were the only criterion whisper.cpp would win. They aren't: it's slower than Parakeet, its timings are derived and experimental, and it has no real diarization.

---

### 5. WhisperKit / Argmax OSS Swift

As of **v1.0.0 (2026-05-01)** the repo was renamed `argmaxinc/WhisperKit` → [`argmaxinc/argmax-oss-swift`](https://github.com/argmaxinc/argmax-oss-swift), an MIT Swift package bundling **WhisperKit** (ASR), **SpeakerKit** (diarization), and **TTSKit**. This is a genuine both-in-one-project competitor to FluidAudio and the strongest runner-up.

**Word timestamps: YES, derived.** From `Sources/WhisperKit/Core/Models.swift`:

```swift
public struct WordTiming: Hashable, Codable, Sendable {
    public var word: String
    public var tokens: [Int]
    public var start: Float
    public var end: Float
    public var probability: Float
}
```

and `TranscriptionSegment` carries `public var words: [WordTiming]?`. Richer than FluidAudio's (adds `tokens` and `probability`), but Whisper-based, so the timings are cross-attention-derived, not model-native.

**Acceleration:** Core ML / ANE, heavily optimized. The [arXiv paper](https://arxiv.org/abs/2507.10860) reports "**matches the lowest latency at 0.46 s while achieving the highest accuracy 2.2% WER**" against gpt-4o-transcribe, Deepgram nova-3, and Fireworks large-v3-turbo. Argmax separately reports a **45% latency reduction (8.4 ms → 4.6 ms) on M3 ANE** for the large-v3-turbo text-decoder forward pass, with **75% lower energy (1.5 W → 0.3 W)**. Note the abstract does not name the hardware for the 0.46 s / 2.2% figures.

**Diarization:** SpeakerKit runs **pyannote v4 (community-1)** on Apple Silicon, and Argmax claims it "matches the error rate of state-of-the-art systems such as Pyannote across 13 datasets despite an order of magnitude speedup." It integrates with WhisperKit output with selectable matching strategies for word→speaker alignment.

**Why it's second, not first:**
1. **Licensing fork risk.** OSS package is MIT, but `argmaxinc/speakerkit-pro` weights are `license_name: argmax-fmod-license` — a proprietary subscription license. The good models risk living behind the Pro tier. FluidAudio has no such two-tier structure.
2. **Derived timings** vs Parakeet's native ones.
3. **Slower** — Whisper large-v3-turbo at ~50-130× RTFx class vs Parakeet's ~200× on comparable silicon.
4. **`macOS 14.0+`** floor is more permissive than needed and implies less macOS-26-specific tuning.

Still Swift-only → same sidecar requirement as FluidAudio. If FluidAudio's diarization disappoints on real Zoom audio, **swap in SpeakerKit before swapping anything else.**

---

### 6. sherpa-onnx (k2-fsa)

**License: Apache-2.0** (verified from [LICENSE](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)) — the most permissive runtime here.

**Uniquely good Rust story.** The docs list Rust among 12 language bindings and explicitly list **Tauri** as a supported platform target, alongside macOS arm64. This is the *only* candidate with a first-class pure-Rust path requiring no sidecar.

**Word timestamps: partial (token-level).** From [`sherpa-onnx/c-api/c-api.h`](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/c-api/c-api.h):

```c
/** Array of @c count pointers into @c tokens. */
const char *const *tokens_arr;

/**
 * Optional token timestamps in seconds.
 * This field may be NULL when the model does not provide timestamps.
 * When non-NULL, it contains @c count entries and is parallel to @c tokens_arr.
 */
float *timestamps;
```

So: **token**-level timestamps, parallel to the token array, and only when the model supplies them. With `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` the underlying model *does* supply them (same TDT mechanism), so you get the same native quality — but **you must implement SentencePiece word-boundary merging yourself**, i.e. reimplement FluidAudio's `buildWordTimings`. Note also that timestamps are per-token *start* only (a single float), so you'd derive word end-times from the next token's start rather than a true end. That's a real accuracy loss versus FluidAudio's `TokenTiming.endTime`.

**Diarization:** supported, using `sherpa-onnx-pyannote-segmentation-3-0` or `sherpa-onnx-reverb-diarization-v1` for segmentation, paired with **3D-Speaker**, **WeSpeaker**, or **NeMo** embedding extractors. Same architectural family as FluidAudio's offline VBx. **No published DER numbers in the docs** — flagged.

**Verdict:** the best choice *if* you refuse to ship a sidecar. You trade FluidAudio's ANE tuning, its published DER/RTFx numbers, and its ready-made word merging for a clean `cargo add`. Given that Tauri sidecars are a supported, well-trodden pattern, the trade isn't worth it — but keep sherpa-onnx as the escape hatch if Swift sidecar packaging/notarization becomes painful.

---

### 7. NVIDIA Parakeet — licensing and language reality check

Both current versions verified against live HF cards:

| | v2 | v3 |
|---|---|---|
| License | **CC-BY-4.0** | **CC-BY-4.0** |
| Gated | **No** | **No** |
| Languages | **English only** | **25 European** |
| Params | 600M | 600M |
| Word timestamps | Yes | Yes |
| Self-reported WER | 6.05% avg | — |
| Self-reported RTFx | 3,386 (bs=128) | 3,332.74 |

**The RTFx figures are on NVIDIA datacenter GPUs (A100/H100 class), not Apple Silicon — do not quote them for a Mac.** The Apple-relevant number is FluidAudio's ~207× on M4 Pro.

The premise in the issue holds up: **v2 was English-only CC-BY-4.0, v3 added European languages, and both remain CC-BY-4.0 and ungated.** CC-BY-4.0 permits commercial use and redistribution with attribution — fine for small-circle distribution. Neither card mentions a non-commercial or research-only restriction. v3's 25 languages: Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Ukrainian.

---

### 8. pyannote (audio 4.x, community-1) and its ports

**pyannote.audio 4.0.x** is current. Notable 4.0 changes: `speaker-diarization-community-1` switched to **VBx clustering** (from agglomerative hierarchical) for better speaker assignment and counting; a new **exclusive speaker diarization** output mode explicitly designed "to simplify alignment between fine-grained speaker diarization timestamps and (sometimes not so precise) transcription timestamps" — i.e. pyannote itself now targets the word→speaker assignment problem; pipelines can be stored with internal models in one repo for **fully offline use** after first download. Breaking: Python ≥3.10, ffmpeg-only audio I/O, `use_auth_token` → `token`.

**community-1 DER** (from the model card, dated 2025-09): **AMI (IHM) 17.0%, CALLHOME 26.7%, DIHARD 3 20.2%, VoxConverse 11.2%.** These are the authors' own numbers.

**Licensing / gating — the sharp edge:**
- pyannote.audio **code: MIT**.
- `pyannote/speaker-diarization-community-1` **weights: CC-BY-4.0 but GATED** — "must accept conditions and provide contact information," login + HF token required.
- `pyannote/segmentation-3.0` **weights: MIT but ALSO GATED** — same accept-conditions wall.

Gating is a genuine distribution problem: you cannot ship an app that silently downloads from a gated repo without embedding a token (a licensing and secrets problem) or forcing every user through an HF account. **This is the single strongest practical argument for FluidAudio**, which re-hosts Core ML conversions in **ungated** `FluidInference/*` repos. Note the licenses still travel with the weights — attribute pyannote and WeSpeaker regardless.

Direct use of pyannote.audio in Recap is a non-starter anyway: it's a PyTorch/Python stack, and embedding a Python runtime in a Tauri app for this is not worth it.

---

### 9. NeMo Sortformer / `diar_streaming_sortformer_4spk-v2`

**License CC-BY-4.0, not gated, 117M params.** Streaming latency tiers: 0.32 s / 1.04 s / 10.0 s / 30.4 s. DER (post-processed, authors' own):

| Dataset | DER |
|---|---|
| DIHARD III eval, 1-4 spk | 13.24% |
| DIHARD III eval, 5-9 spk | **42.56%** |
| CALLHOME-part2, 2 spk | 6.57% |
| CALLHOME-part2, 3 spk | 10.05% |
| CALLHOME-part2, 4 spk | 12.44% |
| CH109 | 4.88% |

**The 4-speaker ceiling is the problem.** DER blows up to 42.56% at 5-9 speakers, and Recap's stated hard case is a Zoom mixdown with an *unknown* participant count. Sortformer is excellent when you know there are ≤4 voices, and FluidAudio praises its speaker-identity stability and pre-enrollment behavior — but you can't guarantee ≤4. Available in FluidAudio as `FluidInference/diar-streaming-sortformer-coreml`; FluidAudio measured **34.3% DER / 120.3× RTFx** on AMI SDM high-latency (M4 Pro) and 31.7% on an M2 run, well behind offline VBx's 12.0%.

**Use it only if** you later add live/streaming diarization and can bound the speaker count.

---

### 10. 3D-Speaker / WeSpeaker embeddings

Not standalone systems — speaker-embedding extractors that plug into a segmentation + clustering pipeline. Both are already inside the recommended stack: **WeSpeaker is FluidAudio's embedding model** (`wespeaker_int8.mlmodelc`, `wespeaker_v2.mlmodelc` in the 129 MB `speaker-diarization-coreml` repo), and sherpa-onnx offers 3D-Speaker/WeSpeaker/NeMo as interchangeable extractors. No separate decision to make.

---

### 11. Silero VAD

**MIT, code and weights, "zero strings attached — no telemetry, no keys, no registration, no built-in expiration." ~2 MB JIT model. Latest v6.2.1 (2026-02-24).** Explicitly **VAD only — it does not do diarization.**

Role in Recap: cheap pre-filter to skip silent regions before ASR/diarization, and to trim the mic track. At 2 MB with MIT terms it's free to include. Already integrated in FluidAudio. Optional, not load-bearing.

---

## Composition / pipeline sketch (recommended stack)

Two tracks, two different amounts of work, one merge.

```
                     ┌─────────────────────────────────────────┐
  mic.wav ──────────▶│ Sidecar: fluidaudiocli transcribe       │──▶ words[] (speaker = "ME")
  (1 known speaker)  │   --word-timestamps --output-json       │
                     └─────────────────────────────────────────┘

                     ┌─────────────────────────────────────────┐
  system.wav ───┬───▶│ Sidecar: fluidaudiocli transcribe       │──▶ words[]  {word, start, end}
  (N unknown    │    │   --word-timestamps --output-json       │
   speakers)    │    └─────────────────────────────────────────┘
                │    ┌─────────────────────────────────────────┐
                └───▶│ Sidecar: FluidAudio offline VBx diarizer│──▶ segments[] {speakerId, start, end}
                     └─────────────────────────────────────────┘
                                        │
                                        ▼
                        Rust: word→speaker assignment
                                        │
                                        ▼
                        Rust: merge both tracks by start time
                                        │
                                        ▼
                      Unified transcript, word-level timed
```

### Why the mic track is nearly free

Recap keeps sources as separate tracks and the mic track has one known speaker. **Do not diarize it.** Transcribe it and stamp every word with the local user's identity. This halves the diarization work and eliminates the most common failure mode of mixed-track pipelines — the local speaker being split across multiple pseudo-speakers.

### Word→speaker assignment (the system-audio track)

ASR and diarization run **independently** over the same audio, producing two unaligned timelines. The join:

1. **Midpoint assignment (baseline).** For each word `w`, compute `mid = (w.start + w.end) / 2` and assign the diarization segment whose `[start, end]` contains `mid`. Midpoint beats start-point because diarization boundaries are systematically imprecise at turn edges, and a word straddling a boundary is more likely to belong to the speaker occupying its center.
2. **Max-overlap tiebreak.** If no segment contains the midpoint (gaps happen — VAD dropouts, missed speech), assign the segment with the greatest temporal overlap with `[w.start, w.end]`; if still none, inherit the previous word's speaker.
3. **Turn smoothing.** Enforce a minimum turn length (~0.5 s or ~3 words). A single word attributed to a different speaker mid-sentence is nearly always a diarization artifact, not a real interruption. Majority-vote within a sliding window and rewrite outliers. This is the highest-value cleanup step for a UI that renders speaker-labelled paragraphs.
4. **Overlap caveat.** FluidAudio's published DER uses `ignoreOverlap=true`, so its overlap performance is *unmeasured by those numbers*. On simultaneous speech expect words to land on whichever speaker the segmentation model favored. Mitigation: keep the raw `quality_score`/confidence and render low-confidence attributions with a visual hedge rather than a hard speaker label.
5. **Codec degradation.** Zoom/Meet mixdowns are heavily compressed and often 16 kHz. Both the pyannote segmentation model and WeSpeaker were trained on real meeting corpora including AMI SDM (distant mics) and AliMeeting, so this is closer to in-domain than out — but the VoxConverse 15.07% figure is a better expectation-setter than the 10.62% AMI number.

### Track merge

After both tracks yield `{word, start, end, speakerId}`, merge into one array sorted by `start`. Both tracks share a common recording clock, so **no cross-track alignment is needed — this is the payoff for recording separate tracks.** Verify the sidecar preserves sample-accurate offsets when a track starts late; if so, add the track's recording-start offset before merging. Speaker ID namespacing: mic track → `"ME"`; system track → `"REMOTE_00"`, `"REMOTE_01"`, … so the two label spaces never collide.

### Concrete integration steps

1. Build a thin Swift executable against the FluidAudio SPM package (or vendor `fluidaudiocli` directly). Sign + notarize it; register it as a Tauri `externalBin` sidecar.
2. Rust invokes it per track, parses `TranscriptionJSONOutput` from stdout (`serde_json`).
3. First-run model download (~500 MB ASR + 129 MB diarization) with a progress UI — **do not bundle**; it would balloon the app and the CC-BY-4.0 attribution surface.
4. Ship an attribution/credits screen: NVIDIA Parakeet (CC-BY-4.0), pyannote (CC-BY-4.0/MIT), WeSpeaker, FluidAudio (Apache-2.0).
5. Keep the ASR engine behind a Rust trait with two impls from day one — `FluidAudioSidecar` and `AppleSpeechSidecar`. Both emit `{word, start, end}`. This makes the fallback a config flag, not a rewrite.

---

## Open questions / could not verify

1. **Apple `SpeechTranscriber` word granularity is not normatively documented.** `.audioTimeRange` demonstrably attaches `TimeRangeAttribute` to attributed-string runs, and WWDC25 session 277 demonstrates per-word highlighting, but I could not extract a sentence from Apple's *written* reference docs guaranteeing runs are word-granular rather than phrase-granular. **Verify empirically before relying on it** — 20 lines of Swift, iterate `result.text.runs`, print each run's range. Apple's docs pages are JS-rendered and resisted extraction; the framework symbol index and the `resultattributeoption` JSON endpoints worked, the prose article did not.
2. **No published RTFx for Apple `SpeechTranscriber`.** Apple publishes no speed figure. Unsourceable — measure it yourself.
3. **whisper.cpp's ">x3 faster" Core ML claim names no hardware.** Flagged as unsourced.
4. **All FluidAudio benchmarks are self-reported** by the project that ships the models, on its own harness. Hardware and scoring config are disclosed (M4 Pro/M5 Pro/M2, collar=0.25 s, `ignoreOverlap=true`), which is better disclosure than most — but no independent replication exists. Same caveat for NVIDIA's Parakeet RTFx, pyannote's community-1 DER, Argmax's SpeakerKit claims, and NVIDIA's Sortformer DER.
5. **License discrepancy on `FluidInference/parakeet-tdt-0.6b-v3-coreml`:** the HF repo metadata says `cc-by-4.0` while the README body says "Apache 2.0. See the FluidAudio repository." The upstream NVIDIA weights are unambiguously CC-BY-4.0, which should govern the weights (Apache-2.0 plausibly refers to the SDK). **Low risk — both permit redistribution with attribution — but worth an email to FluidInference if you want it airtight.**
6. **sherpa-onnx publishes no DER for its diarization pipeline.** Its docs name the models (`sherpa-onnx-pyannote-segmentation-3-0`, `sherpa-onnx-reverb-diarization-v1`, 3D-Speaker/NeMo embeddings) but give no accuracy numbers, no statement on whether speaker count is estimated or required, and no model file sizes. Would need direct benchmarking.
7. **Per-file model sizes for the Core ML repos.** I have repo totals (2.99 GB / 129 MB) and the crate's "~500 MB" first-download figure, but not authoritative per-variant sizes. Confirm by running the downloader once and measuring the cache directory.
8. **pyannote.audio 4.0.7 release date returned as "June 30, 2024,"** which is inconsistent with 4.0 shipping alongside community-1 (model card dated 2025-09). Likely a fetch/parse artifact. The version number and changelog contents are the reliable parts; **treat the date as unverified.**
9. **Expected contradiction that held up:** I expected `fluidaudio-rs` to be the clean Tauri answer. Reading the FFI showed `AsrResult` drops all timing data — the single most consequential finding here, and invisible from the README.
10. **Argmax repo rename** `argmaxinc/WhisperKit` → `argmaxinc/argmax-oss-swift` (v1.0.0, 2026-05-01) came from search results rather than a release note I read directly; the new repo demonstrably exists and serves the merged README. Version/date **partially verified.**
11. **Not evaluated:** Qwen3-ASR (surfaced repeatedly in FluidAudio/Argmax materials, claimed ~1.32% WER at 5-bit MLX on Apple Silicon, but I did not verify its word-timestamp support or license) and Cohere Transcribe (in FluidAudio's model list, INT8 encoder ~1.8 GB, 14 languages, license unverified). Both are 2026-current and could merit a follow-up if Parakeet's accuracy disappoints.

---

## Sources

**Apple**
- https://developer.apple.com/documentation/speech — Speech framework symbol index (no diarization symbol)
- https://developer.apple.com/documentation/speech/speechtranscriber — availability macOS 26.0+, options, results
- https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption — `.audioTimeRange`, `.transcriptionConfidence`
- https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption/audiotimerange — `TimeRangeAttribute`
- https://developer.apple.com/documentation/Speech/bringing-advanced-speech-to-text-capabilities-to-your-app — WWDC25 sample code
- https://developer.apple.com/videos/play/wwdc2025/277/ — WWDC25 session 277

**FluidAudio**
- https://github.com/FluidInference/FluidAudio — repo, Apache-2.0
- https://github.com/FluidInference/FluidAudio/blob/main/Sources/FluidAudio/ASR/Parakeet/AsrTypes.swift — `TokenTiming`, `WordTiming`, `buildWordTimings`, `ASRResult.tokenTimings`
- https://github.com/FluidInference/FluidAudio/blob/main/Sources/FluidAudioCLI/Commands/ASR/Parakeet/SlidingWindow/TranscribeCommand.swift — `--word-timestamps`, `TranscriptionJSONOutput`
- https://github.com/FluidInference/FluidAudio/blob/main/Sources/FluidAudio/Diarizer/DiarizerProtocol.swift — `Diarizer` protocol
- https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Benchmarks.md — ASR/diarization benchmarks
- https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Diarization/BenchmarkAMISubset.md — AMI SDM DER table, hardware, scoring config
- https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Diarization/GettingStarted.md — diarizer selection matrix
- https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Models.md — model inventory
- https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml — 2.99 GB, license
- https://huggingface.co/FluidInference/speaker-diarization-coreml — 129 MB, pyannote+WeSpeaker+PLDA+VBx

**fluidaudio-rs**
- https://github.com/FluidInference/fluidaudio-rs — MIT, C FFI bridge to Swift
- https://github.com/FluidInference/fluidaudio-rs/blob/main/src/ffi/bridge.rs — `AsrResult` (no timings), `DiarizationSegment`
- https://github.com/FluidInference/fluidaudio-rs/issues/9 — version skew
- https://crates.io/crates/fluidaudio-rs

**NVIDIA**
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 — CC-BY-4.0, 25 languages, word timestamps, RTFx 3332.74 (GPU)
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2 — CC-BY-4.0, English-only, 6.05% WER
- https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2 — CC-BY-4.0, 117M, DER table

**pyannote**
- https://github.com/pyannote/pyannote-audio — MIT code
- https://github.com/pyannote/pyannote-audio/releases — 4.0.x, VBx clustering, exclusive diarization
- https://huggingface.co/pyannote/speaker-diarization-community-1 — CC-BY-4.0, GATED, DER numbers
- https://huggingface.co/pyannote/segmentation-3.0 — MIT, GATED

**whisper.cpp**
- https://github.com/ggml-org/whisper.cpp — MIT, Core ML/Metal, `-tdrz`
- https://github.com/ggml-org/whisper.cpp/blob/master/include/whisper.h — `dtw_token_timestamps`, `token_timestamps`, `max_len`, `split_on_word`

**Argmax**
- https://github.com/argmaxinc/argmax-oss-swift — MIT, WhisperKit + SpeakerKit + TTSKit
- https://github.com/argmaxinc/WhisperKit/blob/main/Sources/WhisperKit/Core/Models.swift — `WordTiming` struct
- https://arxiv.org/abs/2507.10860 — WhisperKit paper, 0.46 s / 2.2% WER
- https://huggingface.co/argmaxinc/speakerkit-pro — `argmax-fmod-license` (proprietary)
- https://www.argmaxinc.com/blog/speakerkit
- https://www.argmaxinc.com/blog/pyannote-argmax

**sherpa-onnx**
- https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE — Apache-2.0
- https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/c-api/c-api.h — `float *timestamps` (token-level)
- https://k2-fsa.github.io/sherpa/onnx/index.html — platforms incl. Tauri, Rust bindings
- https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html — segmentation + embedding models
- https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html — Parakeet TDT v2/v3 int8

**Silero**
- https://github.com/snakers4/silero-vad — MIT, ~2 MB, v6.2.1, VAD only
