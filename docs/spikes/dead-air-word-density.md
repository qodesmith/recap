# Measurement: does dead air produce words, and what is the density gap?

**Issue:** [qodesmith/recap#21](https://github.com/qodesmith/recap/issues/21)
**Date:** 2026-08-03
**Verdict:** the ticket's third outcome — **the premise is wrong**. #19's "33 minutes of dead air" is not dead air. The two extra Speakers it produced are **real, audible, non-participant speech**: a **YouTube video playing in the background** (587 words) and a **side conversation** after the meeting ended (70 words). They transcribe at **3.40 and 3.04 words/second**, sitting squarely inside the real-participant range of **2.86–4.07 w/s**. There is **no density gap**. The hint #20 deferred to this measurement **must not ship**, and #20's word-derived rule **removes none of them**.

Throwaway spike measurement. Machine: Apple Silicon, macOS 26.5.2, Xcode CLT Swift 6.3.3. FluidAudio cloned at `5390df9` (2026-08-01), stock release build of `fluidaudiocli` — no instrumentation needed. Parakeet TDT 0.6b **v3**, `--word-timestamps`; offline VBx diarization. Composition is #10's word-midpoint join.

## Samples

The same four as #19, all re-run end to end.

| name | duration | words | speakers found |
|---|---|---|---|
| `zeyad 01.mov` | 34.5 min | 6150 | 2 |
| `initial talk about embedded ai.mkv` | 83.3 min (49.75 min real) | 10614 | 6 |
| `project aurora 1.mkv` | 58.6 min | 11515 | 3 |
| `07-19-2026-all-your-trust.mkv` | 109.4 min | 17222 | 4 |

None are committed (private, GB-scale).

---

## Measurement 1 — the phantoms have words, and plenty of them

The 83.3-min sample, split at the 49:45 ground-truth boundary:

### Whole recording

| speaker | segs | talk time | **words** | **words/sec** | what it actually is |
|---|---|---|---|---|---|
| S2 | 190 | 1221 s | 3827 | 3.135 | participant |
| S3 | 231 | 933 s | 3800 | 4.072 | participant |
| S1 | 115 | 595 s | 2242 | 3.770 | participant |
| **S5** | 5 | 173 s | **587** | **3.398** | **background YouTube video** |
| S4 | 2 | 22 s | 88 | 4.030 | participant (the brief one) |
| **S6** | 9 | 23 s | **70** | **3.036** | **post-meeting side conversation** |

#19 reported S5 and S6 as existing only in the dead air after 49:45, and #20 built on that reading. Both facts hold — they *are* only in that window — but the window is not silent.

### What S5 is

Not noise. A video playing in the room, transcribed cleanly:

> _[74:55–75:14]_ "I spent hundreds of many years remembering ancient world life… **Hey everyone, welcome to Belgiumblegy Explained. Over the last couple of months, we have quite a few videos discussing Christoph Nolan's upcoming adaptation of the Odyssey.**"

> _[76:03–76:37]_ "The trailer received an extreme negative response on YouTube… filled with people criticizing the casting, the dialogue, the costumes…"

Five segments, 587 words of YouTube commentary about a film trailer. The diarizer was right that this is a distinct voice. It is simply not a participant.

### What S6 is

Also not noise — a genuine human conversation that happens after the meeting:

> _[82:47–82:53]_ "Um I ordered feeding tongue, a fake plant, and the vine and leaflet."
> _[82:57–83:07]_ "Not yet. I just gotta wait until it dries completely. Where is it? It's on paper towels in the kitchen."

Real speech, real people, wrong recording.

---

## Measurement 2 — actual silence really is wordless

The ticket's literal question ("does dead air transcribe to **any** words") still deserves an answer, so the audio was classified by per-second RMS. Quiet = below −50 dBFS, which is far under conversational speech here (median −26 dBFS in the content window) but above the digital-silence floor.

| window | length | quiet | median dBFS | words | diar segs |
|---|---|---|---|---|---|
| whole file | 4999 s | 1667 s (33.3 %) | −33.7 | 10614 | 552 |
| 0–49:45 (content) | 2985 s | 52 s (1.7 %) | −26.0 | 9105 | 517 |
| 49:45–end | 2014 s | 1615 s (80.2 %) | −60.2 | 1509 | 35 |

So the post-meeting window is **80 % genuinely quiet** — and the remaining 20 % holds all 1509 words. The longest quiet runs produce nothing at all:

| quiet run | length | words |
|---|---|---|
| 64:51 | 286 s | **0** |
| 54:48 | 116 s | **0** |
| 70:08 | 99 s | **0** |
| 63:18 | 92 s | **0** |
| 60:43 | 79 s | **0** |
| 58:27 | 135 s | 19 — faint speech under the threshold, not hallucination |

Across the whole 83-min file, **373 of 10614 words (3.5 %) land in quiet seconds**, and the six longest quiet runs yield zero between them. Across all four samples the picture is the same (aurora: 92 words of 11515 in 147 s of quiet).

**Parakeet does not hallucinate a transcript out of silence.** That is a genuinely reassuring result — it is the failure mode that would have made #20's residue unbounded — but it is not the result #20 needed, because silence was never what produced S5 and S6.

---

## Measurement 3 — word density has no discriminating power

Every Speaker, all four samples, sorted by density:

| sample | speaker | words | **w/s** | nature |
|---|---|---|---|---|
| trust | S2 | 1545 | **1.539** | singing worship team |
| trust | S1 | 498 | 2.857 | participant |
| embedded | **S6** | 70 | **3.036** | **non-participant (side conversation)** |
| embedded | S2 | 3827 | 3.135 | participant |
| zeyad | S1 | 1925 | 3.236 | participant |
| trust | S4 | 326 | 3.450 | participant |
| **embedded** | **S5** | 587 | **3.398** | **non-participant (background video)** |
| trust | S3 | 14853 | 3.532 | participant |
| embedded | S1 | 2242 | 3.770 | participant |
| aurora | S2 | 1402 | 3.847 | participant |
| aurora | S3 | 5 | 3.875 | participant (1.3 s, 5 words) |
| zeyad | S2 | 4225 | 3.971 | participant |
| aurora | S1 | 10108 | 3.994 | participant |
| embedded | S4 | 88 | **4.030** | participant (22 s — the #19 cross-check) |
| embedded | S3 | 3800 | 4.072 | participant |

**Conversational speech is 2.86–4.07 w/s regardless of who is speaking or for how long.** #20 predicted a phantom would sit "~2 orders of magnitude below" a participant. Measured, the two non-participants sit at 3.04 and 3.40 — **inside the interquartile range of the real ones**. Any threshold that flags S6 flags four real participants first.

Two cross-checks the ticket asked for, both confirming this:

- **The 21 s participant (S4)** — the case that killed talk time as a signal in #19 — has the **highest density in its own recording** (4.030 w/s) and the second-highest overall. Brevity does not depress density.
- **The only genuine low-density Speaker anywhere is singing** (trust S2, 1.539 w/s) — sustained notes, few words per second. It is real content, so a density hint would flag a worship team and miss both actual non-participants. Exactly backwards.

---

## Measurement 4 — #20's ≥1-word rule fires zero times

#20 decided a diarization label becomes a `Speaker` only if ≥1 word lands in it, expecting that to dissolve the phantoms for free.

**Across all four samples — 15 Speakers — every single one has words.** The minimum is aurora's S3 at 5 words. The rule removes **nothing**.

It is not wrong, and it should stay: it is cheap, it correctly drops wordless *segments* (the post-49:45 window has a 2 s S1 segment with zero words), and it costs nothing to keep. But it does no work against the thing it was written to fix, because that thing has 587 words.

---

## What this means for #20

The ticket named the category **"phantom Speakers from non-speech audio."** On the evidence, that category is empty. What actually populates the tail is **non-participant speech**:

1. **Media playing in the room** — a video, a podcast, a call on speaker.
2. **Human conversation that isn't the conversation** — a side chat, someone in the next room, talk after the meeting ends.

Both are speech. Both are correctly diarized as distinct voices. Neither is distinguishable from a participant by any statistic over the transcript, because *the model is not wrong about them* — it is doing its job on audio that contains people talking. The only thing that makes them unwanted is intent, which lives with the user and nowhere in the signal.

Consequences:

- **Drop the automatic low-word-density hint.** Not because #20's rule handles it (it doesn't) but because the signal it would key on does not exist. This is outcome 1's *action* arrived at through outcome 3's *reasoning* — and it matters which, because the reason "there is nothing to detect" is stable, while "the rule already fixed it" is false and would have collapsed the first time someone recorded near a TV.
- **Manual Speaker-level dismissal is now the whole mitigation**, and more load-bearing than #20 assumed. It is not clearing up a few seconds of noise; on this sample it suppresses **587 words of YouTube commentary** that the transcript and #15's export would otherwise attribute to a participant.
- **Reversibility is vindicated.** Dismissal now hides real, correct transcribed text, so a mistaken dismissal destroys something a user might want back. #20's "reversible flag, not a delete" was the right call for a reason stronger than the one it gave.
- **The rail's two hint types collapse to one.** #18's merge hint survives (grounded at 0.45–0.55 by #19); the dismiss hint has nothing to fire on. The Dismissed section and the manual action stay.

### One candidate signal, noted and not recommended

Mean diarization-segment duration does separate the background video: S5 averages **34.5 s per segment** against 4.0–6.4 s for the participants — a monologue from a video never interleaves with turn-taking. But it fails on the other non-participant in the same recording (S6 averages 2.6 s, indistinguishable), and a real participant in that recording has a 133 s segment. One outlier, one sample, two counterexamples. Not a signal — recorded only so it isn't rediscovered and mistaken for one.

## How to reproduce

```bash
git clone --depth 1 https://github.com/FluidInference/FluidAudio.git
cd FluidAudio && swift build -c release --product fluidaudiocli
BIN=.build/arm64-apple-macosx/release/fluidaudiocli

ffmpeg -i input.mkv -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav
"$BIN" transcribe audio.wav --model-version v3 --language en --word-timestamps --output-json asr.json
"$BIN" process    audio.wav --mode offline --output diar.json

bun spike/dead-air/word_density.ts  asr.json diar.json --split 2985 --dump 600
bun spike/dead-air/silence_check.ts audio.wav asr.json diar.json --from 2985
```
