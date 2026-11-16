// Decks de Pokémon: um JSON por deck em <dados do usuário>/decks/pokemon.
import fs from 'fs'
import path from 'path'
import { decksDir } from '../paths'
import { pkmDb } from './pkmDb'
import type { PkmDeck, PkmDeckSummary, PkmType } from '../../shared/pokemon/types'

function dir(): string {
  const d = path.join(decksDir(), 'pokemon')
  fs.mkdirSync(d, { recursive: true })
  return d
}

function fileFor(id: string): string {
  return path.join(dir(), `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)
}

export function listPkmDecks(): PkmDeckSummary[] {
  const out: PkmDeckSummary[] = []
  for (const f of fs.readdirSync(dir())) {
    if (!f.endsWith('.json')) continue
    try {
      const deck = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as PkmDeck
      const types = new Set<PkmType>()
      const cards = pkmDb.cardsByIds(deck.main.map((c) => c.oracleId))
      for (const c of deck.main) {
        const card = cards[c.oracleId]
        if (card?.category === 'Pokemon') card.types.forEach((x) => types.add(x))
      }
      out.push({
        id: deck.id,
        name: deck.name,
        format: deck.format,
        cardCount: deck.main.reduce((s, c) => s + c.qty, 0),
        coverPrintingId: deck.coverPrintingId ?? deck.main.find((c) => cards[c.oracleId]?.category === 'Pokemon')?.printingId ?? cards[deck.main[0]?.oracleId]?.defaultPrintingId,
        types: [...types],
        updatedAt: deck.updatedAt
      })
    } catch {
      /* arquivo corrompido: ignora */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getPkmDeck(id: string): PkmDeck | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as PkmDeck
  } catch {
    return null
  }
}

export function savePkmDeck(deck: PkmDeck): PkmDeck {
  const saved: PkmDeck = { ...deck, updatedAt: new Date().toISOString() }
  fs.writeFileSync(fileFor(deck.id), JSON.stringify(saved, null, 2), 'utf8')
  return saved
}

export function removePkmDeck(id: string): void {
  try {
    fs.unlinkSync(fileFor(id))
  } catch {
    /* já removido */
  }
}
