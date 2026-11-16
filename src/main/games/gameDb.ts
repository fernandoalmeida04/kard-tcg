// Banco local genérico (um por jogo): carregar, buscar, detalhes e resolver nomes de listas.
import fs from 'fs'
import path from 'path'
import { databaseDir, dirSize, imagesDir } from '../paths'
import type {
  GameId,
  GCard,
  GCardDetails,
  GCardSummary,
  GDbFile,
  GDbStatus,
  GNameResolution,
  GPrinting,
  GSearchQuery,
  GSearchResult,
  GSet
} from '../../shared/games/types'
import { getGame } from '../../shared/games/registry'
import { limitOf, normalizeName } from '../../shared/games/helpers'

export const GAME_DB_VERSION = 1

interface Indexed {
  card: GCard
  names: string
  text: string
  latest: string
}

export class GameDatabase {
  private cards = new Map<string, GCard>()
  private printings = new Map<string, GPrinting>()
  private byName = new Map<string, string[]>()
  private byCode = new Map<string, string>()
  private setList: GSet[] = []
  private indexed: Indexed[] = []
  private meta: { lang: string; updatedAt: string } | null = null
  loading = false

  constructor(readonly game: GameId) {}

  file(): string {
    return path.join(databaseDir(), `${this.game}.json`)
  }

  imagesDir(): string {
    const dir = path.join(imagesDir(), this.game)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  isReady(): boolean {
    return this.cards.size > 0
  }

  async loadFromDisk(): Promise<void> {
    if (!fs.existsSync(this.file())) return
    this.loading = true
    try {
      const data = JSON.parse(await fs.promises.readFile(this.file(), 'utf8')) as GDbFile
      if (data.version === GAME_DB_VERSION && data.game === this.game) this.loadFromData(data)
    } catch (err) {
      console.error(`[gameDb:${this.game}] falha ao carregar banco:`, err)
    } finally {
      this.loading = false
    }
  }

  loadFromData(data: GDbFile): void {
    this.cards.clear()
    this.printings.clear()
    this.byName.clear()
    this.byCode.clear()
    this.indexed = []
    this.meta = { lang: data.lang, updatedAt: data.updatedAt }
    this.setList = data.sets
    for (const p of data.printings) {
      this.printings.set(p.id, p)
      if (p.code) this.byCode.set(p.code.toLowerCase(), p.id)
    }
    for (const c of data.cards) {
      this.cards.set(c.id, c)
      const names = [c.name, c.localName].filter(Boolean) as string[]
      for (const n of names) {
        const k = normalizeName(n)
        this.byName.set(k, [...(this.byName.get(k) ?? []), c.id])
      }
      const fieldText = Object.values(c.fields)
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => typeof v === 'string')
        .join(' ')
      this.indexed.push({
        card: c,
        names: names.map(normalizeName).join(' | '),
        text: normalizeName([c.text, c.localText, c.text2, c.localText2, c.subtype, fieldText].filter(Boolean).join(' ')),
        latest: c.releasedAt ?? this.printings.get(c.printingIds[0])?.releasedAt ?? ''
      })
    }
  }

  status(): GDbStatus {
    let sizeBytes: number | undefined
    try {
      sizeBytes = fs.statSync(this.file()).size
    } catch {
      sizeBytes = undefined
    }
    const img = dirSize(path.join(imagesDir(), this.game))
    return {
      ready: this.isReady(),
      loading: this.loading,
      cardCount: this.cards.size,
      printingCount: this.printings.size,
      setCount: this.setList.length,
      lang: this.meta?.lang ?? 'en',
      updatedAt: this.meta?.updatedAt,
      sizeBytes,
      imageCacheBytes: img.bytes,
      imageCount: img.files
    }
  }

  sets(): GSet[] {
    return this.setList
  }

  getPrinting(id: string): GPrinting | undefined {
    return this.printings.get(id)
  }

  details(id: string): GCardDetails | null {
    const card = this.cards.get(id)
    if (!card) return null
    return { card, printings: card.printingIds.map((p) => this.printings.get(p)).filter(Boolean) as GPrinting[] }
  }

  cardsByIds(ids: string[]): Record<string, GCard> {
    const out: Record<string, GCard> = {}
    for (const id of ids) {
      const c = this.cards.get(id)
      if (c) out[id] = c
    }
    return out
  }

  printingsByIds(ids: string[]): Record<string, GPrinting> {
    const out: Record<string, GPrinting> = {}
    for (const id of ids) {
      const p = this.printings.get(id)
      if (p) out[id] = p
    }
    return out
  }

