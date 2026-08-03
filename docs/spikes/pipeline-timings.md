# Measurement: the spans #13 guessed at

**Issue:** [qodesmith/recap#19](https://github.com/qodesmith/recap/issues/19)
**Date:** 2026-08-03
**Verdict:** the unreportable span is **~2 % of a run, not 50 %**. #13's phase weighting was wrong by an order of magnitude in the direction that makes its design *safer*, not riskier — but two structural assumptions underneath it are wrong and need correcting.

Throwaway spike measurement. Machine: Apple Silicon, macOS 26.5.2, Xcode CLT Swift 6.3.3. FluidAudio cloned at HEAD 2026-08-03, release build, patched with `RECAP_TIMING` stderr instrumentation (see [Instrumentation](#instrumentation)).

## Samples

| name | duration | speakers found | note |
|---|---|---|---|
| `zeyad 01.mov` | 34.5 min | 2 | the #10 sample — 2-person interview |
| `project aurora 1.mkv` | 58.6 min | 3 | ground truth not established |
| `initial talk about embedded ai.mkv` | 83.3 min | 6 | ground truth not established |
| `07-19-2026-all-your-trust.mkv` | 109.4 min | 4 | ground truth not established |

None are committed (private, GB-scale).

---

## Measurement 1 — the clustering split

Full pipeline on the 34.5-min sample (2071 s audio):

| stage | wall | share | reportable? |
|---|---|---|---|
| decode → 16 kHz mono | 1.74 s | 6.2 % | bar (`-progress`) |
| **ASR total** | **13.59 s** | **48.4 %** | |
| — chunked decode (161 chunks) | ~9.6 s | 34.2 % | bar |
| — seam-gap repair | 3.98 s | 14.2 % | **see measurement 4** |
| **diarization total** | **10.23 s** | **36.4 %** | |
| — audio load | 0.05 s | 0.2 % | — |
| — segmentation ‖ embedding extraction | 9.49 s wall | 33.8 % | bar (chunked) |
| — **cluster phase** | **0.57 s** | **2.0 %** | **the only spinner span** |
| mixdown (`aac_at`) | 2.54 s | 9.0 % | bar |
| **total** | **~28.1 s** | | **~74× realtime** |

### Inside the cluster phase

| sub-phase | wall | share of cluster phase |
|---|---|---|
| AHC | 0.442 s | 77.8 % |
| VBx | 0.0011 s | 0.2 % |
| centroids + assignment | 0.0008 s | 0.1 % |
| reconstruction | 0.122 s | 21.5 % |

**#13's 50/50 assumption was ~25× pessimistic.** The span that shows a spinner instead of a bar is 2 % of the run — 0.57 s out of 28 s. Three of #13's four spinners are sub-frame (VBx 1 ms, assignment 0.8 ms); only AHC is even perceptible, and at 0.44 s nothing can "feel stuck".

### Two structural corrections to #13

**1. Embedding extraction is not in the cluster phase.** It runs in `prepare()`, in a `Task.detached` racing segmentation, consuming segmentation's chunk stream as it is produced:

- segmentation: 6.47 s
- embedding extraction: 9.49 s
- prepare wall: **9.49 s** — the two overlap almost completely

So #13's spinner list (embeddings → AHC → VBx → reconstruction) is wrong on its first and largest item. Embedding extraction is chunk-driven and *longer* than segmentation, so it is the phase that should carry the diarization bar — and the two cannot be shown as sequential steps because they aren't sequential.

**2. AHC is O(n²) in embedding count.** Measured across all four samples:

| audio | embeddings | AHC | cluster phase |
|---|---|---|---|
| 34.5 min | 1221 | 0.442 s | 0.57 s |
| 58.6 min | 1865 | 0.976 s | 1.19 s |
| 83.3 min | 1935 | 1.032 s | 1.32 s |
| 109.4 min | 3259 | 3.035 s | 3.43 s |

`(3259/1221)² = 7.12`; `0.442 × 7.12 = 3.15 s` vs measured 3.04 s — quadratic, confirmed. Extrapolating to V1's ~2 h worst case: ~3600 embeddings → **AHC ≈ 3.8 s, cluster phase ≈ 4.3 s**. Still a tolerable spinner. It stops being tolerable past ~4 h (≈15 s), which V1 does not target.

---

## Measurement 2 — FFmpeg stages

Per audio-minute, on the 34.5-min sample:

| stage | measured | #13's guess | verdict |
|---|---|---|---|
| decode → 16 kHz mono WAV/FLAC | **0.050 s/min** | 0.30 s/min | 6× pessimistic |
| mixdown, `aac_at` encoder | **0.074 s/min** | 0.25 s/min | 3.4× pessimistic |
| mixdown, native `aac` encoder | 0.253 s/min | 0.25 s/min | dead on |

**The encoder choice is the whole mixdown stage.** Native `aac` takes 8.75 s; AudioToolbox `aac_at` takes 2.54 s for identical work — 3.4×. Isolating the rest (`amix` of two FLACs to `-f null`) costs 0.99 s, so the *mix* is nearly free and the encode dominates.

`aac_at` wraps the macOS AudioToolbox system framework — no licensing consequence for #4's LGPL decode-only sidecar, but the sidecar build **must not disable `--enable-audiotoolbox`** (default-on on macOS).

Mixdown variants measured (34.5 min): 2 × 16 kHz FLAC → m4a = 8.75 s; 1 track → m4a = 8.53 s; original 48 kHz source → m4a = 10.80 s. Track count barely moves it.

Note `-c:a flac` from a float source silently produced a **larger** file than the raw WAV (67 MB vs 66 MB). Forcing `-sample_fmt s16` gives 33.9 MB — a ~2× storage difference on #12's `tracks/*.flac`.

---

## Measurement 3 — speaker count and cluster similarity

### Within- vs between-speaker similarity is a clean, wide gap

Cosine similarity of per-Speaker average 256-dim embeddings, all 4 samples, 15 pairs:

| | range observed |
|---|---|
| **between different Speakers** | **−0.054 … 0.298** |
| **within one Speaker** (chunk vs own average, mean) | **0.554 … 0.873** |

Every between-Speaker pair across every sample sits below 0.30; every within-Speaker cohesion mean sits above 0.55. The top between-Speaker values cluster tightly: 0.298, 0.297, 0.253, 0.244, 0.235.

**This gives #18 the number it was missing.** Its "conservative auto-hint threshold" was a pure guess; the between-Speaker ceiling is ≈ **0.30** with the within-Speaker floor at ≈ **0.55**. A hint threshold anywhere in **0.45–0.55** is clear of every different-humans pair measured, with margin on both sides.

### The clusterer over-splits internally — and already repairs itself

The pipeline collapses far more warm-start clusters than #18 assumed:

| sample | AHC clusters | VBx active (`pi > 1e-7`) | final Speakers |
|---|---|---|---|
| 34.5 min | 6 | 3 | **2** |
| 58.6 min | 14 | — | **3** |
| 83.3 min | 24 | — | **6** |
| 109.4 min | 30 | — | **4** |

**#18's premise that "unbounded fixed-threshold AHC" is the over-split risk is wrong in an important way: AHC is only the warm start.** VBx prunes via its mixture weights (`computeCentroids` keeps only `pi > 1e-7`), then reconstruction's minimum-segment-duration drops the residue. On the 34.5-min sample the chain ran 6 → 3 → 2, and the pruned third cluster held 2 of 1221 chunks.

### The real shape of over-splitting: a tail of tiny Speakers

Talk time per final Speaker:

| sample | substantial Speakers | tail |
|---|---|---|
| 34.5 min | 1063 s, 594 s | — none |
| 58.6 min | 2530 s, 364 s | 1 s |
| 83.3 min | 1220 s, 933 s, 594 s | 172 s, 23 s, 21 s |
| 109.4 min | 4205 s, 1003 s | 174 s, 94 s |

The 34.5-min sample — the *only* one #18 had — is the only one with **no tail at all**. Every recording over ~58 min produced one to three Speakers with an order of magnitude less talk time than the real participants. Duration alone separates them cleanly.

### ⚠️ The open fork this creates for #18

The tail Speakers' embeddings are **not** similar to the dominant Speakers — every pair is ≤ 0.30, the same range as genuinely different humans. So either:

- **(a) the tails are genuine brief participants** — a third person who spoke once, a voice through a laptop speaker, background audio. Then nothing over-split, and #18's mechanism is untested but its threshold is now grounded at ≈0.30/0.55.
- **(b) the tails are fragments of a real Speaker** — then **#18's chosen mechanism does not work**, because embedding similarity cannot see them, and the cheap signal is talk-time (the third bullet of this measurement's brief), not embedding distance.

A structural test — is the tail sandwiched inside one other Speaker's turns? — came out inconclusive:

```
embedded  S1: 115 segs, median 4.7s — sandwiched  4/115, median gap 1.15s
embedded  S5:   5 segs, median 23.1s — sandwiched  3/5   (S2), median gap 12.44s
embedded  S6:   9 segs, median 2.0s — sandwiched  5/9   (S2), median gap 0.61s
aurora    S3:   1 seg,  median 1.3s — sandwiched  0/1
trust     S1:  23 segs, median 3.8s — sandwiched  1/23,  median gap 2.60s
trust     S4:  20 segs, median 3.4s — sandwiched  3/20,  median gap 0.93s
```

Only `embedded` S6 (5/9 inside S2, 0.61 s gaps, 2 s median duration) looks fragment-like. The rest are bounded by turn changes like ordinary participants.

**Resolving (a) vs (b) requires ground truth on who is actually in these recordings — human input this measurement cannot supply.**

---

## Measurement 4 — is seam-repair `n/N` knowable up front?

**No. #13's assumption that the sidecar can emit `n/N` for seam repair is wrong.** Measured on the 34.5-min sample:

| pass | frame-gap candidates | cumulative probes | tokens recovered |
|---|---|---|---|
| 1 | 30 | 15 | 151 |
| 2 | 24 | 16 | 5 |
| 3 | 25 | 17 | 0 → loop ends |

Three things break an up-front `N`:

1. **The cheap test over-counts.** Pass 1 finds 30 gaps wide enough to consider, but only **15** survive the RMS speech gate — and that gate reads audio, so it is not free to evaluate for all candidates in advance.
2. **The loop runs up to 3 passes**, and a later pass's candidate set does not exist until the previous pass has spliced its recoveries in.
3. Only the hard cap — **32 probes** — is known in advance, and the run used 17.

What *is* emittable: a per-pass candidate count (`n / 30` during pass 1) that will finish early, plus "pass k of ≤3". Honest options are a **spinner**, or a bar that visibly resets per pass. Given the span is 3.98 s — **14 % of the run, ~7× the entire clustering phase** — this is the more consequential unmeasurable span, and #13 never looked at it.

Also measured: **161 ASR chunks**, not the ~556 estimated in #17/#10. At 2071 s that is ~12.9 s per chunk, consistent with a 15 s window minus overlap. Any `n/N` bar over ASR chunks should expect hundreds, not thousands.

---

## Consequences for #13's ETA

#13's ETA refuses to project when >50 % of remaining work is unmeasurable. Measured, the unmeasurable share is:

- clustering: **2.0 %** of the run
- seam repair (if left as a spinner): 14.2 %

Even counting seam repair as unmeasurable, **~84 % of the run is bar-able**, so the ETA will show a number essentially always — it can only cross the 50 % threshold in the last few seconds of a run, when the remaining work is the cluster phase alone. The guard is sound but will almost never fire.

## Instrumentation

Patch applied to the FluidAudio clone (not committed to this repo — the clone is throwaway):

- `Sources/FluidAudio/Diarizer/Offline/Core/RecapTiming.swift` — new; writes `RECAP_TIMING <label> <value>` to stderr.
- `OfflineDiarizerManager.cluster(_:)` — timers around AHC, VBx, centroids+assignment, reconstruction; echoes `prepare()`'s segmentation / embedding / audio-load timings.
- `ChunkProcessor` — timer around `repairSeamGaps`, plus per-pass frame-gap candidate counts, cumulative probe counts and insert counts.

Analysis scripts committed under `spike/pipeline-timings/`.

## How to reproduce

```bash
git clone --depth 1 https://github.com/FluidInference/FluidAudio.git
# apply the instrumentation described above
cd FluidAudio && swift build -c release --product fluidaudiocli
BIN=.build/arm64-apple-macosx/release/fluidaudiocli

ffmpeg -i input.mov -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav
"$BIN" process   audio.wav --mode offline --output diar.json --export-embeddings emb.json
"$BIN" transcribe audio.wav --model-version v3 --language en --word-timestamps --output-json asr_v3.json

bun spike/pipeline-timings/embed_stats.ts emb.json
bun spike/pipeline-timings/tail_context.ts diar.json
```
