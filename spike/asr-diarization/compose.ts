// THROWAWAY SPIKE (#10) — compose ASR word timings + diarization segments.
// Assigns each word to the speaker whose diarization segment covers the word's
// midpoint (nearest segment if none covers it), then groups consecutive
// same-speaker words into speaker-attributed transcript segments.
// Usage: bun compose.ts <asr.json> <diar.json>
import { readFileSync } from "node:fs";

type Word = { word: string; startTime: number; endTime: number };
type Seg = { speakerId: string; startTimeSeconds: number; endTimeSeconds: number; qualityScore?: number };

const [, , asrPath, diarPath] = process.argv;
const asr = JSON.parse(readFileSync(asrPath, "utf8"));
const diar = JSON.parse(readFileSync(diarPath, "utf8"));
const words: Word[] = asr.wordTimings ?? [];
const segs: Seg[] = (diar.segments ?? []).slice().sort(
  (a: Seg, b: Seg) => a.startTimeSeconds - b.startTimeSeconds,
);

function speakerAt(t: number): { id: string; covered: boolean } {
  let best: Seg | null = null;
  let bestDist = Infinity;
  for (const s of segs) {
    if (t >= s.startTimeSeconds && t <= s.endTimeSeconds) return { id: s.speakerId, covered: true };
    const d = t < s.startTimeSeconds ? s.startTimeSeconds - t : t - s.endTimeSeconds;
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return { id: best?.speakerId ?? "?", covered: false };
}

// Assign every word.
let coveredCount = 0;
const attributed = words.map((w) => {
  const mid = (w.startTime + w.endTime) / 2;
  const { id, covered } = speakerAt(mid);
  if (covered) coveredCount++;
  return { ...w, speaker: id };
});

// Group consecutive same-speaker words into segments.
type OutSeg = { speaker: string; start: number; end: number; text: string; nWords: number };
const out: OutSeg[] = [];
for (const w of attributed) {
  const last = out[out.length - 1];
  if (last && last.speaker === w.speaker) {
    last.end = w.endTime;
    last.text += " " + w.word.trim();
    last.nWords++;
  } else {
    out.push({ speaker: w.speaker, start: w.startTime, end: w.endTime, text: w.word.trim(), nWords: 1 });
  }
}

const speakers = [...new Set(segs.map((s) => s.speakerId))].sort();
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

console.error(`\n=== COMPOSE SUMMARY ===`);
console.error(`ASR model:            ${asr.modelVersion}`);
console.error(`words:                ${words.length}`);
console.error(`diar segments:        ${segs.length}`);
console.error(`distinct speakers:    ${speakers.length} -> ${speakers.join(", ")}`);
console.error(`words inside a seg:   ${coveredCount}/${words.length} (${((100 * coveredCount) / words.length).toFixed(1)}%)`);
console.error(`merged transcript segs: ${out.length}`);
console.error(`speaker turns (>=1 word):`);
for (const sp of speakers) {
  const turns = out.filter((o) => o.speaker === sp);
  const secs = turns.reduce((a, o) => a + (o.end - o.start), 0);
  console.error(`  ${sp}: ${turns.length} turns, ${secs.toFixed(0)}s talk time`);
}

// Emit the composed transcript (the real output shape downstream designs against).
const transcript = out.map((o) => ({
  speaker: o.speaker,
  startTime: o.start,
  endTime: o.end,
  text: o.text,
  wordCount: o.nWords,
}));
process.stdout.write(JSON.stringify({ model: asr.modelVersion, speakers, segments: transcript }, null, 2));

// Also print a human-readable preview to stderr.
console.error(`\n=== TRANSCRIPT PREVIEW (first 25 turns) ===`);
for (const o of out.slice(0, 25)) {
  console.error(`[${fmt(o.start)}–${fmt(o.end)}] ${o.speaker}: ${o.text.slice(0, 120)}${o.text.length > 120 ? "…" : ""}`);
}
