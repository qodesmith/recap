# PROTOTYPE — pipeline progress surface (issue #13)

Throwaway. Not production code. Exists to answer one question: **what does the
user see after pressing one Transcribe button?**

```bash
cd prototypes/pipeline-progress
bun install
bun run dev
```

Three variants on one route, switchable with the floating bottom bar, `←`/`→`,
or `?variant=A|B|C`:

| | Recording page | Global indicator |
|---|---|---|
| **A** | Per-track cards, each a vertical checklist of phases | Left-sidebar Activity section |
| **B** | Dense monospace table, every phase of every track as a row | Persistent top strip, expands to the queue |
| **C** | Progress sweeps across each track's waveform, transcript materialises under the edge | Floating dock, bottom-right |

## Decisions already baked in (grilled before building)

- Hybrid placement — Transcribe lands you on the recording page, you can leave.
- One bar **per track**, labelled by source.
- **Measurable → progress bar. Unmeasurable → spinner. Everything gets a label.**
- Visible queue; recording while a transcription runs is allowed.
- Cancel keeps tracks that already finished; Transcribe then means "do the rest".

## What to poke (yellow PROTOTYPE CONTROLS panel, top right)

- **Sim speed** — leave at 1× to judge feel; raise it to see the end.
- **Machine** — 1× is the Mac #10 measured (79× realtime); 3–4× is the slowest
  supported Mac.
- **Clustering share** — the honest unknown. #17 flagged that diarization's
  clustering emits no progress at all, and #10 never measured how long it takes.
  This slider is how much of the run is pure spinner. **Push it to 90% and see
  whether the UI still holds up** — if it doesn't, that measurement becomes a
  ticket.
- **Fail a track** — exercises #11's partial-success path.

## Timing provenance

All timings are derived, not invented — see the header comment in
`src/pipeline.ts` for what is MEASURED (#10), SOURCED (#17), and GUESSED
(the segmentation/clustering split, and FFmpeg decode/mixdown/peaks throughput,
which nobody has timed).
