# Long-Form Audio on the FluidAudio / Parakeet TDT Stack

**Date:** 2026-07-20
**Issue:** qodesmith/recap#17 (child of #1; premise is the #2 decision)
**Source of truth:** FluidAudio at commit `baa11f65daa3003daf4401308786b1dcdeddd84e` (2026-07-20), read as source, not README.
**Constraints assumed:** hour-scale conversations are the normal case; word timings are load-bearing for playback sync; one-action transcribe+diarize; Swift sidecar linking FluidAudio as a library.

## Bottom line up front

**The premise of this ticket is wrong, and the correction is good news.** Parakeet TDT's two attention modes are real in NeMo/PyTorch, but **FluidAudio never reaches them**. The Core ML encoder is compiled with a **fixed 240,000-sample (15.00 s) input window** (`ASRConstants.maxModelSamples`), so there is no ~24-minute threshold and no attention-mode switch anywhere in the Swift stack. The routing test is one line: `if audioSamples.count <= ASRConstants.maxModelSamples` decode in one pass, `else` hand the whole file to `ChunkProcessor`. **Anything over 15 seconds is chunked.** A two-hour file is not a special case — it is the same path a 20-second file takes, roughly 556 chunks instead of 2.

`SlidingWindow` is a **directory name**, not a runtime code path. The batch TDT decoder lives at `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/`. The #17 inference from the file path pointed at the right file for the wrong reason.

**Word timings stay globally coherent, and this is structural rather than incidental.** Chunk-local frame indices are never rebased after the fact — each chunk is decoded with a `globalFrameOffset` computed from its start sample, and the decoder adds that offset *at emission time* (`TdtDecoderV3.swift:416`). Timestamps are absolute the moment they exist. Frames-to-seconds conversion happens exactly once, over the merged stream. There is no accumulator, so **no drift is possible** — the failure mode this ticket feared is not in the design.

What *is* real at seams is content damage, not timing damage: dropped words, duplicated words, and glued words. FluidAudio has spent roughly a year fixing these, and `Documentation/ASR/LongTranscription.md` (691 lines) documents the failure classes, the fixes, and — unusually — the ones still open. Recap should read that document as a risk register, not a reassurance.

Memory fits: the disk-backed paths `mmap` a decoded temp file, so a two-hour file costs **~460 MB of temp disk**, with diarization the heap-dominant stage at **~490 MB** (ASR is far lower). Provided the sidecar passes a **URL and not a `[Float]` array** — the array overload silently adds another 460 MB and is the more obvious API.

**Two real risks land on Recap, and neither is timing drift.** First, **diarization speaker-count estimation is an unbounded fixed-threshold cut with no duration normalization** — over two hours it will tend to split one speaker into several, and nothing caps the count. Recap's mergeable Recording-scoped `Speaker` (from #6) is the mitigation, and this raises the value of speaker-merge UX from convenience to necessity. Second, **both stages have unreported tails**: diarization's progress callback covers segmentation only and goes silent through clustering, which is exactly the "bar stuck at 100%" hazard #13 is trying to avoid.

---

## Answers, by the ticket's eight points

### 1. Do the two attention modes exist, what's the threshold, and who flips the switch?

**The modes exist. The threshold does not. And none of it reaches Recap.**

Both attention modes are real in NeMo/PyTorch. The switch is an **explicit caller-side API call with no automatic duration logic anywhere in NeMo's source**. From the v3 model card, under "Transcribing long-form audio":

```python
asr_model.change_attention_model(
    self_attention_model="rel_pos_local_attn", att_context_size=[256, 256])
```

`change_attention_model` is defined in `nemo/collections/asr/parts/mixins/mixins.py:523` and `conformer_encoder.py:1154`. Nothing in `transcription.py` (the `transcribe()` path) or `rnnt_models.py` references attention mode or audio duration — **there is no duration-conditional branch to find.**

**The "~24 minute threshold" is a misreading.** 24 minutes is a documented **memory ceiling for full attention**, not a mode-switch trigger. Nothing switches at 24 minutes; you exceed it and OOM unless you have already called `change_attention_model` yourself. The v3 card: *"supporting audio up to 24 minutes long with full attention (on A100 80GB) or up to 3 hours with local attention."* The v2 card states 24 minutes bare, **with no hardware named and no long-form section at all** — no `change_attention_model`, no local attention, no 3-hour figure. That material is v3-only.

