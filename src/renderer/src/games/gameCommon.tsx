// Peças compartilhadas da interface dos jogos genéricos (Yu-Gi-Oh! e outros que usem a estrutura genérica):
// cache de cartas/impressões, imagem de carta, ícone de cor e importação de listas.
import type { CSSProperties } from 'react'
import type { CardFinish, DeckCard } from '@shared/types'
import type { GameDef, GameId, GCard, GDeck, GPrinting } from '@shared/games/types'
import { gameImageUrl } from '@shared/api'
import { getGame } from '@shared/games/registry'
import { t } from '@shared/i18n'
import { CardImage, type FallbackData } from '../components/common'

// ---------------- Cache (evita IPC repetido) ----------------

const cardCaches = new Map<GameId, Map<string, GCard>>()
const printCaches = new Map<GameId, Map<string, GPrinting>>()

function cardCache(game: GameId): Map<string, GCard> {
  let m = cardCaches.get(game)
  if (!m) cardCaches.set(game, (m = new Map()))
  return m
}

function printCache(game: GameId): Map<string, GPrinting> {
  let m = printCaches.get(game)
  if (!m) printCaches.set(game, (m = new Map()))
  return m
}

export async function getGCards(game: GameId, ids: string[]): Promise<Record<string, GCard>> {
  const cache = cardCache(game)
  const missing = [...new Set(ids)].filter((id) => id && !cache.has(id))
  if (missing.length) {
    const fetched = await window.kard.games.cards(game, missing)
    for (const [id, c] of Object.entries(fetched)) cache.set(id, c)
  }
  const out: Record<string, GCard> = {}
  for (const id of ids) {
    const c = cache.get(id)
    if (c) out[id] = c
  }
  return out
}

export async function getGPrintings(game: GameId, ids: string[]): Promise<Record<string, GPrinting>> {
  const cache = printCache(game)
  const missing = [...new Set(ids)].filter((id) => id && !cache.has(id))
  if (missing.length) {
    const fetched = await window.kard.games.printings(game, missing)
    for (const [id, p] of Object.entries(fetched)) cache.set(id, p)
  }
  const out: Record<string, GPrinting> = {}
  for (const id of ids) {
    const p = cache.get(id)
    if (p) out[id] = p
  }
  return out
}

export function rememberGCard(game: GameId, c: GCard): void {
  cardCache(game).set(c.id, c)
}

export function rememberGPrintings(game: GameId, list: GPrinting[]): void {
  const cache = printCache(game)
  for (const p of list) cache.set(p.id, p)
}

/** Limpa o cache do jogo (após baixar o banco de novo). */
export function clearGCache(game: GameId): void {
  cardCaches.delete(game)
  printCaches.delete(game)
}

// ---------------- Deck ----------------

/** Lista de cartas de uma seção do deck ('maybeboard' = "talvez"). Cria a seção se faltar. */
export function gSectionList(deck: GDeck, section: string): DeckCard[] {
  if (section === 'maybeboard') return deck.maybeboard
  if (!deck.sections[section]) deck.sections[section] = []
  return deck.sections[section]
}

/** Todas as linhas das seções do deck (sem o "talvez"). */
export function gMainLines(def: GameDef, deck: GDeck): DeckCard[] {
  const ids = new Set(def.sections.map((s) => s.id))
  const out: DeckCard[] = []
  for (const s of def.sections) out.push(...(deck.sections[s.id] ?? []))
  // seções que não existem mais no GameDef (dados antigos) também contam
  for (const [k, list] of Object.entries(deck.sections)) if (!ids.has(k)) out.push(...list)
  return out
}

/** Todas as linhas do deck, incluindo o "talvez". */
export function gAllLines(deck: GDeck): DeckCard[] {
  return [...Object.values(deck.sections).flat(), ...deck.maybeboard]
}

/** Seção padrão de uma carta (a da carta, se existir no jogo; senão a primeira). */
export function defaultSectionOf(def: GameDef, card: GCard | undefined): string {
  if (card && def.sections.some((s) => s.id === card.section)) return card.section
  return def.sections[0]?.id ?? 'main'
}

// ---------------- Importação de listas ----------------

/**
 * Lê uma lista (formato do jogo, via def.parseText) e soma as cartas ao deck `base`.
 * Cada linha vai para a seção indicada na lista, ou para a seção padrão da carta.
 */