  /** Valores distintos de um campo (para filtros sem opções fixas). */
  facet(key: string): string[] {
    const set = new Set<string>()
    for (const c of this.cards.values()) {
      const v = key === 'category' ? c.category : key === 'subtype' ? c.subtype : key === 'colors' ? c.colors : c.fields[key]
      for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null && x !== '') set.add(String(x))
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  private summary(c: GCard, printingId = c.defaultPrintingId): GCardSummary {
    return {
      id: c.id,
      name: c.name,
      displayName: c.localName || c.name,
      category: c.category,
      subtype: c.subtype,
      colors: c.colors,
      fields: c.fields,
      section: c.section,
      defaultPrintingId: printingId
    }
  }

  search(q: GSearchQuery): GSearchResult {
    const def = getGame(this.game)
    const { words, texts } = parseText(q.text ?? '')
    const limit = Math.min(q.limit ?? 60, 500)
    const offset = q.offset ?? 0
    const sets = (q.sets ?? []).map((s) => s.toLowerCase())
    const valueOf = (c: GCard, key: string) => (key === 'category' ? c.category : key === 'subtype' ? c.subtype : key === 'colors' ? c.colors : c.fields[key])
    const results: Indexed[] = []
    for (const ic of this.indexed) {
      const c = ic.card
      if (q.format && def && limitOf(def, c, q.format) === 0) continue
      let ok = true
      for (const [key, accepted] of Object.entries(q.filters ?? {})) {
        if (!accepted.length) continue
        const v = valueOf(c, key)
        const vals = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? ''))
        if (!accepted.some((a) => vals.includes(a))) {
          ok = false
          break
        }
      }
      if (!ok) continue
      for (const [key, r] of Object.entries(q.ranges ?? {})) {
        const n = Number(c.fields[key])
        if ((r.min !== undefined || r.max !== undefined) && isNaN(n)) ok = false
        else if (r.min !== undefined && n < r.min) ok = false
        else if (r.max !== undefined && n > r.max) ok = false
        if (!ok) break
      }
      if (!ok) continue
      if (sets.length && !c.printingIds.some((id) => sets.includes(this.printings.get(id)?.set.toLowerCase() ?? ''))) continue
      if (words.some((w) => !ic.names.includes(w))) continue
      if (texts.some((w) => !ic.text.includes(w))) continue
      results.push(ic)
    }

    const sortDef = def?.sorts.find((s) => s.id === q.sort)
    const dir = (q.sortDir ?? sortDef?.dir ?? 'asc') === 'desc' ? -1 : 1
    const nameOf = (c: GCard) => (c.localName || c.name).toLowerCase()
    results.sort((a, b) => {
      let d = 0
      if (q.sort === 'release') d = a.latest.localeCompare(b.latest)
      else if (sortDef) d = (Number(a.card.fields[sortDef.field]) || -1) - (Number(b.card.fields[sortDef.field]) || -1)
      if (d === 0) return nameOf(a.card).localeCompare(nameOf(b.card))
      return d * dir
    })
    if (words.length && (!q.sort || q.sort === 'name')) {
      const full = words.join(' ')
      const rank = (ic: Indexed) => (ic.names.split(' | ').includes(full) ? 0 : ic.names.split(' | ').some((n) => n.startsWith(full)) ? 1 : 2)
      results.sort((a, b) => rank(a) - rank(b))
    }
    return {
      total: results.length,
      cards: results.slice(offset, offset + limit).map((ic) => {
        if (sets.length) {
          const pid = ic.card.printingIds.find((id) => sets.includes(this.printings.get(id)?.set.toLowerCase() ?? ''))
          if (pid) return this.summary(ic.card, pid)
        }
        return this.summary(ic.card)
      })
    }
  }

  /** Resolve linhas de lista: código impresso (ex.: OP01-016), id da carta (ex.: passcode) ou nome. */
  resolveNames(lines: { name?: string; code?: string }[]): GNameResolution[] {
    return lines.map((l) => {
      const query = l.code ?? l.name ?? ''
      if (l.code) {
        const pid = this.byCode.get(l.code.toLowerCase())
        const p = pid ? this.printings.get(pid) : undefined
        if (p) return { query, cardId: p.cardId, printingId: p.id, name: this.cards.get(p.cardId)?.name }
        const byId = this.cards.get(l.code) ?? this.cards.get(l.code.toUpperCase())
        if (byId) return { query, cardId: byId.id, name: byId.name }
        // id de impressão (ex.: passcode de arte alternativa do Yu-Gi-Oh!)
        const asPrinting = this.printings.get(l.code)
        if (asPrinting) return { query, cardId: asPrinting.cardId, printingId: asPrinting.id, name: this.cards.get(asPrinting.cardId)?.name }
      }
      if (l.name) {
        const ids = this.byName.get(normalizeName(l.name)) ?? []
        const card = ids.map((id) => this.cards.get(id)!).filter(Boolean)[0]
        if (card) return { query, cardId: card.id, name: card.name }
      }
      return { query }
    })
  }
}

function parseText(text: string): { words: string[]; texts: string[] } {
  const words: string[] = []
  const texts: string[] = []
  const tokens = text.match(/\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+/g) ?? []
  for (const tok of tokens) {
    const m = tok.match(/^(\w+):(.+)$/)
    if (m && ['o', 'text', 'texto'].includes(m[1].toLowerCase())) texts.push(normalizeName(m[2].replace(/"/g, '')))
    else words.push(normalizeName(tok.replace(/"/g, '')))
  }
  return { words, texts }
}

const instances = new Map<GameId, GameDatabase>()

export function gameDb(game: GameId): GameDatabase {
  let db = instances.get(game)
  if (!db) instances.set(game, (db = new GameDatabase(game)))
  return db
}