The published ceilings, for completeness:

| Source | Claim |
|---|---|
| v2 model card | "up to 24 minutes in a single pass" — **no hardware stated** |
| v3 model card | 24 min full attention **on A100 80GB**; up to 3 h local attention |
| NeMo `inference.rst` | local attention recommended for audio ">1 hour"; no upper bound |
| Fast Conformer paper (arXiv:2305.05084), Table 3 | Max transcribable minutes, batch 1, A100: Fast Conformer **25**; Fast Conformer + Limited Context **675** (11.25 h) |

Note the docs disagree with themselves on context size — `inference.rst` uses `att_context_size=[128,128]`, the v3 card uses `[256,256]`, with no reconciliation and no stated accuracy difference.

**Why none of this is actionable for Recap.** Every number above is A100-80GB PyTorch. FluidAudio does not run PyTorch, does not call NeMo, and cannot call `change_attention_model` — the Core ML encoder is exported with a **fixed 240,000-sample input shape**, so attention configuration is baked in at conversion time and is not a runtime choice. Searching the entire FluidAudio tree for `local_attn`, `att_context`, "full attention", or `24 min` returns hits only in the **Nemotron streaming** model family (`att_context_size=[56,0]`), a different architecture Recap is not using. **For the chosen stack, question 1 is moot: the answer is "neither mode — a fixed 15-second window."**

### 2. What does FluidAudio actually do with a two-hour file?

**It chunks it into ~556 overlapping 15-second windows and merges them.** It does not switch attention mode (it cannot), and it does not refuse.

The routing decision, `AsrManager+Transcription.swift:15`:

```swift
if audioSamples.count <= ASRConstants.maxModelSamples {
    // single-pass: pad to 240,000 samples and decode
```

with the `else` branch at line 40–41 constructing `ChunkProcessor(audioSamples:)`. `maxModelSamples` is `240_000` — 15.0 s at 16 kHz (`ASRConstants.swift:9-12`). So the real threshold in this stack is **15 seconds, not 24 minutes**.

Chunk geometry is fixed, derived from the encoder, and *not runtime-configurable* (`LongTranscription.md`, "Chunk Geometry"):

| Quantity | Value | Source |
|---|---|---|
| Encoder window | 240,000 samples (15.00 s) | `ASRConstants.maxModelSamples` |
| Encoder frame | 1,280 samples (80 ms) | `ASRConstants.samplesPerEncoderFrame` |
| Visible chunk | ≈14.96 s, frame-aligned | `ChunkProcessor.chunkSamples(...)` |
| Overlap | 2.0 s, frame-aligned, capped at `chunkSamples/2` | `ChunkProcessor.overlapSeconds` |
| Stride | `chunk − overlap` ≈ 12.96 s | `ChunkProcessor.strideSamples(...)` |
| Minimum seam overlap | 6 frames (480 ms) | `silenceAlignedChunkStarts` |

**Two hours at a ~12.96 s stride ≈ 556 chunks and ~555 seams.** FluidAudio's own seam canary fixture is a 1-hour file with "~277 seams" (`LongTranscription.md`, "Seam Canary"), which corroborates the arithmetic.

Chunks are decoded **statelessly and in parallel** — each gets a fresh `TdtDecoderState` — across a worker pool of cloned `AsrManager`s, default `parallelChunkConcurrency = 4`. FluidAudio reports **2.2–2.8× wall-clock speedup on an M3 with a 1-hour file**, costing 19–31 MiB extra resident per the extra clones.

### 3. **Critical:** do word timings stay globally coherent across chunk boundaries?

**Yes. Timings are absolute by construction, not rebased afterward.**

The chain, traced through source:

1. `ChunkProcessor.transcribeChunk` computes the offset from the chunk's position in the *file*:
   ```swift
   let globalFrameOffset = chunkStart / ASRConstants.samplesPerEncoderFrame
   ```
   (`ChunkProcessor.swift:765`, with the comment "Global frame offset is based on original chunkStart".)

2. It is passed down through `executeMLInferenceWithTimings` into the decoder, where every emitted token's timestamp is offset **at the moment of emission**:
   ```swift
   let emissionTimestamp = timeIndicesCurrentLabels + globalFrameOffset
   ```
   (`TdtDecoderV3.swift:416`; the final-token path at line 543 does the same.)

