// Monta partidas de Pokémon: cartas do deck, cadeia de evolução (Doce Raro) e deck automático do bot.
import type { PkmCard, PkmType } from '@shared/pokemon/types'
import type { PGameCard } from '@shared/pkm-engine'
import { isCardAutomated } from '@shared/pkm-engine'
import { t } from '@shared/i18n'
import { getPkmCards } from '../pkmCommon'

/** Linha de deck (id da carta, impressão, quantidade). */
export interface PkmDeckLine {
  cardId: string
  printingId?: string
  qty: number
}

/** Cartas da partida a partir das linhas do deck (usando o banco local). */
export async function pkmDeckToGameCards(lines: PkmDeckLine[]): Promise<{ cards: PGameCard[]; missing: number }> {
  const db = await getPkmCards(lines.map((l) => l.cardId))
  const cards: PGameCard[] = []
  let missing = 0
  for (const l of lines) {
    const card = db[l.cardId]
    if (!card) {
      missing += l.qty
      continue
    }
    for (let i = 0; i < l.qty; i++) cards.push({ card, printingId: l.printingId ?? card.defaultPrintingId })
  }
  return { cards, missing }
}

/** Estágio 1 → Básico para os Estágio 2 dos decks (o Doce Raro pula o Estágio 1). */
export async function buildEvolutions(decks: PGameCard[][]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const all = decks.flat().map((g) => g.card)
  const known = new Map(all.map((c) => [c.name, c]))
  const need = new Set(all.filter((c) => c.stage === 'Stage2' && c.evolveFrom).map((c) => c.evolveFrom!))
  for (const name of need) {
    let s1 = known.get(name)
    if (!s1) {
      try {
        const r = await window.kard.pkm.search({ text: name, categories: ['Pokemon'], limit: 20 })
        const cards = await getPkmCards(r.cards.map((x) => x.id))
        s1 = Object.values(cards).find((c) => c.name === name && c.evolveFrom)
      } catch {
        s1 = undefined
      }
    }
    if (s1?.evolveFrom) out[name] = s1.evolveFrom
  }
  return out
}

const TRAINERS = ['Potion', 'Switch', 'Nest Ball', "Professor's Research", 'Ultra Ball', "Boss's Orders", 'Energy Retrieval', 'Great Ball', 'Super Rod']

async function findByName(name: string, category: 'Pokemon' | 'Trainer' | 'Energy'): Promise<PkmCard | undefined> {
  const r = await window.kard.pkm.search({ text: name, categories: [category], limit: 30 })
  const cards = await getPkmCards(r.cards.map((x) => x.id))
  return Object.values(cards).find((c) => c.name === name)
}

/** Deck automático do bot: Pokémon Básicos de um tipo (com ataques automatizados), Treinadores simples e Energia. */
export async function generatePkmBotDeck(type: PkmType): Promise<{ cards: PGameCard[]; name: string }> {
  const r = await window.kard.pkm.search({ categories: ['Pokemon'], types: [type], stage: 'Basic', format: 'expanded', limit: 400 })
  const db = await getPkmCards(r.cards.map((x) => x.id))
  const pool = Object.values(db).filter(
    (c) => (c.hp ?? 0) >= 60 && c.attacks.length > 0 && c.attacks.every((a) => a.cost.every((x) => x === type || x === 'Colorless')) && isCardAutomated(c) && !c.abilities.length
  )
  if (pool.length < 3) throw new Error(t('Não há Pokémon suficientes deste tipo no banco para montar o deck do bot.'))
  const picked: PkmCard[] = []
  const copy = [...pool]
  while (picked.length < 5 && copy.length) picked.push(copy.splice(Math.floor(Math.random() * Math.min(copy.length, 60)), 1)[0])
  const cards: PGameCard[] = []
  for (const c of picked) for (let i = 0; i < 4; i++) cards.push({ card: c, printingId: c.defaultPrintingId })
  for (const name of TRAINERS) {
    const c = await findByName(name, 'Trainer').catch(() => undefined)
    if (c && isCardAutomated(c)) for (let i = 0; i < 2; i++) cards.push({ card: c, printingId: c.defaultPrintingId })
  }
  const energy = (await findByName(`${type} Energy`, 'Energy').catch(() => undefined)) ?? (await findByName(`Basic ${type} Energy`, 'Energy').catch(() => undefined))
  if (!energy) throw new Error(t('Energia básica do tipo não encontrada no banco.'))
  while (cards.length < 60) cards.push({ card: energy, printingId: energy.defaultPrintingId })
  return { cards: cards.slice(0, 60), name: t('Bot ({type})', { type }) }
}
