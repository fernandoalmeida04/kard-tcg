import type { CardData, Deck, DeckCard, FormatId } from '@shared/types'
import { getFormat, isCommanderFormat, COLOR_NAMES } from '@shared/formats'
import { isFullySupported, parseCardFaces, type GameCard } from '@shared/engine'
import { getCards, getPrintings } from '../cardCache'
import { finishOf } from '../components/common'
import { t } from '@shared/i18n'

export function toGameCard(c: CardData, printingId?: string): GameCard {
  return {
    oracleId: c.oracleId,
    name: c.name,
    displayName: c.localName || c.name,
    manaCost: c.manaCost,
    cmc: c.cmc,
    typeLine: c.typeLine,
    displayType: c.localTypeLine || c.typeLine,
    oracleText: c.oracleText,
    displayText: c.localText || c.oracleText,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    colors: c.colors,
    colorIdentity: c.colorIdentity,
    keywords: c.keywords,
    producedMana: c.producedMana,
    layout: c.layout,
    printingId: printingId ?? c.defaultPrintingId,
    faces: c.faces?.map((f) => ({
      name: f.name,
      displayName: f.localName || f.name,
      manaCost: f.manaCost,
      typeLine: f.typeLine,
      displayType: f.localTypeLine || f.typeLine,
      oracleText: f.oracleText,
      displayText: f.localText || f.oracleText,
      power: f.power,
      toughness: f.toughness,
      loyalty: f.loyalty,
      colors: f.colors ?? c.colors
    }))
  }
}

export async function deckToGameCards(deck: Deck): Promise<{ deck: GameCard[]; commanders: GameCard[] }> {
  const all = [...deck.commanders, ...deck.main]
  const cards = await getCards(all.map((c) => c.oracleId))
  const prints = await getPrintings(all.map((dc) => dc.printingId ?? cards[dc.oracleId]?.defaultPrintingId).filter(Boolean) as string[])
  const make = (dc: DeckCard): GameCard => {
    const c = cards[dc.oracleId]
    const gc = toGameCard(c, dc.printingId)
    const finish = finishOf(prints[gc.printingId ?? ''], dc.finish)
    if (finish) gc.finish = finish
    return gc
  }
  const main: GameCard[] = []
  for (const dc of deck.main) {
    if (!cards[dc.oracleId]) continue
    for (let i = 0; i < dc.qty; i++) main.push(make(dc))
  }
  const commanders = isCommanderFormat(deck.format) ? deck.commanders.filter((dc) => cards[dc.oracleId]).map(make) : []
  return { deck: main, commanders }
}

function supportedAndUseful(c: CardData): boolean {
  const faces = parseCardFaces({ name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, keywords: c.keywords, producedMana: c.producedMana, layout: c.layout, faces: c.faces })
  if (!faces.every(isFullySupported)) return false
  const p = faces[0]
  if (/\bCreature\b/.test(c.typeLine)) return true
  if (/\b(Instant|Sorcery)\b/.test(c.typeLine)) return Boolean(p.spell && (p.spell.effects.length || p.spell.modes))
  return p.statics.length > 0 || p.triggers.length > 0 || p.activated.length > 0 || Boolean(p.aura)
}

function pickWeighted<T>(list: T[], n: number, taken: Set<T>): T[] {
  // os primeiros da lista (mais populares) têm mais chance
  const out: T[] = []
  const pool = list.filter((x) => !taken.has(x))
  while (out.length < n && pool.length) {
    const idx = Math.floor(Math.pow(Math.random(), 2.2) * Math.min(pool.length, 160))
    const [x] = pool.splice(idx, 1)
    out.push(x)
    taken.add(x)
  }
  return out
}

