/**
 * recap#19 — are the low-talk-time Speakers fragments of a dominant Speaker,
 * or genuine brief participants?
 *
 * A fragment tends to sit *inside* another speaker's turn: the segment before
 * and after it are the same speaker, separated by short gaps. A genuine brief
 * participant is bounded by turn changes like anyone else.
 */
type Seg = {speakerId: string; startTimeSeconds: number; endTimeSeconds: number}

const segs: Seg[] = (await Bun.file(process.argv[2]).json()).segments
segs.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

const talk = new Map<string, number>()
for (const s of segs) {
  talk.set(s.speakerId, (talk.get(s.speakerId) ?? 0) + (s.endTimeSeconds - s.startTimeSeconds))
}
const ranked = [...talk.entries()].sort((a, b) => b[1] - a[1])
const tails = ranked.slice(2).map(([id]) => id)

for (const tail of tails) {
  let sandwiched = 0
  let total = 0
  const neighbours = new Map<string, number>()
  const gaps: number[] = []
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].speakerId !== tail) continue
    total++
    const prev = segs[i - 1]
    const next = segs[i + 1]
    if (!prev || !next) continue
    if (prev.speakerId === next.speakerId && prev.speakerId !== tail) {
      sandwiched++
      neighbours.set(prev.speakerId, (neighbours.get(prev.speakerId) ?? 0) + 1)
      gaps.push(segs[i].startTimeSeconds - prev.endTimeSeconds)
      gaps.push(next.startTimeSeconds - segs[i].endTimeSeconds)
    }
  }
  const medGap = gaps.length
    ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)].toFixed(2)
    : 'n/a'
  const durs = segs.filter(s => s.speakerId === tail).map(s => s.endTimeSeconds - s.startTimeSeconds)
  const medDur = durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)].toFixed(1)
  console.log(
    `${tail}: ${total} segs, median dur ${medDur}s — sandwiched inside one other speaker's turn: ` +
      `${sandwiched}/${total}` +
      (neighbours.size ? ` (${[...neighbours].map(([k, v]) => `${k}×${v}`).join(', ')})` : '') +
      `, median gap ${medGap}s`,
  )
}
