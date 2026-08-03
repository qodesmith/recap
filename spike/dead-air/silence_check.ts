// THROWAWAY SPIKE (#21) — is the "dead air" actually silent, and does silence produce words?
//
// Reads a 16 kHz mono s16le WAV, computes per-second RMS (dBFS), then reports:
//   1. how much of a given window is genuinely quiet
//   2. whether any ASR words land inside the quiet stretches
// This separates "the clusterer invented a speaker from noise" from
// "there was real speech there that nobody counted as a participant".
//
// Usage: bun silence_check.ts <audio.wav> <asr.json> <diar.json> [--from <s>] [--to <s>]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name: string): number | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : Number(args[i + 1]);
}
const positional = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const [wavPath, asrPath, diarPath] = positional;
const from = flag("from") ?? 0;
const to = flag("to") ?? Infinity;

// --- WAV: skip the 44-byte canonical header, read s16le mono @16 kHz ----------
const buf = readFileSync(wavPath!);
const SR = 16000;
const pcm = new Int16Array(
  buf.buffer,
  buf.byteOffset + 44,
  (buf.byteLength - 44) >> 1,
);
const totalSecs = pcm.length / SR;

const rms: number[] = [];
for (let s = 0; s < Math.floor(totalSecs); s++) {
  let acc = 0;
  for (let i = s * SR; i < (s + 1) * SR; i++) acc += pcm[i]! * pcm[i]!;
  const r = Math.sqrt(acc / SR) / 32768;
  rms.push(r > 0 ? 20 * Math.log10(r) : -120);
}

const asr = JSON.parse(readFileSync(asrPath!, "utf8"));
const diar = JSON.parse(readFileSync(diarPath!, "utf8"));
const words: { word: string; startTime: number; endTime: number }[] =
  asr.wordTimings ?? [];
const segs: { speakerId: string; startTimeSeconds: number; endTimeSeconds: number }[] =
  diar.segments ?? [];

// --- quiet-second classification ----------------------------------------------
// -50 dBFS is well below conversational speech (which sits around -30..-15 here)
// but above the digital-silence floor, so it catches room tone as "quiet".
const QUIET_DB = -50;

function report(label: string, a: number, b: number) {
  const lo = Math.max(0, Math.floor(a));
  const hi = Math.min(rms.length, Math.ceil(b));
  const win = rms.slice(lo, hi);
  if (win.length === 0) return;
  const quiet = win.filter((d) => d < QUIET_DB).length;
  const sorted = [...win].sort((x, y) => x - y);
  const wordsIn = words.filter(
    (w) => (w.startTime + w.endTime) / 2 >= lo && (w.startTime + w.endTime) / 2 < hi,
  ).length;
  const segsIn = segs.filter(
    (s) => s.startTimeSeconds >= lo && s.startTimeSeconds < hi,
  ).length;
  console.log(
    `| ${label} | ${(hi - lo).toFixed(0)} s | ${quiet} s (${((100 * quiet) / win.length).toFixed(1)}%) | ${sorted[0]!.toFixed(1)} | ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} | ${sorted[sorted.length - 1]!.toFixed(1)} | ${wordsIn} | ${segsIn} |`,
  );
}

console.log(`# Silence check — ${wavPath}`);
console.log(`\nduration ${(totalSecs / 60).toFixed(1)} min · quiet threshold ${QUIET_DB} dBFS\n`);
console.log(
  `| window | length | quiet seconds | min dBFS | median dBFS | max dBFS | words | diar segs |\n|---|---|---|---|---|---|---|---|`,
);
report("whole file", 0, totalSecs);
if (from > 0) report(`0–${from} s`, 0, from);
if (to !== Infinity) report(`${from}–${to} s`, from, to);
report(`${from} s–end`, from, totalSecs);

// --- longest genuinely quiet runs ---------------------------------------------
const runs: { start: number; end: number }[] = [];
for (let s = 0; s < rms.length; s++) {
  if (rms[s]! < QUIET_DB) {
    const last = runs[runs.length - 1];
    if (last && last.end === s) last.end = s + 1;
    else runs.push({ start: s, end: s + 1 });
  }
}
runs.sort((a, b) => b.end - b.start - (a.end - a.start));

console.log(`\n## Longest continuous quiet runs (< ${QUIET_DB} dBFS)\n`);
console.log(`| start | length | words landing inside |\n|---|---|---|`);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
let quietTotal = 0;
let wordsInQuiet = 0;
for (const r of runs) {
  quietTotal += r.end - r.start;
  const w = words.filter(
    (x) => (x.startTime + x.endTime) / 2 >= r.start && (x.startTime + x.endTime) / 2 < r.end,
  );
  wordsInQuiet += w.length;
}
for (const r of runs.slice(0, 12)) {
  const w = words.filter(
    (x) => (x.startTime + x.endTime) / 2 >= r.start && (x.startTime + x.endTime) / 2 < r.end,
  );
  console.log(
    `| ${fmt(r.start)} | ${r.end - r.start} s | ${w.length}${w.length ? ` — "${w.map((x) => x.word.trim()).join(" ").slice(0, 80)}"` : ""} |`,
  );
}
console.log(
  `\n**Total quiet: ${quietTotal} s across ${runs.length} runs; words landing in quiet: ${wordsInQuiet} of ${words.length}.**`,
);
