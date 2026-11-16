import fs from 'fs'
import path from 'path'
import { databaseDir, dirSize, imagesDir } from './paths'
import type {
  CardData,
  CardDetails,
  CardSearchQuery,
  CardSearchResult,
  CardSummary,
  DbStatus,
  LangCode,
  NameResolution,
  Printing,
  SetInfo
} from '../shared/types'
import type { CandidateQuery } from '../shared/api'

export interface DbFile {
  version: number
  lang: LangCode
  updatedAt: string
  bulkUpdatedAt?: string
  cards: CardData[]
  printings: Printing[]
}

const DB_VERSION = 1
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G']
const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 }

interface IndexedCard {
  card: CardData
  search: string // nomes em minúsculas, sem acento
  type: string
  text: string
}

class CardDatabase {
  private cards = new Map<string, CardData>()
  private printings = new Map<string, Printing>()
  private byOracle = new Map<string, Printing[]>()
  private nameIndex = new Map<string, string>()
  private setsByOracle = new Map<string, Set<string>>()
  private setList: SetInfo[] = []
  private indexed: IndexedCard[] = []
  private meta: Omit<DbFile, 'cards' | 'printings'> | null = null
  loading = false

  file(): string {
    return path.join(databaseDir(), 'cards.json')
  }

  isReady(): boolean {
    return this.cards.size > 0
  }

  async loadFromDisk(): Promise<void> {
    const f = this.file()
    if (!fs.existsSync(f)) return
    this.loading = true
    try {
      const raw = await fs.promises.readFile(f, 'utf8')
      const data = JSON.parse(raw) as DbFile
      if (data.version !== DB_VERSION) return
      this.loadFromData(data)
    } catch (err) {
      console.error('[cardDb] falha ao carregar banco:', err)
    } finally {
      this.loading = false
    }
  }

