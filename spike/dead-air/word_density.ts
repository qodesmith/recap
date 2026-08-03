// THROWAWAY SPIKE (#21) — does dead air produce words, and what is the density gap?
//
// Composes ASR word timings with diarization segments using the #10 word-midpoint
// join, then reports PER SPEAKER: word count, diarization talk time, and
// words-per-second — the "word density" signal #20 deferred to measurement.
//
// Usage: bun word_density.ts <asr.json> <diar.json> [--split <seconds>] [--dump <n>]
//   --split  report each speaker split before/after this timestamp (ground-truth boundary)
//   --dump   dump the full text of any speaker with <= n words
import { readFileSync } from "node:fs";

type Word = { word: string; startTime: number; endTime: number };
type Seg = { speakerId: string; startTimeSeconds: number; endTimeSeconds: number };

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--") && !isFlagValue(a));
function isFlagValue(a: string) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1]?.startsWith("--");
}
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

const [asrPath, diarPath] = positional;
const splitAt = flag("split") ? Number(flag("split")) : undefined;
const dumpUnder = flag("dump") ? Number(flag("dump")) : 400;

const asr = JSON.parse(readFileSync(asrPath!, "utf8"));
const diar = JSON.parse(readFileSync(diarPath!, "utf8"));
const words: Word[] = asr.wordTimings ?? [];
const segs: Seg[] = (diar.segments ?? [])
  .slice()
  .sort((a: Seg, b: Seg) => a.startTimeSeconds - b.startTimeSeconds);

// --- #10's word-midpoint join, verbatim in behaviour ---------------------------
function speakerAt(t: number): { id: string; covered: boolean } {
  let best: Seg | null = null;
  let bestDist = Infinity;
  for (const s of segs) {
    if (t >= s.startTimeSeconds && t <= s.endTimeSeconds)
      return { id: s.speakerId, covered: true };
    const d = t < s.startTimeSeconds ? s.startTimeSeconds - t : t - s.endTimeSeconds;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return { id: best?.speakerId ?? "?", covered: false };
}

const attributed = words.map((w) => {
  const mid = (w.startTime + w.endTime) / 2;
  return { ...w, mid, speaker: speakerAt(mid).id };
});

// --- per-speaker roll-up -------------------------------------------------------
const speakerIds = [...new Set(segs.map((s) => s.speakerId))].sort();

type Row = {
  id: string;
  nSegs: number;
  talkTime: number;
  nWords: number;
  density: number;
  words: typeof attributed;
};

function rollup(inWindow: (t: number) => boolean): Row[] {
  return speakerIds
    .map((id) => {
      const mySegs = segs.filter((s) => s.speakerId === id && inWindow(s.startTimeSeconds));
      const talkTime = mySegs.reduce(
        (a, s) => a + (s.endTimeSeconds - s.startTimeSeconds),
        0,
      );
      const myWords = attributed.filter((w) => w.speaker === id && inWindow(w.mid));
      return {
        id,
        nSegs: mySegs.length,
        talkTime,
        nWords: myWords.length,
        density: talkTime > 0 ? myWords.length / talkTime : 0,
        words: myWords,
      };
    })
    .sort((a, b) => b.nWords - a.nWords);
}

const fmtT = (t: number) => {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

function table(title: string, rows: Row[]) {
  console.log(`\n### ${title}`);
  console.log(
    `| speaker | segs | talk time | words | words/sec |\n|---|---|---|---|---|`,
  );
  for (const r of rows) {
    if (r.nSegs === 0 && r.nWords === 0) continue;
    console.log(
      `| ${r.id} | ${r.nSegs} | ${r.talkTime.toFixed(0)} s | **${r.nWords}** | ${r.density.toFixed(3)} |`,
    );
  }
}

console.log(`# Word density — ${asrPath}`);
console.log(
  `\nASR model: ${asr.modelVersion} · words: ${words.length} · diar segments: ${segs.length} · speakers: ${speakerIds.length}`,
);

const all = rollup(() => true);
table("All speakers, whole recording", all);

if (splitAt !== undefined) {
  table(`Before ${fmtT(splitAt)} (real content)`, rollup((t) => t < splitAt));
  table(`After ${fmtT(splitAt)} (dead air)`, rollup((t) => t >= splitAt));
}

// --- text dump for the tail ----------------------------------------------------
for (const r of all) {
  if (r.nWords > dumpUnder) continue;
  console.log(
    `\n### ${r.id} — full text (${r.nWords} words, ${r.talkTime.toFixed(0)} s, ${r.density.toFixed(3)} w/s)`,
  );
  if (r.nWords === 0) {
    console.log(`\n_(no words — wordless diarization label)_`);
    continue;
  }
  // group consecutive words into runs so the dump reads as utterances
  const runs: { start: number; end: number; text: string[] }[] = [];
  for (const w of r.words) {
    const last = runs[runs.length - 1];
    if (last && w.startTime - last.end < 2) {
      last.end = w.endTime;
      last.text.push(w.word.trim());
    } else {
      runs.push({ start: w.startTime, end: w.endTime, text: [w.word.trim()] });
    }
  }
  for (const run of runs) {
    console.log(`- \`[${fmtT(run.start)}–${fmtT(run.end)}]\` ${run.text.join(" ")}`);
  }
}
