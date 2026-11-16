// Formatos, validação de deck e listas de texto do Pokémon TCG.
import type { DeckCard } from '../types.ts'
import { t } from '../i18n/index.ts'
import type { PkmCard, PkmCategory, PkmDeck, PkmFormatId, PkmType } from './types.ts'

export interface PkmFormatDef {
  id: PkmFormatId
  name: string
  description: string
  /** Tamanho exato do deck (null = livre). */
  size: number | null
  /** Campo de legalidade do TCGdex; null = todas as cartas. */
  legalKey: 'standard' | 'expanded' | null
}

export const PKM_FORMATS: PkmFormatDef[] = [
  { id: 'standard', name: 'Standard', description: 'Formato oficial atual: coleções com marcas de regulamentação recentes. 60 cartas.', size: 60, legalKey: 'standard' },
  { id: 'expanded', name: 'Expanded', description: 'Coleções desde Preto e Branco, com lista de banidas. 60 cartas.', size: 60, legalKey: 'expanded' },
  { id: 'unlimited', name: 'Ilimitado', description: 'Todas as cartas já lançadas. 60 cartas.', size: 60, legalKey: null },
  { id: 'casual', name: 'Livre', description: 'Sem restrições de tamanho ou legalidade.', size: null, legalKey: null }
]

export function getPkmFormat(id: string): PkmFormatDef {
  return PKM_FORMATS.find((f) => f.id === id) ?? PKM_FORMATS[0]
}

/**
 * Siglas do Pokémon TCG Live / torneios por coleção do TCGdex (as que o TCGdex não informa em `tcgOnline`).
 */
export const PKM_SET_CODES: Record<string, string> = {
  swshp: 'PR-SW',
  swsh11: 'LOR',
  swsh12: 'SIT',
  'swsh12.5': 'CRZ',
  sve: 'SVE',
  sv01: 'SVI',
  svp: 'PR-SV',
  sv02: 'PAL',
  sv03: 'OBF',
  'sv03.5': 'MEW',
  sv04: 'PAR',
  'sv04.5': 'PAF',
  sv05: 'TEF',
  sv06: 'TWM',
  'sv06.5': 'SFA',
  sv07: 'SCR',
  sv08: 'SSP',
  'sv08.5': 'PRE',
  sv09: 'JTG',
  sv10: 'DRI',
  'sv10.5w': 'WHT',
  'sv10.5b': 'BLK',
  mee: 'MEE',
  mep: 'MEP',
  me01: 'MEG',
  me02: 'PFL'
}

