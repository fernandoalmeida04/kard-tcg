// Utilidades comuns aos jogos genéricos (TS puro; roda também em scripts node).
import type { DeckCard } from '../types.ts'
import { t } from '../i18n/index.ts'
import type { GameDef, GCard, GDeck, GPrinting, GValidation } from './types.ts'

export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function emptyGDeck(def: GameDef, name: string, format: string): GDeck {
  const now = new Date().toISOString()
  return {
    id: `${def.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    game: def.id,
    name,
    format,
    sections: Object.fromEntries(def.sections.map((s) => [s.id, []])),
    maybeboard: [],
    createdAt: now,
    updatedAt: now
  }
}

export function gCount(list: DeckCard[] | undefined): number {
  return (list ?? []).reduce((s, c) => s + c.qty, 0)
}

/** Limite de cópias da carta no formato (0 = proibida). */
export function limitOf(def: GameDef, card: GCard, format: string): number {
  if (card.notLegal?.includes(format)) return 0
  return card.limits[format] ?? def.defaultLimit
}

/**
 * Validação básica comum: tamanho de cada seção, cópias por carta (somando todas as seções),
 * cartas proibidas/limitadas no formato e cartas fora do banco local.
 * `copyKey`: como contar cópias — pelo nome (Yu-Gi-Oh!) ou pelo id da carta/código.
 */
export function basicValidate(def: GameDef, deck: GDeck, cards: Record<string, GCard>, copyKey: (c: GCard) => string = (c) => c.id): GValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const counts: Record<string, number> = {}
  const copies = new Map<string, { qty: number; card: GCard }>()
  const missing: string[] = []
  for (const sec of def.sections) {
    const list = deck.sections[sec.id] ?? []
    counts[sec.id] = gCount(list)
    for (const dc of list) {
      const c = cards[dc.oracleId]
      if (!c) {
        missing.push(dc.name)
        continue
      }
      const k = copyKey(c)
      const cur = copies.get(k)
      copies.set(k, { qty: (cur?.qty ?? 0) + dc.qty, card: c })
    }
    if (counts[sec.id] < sec.min || counts[sec.id] > sec.max) {
      errors.push(
        sec.min === sec.max
          ? t('{section}: precisa ter exatamente {n} cartas (atual: {count}).', { section: t(sec.label), n: sec.min, count: counts[sec.id] })
          : t('{section}: precisa ter de {min} a {max} cartas (atual: {count}).', { section: t(sec.label), min: sec.min, max: sec.max, count: counts[sec.id] })
      )
    }
  }
  for (const { qty, card } of copies.values()) {
    const lim = limitOf(def, card, deck.format)
    const name = card.localName ?? card.name
    if (lim === 0) errors.push(t('{name} é proibida neste formato.', { name }))
    else if (qty > lim) errors.push(lim === 1 ? t('{name}: apenas 1 cópia permitida ({n}).', { name, n: qty }) : t('{name}: no máximo {max} cópias ({n}).', { name, max: lim, n: qty }))
  }
  if (missing.length === 1) warnings.push(t('1 carta não encontrada no banco local: {names}', { names: missing[0] }))
  else if (missing.length > 1) warnings.push(t('{n} cartas não encontradas no banco local: {names}', { n: missing.length, names: missing.slice(0, 5).join(', ') }))
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings, counts }
}

/** Código impresso de uma impressão (para exportar listas). */
export function codeOf(p: GPrinting | undefined, card: GCard | undefined): string {
  return p?.code ?? card?.id ?? ''
}
