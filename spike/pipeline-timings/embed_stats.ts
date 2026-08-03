/**
 * recap#19 measurement 3 — per-Speaker average embeddings and pairwise cosine
 * similarity, over FluidAudio's `--export-embeddings` payload.
 *
 * Throwaway spike tooling.
 */
type Row = {
  chunkIndex: number
  speakerIndex: number
  startTime: number
  endTime: number
  embedding256: number[]
  cluster: number
}

const rows: Row[] = await Bun.file(process.argv[2]).json()

const byCluster = new Map<number, Row[]>()
for (const r of rows) {
  if (!byCluster.has(r.cluster)) byCluster.set(r.cluster, [])
  byCluster.get(r.cluster)!.push(r)
}

function mean(vecs: number[][]): number[] {
  const out = new Array(vecs[0].length).fill(0)
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i]
  return out.map(x => x / vecs.length)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const clusters = [...byCluster.keys()].sort((a, b) => a - b)
const avg = new Map(clusters.map(c => [c, mean(byCluster.get(c)!.map(r => r.embedding256))]))

console.log('## Per-cluster')
for (const c of clusters) {
  const rs = byCluster.get(c)!
  const talk = rs.reduce((s, r) => s + (r.endTime - r.startTime), 0)
  // Cohesion: how tightly this cluster's own chunks sit around their mean.
  const sims = rs.map(r => cosine(r.embedding256, avg.get(c)!))
  sims.sort((a, b) => a - b)
  console.log(
    `cluster ${c}: chunks=${rs.length} chunk-span-sum=${talk.toFixed(1)}s ` +
      `self-cohesion mean=${(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(4)} ` +
      `p05=${sims[Math.floor(sims.length * 0.05)].toFixed(4)} min=${sims[0].toFixed(4)}`,
  )
}

console.log('\n## Pairwise cosine similarity of average embeddings')
for (let i = 0; i < clusters.length; i++) {
  for (let j = i + 1; j < clusters.length; j++) {
    const a = clusters[i]
    const b = clusters[j]
    console.log(`${a} vs ${b}: ${cosine(avg.get(a)!, avg.get(b)!).toFixed(4)}`)
  }
}