3. Frames become seconds **exactly once**, after the merge, over the whole file's token stream (`AsrManager+TokenProcessing.swift:53,73`): `startTime = TimeInterval(frameIndex) * 0.08`.

Three consequences worth stating plainly:

- **No drift is structurally possible.** Nothing accumulates. Each chunk's offset is computed independently from its own start sample by integer division, and chunk starts are always frame-aligned (`chunkLayout` guarantees `raw / samplesPerEncoderFrame * samplesPerEncoderFrame`). Seam #500 is exactly as accurate as seam #1. This is a stronger guarantee than the ticket hoped for.
- **No overlap in the output.** The merge picks one side of each overlap region per token; it never emits both. The merged stream is then sorted by timestamp (`ChunkProcessor.swift:675`) and converted in order.
- **Resolution is 80 ms, uniformly.** Timestamps quantize to the encoder frame. For playback-sync highlighting this is the real precision limit — not seam behavior.

One systematic, *global* correction to be aware of: the pipeline subtracts one encoder frame from every token to compensate for TDT emission delay ("tokens are emitted ~1 encoder frame after the acoustic event (median offsetStart = +1 frame on earnings22 across both v2 and v3)", `AsrManager+TokenProcessing.swift:55-67`, overridable via `TDT_EMISSION_DELAY_FRAMES`). This is applied uniformly to every token, so it shifts the whole timeline by 80 ms rather than distorting it at seams.

**Evidence caveat.** The tests that cover this (`TdtDecoderChunkTests.swift:127-145, 200-212`) *re-implement the offset arithmetic in the test body* and assert on their own restatement rather than driving the decoder. They pin the formula, not the wiring. The formula is correct and I read the production call sites directly, but an end-to-end assertion that a long file's timings are monotonic and land on real word onsets does not exist upstream. **#10 should measure this rather than assume it.**

### 4. What happens to words straddling a boundary?

They can be **duplicated or glued**; the codebase's stated invariant is that they must **never be dropped** — and that invariant is recent and hard-won.

The merge is a four-step ladder (`ChunkProcessor.mergeChunks`, documented in `LongTranscription.md` "Overlap Merge"): disjoint shortcut → contiguous time-tolerant match → LCS fallback → midpoint split. Matching is on **token ID + frame-time tolerance** (`overlapSeconds / 2` = 1.0 s), never on text, so it is language-agnostic and cannot collapse two different words sharing a substring.

Layered on top, each traceable to a specific upstream bug:

