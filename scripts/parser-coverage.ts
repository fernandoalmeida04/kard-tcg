// Mede quantas cartas do banco local o motor de regras automatiza por completo.
// Uso: node --experimental-strip-types scripts/parser-coverage.ts [caminho/cards.json] [--popular N] [--top N] [--examples]
import fs from 'fs'
import { parseCardFaces, isFullySupported } from '../src/shared/engine/index.ts'
import type { ParsedCard } from '../src/shared/engine/index.ts'

const args = process.argv.slice(2)
const flag = (name: string, def: number) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : def
}
const file = args.find((a) => a.endsWith('.json')) ?? 'database/cards.json'
const POPULAR = flag('--popular', 3000)
const TOP = flag('--top', 40)
const examples = args.includes('--examples')

interface C {
  name: string
  typeLine: string
  oracleText: string
  keywords: string[]
  producedMana?: string[]
  layout: string
  faces?: { name: string; typeLine: string; oracleText: string }[]
  edhrecRank?: number
  legalities: Record<string, string>
}
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { cards: C[] }

function fragments(p: ParsedCard): string[] {
  const out = [...p.unsupported]
  if (p.spell) {
    out.push(...p.spell.unsupported)
    if (!p.spell.modes && p.spell.effects.length === 0 && !p.spell.unsupported.length) out.push('(mágica sem efeito reconhecido)')
    for (const m of p.spell.modes ?? []) out.push(...m.unsupported)
  }
  for (const t of p.triggers) out.push(...t.unsupported)
  for (const a of p.activated) out.push(...a.unsupported)
  return out
}

let total = 0
let full = 0
let popularTotal = 0
let popularFull = 0
const frag = new Map<string, { n: number; pop: number; ex: string[] }>()
const byType: Record<string, [number, number]> = {}
for (const c of data.cards) {
  if (!c.legalities || Object.keys(c.legalities).length === 0) continue
  total++
  let ps: ParsedCard[]
  try {
    ps = parseCardFaces(c)
  } catch (e) {
    console.log('ERRO ao interpretar', c.name, e)
    continue
  }
  const ok = ps.every(isFullySupported)
  if (ok) full++
  const popular = (c.edhrecRank ?? 1e9) < POPULAR
  if (popular) {
    popularTotal++
    if (ok) popularFull++
  }
  const t = ['Creature', 'Instant', 'Sorcery', 'Land', 'Artifact', 'Enchantment', 'Planeswalker'].find((x) => c.typeLine.includes(x)) ?? 'Other'
  byType[t] ??= [0, 0]
  byType[t][0]++
  if (ok) byType[t][1]++
  for (const l of new Set(ps.flatMap(fragments))) {
    const key = l.replace(/\d+/g, 'N').replace(/\{[WUBRGC]\}/g, '{M}').slice(0, 110)
    const e = frag.get(key) ?? { n: 0, pop: 0, ex: [] }
    e.n++
    if (popular) e.pop++
    if (e.ex.length < 3) e.ex.push(c.name)
    frag.set(key, e)
  }
}
console.log(`Cartas legais em algum formato: ${total}`)
console.log(`Totalmente automatizadas: ${full} (${((full / total) * 100).toFixed(1)}%)`)
console.log(`Top ${POPULAR} mais populares: ${popularFull}/${popularTotal} (${((popularFull / popularTotal) * 100).toFixed(1)}%)`)
for (const [t, [n, ok]] of Object.entries(byType)) console.log(`  ${t}: ${ok}/${n} (${((ok / n) * 100).toFixed(1)}%)`)
const show = (title: string, sorter: (a: { n: number; pop: number }) => number) => {
  console.log(`\n${title}`)
  for (const [l, e] of [...frag.entries()].sort((a, b) => sorter(b[1]) - sorter(a[1])).slice(0, TOP)) {
    console.log(`  ${String(e.n).padStart(4)} (${String(e.pop).padStart(3)} pop)  ${l}${examples ? `   [${e.ex.join('; ')}]` : ''}`)
  }
}
show('Mais comuns em cartas populares:', (e) => e.pop * 1000 + e.n)
show('Mais comuns no total:', (e) => e.n)
