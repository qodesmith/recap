# Spike: local transcription + diarization with word-level timings

**Issue:** [qodesmith/recap#10](https://github.com/qodesmith/recap/issues/10)
**Date:** 2026-07-20
**Verdict:** ✅ **PROVEN.** The chosen local pipeline produces a diarized, word-timed transcript on a real multi-speaker conversation, far faster than realtime, at modest memory. This is throwaway spike evidence — not production code.

## What was run

- **Input:** a real 34.5-min (2071 s) 2-person screen-share/interview recording (`~/Downloads/zeyad 01.mov`, English, AAC stereo 48 kHz). Real conversational audio — crosstalk, interruptions, disfluencies, filler — *not* clean read speech. **Not committed** (private, 1.6 GB); decoded to 16 kHz mono WAV via `ffmpeg` for the pipeline.
- **Engine:** FluidAudio (release build of the stock `fluidaudiocli`, cloned at HEAD 2026-07-20). This is the *disposable spike vehicle*; production uses the `recap-inference` binary from #7, not this CLI.
- **ASR:** Parakeet TDT `--model-version v3` and `v2`, `--word-timestamps --output-json`, `--language en`.
- **Diarization:** `process --mode offline` (VBx clustering — the recommended hard-case pipeline).
- **Compose:** `spike/asr-diarization/compose.ts` — assigns each word to the diarization segment covering its midpoint (nearest segment if none covers), then groups consecutive same-speaker words into turns.

All measurements on this Apple Silicon Mac (macOS 26, Xcode CLT Swift 6.3.3). Model downloads happen once on first run and are **excluded** from the timings below (CLI reports its own compute time).

## Results

### 1–3. Transcription + diarization + composition all work

| | v3 | v2 |
|---|---|---|
| Words | 6151 | 5859 |
| Mean confidence | 0.938 | 0.952 |
| Word timings | ✅ monotonic, sub-second, last word ends at **2071.0 s** = audio length (no drift) | ✅ last word 2068.2 s |
| Composed turns | 87 | 87 |
| Words inside a diar segment | **90.8 %** | **91.8 %** |

Diarization found **exactly 2 speakers** (correct), 387 segments, talk-time split S2 ≈ 1064 s / S1 ≈ 595 s. The composed transcript reads as a coherent alternating 2-person conversation (see `samples/composed_v3.json`, `composed_v2.json`).

### 4. Speed + memory (well above realtime)

| Stage | Compute time (2071 s audio) | RTFx | Peak memory |
|---|---|---|---|
| ASR v3 | 13.32 s | **155.5×** | ~514 MB RSS / 90 MB footprint |
| ASR v2 | 11.85 s | **174.7×** | ~85 MB footprint |
| Diarization (VBx offline) | 12.99 s | **159.4×** | ~581 MB RSS / 810 MB footprint |
| **Pipeline (ASR + diar, sequential)** | **~26 s** | **~79× realtime** | one-process-at-a-time → **~800 MB peak** |

A 1-hour recording ≈ ~45 s of processing. First-run model downloads observed: ~500 MB (ASR, ~170 s wall on this run incl. download) + ~129 MB (diar). Memory fits the ~490 MB heap estimate from #17.

### 5. Output shape (design downstream against this, not a guess)

**ASR** (`TranscriptionJSONOutput`): `{ audioFile, mode, modelVersion, text, durationSeconds, processingTimeSeconds, rtfx, confidence, timingsConfirmed, wordTimings: [{ word, startTime, endTime }] }`. Word timings are model-native TDT (not DTW).

**Diarization** (`ProcessingResult`): `{ audioFile, durationSeconds, processingTimeSeconds, realTimeFactor, speakerCount, segments: [{ speakerId, startTimeSeconds, endTimeSeconds, qualityScore, embedding: Float[256] }] }`. `speakerId` is `"S1"`, `"S2"`, … (diarization-label provenance, matching the domain model). Each segment carries a 256-dim speaker embedding (stripped from the committed sample; **relevant to cross-track merge #11** — embeddings are the material for matching speakers across tracks).

Real samples committed under `samples/`.

### 6. Incremental progress is extractable

The run is inherently chunked: diarization profiling reported **1036 segmentation windows** + batched embedding evals; ASR sliding-window is ~556 chunks (15 s Core ML shape, per #17). The granularity to emit monotonic progress exists. The stock CLI's *batch* mode returns only a final result (progress goes to os_log) — which is exactly why #7 specified writing `recap-inference` to surface per-chunk progress over stdout. Not re-proven here; #7 owns the production progress protocol. Feeds **#13**.

### 7. Quality floor

- **Speaker count + turn-level attribution: good.** 2 speakers correct; turns alternate sensibly across the whole 34 min.
- **Word-level boundary bleed:** the first word or two of a turn sometimes belongs to the previous speaker (e.g. a trailing "see." lands at the head of the next turn), because diar segment edges and word edges don't align exactly. Directly **motivates segment-reassignment + inline-text editing** (the domain model's targeted editing).
- **~9 % of words fall outside any diar segment** (VAD gaps, overlap, silence) and snap to nearest — acceptable, but the merge/edit UI should expect it.
- **Overlapping speech / crosstalk:** offline VBx with `ignoreOverlap` assigns one speaker per region; simultaneous talk is attributed to one side. Reassignment editing covers the residue.
- **Proper nouns are the weak spot for both models** ("Terzo" → "Terzel"/"Churzel", "procurement" → "Kurement"/"Curment", "Louis"/"Louise"). Neither v2 nor v3 clearly wins here — a custom-vocab boost (FluidAudio supports it) is the lever, not model choice.

## v2 vs v3 head-to-head (evidence for #16 — decision left to that ticket)

On this English conversation the two are **very close**. v2 (English-only): higher confidence (0.952 vs 0.938), marginally faster (174× vs 155×), reads slightly cleaner/more punctuated. v3 (25-lang): more verbatim, preserves disfluencies. Both make the same proper-noun mistakes. **No quality gap large enough to force a UI choice** — the published-benchmark gap (v2 2.1 % LibriSpeech vs v3 5.4 % FLEURS) did not translate into a visible difference on real conversational audio, exactly as #10 predicted. #16 decides ship/default with this evidence.

## Downstream implications

- **#11 (merge):** per-track word timings are drift-free and share one clock; diar segments carry 256-dim embeddings — the raw material for cross-track speaker matching. `qualityScore` and the ~9 % out-of-segment words define the partial/uncertain cases the merge must handle.
- **#13 (progress):** work is chunked (~556 ASR + 1036 diar windows); progress is extractable, but the stock CLI doesn't stream it — #7's `recap-inference` must. One fused monotonic number per track needs an ASR:diar weight; here the two stages were near-equal (~13 s each), so ~50/50 is a good first calibration.
- **#16 (models):** evidence above; both viable for English, v2 marginally ahead.
- **#18 (over-splitting):** on this 34.5-min file VBx offline held at 2 speakers with **no over-split** — a positive early signal that #18's risk may be milder than the fixed-threshold-AHC analysis feared. Single sample; still worth a longer/many-speaker check.

## How to reproduce

```bash
git clone --depth 1 https://github.com/FluidInference/FluidAudio.git
cd FluidAudio && swift build -c release --product fluidaudiocli
BIN=.build/arm64-apple-macosx/release/fluidaudiocli
ffmpeg -i input.mov -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav
"$BIN" transcribe audio.wav --model-version v3 --language en --word-timestamps --output-json asr_v3.json
"$BIN" transcribe audio.wav --model-version v2 --language en --word-timestamps --output-json asr_v2.json
"$BIN" process   audio.wav --mode offline --output diar.json
bun spike/asr-diarization/compose.ts asr_v3.json diar.json > composed_v3.json
```
