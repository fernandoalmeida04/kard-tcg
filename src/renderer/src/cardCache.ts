// Cache de cartas e impressões no processo de interface (evita IPC repetido).
import type { CardData, Printing } from '@shared/types'

const cards = new Map<string, CardData>()
const printings = new Map<string, Printing>()

export async function getCards(ids: string[]): Promise<Record<string, CardData>> {
  const missing = [...new Set(ids)].filter((id) => id && !cards.has(id))
  if (missing.length) {
    const fetched = await window.kard.db.cards(missing)
    for (const [id, c] of Object.entries(fetched)) cards.set(id, c)
  }
  const out: Record<string, CardData> = {}
  for (const id of ids) {
    const c = cards.get(id)
    if (c) out[id] = c
  }
  return out
}

export async function getPrintings(ids: string[]): Promise<Record<string, Printing>> {
  const missing = [...new Set(ids)].filter((id) => id && !printings.has(id))
  if (missing.length) {
    const fetched = await window.kard.db.printings(missing)
    for (const [id, p] of Object.entries(fetched)) printings.set(id, p)
  }
  const out: Record<string, Printing> = {}
  for (const id of ids) {
    const p = printings.get(id)
    if (p) out[id] = p
  }
  return out
}

export function cachedCard(id: string): CardData | undefined {
  return cards.get(id)
}

export function rememberCard(c: CardData): void {
  cards.set(c.oracleId, c)
}

export function rememberPrintings(list: Printing[]): void {
  for (const p of list) printings.set(p.id, p)
}

export function clearCardCache(): void {
  cards.clear()
  printings.clear()
}