/** Gera um deck automático para o bot usando cartas que o motor suporta totalmente. */
export async function generateBotDeck(colors: string[], format: FormatId): Promise<{ deck: GameCard[]; commanders: GameCard[]; name: string }> {
  const fmt = getFormat(format)
  const cmd = isCommanderFormat(format)
  const legal = fmt.legalityKey
  const cols = colors.length ? colors : ['R', 'G']
  const all = await window.kard.db.candidates({ colors: cols, format: legal, maxCmc: 7, limit: 6000 })
  const basics = await window.kard.db.basicLands()
  const usable = all.filter(supportedAndUseful)
  const isCreature = (c: CardData) => /\bCreature\b/.test(c.typeLine)
  const isSpell = (c: CardData) => /\b(Instant|Sorcery)\b/.test(c.typeLine)

  let commander: CardData | undefined
  if (cmd) {
    const legends = all.filter((c) => /\bLegendary\b/.test(c.typeLine) && /\bCreature\b/.test(c.typeLine) && c.cmc >= 2 && c.cmc <= 6)
    const exact = legends.filter((c) => c.colorIdentity.length === cols.length && supportedAndUseful(c))
    commander = exact[Math.floor(Math.random() * Math.min(exact.length, 20))] ?? legends.find(supportedAndUseful) ?? legends[0]
  }
  const identity = commander ? commander.colorIdentity : cols
  const pool = usable.filter((c) => c.colorIdentity.every((x) => identity.includes(x)) && c.oracleId !== commander?.oracleId)

  const creaturesByCmc = (lo: number, hi: number) => pool.filter((c) => isCreature(c) && c.cmc >= lo && c.cmc <= hi)
  const spells = pool.filter(isSpell)
  const others = pool.filter((c) => !isCreature(c) && !isSpell(c))
  const taken = new Set<CardData>()
  const chosen: CardData[] = []
  const plan = cmd
    ? { c1: 4, c2: 8, c3: 8, c4: 6, c5: 6, sp: 18, ot: 12 }
    : { c1: 2, c2: 3, c3: 3, c4: 2, c5: 1, sp: 3, ot: 1 }
  chosen.push(...pickWeighted(creaturesByCmc(0, 1), plan.c1, taken))
  chosen.push(...pickWeighted(creaturesByCmc(2, 2), plan.c2, taken))
  chosen.push(...pickWeighted(creaturesByCmc(3, 3), plan.c3, taken))
  chosen.push(...pickWeighted(creaturesByCmc(4, 4), plan.c4, taken))
  chosen.push(...pickWeighted(creaturesByCmc(5, 7), plan.c5, taken))
  chosen.push(...pickWeighted(spells, plan.sp, taken))
  chosen.push(...pickWeighted(others, plan.ot, taken))

  const deck: GameCard[] = []
  const nonlandTarget = cmd ? fmt.exactSize! - 1 - 37 : 36
  if (cmd) {
    for (const c of chosen) deck.push(toGameCard(c))
    // completa com criaturas se faltou
    const extra = pickWeighted(pool.filter(isCreature), nonlandTarget - deck.length, taken)
    for (const c of extra) deck.push(toGameCard(c))
  } else {
    const copies = Math.min(4, fmt.maxCopies)
    let i = 0
    while (deck.length < nonlandTarget && chosen.length) {
      const c = chosen[i % chosen.length]
      const already = deck.filter((d) => d.oracleId === c.oracleId).length
      if (already < copies) deck.push(toGameCard(c))
      i++
      if (i > chosen.length * copies + 10) break
    }
    // se ainda faltar, completa com mais cartas distintas
    while (deck.length < nonlandTarget) {
      const more = pickWeighted(pool, 1, taken)[0]
      if (!more) break
      for (let k = 0; k < copies && deck.length < nonlandTarget; k++) deck.push(toGameCard(more))
    }
  }

  // Terrenos básicos proporcionais aos símbolos de mana
  const landCount = (cmd ? fmt.exactSize! - 1 : 60) - deck.length
  const weight: Record<string, number> = {}
  for (const c of deck) for (const s of c.manaCost.match(/\{[WUBRG]\}/g) ?? []) weight[s[1]] = (weight[s[1]] ?? 0) + 1
  const landColors = identity.filter((c) => basics[c])
  const totalW = landColors.reduce((s, c) => s + (weight[c] ?? 1), 0) || 1
  let placed = 0
  landColors.forEach((c, idx) => {
    const n = idx === landColors.length - 1 ? landCount - placed : Math.round((landCount * (weight[c] ?? 1)) / totalW)
    for (let k = 0; k < n; k++) deck.push(toGameCard(basics[c]))
    placed += n
  })
  if (landColors.length === 0 && basics.C) for (let k = 0; k < landCount; k++) deck.push(toGameCard(basics.C))

  const name = `Bot · ${identity.map((c) => t(COLOR_NAMES[c])).join('/') || t('Incolor')}`

  return { deck, commanders: commander ? [toGameCard(commander)] : [], name }
}