export async function importGameDeckText(def: GameDef, text: string, baseDeck: GDeck): Promise<{ deck: GDeck; missing: string[] }> {
  const lines = def.parseText(text)
  const deck: GDeck = {
    ...baseDeck,
    sections: Object.fromEntries(Object.entries(baseDeck.sections).map(([k, v]) => [k, v.map((c) => ({ ...c }))])),
    maybeboard: baseDeck.maybeboard.map((c) => ({ ...c }))
  }
  for (const s of def.sections) if (!deck.sections[s.id]) deck.sections[s.id] = []
  const missing: string[] = []
  if (!lines.length) return { deck, missing }
  const res = await window.kard.games.resolveNames(
    def.id,
    lines.map((l) => ({ name: l.name, code: l.code }))
  )
  const cards = await getGCards(
    def.id,
    res.map((r) => r?.cardId).filter(Boolean) as string[]
  )
  const sectionIds = new Set(def.sections.map((s) => s.id))
  lines.forEach((l, i) => {
    const r = res[i]
    if (!r?.cardId) {
      missing.push(l.name ?? l.code ?? '?')
      return
    }
    const card = cards[r.cardId]
    const target = l.section === 'maybeboard' ? 'maybeboard' : l.section && sectionIds.has(l.section) ? l.section : card ? defaultSectionOf(def, card) : 'maybeboard'
    const list = gSectionList(deck, target)
    const ex = list.find((c) => c.oracleId === r.cardId)
    if (ex) ex.qty += l.qty
    else list.push({ oracleId: r.cardId, printingId: r.printingId, qty: l.qty, name: r.name ?? card?.name ?? l.name ?? l.code ?? '' })
  })
  return { deck, missing }
}

// ---------------- Texto ----------------

/** Texto de regras (no idioma do banco quando houver) + texto secundário. */
export function cardText(card: GCard): string {
  return [card.localText ?? card.text, card.localText2 ?? card.text2].filter(Boolean).join('\n\n')
}

export function cardName(card: GCard | undefined, fallback = ''): string {
  return card?.localName ?? card?.name ?? fallback
}

export function gFallback(def: GameDef, card: GCard | undefined, name?: string): FallbackData {
  if (!card) return { name: name ?? '' }
  const stats = def.stats(card)
  return {
    name: cardName(card),
    typeLine: def.typeLine(card),
    text: cardText(card),
    loyalty: stats.length ? stats.map((s) => `${s.label} ${s.value}`).join(' · ') : undefined,
    colors: []
  }
}

// ---------------- Componentes ----------------

/** Imagem de uma carta do jogo (cache local), com a proporção do jogo e texto de reserva. */
export function GameCardImage({
  game,
  printingId,
  size = 'small',
  card,
  name,
  foil,
  title
}: {
  game: GameId
  printingId?: string
  size?: 'small' | 'large'
  card?: GCard
  name?: string
  foil?: CardFinish
  title?: string
}) {
  const def = getGame(game)!
  return (
    <div className="g-img" style={{ '--g-aspect': String(def.aspect || 0.716) } as CSSProperties}>
      <CardImage printingId={printingId} url={gameImageUrl(game, printingId, size)} fallback={gFallback(def, card, name)} foil={foil} title={title} />
    </div>
  )
}

/** Cor de texto legível sobre uma cor CSS (#rgb / #rrggbb); outras cores → branco. */
function textOn(css: string): string {
  const m = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return '#fff'
  let h = m[1]
  if (h.length === 3) h = h.replace(/./g, (x) => x + x)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#151515' : '#fff'
}

/** Cor/atributo do jogo: bolinha (padrão) ou etiqueta com o nome (`label`). */
export function ColorChip({ def, color, label, size = 14, count }: { def: GameDef; color: string; label?: boolean; size?: number; count?: number }) {
  const c = def.colors.find((x) => x.id === color)
  const css = c?.css ?? '#666'
  const name = c ? t(c.label) : color
  if (!label) {
    return <span className="g-chip dot" style={{ width: size, height: size, background: css }} title={count !== undefined ? `${name}: ${count}` : name} />
  }
  return (
    <span className="g-chip" style={{ background: css, color: textOn(css) }} title={name}>
      {name}
      {count !== undefined && <b>{count}</b>}
    </span>
  )
}