- **Word-boundary splice repair** (issue #683). The two windows tokenize the same seam audio independently, and the right window often drops the SentencePiece `▁` prefix because the word is utterance-initial for it. Splicing a continuation piece straight after a left token produced `"work" + "ks"` → `"worksks"`, and mid-word punctuation like `"ye,ah"`. Fixed by deriving a **splice-safe token ID set** from the vocabulary (pieces with `▁`/space prefix, or punctuation-only) and only ever splicing at those.
- **Case-folded matching + duplicate collapse** (issue #706). A window starting mid-sentence biases the decoder to capitalize its first word, so exact-ID matching couldn't align `Meeting` with the previous window's `meeting`, leaving `…the meeting Meeting was…`. Fixed with `caseVariantCanonicalIds` plus `collapseSeamWordDuplicates`, which reconstructs whole SentencePiece words before deduping. Genuine repeats ("that that") and real sentence boundaries are deliberately left alone.
- **Seam-gap repair** (issue #758, PR #761, **July 2026 — three weeks old**). The worst class: the decoder emits *blank* for audible speech at a low-SNR seam (crosstalk, applause, soft speech), so the words exist in neither chunk and no merge-layer fix can see them. `repairSeamGaps` walks inter-token gaps over 1.5 s that carry speech-level energy and re-decodes each with a fresh seam-free window, splicing in only strictly-in-gap tokens. Notably, "which seams fail depends on decoder state and shifts with model recompilation — the same file drops *different* spans after an e5rt/ANE recompile."
- **End-aligned final window** (issue #747, July 2026). A short trailing chunk zero-padded to the model window decoded to all-blank on quiet audio, ending the transcript several words early **with high confidence and no error**. Now the last chunk backfills backwards with real audio and ends at the last speech-bearing frame rather than EOF. **Requires the V3 decoder** — v2 and tdtCtc110m keep the old zero-padded layout and remain exposed to this.
- **Bound-safe fallbacks** (PR #759). Closed three residual paths where a seam with no splice-safe token could silently discard content. The governing rule: *"a seam may produce a glued word in the worst case, but it must never delete real content."*

**Residual, per FluidAudio's own "Known Limitations":**
- Seam **garbles** ("language in" → "languag ines") leave no token gap, are invisible to the repair pass, and need a fix in the merger itself. **Open.**
- Edge re-hearings can duplicate a boundary word at roughly **1 per 15–20 min of dense conference speech**. Deliberately not deduped harder, because genuine stutters sit at the same time separations.
- The dead-silence-at-window-end pathology also hits **mid-file** windows whose stride lands inside a silence run; a general fix was tried and reverted as net-neutral on WER. **Open, and Recap-relevant** — conversation recordings have plenty of mid-file silence.

For Recap's two-hour normal case, calibrate on that duplicate rate: **~6–8 duplicated boundary words per two-hour recording**, plus an unquantified garble rate. Segment-level editing (already in scope per #1) covers this; it does not threaten the timing model.

### 5. Accuracy cost of the long-form path vs full attention

**Nobody publishes this, and for Recap the comparison is unmeasurable in principle.**

On the NVIDIA side: **no Parakeet TDT longform WER exists.** Neither model card scores longform separately — both benchmark tables are short-form (Open ASR Leaderboard, FLEURS, MLS, CoVoST). The v3 technical report (arXiv:2509.14128) has a longform inference section that evaluates **Canary only**; Parakeet-TDT-0.6B-v3 is not in it.

The one adjacent NVIDIA number is from the Fast Conformer paper, where limited context **improved** longform WER (TED-LIUM v3 9.15% → 7.5%; Earnings21 17.65% → 11.85%). **Do not transfer that result.** It is a different checkpoint, and critically it was *trained* with limited context, whereas Parakeet TDT v2/v3 are "trained with full attention" (v2 card). Applying `change_attention_model` post-hoc is a train/inference mismatch, and NVIDIA publishes no WER for that case.

On the FluidAudio side the question dissolves: **there is no full-attention path to compare against.** Every file over 15 seconds is chunked, so "long-form path vs full attention" has no A/B. The closest available figures come from FluidAudio's own benchmarks (M2 Air, 100 files, `benchmarks100.md`):

| Dataset | Model | WER |
|---|---|---|
| LibriSpeech test-clean (short, mostly single-chunk) | Parakeet TDT v3 | **2.6%** |
| LibriSpeech test-clean | Parakeet TDT v2 | 3.8% |
| Earnings22-KWS (long-form conference) | TDT + CTC | **16.5%** |

**That 2.6% → 16.5% gap is not a chunking penalty** and must not be quoted as one — it confounds chunking with domain, audio quality, speaker count, and vocabulary. It is included only to set the expectation that clean-read-speech WER is not what Recap will see.

The two genuinely attributable long-form numbers in the source:

- Silence-aligned chunk starts measured **~1 WER point *worse*** on Earnings-22 long-form with no artifact benefit, and were dropped from the default path — "the fix belongs in the merge, not the chunk grid."
- Dual-decode arbitration costs **≈1.1–1.5× runtime** and is off by default; FluidAudio classes its wins as "quality-tier rather than correctness-tier."

**The honest summary: the accuracy cost of chunking on this stack is unpublished and unmeasured.** FluidAudio's own guidance is that aggregate WER is the wrong instrument anyway — "a merge bug can be invisible to the aggregate metric and still make transcripts unusable" (the #683 fix repaired six seam artifacts in an hour of audio while remaining exactly WER-neutral on FLEURS). #10 should count artifacts, not compute WER.

### 6. Memory ceiling — does a two-hour file fit?

**Comfortably.** `ASRConfig.streamingEnabled` defaults to `true` with `streamingThreshold = 480_000` samples (30 s), so any Recap-sized file automatically takes the disk-backed path (`AsrManager.swift:393-401`).

`AudioSourceFactory.makeDiskBackedSource` (`AudioSourceFactory.swift:11-85`) decodes/resamples the input to a **temp file** via `AVAudioConverter` streaming conversion, then maps it:

```swift
let mappedData = try Data(contentsOf: tempURL, options: [.mappedIfSafe])
```

So the decoded PCM lives on disk and is paged in per chunk. `AsrManager.transcribeDiskBacked`'s doc comment claims **"constant memory usage (~1.2MB) regardless of file size"**; `LongTranscription.md` puts it as "the difference between a few hundred MiB of peak resident memory and a few hundred KiB."

Concrete two-hour budget:

| Item | Size |
|---|---|
| Temp decoded PCM on **disk** | 7200 s × 16000 × 4 B ≈ **460 MB** |
| Resident audio (mmap working set) | ~1–2 MB |
| Parakeet Core ML weights | ~500 MB (from #2) |
| 4 worker clones | +19–31 MiB total (clones share loaded models) |

**The real constraint is transient disk, not RAM** — ~460 MB in `NSTemporaryDirectory()` per in-flight track. Recap processes tracks separately (standing decision in #1), so concurrent multi-track processing multiplies this. Worth a disk-space preflight and worth confirming cleanup: `DiskBackedAudioSampleSource` holds `fileURL` and there is a `cleanup()` call on the guard path, but I did not trace every exit path to confirm the temp file is always removed. **#10 should watch `TMPDIR` across a run.**

Lowest-water-mark configuration, per the docs: `parallelChunkConcurrency = 1` with streaming enabled — at the cost of the 2.2–2.8× speedup.

### 7. Does the diarization pipeline have its own long-form limit?

**No hard limit, timings are absolute, cost scales fine — but speaker-count estimation is the single weakest link in the whole pipeline for hour-scale audio.**

**Geometry.** `OfflineDiarizerConfig.Segmentation.community` (`OfflineDiarizerTypes.swift:46-55`) is a **10 s window with `stepRatio: 0.2` → a 2.0 s hop (80% overlap)**. Windows are pulled from the audio source in a `stride` loop in batches of 32, reusing the previous window's tail via `memmove` (`OfflineSegmentationProcessor.swift:124-233`) — never a whole-file array. Segmentation and embedding run concurrently, joined by an `AsyncThrowingStream`.

**Two hours → 3600 windows**, ~113 batched segmentation predictions, and (at ≤3 powerset speaker slots per window, minus masks rejected below a 20% activity floor) **~5,000–6,000 embeddings**, hard-capped at 10,800.

**No duration guard exists.** `OfflineDiarizerConfig.validate()` checks thresholds, step ratio and batch size — no duration check. The `duration < 1.0` guard in `AudioValidation.swift` is wired only into the *legacy streaming* `DiarizerManager`, never the offline path. The only hard failure is `noSpeechDetected` on zero samples or zero surviving embeddings. **It will not refuse a two-hour file.**

**Clustering cost is fine.** VBx itself is **linear** — O(N·K·D) per iteration via two BLAS `dgemm` calls, O(N·K) memory, capped at **20 iterations** with a `1e-4` tolerance. There is no pairwise affinity matrix anywhere. The quadratic step is the **AHC warm start** (`fastcluster` centroid linkage): O(N·D) memory but ≥O(N²) time. At N≈5,400 with D=256 that is ~14.6 M pair distances ≈ **1–3 seconds**, with buffers around 11 MB. Fine at two hours; it grows 4× per doubling, so it is the thing that would eventually bite on a much longer file — not at Recap's scale.

**Timestamps are globally absolute**, by the same design as ASR. The chunk offset is computed from the sample offset at the source (`OfflineSegmentationProcessor.swift:303`: `Double(offset) / Double(config.sampleRate)`) and embedding times are `chunkOffsetSeconds + frameIndex * frameDuration` where `frameDuration = 10/589 ≈ 16.978 ms`. Stitching is **vote accumulation onto one global frame grid**, not sequential rebasing (`OfflineReconstruction.swift:59-104`) — each global frame is covered by 5 overlapping windows and averaged. Cross-window speaker identity needs no permutation matching because **clustering is global over all embeddings first**. No drift, same as ASR.

**The problem: speaker count is an unbounded, threshold-based cut with no duration normalization.**

```swift
public static let community = Clustering(
    threshold: 0.6, warmStartFa: 0.07, warmStartFb: 0.8,
    minSpeakers: nil, maxSpeakers: nil, numSpeakers: nil)
```
(`OfflineDiarizerTypes.swift:137-144`)

K is decided entirely by AHC at a fixed cosine threshold of 0.6, and **VBx never revises it** — `VBxClustering.swift:78` simply adopts `Set(initialClusters).count`. VBx can only *prune* speakers whose weight falls below `1e-7`. With `maxSpeakers: nil`, no cap is applied at all (constraints are built only if the caller sets one; unset, max defaults to the embedding count).

**This is a structural degradation risk over long audio, and it confirms the ticket's suspicion.** A fixed cosine cut on a dendrogram over a monotonically growing point set has no duration normalization, so channel drift, room acoustics, mic distance changes and vocal fatigue over two hours tend to **split one speaker into several clusters**, with nothing bounding the count. Note that the 3-speaker limit in reconstruction bounds only *concurrent* speakers per frame, **not the global count** — so a two-hour recording of three people can legitimately emit far more than three speakers.

Recap has two mitigations already in the design and should lean on them: `Speaker` is Recording-scoped, renameable and **mergeable** (per #6/`CONTEXT.md`), and the mic track has a known speaker. Setting `maxSpeakers` explicitly is available but has a sharp edge — supplying any constraint triggers a **full K-means re-cluster (n_init=10, 100 iterations) that discards VBx's assignment entirely** (`VBxClustering.swift:709-715`). That is a different algorithm, not a clamp, and would need its own evaluation.

**Memory** is heavier than ASR but fits. The file-based API is mmap-backed like ASR. Estimated two-hour heap:

| Item | MB |
|---|---|
| `SegmentationOutput` retained for whole file (`logProbs` 153 + `speakerWeights` 119) | **272** |
| Reconstruction frame grid (~424,600 frames × K) | ~110 |
| Clustering copies (embeddings 11 + AHC 22 + VBx 6) | ~40 |
| `TimedEmbeddings` (~5,400 × ~4.5 KB) | ~25 |
| ANE pooled buffers | ~40 |
| mmap'd audio (+460 MB temp file on disk) | 460 mapped, clean/evictable |
| **Heap total** | **~490 MB + model weights** |

Two findings inside that worth flagging. First, `logProbs` — **~150 MB of the 272 MB is pure waste**: it is accumulated for every chunk of the file, re-wrapped into `SegmentationChunk`, and **never read** by `processChunk` or `OfflineReconstruction`. Second, calling the `[Float]` overload `process(audio:)` instead of the file API **adds a further 460 MB**; the CLI correctly avoids it, and **Recap's sidecar must pass a URL, not a sample array.** That is a live footgun, since the array overload is the more obvious API.

So diarization is the memory-dominant stage of the pipeline (~490 MB vs ASR's low-hundreds), and ASR + diarization on the same track should be run **sequentially, not concurrently**, unless #10 measures otherwise.

### 8. Is chunk-level progress observable from outside the sidecar?

**The API exists; the CLI doesn't use it — and for Recap that distinction doesn't matter.**

`ChunkProcessor.process` takes an optional progress callback (`ChunkProcessor.swift:458`):

```swift
progressHandler: ((Double) async -> Void)? = nil
```

fired after each chunk is dispatched with `Double(chunkEnd) / Double(totalSamples)` (line 621-624).

The **offline VBx diarizer has a different callback** — note it is *not* the `DiarizerManager.performCompleteDiarization(progressHandler:)` `0.0...1.0` API, which belongs to the legacy *streaming* diarizer Recap is not using. The offline path reports counts (`OfflineDiarizerManager.swift:180-200`):

```swift
let totalChunks = max(1, (audioSource.sampleCount + config.samplesPerStep - 1) / config.samplesPerStep)
...
chunkHandler: { chunk in progressCallback?(chunk.chunkIndex + 1, totalChunks)
```

`ProcessCommand` consumes it but logs at only 25% granularity.

**`TranscribeCommand` never passes an ASR progress handler at all.** Grepping `progressHandler` across `Sources/FluidAudioCLI/` returns exactly one hit, in `JapaneseAsrBenchmark`. So the *stock CLI binary* emits no incremental ASR progress and would need patching.

But per #2, Recap is **writing its own Swift sidecar** against FluidAudio as an SPM dependency, not shipping `fluidaudiocli`. That sidecar passes its own closures and prints whatever JSON progress lines Recap wants. **No fork, no patch — these are library calls.** That closes the "would it need patching" question in #13's favour.

Granularity is good on paper: ~556 ASR ticks and 3,600 diarization ticks over a two-hour file. Four caveats for #13, and they are the substance of this point:

- **Diarization progress covers only segmentation.** The callback fires from the segmentation task alone. `cluster(_:)` — embedding flush, AHC, VBx, reconstruction — has **no progress reporting whatsoever**, only after-the-fact `logger.debug` timings. On a two-hour file the diarization bar reaches 100% while a substantial fraction of wall time is still ahead. This is the #13 anti-pattern ("a bar that sits at 90% for four minutes is worse than no bar") sitting in the library by default.
- **ASR progress fires at dispatch, not completion.** With `parallelChunkConcurrency = 4`, up to four chunks are in flight, so the bar runs slightly ahead of real work and is not monotonic in work done.
- **ASR has a silent tail too.** The seam-gap repair pass runs *after* the last chunk reports and can add up to 32 extra window decodes (~20% over baseline on applause-heavy audio).
- **Weighting is not 50/50.** Published RTFx (~207× ASR, ~60× diarization, M4 Pro, self-reported, from #2) puts diarization at roughly **3.5× the wall-clock of ASR.**

Both stages therefore have unreported tails at the end. The design implication for #13 is concrete: **do not model this as one continuous bar.** Named stages with an explicit indeterminate "clustering speakers" / "finishing up" phase match what the pipeline can actually report. Recap's sidecar could add its own coarse markers around `cluster(_:)` (embeddings → AHC → VBx → reconstruction) since it controls the call site, but the library will not hand it percentages for that span.

---

## What #10 must measure

Settled from source and needing no spike: chunk geometry, the timestamp-offset mechanism, the progress API, the memory model. Genuinely open:

1. **End-to-end timing coherence on a real hour-plus file** — the upstream tests pin the arithmetic, not the wiring. Assert monotonicity and spot-check word onsets against the waveform *at seams specifically* (multiples of ~12.96 s).
2. **Seam artifact rate on Recap-like audio.** FluidAudio's numbers come from earnings calls and dictation. A compressed Zoom mixdown with crosstalk is the exact profile that triggers the #758 low-SNR class. Count duplicates, garbles, and drops per hour.
3. **The mid-file dead-silence class** (open upstream). Conversation recordings have long silences; a stride boundary landing in one can lose a window. Test a file with deliberate multi-second pauses.
4. **Temp-file cleanup** under success, failure, and cancellation.
5. **Peak RSS and wall clock** on a two-hour file at `parallelChunkConcurrency` 1 vs 4.
6. **Whether the v3 no-mel path is needed.** Default `melChunkContext = true` caused wrong-language drift at seams on v3 multilingual audio (#594). Recap is English-dominant, where the mel prepend is the *fix* not the bug — but this needs one A/B, since #16 may pick v3.
7. **How many speakers diarization actually reports for a known-3-person, two-hour conversation.** This is the highest-value single measurement on the ticket: it directly sizes the speaker-merge burden and tests the drift hypothesis. Also worth capturing how the count grows with duration (same recording truncated to 15 / 30 / 60 / 120 min).
8. **Wall-clock split between segmentation and clustering** in diarization, since the progress callback goes silent for the second part. #13 cannot weight what nobody has timed.

## Unresolved

Stated plainly, per the ticket's instruction:

- **The accuracy cost of chunking is unpublished by anyone** and cannot be derived. NVIDIA publishes no Parakeet TDT longform WER; FluidAudio has no full-attention path to compare against. Only #10 can produce a number, and it should be an artifact count rather than WER.
- **NVIDIA documents no timestamp-coherence guarantee or caveat** for long-form or chunked inference in either direction — "Timestamps" and "Long Audio Inference" are adjacent sections of `inference.rst` with zero cross-reference. This does not affect the finding for Recap, which rests on FluidAudio's Swift source rather than NeMo's behaviour, but it means there is no upstream authority to appeal to.
- **Upstream timing tests restate the arithmetic rather than exercise the decoder** (see point 3). The mechanism is correct as read; it is simply not defended by an executable end-to-end assertion.
- **Diarization Core ML weight sizes** are not determinable from source — models are downloaded at runtime.
- **Temp-file cleanup** on all failure and cancellation paths was not traced exhaustively.
- **Embeddings-per-window is content-dependent**; the two-hour cost estimates assume ~1.5 of a possible 3 per window. AHC time scales with the square of whatever it truly is.

---

## Sources

**FluidAudio** (commit `baa11f6`, read locally; paths are repo-relative)
- `Documentation/ASR/LongTranscription.md` — chunk geometry, failure modes, merge ladder, repair passes, evolution table, known limitations
- `Sources/FluidAudio/Shared/ASRConstants.swift` — `maxModelSamples = 240_000`, `samplesPerEncoderFrame = 1280`, `secondsPerEncoderFrame = 0.08`
- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/ChunkProcessor.swift` — chunking, boundary search, merge ladder, seam-gap repair, progress callback
- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/AsrManager+Transcription.swift` — the 15 s routing test
- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/AsrManager.swift` — streaming threshold, `transcribeDiskBacked`
- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/Decoder/TdtDecoderV3.swift` — `emissionTimestamp = local + globalFrameOffset`
- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/TDT/AsrManager+TokenProcessing.swift` — single frames→seconds conversion, emission-delay correction
- `Sources/FluidAudio/ASR/Parakeet/AsrTypes.swift` — `ASRConfig` long-form knobs, `WordTiming`, `buildWordTimings`
- `Sources/FluidAudio/Shared/AudioSourceFactory.swift` — temp-file decode + `.mappedIfSafe`
- `Sources/FluidAudio/Diarizer/Offline/Core/OfflineDiarizerTypes.swift` — 10 s/2 s window geometry, clustering defaults (`threshold: 0.6`, `maxSpeakers: nil`), `validate()` with no duration check
- `Sources/FluidAudio/Diarizer/Offline/Core/OfflineDiarizerManager.swift` — pipeline, AHC warm start, progress callback, disk-backed source
- `Sources/FluidAudio/Diarizer/Offline/Segmentation/OfflineSegmentationProcessor.swift` — streaming window loop, chunk offsets, retained `SegmentationOutput`
- `Sources/FluidAudio/Diarizer/Offline/Extraction/OfflineEmbeddingExtractor.swift` — embedding times, activity floor
- `Sources/FluidAudio/Diarizer/Offline/Utils/OfflineReconstruction.swift` — global frame grid vote accumulation
- `Sources/FluidAudio/Diarizer/Clustering/VBxClustering.swift` — linear VBx, 20-iteration cap, `speakerCount` adopted from AHC
- `Sources/FluidAudio/Diarizer/Clustering/AHCClustering.swift` + `Sources/FastClusterWrapper/` — O(N²) centroid linkage
- `Sources/FluidAudio/Diarizer/Core/DiarizerManager.swift` — legacy *streaming* diarizer progress API (**not** the offline path)
- `Sources/FluidAudioCLI/Commands/ASR/Parakeet/SlidingWindow/TranscribeCommand.swift` — no progress handler wired
- `Tests/.../TdtDecoderChunkTests.swift` — offset tests (arithmetic restatement, see caveat)
- `Documentation/ASR/benchmarks100.md` — WER/RTFx tables (M2 Air, 100 files)
- Upstream issues referenced: [#683](https://github.com/FluidInference/FluidAudio/issues/683), [#706](https://github.com/FluidInference/FluidAudio/issues/706), [#747](https://github.com/FluidInference/FluidAudio/issues/747), [#758](https://github.com/FluidInference/FluidAudio/issues/758), [#594](https://github.com/FluidInference/FluidAudio/issues/594)

**NVIDIA / NeMo**
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2 — "up to 24 minutes in a single pass", no hardware, no long-form section
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 — `change_attention_model` example, 24 min full attention on A100 80GB / 3 h local attention
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/raw/main/config.json — `subsampling_factor: 8`, TDT durations `[0,1,2,3,4]`
- https://github.com/NVIDIA-NeMo/NeMo/blob/main/docs/source/asr/inference.rst — "Long Audio Inference", `att_context_size=[128,128]`, `time_stride = 8 * window_stride`
- https://github.com/NVIDIA-NeMo/NeMo/blob/main/nemo/collections/asr/parts/mixins/mixins.py — `change_attention_model` (`:523`), `change_subsampling_conv_chunking_factor` (`:590`)
- https://github.com/NVIDIA-NeMo/NeMo/blob/main/nemo/collections/asr/parts/mixins/transcription.py — no duration-conditional branch
- https://arxiv.org/abs/2305.05084 — Fast Conformer; Table 3 max transcribable duration; limited-context longform WER
- https://arxiv.org/abs/2304.06795 — TDT ("Efficient Sequence Transduction by Jointly Predicting Tokens and Durations")
- https://arxiv.org/abs/2509.14128 — Canary-1B-v2 & Parakeet-TDT-0.6B-v3 report (longform section evaluates Canary only)
