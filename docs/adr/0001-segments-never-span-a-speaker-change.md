# Segments never span a speaker change

ASR and diarization emit incompatible boundaries: Whisper chunks on phrase and pause, diarization on speaker turns, and a single Whisper chunk will happily run across a turn. We resolved this in favour of diarization — Segmentation cuts ASR output at turn boundaries, using word-level timings to find the cut, so a Segment is a contiguous span of speech by exactly one Speaker on exactly one Track.

## Considered Options

**Pass ASR output through as-is**, treating speaker as a best-guess attribute of a chunk that may contain two people. Rejected: it pushes the problem into every consumer. The transcript UI renders speaker-labelled blocks and would need sub-segment speaker rendering; "reassign this segment to Aaron" has no well-defined target when the segment is half Aaron; export has to decide who a mixed chunk belongs to. The ambiguity doesn't disappear, it just gets solved repeatedly and inconsistently.

## Consequences

The one-speaker invariant is what lets several other decisions stay simple, and reversing it would take them with it:

- **Transcript is a view, not an entity.** Merge has nothing left to decide except ordering, so it's a sort over Segments rather than a stage that produces and stores a second copy of the transcript.
- **Speaker reassignment and rename are clean, independent operations**, because a Segment references exactly one Speaker id.
- **Overlap is derived**, not stored — a question asked of two Segments on different Tracks.

The cost is concentrated in Segmentation, which must do real work rather than forwarding ASR output. This is only possible because word-level timestamps are a hard requirement for playback sync — we get the cut points for free from a constraint we already accepted.
