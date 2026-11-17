// Mede quantas cartas de Pokémon o motor automatiza. Uso: node --experimental-strip-types scripts/pkm-coverage.ts [--top N] [--standard]
import fs from 'fs'
import { parseCardRules, parseEffectText, normalizeEffect } from '../src/shared/pkm-engine/effects.ts'
import type { PkmCard } from '../src/shared/pokemon/types.ts'

const args = process.argv.slice(2)
const TOP = Number(args[args.indexOf('--top') + 1]) || 30
const db = JSON.parse(fs.readFileSync('database/pokemon.json', 'utf8'))
const all: PkmCard[] = Array.isArray(db.cards) ? db.cards : Object.values(db.cards)
const cards = all.filter((c) => (args.includes('--standard') ? c.legal?.standard : c.legal?.standard || c.legal?.expanded))
let atk = 0, atkOk = 0, tr = 0, trOk = 0, ab = 0, abOk = 0, full = 0
const miss: Record<string, number> = {}
for (const c of cards) {
  const r = parseCardRules(c)
  let ok = true
  c.attacks.forEach((a, i) => {
    atk++
    if (!r.attacks[i].unsupported.length) atkOk++
    else { ok = false; for (const u of r.attacks[i].unsupported) miss['A: ' + u.replace(/\d+/g, 'N')] = (miss['A: ' + u.replace(/\d+/g, 'N')] ?? 0) + 1 }
  })
  c.abilities.forEach((a, i) => {
    ab++
    if (!r.abilities[i].unsupported.length && r.abilities[i].effects.length) abOk++
    else ok = false
  })
  if (c.category === 'Trainer') {
    tr++
    if (!r.trainer?.unsupported.length) trOk++
    else { ok = false; for (const u of r.trainer.unsupported) miss['T: ' + u.replace(/\d+/g, 'N')] = (miss['T: ' + u.replace(/\d+/g, 'N')] ?? 0) + 1 }
  }
  if (ok) full++
}
const pct = (a: number, b: number) => `${a}/${b} (${((a / b) * 100).toFixed(1)}%)`
console.log('Cartas:', cards.length, '· totalmente automatizadas:', pct(full, cards.length))
console.log('Ataques:', pct(atkOk, atk), '· Treinadores:', pct(trOk, tr), '· Habilidades:', pct(abOk, ab))
console.log('\nTrechos não reconhecidos mais comuns:')
Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, TOP).forEach(([k, v]) => console.log(String(v).padStart(5), k.slice(0, 150)))
void parseEffectText; void normalizeEffect