  loadFromData(data: DbFile): void {
    this.cards.clear()
    this.printings.clear()
    this.byOracle.clear()
    this.nameIndex.clear()
    this.setsByOracle.clear()
    this.indexed = []
    const { cards, printings, ...meta } = data
    this.meta = meta
    for (const c of cards) this.cards.set(c.oracleId, c)
    const setMeta = new Map<string, { name: string; releasedAt: string; oracles: Set<string> }>()
    for (const p of printings) {
      this.printings.set(p.id, p)
      const list = this.byOracle.get(p.oracleId)
      if (list) list.push(p)
      else this.byOracle.set(p.oracleId, [p])
      const sets = this.setsByOracle.get(p.oracleId)
      if (sets) sets.add(p.set)
      else this.setsByOracle.set(p.oracleId, new Set([p.set]))
      let sm = setMeta.get(p.set)
      if (!sm) setMeta.set(p.set, (sm = { name: p.setName || p.set.toUpperCase(), releasedAt: p.releasedAt || '', oracles: new Set() }))
      if (p.releasedAt && (!sm.releasedAt || p.releasedAt < sm.releasedAt)) sm.releasedAt = p.releasedAt
      sm.oracles.add(p.oracleId)
    }
    this.setList = [...setMeta.entries()]
      .map(([code, s]) => ({ code, name: s.name, releasedAt: s.releasedAt, cardCount: s.oracles.size }))
      .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name))
    for (const list of this.byOracle.values()) {
      list.sort((a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || ''))
    }
    for (const c of cards) {
      const names = [c.name, c.localName, ...(c.faces ?? []).flatMap((f) => [f.name, f.localName])].filter(Boolean) as string[]
      for (const n of names) {
        const key = normalize(n)
        if (!this.nameIndex.has(key)) this.nameIndex.set(key, c.oracleId)
      }
      this.indexed.push({
        card: c,
        search: names.map(normalize).join(' | '),
        type: normalize(`${c.typeLine} ${c.localTypeLine ?? ''}`),
        text: normalize(`${c.oracleText} ${c.localText ?? ''}`)
      })
    }
  }

  status(): DbStatus {
    const f = this.file()
    let sizeBytes: number | undefined
    try {
      sizeBytes = fs.statSync(f).size
    } catch {
      sizeBytes = undefined
    }
    const img = dirSize(imagesDir())
    return {
      ready: this.isReady(),
      loading: this.loading,
      path: databaseDir(),
      cardCount: this.cards.size,
      printingCount: this.printings.size,
      lang: this.meta?.lang ?? 'en',
      updatedAt: this.meta?.updatedAt,
      bulkUpdatedAt: this.meta?.bulkUpdatedAt,
      sizeBytes,
      imageCacheBytes: img.bytes,
      imageCount: img.files
    }
  }

  /** Coleções presentes no banco, da mais recente para a mais antiga. */
  sets(): SetInfo[] {
    return this.setList
  }

  /** A carta tem impressão em alguma das coleções (códigos em minúsculas)? */
  inSets(oracleId: string, codes: string[]): boolean {
    const s = this.setsByOracle.get(oracleId)
    return !!s && codes.some((x) => s.has(x))
  }

  /** Impressão da carta em uma das coleções, preferindo o idioma do banco. */
  private printingInSets(oracleId: string, codes: string[]): Printing | undefined {
    const prints = (this.byOracle.get(oracleId) ?? []).filter((p) => codes.includes(p.set))
    return prints.find((p) => p.lang === (this.meta?.lang ?? 'en')) ?? prints[0]
  }

  getPrinting(id: string): Printing | undefined {
    return this.printings.get(id)
  }

  getCard(oracleId: string): CardData | undefined {
    return this.cards.get(oracleId)
  }

  details(oracleId: string): CardDetails | null {
    const card = this.cards.get(oracleId)
    if (!card) return null
    return { card, printings: this.byOracle.get(oracleId) ?? [] }
  }

  cardsByIds(ids: string[]): Record<string, CardData> {
    const out: Record<string, CardData> = {}
    for (const id of ids) {
      const c = this.cards.get(id)
      if (c) out[id] = c
    }
    return out
  }

  printingsByIds(ids: string[]): Record<string, Printing> {
    const out: Record<string, Printing> = {}
    for (const id of ids) {
      const p = this.printings.get(id)
      if (p) out[id] = p
    }
    return out
  }

  summary(c: CardData): CardSummary {
    return {
      oracleId: c.oracleId,
      name: c.name,
      displayName: c.localName || c.name,
      manaCost: c.manaCost,
      cmc: c.cmc,
      typeLine: c.typeLine,
      displayType: c.localTypeLine || c.typeLine,
      colors: c.colors,
      colorIdentity: c.colorIdentity,
      rarity: c.rarity,
      defaultPrintingId: c.defaultPrintingId,
      power: c.power,
      toughness: c.toughness,
      loyalty: c.loyalty
    }
  }

  search(q: CardSearchQuery): CardSearchResult {
    const filters = parseQueryText(q.text ?? '')
    const colors = q.colors ?? []
    const mode = q.colorMode ?? 'any'
    const limit = Math.min(q.limit ?? 60, 500)
    const offset = q.offset ?? 0
    const sets = (q.sets ?? []).map((s) => s.toLowerCase())
    const results: CardData[] = []

    for (const ic of this.indexed) {
      const c = ic.card
      if (q.format && q.format !== 'casual' && q.format !== 'limited') {
        const leg = c.legalities[q.format]
        if (leg !== 'legal' && leg !== 'restricted') continue
      }
      if (q.identity && !c.colorIdentity.every((x) => q.identity!.includes(x))) continue
      if (colors.length) {
        const wantColorless = colors.includes('C')
        const want = colors.filter((x) => x !== 'C')
        const cc = c.colors.length ? c.colors : (c.faces?.[0]?.colors ?? [])
        let ok = false
        if (mode === 'any') ok = (wantColorless && cc.length === 0) || want.some((x) => cc.includes(x))
        else if (mode === 'all') ok = want.every((x) => cc.includes(x)) && (!wantColorless || cc.length === 0)
        else if (mode === 'exact') ok = wantColorless ? cc.length === 0 : cc.length === want.length && want.every((x) => cc.includes(x))
        else if (mode === 'identity') ok = c.colorIdentity.every((x) => want.includes(x))
        if (!ok) continue
      }
      if (q.types?.length && !q.types.every((t) => ic.type.includes(normalize(t)))) continue
      if (q.cmcMin !== undefined && c.cmc < q.cmcMin) continue
      if (q.cmcMax !== undefined && c.cmc > q.cmcMax) continue
      if (q.rarity?.length && !q.rarity.includes(c.rarity)) continue
      if (sets.length && !this.inSets(c.oracleId, sets)) continue
      if (!matchFilters(ic, filters)) continue
      results.push(c)
    }

    const dir = q.sortDir === 'desc' ? -1 : 1
    const sort = q.sort ?? 'name'
    const nameOf = (c: CardData) => (c.localName || c.name).toLowerCase()
    results.sort((a, b) => {
      let d = 0
      if (sort === 'cmc') d = a.cmc - b.cmc
      else if (sort === 'color') d = colorKey(a) - colorKey(b)
      else if (sort === 'rarity') d = (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)
      else if (sort === 'edhrec') d = (a.edhrecRank ?? 1e9) - (b.edhrecRank ?? 1e9)
      else if (sort === 'type') d = typeKey(a) - typeKey(b)
      if (d === 0) d = nameOf(a).localeCompare(nameOf(b))
      return d * dir
    })

    // Prioriza correspondências exatas de nome
    if (filters.words.length && sort === 'name') {
      const full = filters.words.join(' ')
      results.sort((a, b) => {
        const ea = normalize(a.localName || '') === full || normalize(a.name) === full ? 0 : normalize(a.name).startsWith(full) || normalize(a.localName || '').startsWith(full) ? 1 : 2
        const eb = normalize(b.localName || '') === full || normalize(b.name) === full ? 0 : normalize(b.name).startsWith(full) || normalize(b.localName || '').startsWith(full) ? 1 : 2
        return ea - eb
      })
    }

    return {
      total: results.length,
      cards: results.slice(offset, offset + limit).map((c) => {
        const s = this.summary(c)
        // Com filtro de coleção, mostra a arte da impressão daquela coleção
        if (sets.length) {
          const p = this.printingInSets(c.oracleId, sets)
          if (p) s.defaultPrintingId = p.id
        }
        return s
      })
    }
  }

  resolveNames(lines: { name: string; set?: string; cn?: string }[]): NameResolution[] {
    return lines.map((l) => {
      let key = normalize(l.name)
      let oracleId = this.nameIndex.get(key)
      if (!oracleId && key.includes('//')) {
        key = normalize(l.name.split('//')[0])
        oracleId = this.nameIndex.get(key)
      }
      if (!oracleId && key.includes('/')) {
        key = normalize(l.name.split('/')[0])
        oracleId = this.nameIndex.get(key)
      }
      if (!oracleId) return { query: l.name }
      const card = this.cards.get(oracleId)!
      let printingId: string | undefined
      if (l.set) {
        const prints = this.byOracle.get(oracleId) ?? []
        const match =
          prints.find((p) => p.set === l.set && (!l.cn || p.collectorNumber === l.cn) && p.lang === (this.meta?.lang ?? 'en')) ??
          prints.find((p) => p.set === l.set && (!l.cn || p.collectorNumber === l.cn))
        printingId = match?.id
      }
      return { query: l.name, oracleId, printingId, name: card.name }
    })
  }

  candidates(q: CandidateQuery): CardData[] {
    const out: CardData[] = []
    for (const c of this.cards.values()) {
      if (!['normal', 'leveler', 'class', 'saga'].includes(c.layout)) continue
      if (/\bLand\b/.test(c.typeLine)) continue
      if (!c.colorIdentity.every((x) => q.colors.includes(x))) continue
      if (q.maxCmc !== undefined && c.cmc > q.maxCmc) continue
      if (q.format && q.format !== 'casual' && q.format !== 'limited') {
        const leg = c.legalities[q.format]
        if (leg !== 'legal') continue
      }
      out.push(c)
    }
    out.sort((a, b) => (a.edhrecRank ?? 1e9) - (b.edhrecRank ?? 1e9))
    return out.slice(0, q.limit ?? 4000)
  }

  basicLands(): Record<string, CardData> {
    const out: Record<string, CardData> = {}
    const names: Record<string, string> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest', C: 'wastes' }
    for (const [color, name] of Object.entries(names)) {
      const id = this.nameIndex.get(name)
      const c = id ? this.cards.get(id) : undefined
      if (c) out[color] = c
    }
    return out
  }
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .trim()
}

