import type { CardData, CardFinish, Deck, DeckCard, FormatId } from './types.ts'
import { t } from './i18n/index.ts'

export interface FormatDef {
  id: FormatId
  name: string
  /** Chave de legalidade do Scryfall (undefined = sem checagem de legalidade). */
  legalityKey?: string
  minMain: number
  /** Tamanho exato do deck (incluindo comandantes), quando aplicável. */
  exactSize?: number
  maxCopies: number
  sideboardMax: number
  commander: 'none' | 'commander' | 'brawl' | 'oathbreaker'
  startingLife: number
  description: string
}

export const FORMATS: FormatDef[] = [
  { id: 'standard', name: 'Standard', legalityKey: 'standard', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Coleções recentes. Mínimo 60 cartas, até 4 cópias.' },
  { id: 'pioneer', name: 'Pioneer', legalityKey: 'pioneer', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Return to Ravnica em diante.' },
  { id: 'modern', name: 'Modern', legalityKey: 'modern', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Oitava Edição em diante + Modern Horizons.' },
  { id: 'legacy', name: 'Legacy', legalityKey: 'legacy', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Todas as coleções, com lista de banidas.' },
  { id: 'vintage', name: 'Vintage', legalityKey: 'vintage', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Todas as coleções; cartas restritas limitadas a 1 cópia.' },
  { id: 'pauper', name: 'Pauper', legalityKey: 'pauper', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Somente cartas impressas como comuns.' },
  { id: 'historic', name: 'Historic', legalityKey: 'historic', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Formato do MTG Arena.' },
  { id: 'timeless', name: 'Timeless', legalityKey: 'timeless', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Formato eterno do MTG Arena.' },
  { id: 'premodern', name: 'Premodern', legalityKey: 'premodern', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Quarta Edição até Scourge.' },
  { id: 'penny', name: 'Penny Dreadful', legalityKey: 'penny', minMain: 60, maxCopies: 4, sideboardMax: 15, commander: 'none', startingLife: 20, description: 'Cartas baratas do MTGO.' },
  { id: 'commander', name: 'Commander', legalityKey: 'commander', minMain: 100, exactSize: 100, maxCopies: 1, sideboardMax: 0, commander: 'commander', startingLife: 40, description: '100 cartas singleton com comandante lendário; identidade de cor.' },
  { id: 'duel', name: 'Duel Commander', legalityKey: 'duel', minMain: 100, exactSize: 100, maxCopies: 1, sideboardMax: 0, commander: 'commander', startingLife: 20, description: 'Commander 1x1 com 20 de vida.' },
  { id: 'brawl', name: 'Brawl', legalityKey: 'brawl', minMain: 100, exactSize: 100, maxCopies: 1, sideboardMax: 0, commander: 'brawl', startingLife: 25, description: '100 cartas singleton; comandante pode ser planeswalker.' },
  { id: 'standardbrawl', name: 'Standard Brawl', legalityKey: 'standardbrawl', minMain: 60, exactSize: 60, maxCopies: 1, sideboardMax: 0, commander: 'brawl', startingLife: 25, description: '60 cartas singleton com cartas do Standard.' },
  { id: 'oathbreaker', name: 'Oathbreaker', legalityKey: 'oathbreaker', minMain: 60, exactSize: 60, maxCopies: 1, sideboardMax: 0, commander: 'oathbreaker', startingLife: 20, description: '60 cartas; planeswalker + mágica de assinatura.' },
  { id: 'paupercommander', name: 'Pauper Commander', legalityKey: 'paupercommander', minMain: 100, exactSize: 100, maxCopies: 1, sideboardMax: 0, commander: 'commander', startingLife: 30, description: 'Commander só com comuns; comandante incomum.' },
  { id: 'predh', name: 'PreDH', legalityKey: 'predh', minMain: 100, exactSize: 100, maxCopies: 1, sideboardMax: 0, commander: 'commander', startingLife: 40, description: 'Commander com cartas até Modern Horizons.' },
  { id: 'limited', name: 'Limitado (Draft/Selado)', minMain: 40, maxCopies: 999, sideboardMax: 999, commander: 'none', startingLife: 20, description: 'Mínimo 40 cartas, sem limite de cópias.' },
  { id: 'casual', name: 'Casual (livre)', minMain: 40, maxCopies: 999, sideboardMax: 999, commander: 'none', startingLife: 20, description: 'Sem restrições de legalidade.' }
]

export function getFormat(id: FormatId | string): FormatDef {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[FORMATS.length - 1]
}

export function isCommanderFormat(id: FormatId | string): boolean {
  return getFormat(id).commander !== 'none'
}

export function isBasicLand(card: Pick<CardData, 'typeLine'>): boolean {
  return /\bBasic\b/.test(card.typeLine) && /\bLand\b/.test(card.typeLine)
}

/** Limite de cópias imposto pelo texto da própria carta (Relentless Rats, Seven Dwarves...). */
export function copyLimitFromText(card: CardData): number | null {
  const text = card.oracleText ?? ''
  if (/A deck can have any number of cards named/i.test(text)) return Infinity
  const m = text.match(/A deck can have up to (\w+) cards named/i)
  if (m) {
    const n = wordToNumber(m[1])
    if (n) return n
  }
  return null
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20
}

export function wordToNumber(w: string): number | null {
  if (/^\d+$/.test(w)) return parseInt(w, 10)
  return NUMBER_WORDS[w.toLowerCase()] ?? null
}

export function canBeCommander(card: CardData, fmt: FormatDef): boolean {
  const t = card.typeLine
  const front = card.faces?.[0]?.typeLine ?? t
  const legendary = /\bLegendary\b/.test(front)
  if (/can be your commander/i.test(card.oracleText)) return true
  if (fmt.commander === 'oathbreaker') {
    return /\bPlaneswalker\b/.test(front) || /\b(Instant|Sorcery)\b/.test(front)
  }
  if (fmt.id === 'paupercommander') {
    return /\bCreature\b/.test(front)
  }
  if (legendary && /\bCreature\b/.test(front)) return true
  if (legendary && /\bBackground\b/.test(front)) return true
  if (fmt.commander === 'brawl' && legendary && /\bPlaneswalker\b/.test(front)) return true
  return false
}

/** Erros de legalidade (banida / fora do formato) e de limite de cópias, independentes do tamanho do deck. */
export function cardLegalityErrors(deck: Pick<Deck, 'commanders' | 'main' | 'sideboard'>, cards: Record<string, CardData>, fmt: FormatDef): string[] {
  const errors: string[] = []
  const copies = new Map<string, number>()
  const countIn = (list: DeckCard[]) => list.forEach((c) => copies.set(c.oracleId, (copies.get(c.oracleId) ?? 0) + c.qty))
  countIn(deck.main)
  countIn(deck.commanders)
  if (fmt.commander === 'none') countIn(deck.sideboard)

  for (const [oracleId, qty] of copies) {
    const card = cards[oracleId]
    if (!card) continue
    const textLimit = copyLimitFromText(card)
    let limit = fmt.maxCopies
    if (isBasicLand(card)) limit = Infinity
    else if (textLimit !== null) limit = textLimit
    if (fmt.legalityKey) {
      const leg = card.legalities[fmt.legalityKey] ?? 'not_legal'
      if (leg === 'banned') errors.push(t('{card} é banida em {format}.', { card: card.name, format: t(fmt.name) }))
      else if (leg === 'not_legal') errors.push(t('{card} não é legal em {format}.', { card: card.name, format: t(fmt.name) }))
      else if (leg === 'restricted') limit = Math.min(limit, 1)
    }
    if (qty > limit) {
      errors.push(
        limit === 1
          ? t('{card}: apenas 1 cópia permitida ({qty}).', { card: card.name, qty })
          : t('{card}: no máximo {limit} cópias ({qty}).', { card: card.name, limit, qty })
      )
    }
  }
  return errors
}

function hasPartnerAbility(card: CardData): boolean {
  return card.keywords.some((k) => /^(Partner|Partner with|Friends forever|Doctor's companion)$/i.test(k)) ||
    /\bPartner\b|Friends forever|Doctor's companion/i.test(card.oracleText)
}

export interface DeckValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  mainCount: number
  sideCount: number
  commanderCount: number
  totalCount: number
  identity: string[]
}

export function deckCount(list: DeckCard[]): number {
  return list.reduce((s, c) => s + c.qty, 0)
}

/** Valida um deck segundo as regras do formato. `cards` deve conter todas as cartas do deck. */
export function validateDeck(deck: Deck, cards: Record<string, CardData>): DeckValidation {
  const fmt = getFormat(deck.format)
  const errors: string[] = []
  const warnings: string[] = []
  const mainCount = deckCount(deck.main)
  const sideCount = deckCount(deck.sideboard)
  const commanderCount = deckCount(deck.commanders)
  const totalCount = mainCount + commanderCount
  let identity: string[] = []

  const missing = [...deck.commanders, ...deck.main, ...deck.sideboard].filter((c) => !cards[c.oracleId])
  if (missing.length) {
    const names = missing.slice(0, 5).map((m) => m.name).join(', ')
    warnings.push(
      missing.length === 1
        ? t('1 carta não encontrada no banco local: {names}', { names })
        : t('{n} cartas não encontradas no banco local: {names}', { n: missing.length, names })
    )
  }

  // Comandantes
  if (fmt.commander !== 'none') {
    if (commanderCount === 0) {
      errors.push(fmt.commander === 'oathbreaker' ? t('Escolha um Oathbreaker (planeswalker) e uma mágica de assinatura.') : t('Escolha um comandante.'))
    }
    const cmdCards = deck.commanders.map((c) => cards[c.oracleId]).filter(Boolean)
    for (const c of cmdCards) {
      // Qualquer carta pode ser comandante; fora das regras oficiais só gera aviso.
      if (!canBeCommander(c, fmt)) warnings.push(t('{card} normalmente não pode ser comandante neste formato.', { card: c.name }))
    }
    if (fmt.commander === 'oathbreaker') {
      const pw = cmdCards.filter((c) => /Planeswalker/.test(c.typeLine))
      const sig = cmdCards.filter((c) => /Instant|Sorcery/.test(c.typeLine))
      if (pw.length !== 1) errors.push(t('Oathbreaker exige exatamente 1 planeswalker como Oathbreaker.'))
      if (sig.length > 1) errors.push(t('Apenas 1 mágica de assinatura é permitida.'))
      identity = unique(pw.flatMap((c) => c.colorIdentity))
      for (const s of sig) {
        if (!s.colorIdentity.every((x) => identity.includes(x))) errors.push(t('A mágica de assinatura {card} está fora da identidade de cor.', { card: s.name }))
      }
    } else {
      if (cmdCards.length > 2) errors.push(t('No máximo 2 comandantes (parceiros).'))
      if (cmdCards.length === 2) {
        const [a, b] = cmdCards
        const background =
          (/Choose a Background/i.test(a.oracleText) && /Background/.test(b.typeLine)) ||
          (/Choose a Background/i.test(b.oracleText) && /Background/.test(a.typeLine))
        const partners = hasPartnerAbility(a) && hasPartnerAbility(b)
        if (!background && !partners) errors.push(t('{a} e {b} não podem ser comandantes juntos (precisam de Parceiro ou Antecedente).', { a: a.name, b: b.name }))
      }
      identity = unique(cmdCards.flatMap((c) => c.colorIdentity))
    }
  }

  // Tamanho
  if (fmt.exactSize) {
    if (totalCount !== fmt.exactSize) errors.push(t('O deck deve ter exatamente {size} cartas (incluindo comandante). Atual: {count}.', { size: fmt.exactSize, count: totalCount }))
  } else if (mainCount < fmt.minMain) {
    errors.push(t('O deck principal precisa de pelo menos {min} cartas. Atual: {count}.', { min: fmt.minMain, count: mainCount }))
  }
  if (sideCount > fmt.sideboardMax) {
    errors.push(
      fmt.sideboardMax === 0
        ? t('Este formato não usa sideboard.')
        : t('Sideboard com no máximo {max} cartas. Atual: {count}.', { max: fmt.sideboardMax, count: sideCount })
    )
  }

  // Cópias e legalidade
  errors.push(...cardLegalityErrors(deck, cards, fmt))
  if (fmt.commander !== 'none' && deck.commanders.length > 0) {
    for (const c of [...deck.main, ...deck.commanders]) {
      const card = cards[c.oracleId]
      if (!card) continue
      const isCmd = deck.commanders.some((x) => x.oracleId === c.oracleId)
      if (!isCmd && !card.colorIdentity.every((x) => identity.includes(x))) {
        errors.push(t('{card} está fora da identidade de cor do comandante.', { card: card.name }))
      }
    }
  }

  if (fmt.commander === 'none' && commanderCount > 0) {
    warnings.push(t('Este formato não usa comandante; a carta marcada como comandante será ignorada.'))
  }

  const lands = deck.main.reduce((s, c) => s + (cards[c.oracleId] && /\bLand\b/.test(cards[c.oracleId].typeLine) ? c.qty : 0), 0)
  if (mainCount > 0) {
    const ratio = lands / Math.max(1, totalCount)
    if (ratio < 0.3) warnings.push(t('Poucos terrenos ({lands}). Recomendado: ~{rec}.', { lands, rec: Math.round(totalCount * 0.38) }))
    if (ratio > 0.55) warnings.push(t('Muitos terrenos ({lands}).', { lands }))
  }

  return { valid: errors.length === 0, errors: unique(errors), warnings, mainCount, sideCount, commanderCount, totalCount, identity }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G']
export const COLOR_NAMES: Record<string, string> = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', C: 'Incolor' }

export function sortColors(colors: string[]): string[] {
  return [...colors].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b))
}

export function emptyDeck(name = t('Novo deck'), format: FormatId = 'standard'): Deck {
  const now = new Date().toISOString()
  return {
    id: `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    format,
    commanders: [],
    main: [],
    sideboard: [],
    maybeboard: [],
    createdAt: now,
    updatedAt: now
  }
}

/** Exporta no formato de texto usado pelo MTG Arena / MTGO. */
export function exportDeckText(deck: Deck, setOf?: (printingId?: string) => { set: string; cn: string } | null): string {
  const line = (c: DeckCard) => {
    const p = setOf?.(c.printingId)
    const fin = c.finish === 'foil' ? ' *F*' : c.finish === 'etched' ? ' *E*' : ''
    return (p ? `${c.qty} ${c.name} (${p.set.toUpperCase()}) ${p.cn}` : `${c.qty} ${c.name}`) + fin
  }
  const parts: string[] = []
  if (deck.commanders.length) parts.push('Commander', ...deck.commanders.map(line), '')
  parts.push('Deck', ...deck.main.map(line))
  if (deck.sideboard.length) parts.push('', 'Sideboard', ...deck.sideboard.map(line))
  return parts.join('\n')
}

export interface ParsedDeckLine {
  qty: number
  name: string
  set?: string
  cn?: string
  /** Marca "*F*" (foil) ou "*E*" (etched) no fim da linha. */
  finish?: CardFinish
  section: 'main' | 'sideboard' | 'commander' | 'maybeboard'
  /** Bloco separado por linhas em branco (0, 1, 2...). */
  group: number
}

/** Lê listas no formato "4 Lightning Bolt (M10) 146", com seções Commander/Deck/Sideboard. */
export function parseDeckText(text: string): ParsedDeckLine[] {
  const out: ParsedDeckLine[] = []
  let section: ParsedDeckLine['section'] = 'main'
  let group = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (out.length && out[out.length - 1].group === group) group++
      continue
    }
    if (line.startsWith('//') || line.startsWith('#')) continue
    const header = line.toLowerCase().replace(/:$/, '')
    if (['commander', 'comandante', 'commanders'].includes(header)) { section = 'commander'; continue }
    if (['deck', 'main', 'mainboard', 'principal'].includes(header)) { section = 'main'; continue }
    if (['sideboard', 'side', 'reserva'].includes(header)) { section = 'sideboard'; continue }
    if (['maybeboard', 'maybe', 'talvez'].includes(header)) { section = 'maybeboard'; continue }
    if (['companion', 'companheiro'].includes(header)) { section = 'sideboard'; continue }
    let sec = section
    let body = line
    if (/^SB:\s*/i.test(body)) { sec = 'sideboard'; body = body.replace(/^SB:\s*/i, '') }
    const m = body.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+([A-Za-z0-9★\-]+))?)?(?:\s+\*([A-Z]+)\*)?\s*$/)
    if (m) {
      const finish = m[5] === 'F' ? 'foil' : m[5] === 'E' ? 'etched' : undefined
      out.push({ qty: parseInt(m[1], 10), name: m[2].trim(), set: m[3]?.toLowerCase(), cn: m[4], finish, section: sec, group })
    } else {
      out.push({ qty: 1, name: body, section: sec, group })
    }
  }
  return out
}
