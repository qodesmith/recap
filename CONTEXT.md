# Recap

A mac-only desktop app that records or imports conversations and produces a diarized, playback-synced, editable transcript. Everything runs locally on-device.

This file is the project's glossary — the vocabulary every issue, prototype, and module should speak.

## Language

### The library

**Recording**:
The top-level item in the library — one captured or imported conversation, owning its Tracks and its Speakers. Identified by an opaque id and a user-editable title that defaults to its timestamp.
_Avoid_: Conversation, session, meeting

**Track**:
One captured source within a Recording, or the single track of an imported file. Owns its audio and its Segments. Every Track is transcribed and diarized independently of its siblings.
_Avoid_: Channel, stream, input

**Source**:
Where a Track's audio came from — the mic, system audio, or an imported file. A property of the Track; a Recording is neutral about how it came to exist. Track labels are derived from the Source, never typed by the user.

**Capture**:
Recording live audio into a new Recording. The user chooses Sources — the mic, system audio, or both — and each becomes its own Track, metered live so a source that is producing nothing is visible before and during the Capture. A Capture never stops on its own: if a device disappears it falls back to whichever input the system is using rather than ending. Sources are fixed once it starts, and there is no pause.
_Avoid_: Session, take

**Attributed Track**:
A Track whose Speaker is asserted rather than discovered. Diarization is skipped and every Segment is stamped with that Speaker. A mic Track is attributed automatically, because one mic is one person — so the app records people around a table as a single Speaker, by design. Attribution is a revisable default, not a permanent fact — clearing it sends the Track through diarization like any other, which means a Re-transcribe once the Recording has been processed.

**Trim**:
A Recording-level window over its audio, set before transcription and applied to every Track on the shared timeline. Non-destructive — the audio on disk stays whole and the window is two numbers — so the Trim is what the pipeline sees, not what the Recording is. To the user the window _is_ the Recording: playback stays inside it and its start is time zero. Once transcribed, the Trim is fixed; changing it means a Re-transcribe.
_Avoid_: Crop, cut, clip

**Mixdown**:
The single playable file derived from a Recording's Tracks, produced before transcription. What the player plays at every stage. Tracks stay separate for Processing; the Mixdown exists only for listening.

### Transcript structure

**Transcript**:
The Segments of a Recording across all its Tracks, ordered by start time. A view, not a stored thing — there is no separate transcript record, and no re-segmentation of per-Track results.

**Segment**:
A contiguous span of speech by exactly one Speaker on exactly one Track. Never spans a speaker change or a track. The unit the user reads, edits, and reassigns.

**Word**:
Text plus a start and end time, owned by a Segment in order. Has no identity outside its Segment; nothing references a Word directly. Carries the model's confidence score, which is recorded but not surfaced.

**Speaker**:
A participant in a Recording, with a stable identity and a name that defaults to `Speaker 1`, `Speaker 2`. Segments reference a Speaker; renaming changes that Speaker's name and nothing else. Scoped to one Recording — the same person across two Recordings is two Speakers. A Speaker is made of words: a diarization label that catches no Words never becomes a Speaker, because a participant who said nothing is not a participant.

**Dismissal**:
A user's assertion that a Speaker is not a person — room noise, music or dead air that diarization clustered into an identity of its own. The Speaker and its Segments are hidden from the transcript and from exports, never deleted, so a dismissal is always reversible. Distinct from a merge: merge folds a Speaker into a real one, dismissal says there was no one there.

**Provenance**:
The record of which Track and which diarization label produced a Speaker. Because diarization runs per Track, one human captured on two Tracks arrives as two Speakers, each with its own provenance.

**Speaker merge**:
Folding one Speaker into another within a Recording, so both sets of Segments share one identity. Always user-initiated — inferring it automatically would be voice fingerprinting. Reversible, because the merged Speaker retains both provenances.

**Overlap**:
Two Segments on different Tracks whose time spans intersect — people talking at once. A derived observation about any two Segments, never stored, so it stays true after edits, reassignments, and merges.

**Edit**:
A user's change to a Segment's text. The model's original text is preserved alongside it and the Segment is flagged as edited. An edited Segment keeps its start and end but its Words go stale, so playback highlighting falls back from word-level to segment-level.

### Processing

**Processing**:
The umbrella term for everything that happens to a Track's audio after capture or import. The user requests it with one action — _Transcribe_ — however many stages it takes underneath.

**Transcription**:
The stage turning a Track's audio into Words with timings.

**Diarization**:
The stage turning a Track's audio into speaker turns. Skipped on an Attributed Track.

**Segmentation**:
The stage combining Words and speaker turns into Segments, cutting at turn boundaries so no Segment spans a speaker change.

**Re-transcribe**:
Returning a transcribed Recording to `unprocessed` so its Trim can be changed and Processing run again. Discards every piece of transcript work — Segments, edits, Speaker names, merges, dismissals — because a re-run renumbers Speakers. Touches no audio. Distinct from retrying a failed Track, which re-runs one Track and preserves everything else.

**Track state**:
`pending` → `transcribing` → `diarizing` → `transcribed`, or `failed`. Segmentation has no state of its own.

**Recording state**:
`capturing` → `preparing` → `unprocessed` → `processing` → `transcribed`, or `needs attention`; from `unprocessed` onwards it is derived from the Tracks. `preparing` covers decoding, the Mixdown and the waveform data the Trim is drawn against — an import starts there, a capture passes through it — and a Recording cannot be transcribed until it is done. A partially-transcribed Recording is a valid, displayable state — the Segments that exist are shown while the rest is still coming.