function colorKey(c: CardData): number {
  if (c.colors.length === 0) return /Land/.test(c.typeLine) ? 99 : 50
  if (c.colors.length > 1) return 40 + c.colors.length
  return COLOR_ORDER.indexOf(c.colors[0])
}

function typeKey(c: CardData): number {
  const t = c.typeLine
  if (/Creature/.test(t)) return 0
  if (/Planeswalker/.test(t)) return 1
  if (/Instant/.test(t)) return 2
  if (/Sorcery/.test(t)) return 3
  if (/Artifact/.test(t)) return 4
  if (/Enchantment/.test(t)) return 5
  if (/Battle/.test(t)) return 6
  if (/Land/.test(t)) return 9
  return 7
}

// ----------------- Mini linguagem de busca (estilo Scryfall) -----------------

interface ParsedFilters {
  words: string[]
  types: string[]
  texts: string[]
  colors: { op: string; colors: string[] }[]
  identity: string[] | null
  numeric: { field: 'cmc' | 'pow' | 'tou'; op: string; value: number }[]
  rarity: string[]
  formats: string[]
  sets: string[]
  not: ParsedFilters | null
}

function parseQueryText(text: string): ParsedFilters {
  const f: ParsedFilters = { words: [], types: [], texts: [], colors: [], identity: null, numeric: [], rarity: [], formats: [], sets: [], not: null }
  const tokens = text.match(/-?\w+[:=<>!]+"[^"]*"|-?\w+[:=<>!]+\S+|"[^"]*"|\S+/g) ?? []
  for (let tok of tokens) {
    const negate = tok.startsWith('-') && tok.length > 1
    if (negate) tok = tok.slice(1)
    const target: ParsedFilters = negate ? (f.not ??= { words: [], types: [], texts: [], colors: [], identity: null, numeric: [], rarity: [], formats: [], sets: [], not: null }) : f
    const m = tok.match(/^(\w+)(:|=|<=|>=|<|>|!=)(.+)$/)
    if (!m) {
      target.words.push(normalize(tok.replace(/"/g, '')))
      continue
    }
    const key = m[1].toLowerCase()
    const op = m[2] === ':' ? '=' : m[2]
    const val = m[3].replace(/^"|"$/g, '')
    switch (key) {
      case 't':
      case 'type':
        target.types.push(normalize(val))
        break
      case 'o':
      case 'oracle':
      case 'text':
        target.texts.push(normalize(val))
        break
      case 'c':
      case 'color':
        target.colors.push({ op: m[2] === ':' ? '>=' : op, colors: val.toUpperCase().split('').filter((x) => 'WUBRGC'.includes(x)) })
        break
      case 'id':
      case 'identity':
        target.identity = val.toUpperCase().split('').filter((x) => 'WUBRG'.includes(x))
        break
      case 'cmc':
      case 'mv':
      case 'pow':
      case 'power':
      case 'tou':
      case 'toughness': {
        const field = key.startsWith('p') ? 'pow' : key.startsWith('t') ? 'tou' : 'cmc'
        const n = parseFloat(val)
        if (!isNaN(n)) target.numeric.push({ field, op, value: n })
        break
      }
      case 'r':
      case 'rarity':
        target.rarity.push({ c: 'common', u: 'uncommon', r: 'rare', m: 'mythic' }[val.toLowerCase()] ?? val.toLowerCase())
        break
      case 'f':
      case 'format':
      case 'legal':
        target.formats.push(val.toLowerCase())
        break
      case 's':
      case 'set':
      case 'e':
        target.sets.push(val.toLowerCase())
        break
      default:
        target.words.push(normalize(tok))
    }
  }
  return f
}

function cmp(a: number, op: string, b: number): boolean {
  switch (op) {
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '>=':
      return a >= b
    case '!=':
      return a !== b
    default:
      return a === b
  }
}

function matchPositive(ic: IndexedCard, f: ParsedFilters): boolean {
  const c = ic.card
  for (const w of f.words) if (!ic.search.includes(w)) return false
  for (const t of f.types) if (!ic.type.includes(t)) return false
  for (const t of f.texts) if (!ic.text.includes(t)) return false
  for (const cf of f.colors) {
    const cc = c.colors
    const want = cf.colors.filter((x) => x !== 'C')
    if (cf.colors.includes('C') && cc.length !== 0) return false
    if (cf.op === '=' && !(cc.length === want.length && want.every((x) => cc.includes(x)))) return false
    if (cf.op === '>=' && !want.every((x) => cc.includes(x))) return false
    if (cf.op === '<=' && !cc.every((x) => want.includes(x))) return false
  }
  if (f.identity && !c.colorIdentity.every((x) => f.identity!.includes(x))) return false
  for (const n of f.numeric) {
    const raw = n.field === 'cmc' ? c.cmc : parseFloat((n.field === 'pow' ? c.power : c.toughness) ?? '')
    if (isNaN(raw) || !cmp(raw, n.op, n.value)) return false
  }
  if (f.rarity.length && !f.rarity.includes(c.rarity)) return false
  for (const fm of f.formats) {
    const leg = c.legalities[fm]
    if (leg !== 'legal' && leg !== 'restricted') return false
  }
  if (f.sets.length && !db.inSets(c.oracleId, f.sets)) return false
  return true
}

function matchFilters(ic: IndexedCard, f: ParsedFilters): boolean {
  if (!matchPositive(ic, f)) return false
  if (f.not) {
    const n = f.not
    const hasAny = n.words.length || n.types.length || n.texts.length || n.colors.length || n.numeric.length || n.rarity.length || n.formats.length || n.sets.length
    if (hasAny) {
      // cada filtro negado precisa falhar individualmente
      for (const w of n.words) if (ic.search.includes(w)) return false
      for (const t of n.types) if (ic.type.includes(t)) return false
      for (const t of n.texts) if (ic.text.includes(t)) return false
      if (n.rarity.length && n.rarity.includes(ic.card.rarity)) return false
    }
  }
  return true
}

export const db = new CardDatabase()
