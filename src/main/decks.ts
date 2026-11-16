import fs from 'fs'
import path from 'path'
import { decksDir } from './paths'
import { db } from './cardDb'
import type { Deck, DeckSummary } from '../shared/types'

function fileFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '')
  return path.join(decksDir(), `${safe}.json`)
}

export function listDecks(): DeckSummary[] {
  const out: DeckSummary[] = []
  for (const f of fs.readdirSync(decksDir())) {
    if (!f.endsWith('.json')) continue
    try {
      const deck = JSON.parse(fs.readFileSync(path.join(decksDir(), f), 'utf8')) as Deck
      const all = [...deck.commanders, ...deck.main]
      const colors = new Set<string>()
      for (const c of all) db.getCard(c.oracleId)?.colorIdentity.forEach((x) => colors.add(x))
      out.push({
        id: deck.id,
        name: deck.name,
        format: deck.format,
        cardCount: all.reduce((s, c) => s + c.qty, 0),
        coverPrintingId: deck.coverPrintingId ?? deck.commanders[0]?.printingId ?? deck.main[0]?.printingId,
        colors: [...colors],
        updatedAt: deck.updatedAt
      })
    } catch {
      /* arquivo corrompido: ignora */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getDeck(id: string): Deck | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as Deck
  } catch {
    return null
  }
}

export function saveDeck(deck: Deck): Deck {
  const saved: Deck = { ...deck, updatedAt: new Date().toISOString() }
  fs.writeFileSync(fileFor(deck.id), JSON.stringify(saved, null, 2), 'utf8')
  return saved
}

export function removeDeck(id: string): void {
  try {
    fs.unlinkSync(fileFor(id))
  } catch {
    /* já removido */
  }
}
