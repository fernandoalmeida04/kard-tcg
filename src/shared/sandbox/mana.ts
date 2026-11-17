// Habilidades de mana das cartas de Magic, lidas do texto: quanto e quais cores cada fonte gera
// ao ser virada (ex.: Sol Ring = {C}{C}; Gruul Signet = {1},{T}: {R}{G}; terreno dual = {R} ou {G}).
import type { GameCard } from '../engine/types.ts'
import type { SObj } from './types.ts'

export interface ManaOption {
  /** Símbolos gerados, ex.: ['C','C'] ou ['R','G']. */
  mana: string[]
  /** Mana genérica que a habilidade custa além de virar (Signets: {1}). */
  cost: number
}

const COLORS = ['W', 'U', 'B', 'R', 'G']
const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }

function faceText(o: SObj): { text: string; typeLine: string; produced: string[] } {
  const c = o.card as GameCard
  const f = c.faces?.[o.face ?? 0]
  return { text: f?.oracleText ?? c.oracleText ?? '', typeLine: f?.typeLine ?? c.typeLine ?? '', produced: c.producedMana ?? [] }
}

function symbols(s: string): string[] {
  return (s.match(/\{([WUBRGC])\}/g) ?? []).map((x) => x[1])
}

/** Opções de mana ao virar a permanente (vazio se ela não gera mana). */
export function manaOptionsOf(o: SObj): ManaOption[] {
  if (!('typeLine' in o.card)) return []
  const { text, typeLine, produced } = faceText(o)
  const out: ManaOption[] = []
  const add = (mana: string[], cost: number) => {
    if (mana.length && !out.some((x) => x.cost === cost && x.mana.join('') === mana.join(''))) out.push({ mana, cost })
  }
  // linhas do tipo "{1}, {T}: Add {R}{G}." / "{T}: Add {R} or {G}." / "{T}: Add one mana of any color."
  const re = /([^\n.:]*\{T\}[^\n:]*):\s*Add ([^.\n]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const costPart = m[1]
    const what = m[2].trim()
    // habilidades que pedem outro custo além de mana genérica (sacrificar, pagar vida...) também valem: é só indicação
    const cost = (costPart.match(/\{(\d+)\}/g) ?? []).reduce((sum, x) => sum + parseInt(x.slice(1, -1), 10), 0)
    let n: RegExpMatchArray | null
    if (/one mana of any color/i.test(what)) COLORS.forEach((c) => add([c], cost))
    else if ((n = what.match(/(one|two|three|four|five) mana of any one color/i))) COLORS.forEach((c) => add(Array(WORD[n![1].toLowerCase()]).fill(c), cost))
    else if (/mana of any color/i.test(what)) COLORS.forEach((c) => add([c], cost))
    else if (/\bor\b/i.test(what)) {
      // "{R} or {G}" / "{W}, {U}, or {B}" / "{C}{C} or {R}"
      for (const part of what.split(/,\s*or\s*|\s+or\s+|,\s*/i)) add(symbols(part), cost)
    } else add(symbols(what), cost)
  }
  if (out.length) return out
  // sem texto reconhecido: terrenos básicos e o produced_mana do Scryfall (1 mana de cada cor)
  const basic: [RegExp, string][] = [
    [/\bPlains\b/, 'W'],
    [/\bIsland\b/, 'U'],
    [/\bSwamp\b/, 'B'],
    [/\bMountain\b/, 'R'],
    [/\bForest\b/, 'G']
  ]
  for (const [rx, c] of basic) if (rx.test(typeLine)) add([c], 0)
  for (const c of produced) if (/^[WUBRGC]$/.test(c)) add([c], 0)
  return out
}

/** Mana líquida máxima que a fonte gera numa virada (Sol Ring = 2; Signet = 2 − 1 = 1). */
export function maxManaOf(o: SObj): number {
  return Math.max(0, ...manaOptionsOf(o).map((x) => x.mana.length - x.cost))
}

/** Opção que contém a cor pedida, gerando o máximo possível (usada quando só a cor é informada). */
export function bestOptionFor(o: SObj, color: string): ManaOption | null {
  const opts = manaOptionsOf(o).filter((x) => x.mana.includes(color))
  if (!opts.length) return null
  return opts.sort((a, b) => b.mana.length - b.cost - (a.mana.length - a.cost))[0]
}