export function emptyPkmDeck(name: string, format: PkmFormatId): PkmDeck {
  const now = new Date().toISOString()
  return {
    id: `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    format,
    main: [],
    maybeboard: [],
    createdAt: now,
    updatedAt: now
  }
}

export function pkmDeckCount(list: DeckCard[]): number {
  return list.reduce((s, c) => s + c.qty, 0)
}

export function isBasicEnergy(c: PkmCard): boolean {
  return c.category === 'Energy' && c.energyType !== 'Special'
}

export function isBasicPokemon(c: PkmCard): boolean {
  return c.category === 'Pokemon' && (c.stage === 'Basic' || c.stage === 'Baby')
}

export interface PkmValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  total: number
  byCategory: Record<PkmCategory, number>
  basics: number
  types: PkmType[]
}

/** Valida o deck: tamanho, até 4 cópias por nome (exceto Energia Básica), Pokémon Básico, ACE SPEC, Radiante, Prisma e legalidade. */
export function validatePkmDeck(deck: PkmDeck, cards: Record<string, PkmCard>): PkmValidation {
  const fmt = getPkmFormat(deck.format)
  const errors: string[] = []
  const warnings: string[] = []
  const byCategory: Record<PkmCategory, number> = { Pokemon: 0, Trainer: 0, Energy: 0 }
  const byName = new Map<string, { qty: number; card: PkmCard }>()
  const types = new Set<PkmType>()
  let total = 0
  let basics = 0
  let aceSpec = 0
  let radiant = 0
  const missing: string[] = []

  for (const dc of deck.main) {
    const c = cards[dc.oracleId]
    total += dc.qty
    if (!c) {
      missing.push(dc.name)
      continue
    }
    byCategory[c.category] += dc.qty
    if (isBasicPokemon(c)) basics += dc.qty
    if (c.category === 'Pokemon') c.types.forEach((x) => types.add(x))
    if (c.aceSpec) aceSpec += dc.qty
    if (c.radiant) radiant += dc.qty
    const key = c.name.toLowerCase()
    const cur = byName.get(key)
    byName.set(key, { qty: (cur?.qty ?? 0) + dc.qty, card: c })
    if (fmt.legalKey && !c.legal[fmt.legalKey]) errors.push(t('{name} não é legal em {format}.', { name: c.localName ?? c.name, format: t(fmt.name) }))
  }

  if (missing.length === 1) warnings.push(t('1 carta não encontrada no banco local: {names}', { names: missing[0] }))
  else if (missing.length > 1) warnings.push(t('{n} cartas não encontradas no banco local: {names}', { n: missing.length, names: missing.slice(0, 5).join(', ') }))

  if (fmt.size !== null && total !== fmt.size) errors.push(t('O deck deve ter exatamente {size} cartas. Atual: {n}.', { size: fmt.size, n: total }))
  if (fmt.size !== null && basics === 0 && total > 0) errors.push(t('O deck precisa de pelo menos 1 Pokémon Básico.'))
  if (fmt.size === null && basics === 0 && total > 0) warnings.push(t('Sem Pokémon Básico: não será possível começar uma partida.'))

  for (const { qty, card } of byName.values()) {
    if (isBasicEnergy(card)) continue
    const limit = card.prismStar ? 1 : 4
    if (qty > limit && fmt.size !== null) {
      errors.push(limit === 1 ? t('{name}: apenas 1 cópia permitida ({n}).', { name: card.localName ?? card.name, n: qty }) : t('{name}: no máximo 4 cópias com o mesmo nome ({n}).', { name: card.localName ?? card.name, n: qty }))
    }
  }
  if (aceSpec > 1 && fmt.size !== null) errors.push(t('Apenas 1 carta ACE SPEC por deck ({n}).', { n: aceSpec }))
  if (radiant > 1 && fmt.size !== null) errors.push(t('Apenas 1 Pokémon Radiante por deck ({n}).', { n: radiant }))

  if (total >= 40 && byCategory.Energy === 0) warnings.push(t('O deck não tem cartas de Energia.'))

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings, total, byCategory, basics, types: [...types] }
}

// ---------------- Listas de texto (formato do Pokémon TCG Live) ----------------

export interface PkmParsedLine {
  qty: number
  name: string
  /** Sigla da coleção (ex.: "SVI") ou id do TCGdex. */
  set?: string
  number?: string
  section: 'main' | 'maybeboard'
}

const ENERGY_SYMBOLS: Record<string, string> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' }

/** "Basic {L} Energy" → "Basic Lightning Energy". */
export function expandEnergySymbols(name: string): string {
  return name.replace(/\{([GRWLPFDMYNC])\}/g, (_, s: string) => ENERGY_SYMBOLS[s] ?? s)
}

/**
 * Lê listas como as do Pokémon TCG Live:
 *   Pokémon: 12
 *   4 Pikachu ex SVI 63
 *   Trainer: 36 ...
 */
export function parsePkmDeckText(text: string): PkmParsedLine[] {
  const out: PkmParsedLine[] = []
  let section: PkmParsedLine['section'] = 'main'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    const header = line.toLowerCase().replace(/[:\s\d]+$/, '').trim()
    if (/^(pok[eé]mon|trainer|treinadores?|energy|energia|energias|deck|total cards|total de cartas|cartas)$/.test(header)) {
      section = 'main'
      continue
    }
    if (/^(maybeboard|maybe|talvez)$/.test(header)) {
      section = 'maybeboard'
      continue
    }
    const full = line.match(/^(\d+)\s*x?\s+(.+?)\s+((?:PR-)?[A-Za-z0-9]{2,6}(?:\.\d)?)\s+([A-Za-z]{0,4}\d+[a-z]?)$/)
    if (full) {
      out.push({ qty: parseInt(full[1], 10), name: expandEnergySymbols(full[2].trim()), set: full[3], number: full[4], section })
      continue
    }
    const simple = line.match(/^(\d+)\s*x?\s+(.+)$/)
    if (simple) out.push({ qty: parseInt(simple[1], 10), name: expandEnergySymbols(simple[2].trim()), section })
  }
  return out
}

/** Exporta no formato do Pokémon TCG Live (nomes em inglês, sigla e número quando conhecidos). */
export function exportPkmDeckText(
  deck: PkmDeck,
  cards: Record<string, PkmCard>,
  printingOf: (dc: DeckCard) => { code?: string; number: string } | null
): string {
  const groups: Record<PkmCategory, DeckCard[]> = { Pokemon: [], Trainer: [], Energy: [] }
  for (const dc of deck.main) groups[cards[dc.oracleId]?.category ?? 'Trainer'].push(dc)
  const line = (dc: DeckCard) => {
    const c = cards[dc.oracleId]
    const p = printingOf(dc)
    const name = c?.name ?? dc.name
    const num = p ? String(parseInt(p.number, 10) || p.number) : ''
    return p?.code ? `${dc.qty} ${name} ${p.code} ${num}` : `${dc.qty} ${name}`
  }
  const parts: string[] = []
  const head: Record<PkmCategory, string> = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' }
  for (const cat of ['Pokemon', 'Trainer', 'Energy'] as PkmCategory[]) {
    if (!groups[cat].length) continue
    parts.push(`${head[cat]}: ${pkmDeckCount(groups[cat])}`, ...groups[cat].map(line), '')
  }
  parts.push(`Total Cards: ${pkmDeckCount(deck.main)}`)
  return parts.join('\n')
}
