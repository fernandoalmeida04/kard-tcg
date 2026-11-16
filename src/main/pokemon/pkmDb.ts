// Banco local de cartas do Pokémon TCG (gerado a partir do TCGdex).
import fs from 'fs'
import path from 'path'
import { databaseDir, dirSize, imagesDir } from '../paths'
import type {
  PkmCard,
  PkmCardDetails,
  PkmCardSummary,
  PkmDbStatus,
  PkmNameResolution,
  PkmPrinting,
  PkmSearchQuery,
  PkmSearchResult,
  PkmSetInfo,
  PkmType
} from '../../shared/pokemon/types'
import { PKM_TYPES } from '../../shared/pokemon/types'
import { PKM_DB_VERSION, normalize, type PkmDbFile } from './pkmBuild'

export { PKM_DB_VERSION } from './pkmBuild'

interface Indexed {
  card: PkmCard
  names: string
  text: string
  latest: string
}

class PokemonDatabase {
  private cards = new Map<string, PkmCard>()
  private printings = new Map<string, PkmPrinting>()
  private byName = new Map<string, string[]>()
  private setList: PkmSetInfo[] = []
  private setCodes = new Map<string, string[]>()
  private indexed: Indexed[] = []
  private meta: { lang: string; updatedAt: string } | null = null
  loading = false

  file(): string {
    return path.join(databaseDir(), 'pokemon.json')
  }

  imagesDir(): string {
    const dir = path.join(imagesDir(), 'ptcg')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  isReady(): boolean {
    return this.cards.size > 0
  }

  lang(): string {
    return this.meta?.lang ?? 'en'
  }

  async loadFromDisk(): Promise<void> {
    const f = this.file()
    if (!fs.existsSync(f)) return
    this.loading = true
    try {
      const data = JSON.parse(await fs.promises.readFile(f, 'utf8')) as PkmDbFile
      if (data.version === PKM_DB_VERSION) this.loadFromData(data)
    } catch (err) {
      console.error('[pkmDb] falha ao carregar banco:', err)
    } finally {
      this.loading = false
    }
  }

  loadFromData(data: PkmDbFile): void {
    this.cards.clear()
    this.printings.clear()
    this.byName.clear()
    this.setCodes.clear()
    this.indexed = []
    this.meta = { lang: data.lang, updatedAt: data.updatedAt }
    this.setList = data.sets
    for (const s of data.sets) {
      for (const key of [s.id, s.code].filter(Boolean) as string[]) {
        const k = key.toLowerCase()
        this.setCodes.set(k, [...(this.setCodes.get(k) ?? []), s.id])
      }
    }
    for (const p of data.printings) this.printings.set(p.id, p)
    for (const c of data.cards) {
      this.cards.set(c.id, c)
      const names = [c.name, c.localName].filter(Boolean) as string[]
      for (const n of names) {
        const k = normalize(n)
        this.byName.set(k, [...(this.byName.get(k) ?? []), c.id])
      }
      const text = [
        ...c.attacks.flatMap((a) => [a.name, a.localName, a.effect, a.localEffect]),
        ...c.abilities.flatMap((a) => [a.name, a.localName, a.effect, a.localEffect]),
        c.effect,
        c.localEffect
      ]
        .filter(Boolean)
        .join(' ')
      this.indexed.push({ card: c, names: names.map(normalize).join(' | '), text: normalize(text), latest: this.printings.get(c.printingIds[0])?.releasedAt ?? '' })
    }
  }

  status(): PkmDbStatus {
    let sizeBytes: number | undefined
    try {
      sizeBytes = fs.statSync(this.file()).size
    } catch {
      sizeBytes = undefined
    }
    const img = dirSize(path.join(imagesDir(), 'ptcg'))
    return {
      ready: this.isReady(),
      loading: this.loading,
      cardCount: this.cards.size,
      printingCount: this.printings.size,
      setCount: this.setList.length,
      lang: this.lang(),
      updatedAt: this.meta?.updatedAt,
      sizeBytes,
      imageCacheBytes: img.bytes,
      imageCount: img.files
    }
  }

  sets(): PkmSetInfo[] {
    return this.setList
  }

  getPrinting(id: string): PkmPrinting | undefined {
    return this.printings.get(id)
  }

  details(id: string): PkmCardDetails | null {
    const card = this.cards.get(id)
    if (!card) return null
    return { card, printings: card.printingIds.map((p) => this.printings.get(p)).filter(Boolean) as PkmPrinting[] }
  }

  cardsByIds(ids: string[]): Record<string, PkmCard> {
    const out: Record<string, PkmCard> = {}
    for (const id of ids) {
      const c = this.cards.get(id)
      if (c) out[id] = c
    }
    return out
  }

  printingsByIds(ids: string[]): Record<string, PkmPrinting> {
    const out: Record<string, PkmPrinting> = {}
    for (const id of ids) {
      const p = this.printings.get(id)
      if (p) out[id] = p
    }
    return out
  }

  summary(c: PkmCard, printingId = c.defaultPrintingId): PkmCardSummary {
    const p = this.printings.get(printingId)
    return {
      id: c.id,
      name: c.name,
      displayName: c.localName || c.name,
      category: c.category,
      types: c.types,
      hp: c.hp,
      stage: c.stage,
      trainerType: c.trainerType,
      energyType: c.energyType,
      suffix: c.suffix,
      defaultPrintingId: printingId,
      hasImage: Boolean(p?.image || p?.localImage)
    }
  }

  search(q: PkmSearchQuery): PkmSearchResult {
    const { words, texts, hp } = parseText(q.text ?? '')
    const limit = Math.min(q.limit ?? 60, 500)
    const offset = q.offset ?? 0
    const sets = (q.sets ?? []).map((s) => s.toLowerCase())
    const marks = (q.regulationMarks ?? []).map((m) => m.toUpperCase())
    const results: Indexed[] = []
    for (const ic of this.indexed) {
      const c = ic.card
      if (q.format === 'standard' && !c.legal.standard) continue
      if (q.format === 'expanded' && !c.legal.expanded) continue
      if (q.categories?.length && !q.categories.includes(c.category)) continue
      if (q.types?.length) {
        // Energias: o tipo vem do nome (ex.: "Lightning Energy")
        const ts: PkmType[] = c.category === 'Energy' ? PKM_TYPES.filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(c.name)) : c.types
        if (!q.types.some((x) => ts.includes(x))) continue
      }
      if (q.stage && c.stage !== q.stage) continue
      if (q.trainerType && c.trainerType !== q.trainerType) continue
      if (q.energyType && (c.energyType ?? 'Normal') !== q.energyType) continue
      if (q.suffix && (c.suffix ?? '') !== q.suffix) continue
      if (q.hpMin !== undefined && (c.hp ?? -1) < q.hpMin) continue
      if (q.hpMax !== undefined && (c.hp ?? 1e9) > q.hpMax) continue
      if (marks.length && !c.regulationMarks.some((m) => marks.includes(m.toUpperCase()))) continue
      if (sets.length && !c.printingIds.some((id) => sets.includes(this.printings.get(id)?.set.toLowerCase() ?? ''))) continue
      if (words.some((w) => !ic.names.includes(w))) continue
      if (texts.some((w) => !ic.text.includes(w))) continue
      if (hp && !cmp(c.hp ?? -1, hp.op, hp.value)) continue
      results.push(ic)
    }

    const dir = q.sortDir === 'desc' ? -1 : 1
    const sort = q.sort ?? 'name'
    const nameOf = (c: PkmCard) => (c.localName || c.name).toLowerCase()
    const catOrder: Record<string, number> = { Pokemon: 0, Trainer: 1, Energy: 2 }
    results.sort((a, b) => {
      let d = 0
      if (sort === 'hp') d = (a.card.hp ?? -1) - (b.card.hp ?? -1)
      else if (sort === 'type') d = typeKey(a.card) - typeKey(b.card)
      else if (sort === 'release') d = a.latest.localeCompare(b.latest)
      else if (sort === 'category') d = catOrder[a.card.category] - catOrder[b.card.category]
      if (d === 0) d = nameOf(a.card).localeCompare(nameOf(b.card))
      return d * dir
    })
    if (words.length && sort === 'name') {
      const full = words.join(' ')
      const rank = (ic: Indexed) => (ic.names.split(' | ').includes(full) ? 0 : ic.names.split(' | ').some((n) => n.startsWith(full)) ? 1 : 2)
      results.sort((a, b) => rank(a) - rank(b))
    }

    return {
      total: results.length,
      cards: results.slice(offset, offset + limit).map((ic) => {
        // com filtro de coleção, mostra a arte daquela coleção
        if (sets.length) {
          const pid = ic.card.printingIds.find((id) => sets.includes(this.printings.get(id)?.set.toLowerCase() ?? ''))
          if (pid) return this.summary(ic.card, pid)
        }
        return this.summary(ic.card)
      })
    }
  }

  /** Resolve linhas de lista (nome + sigla/número opcionais) para cartas e impressões. */
  resolveNames(lines: { name: string; set?: string; number?: string }[]): PkmNameResolution[] {
    return lines.map((l) => {
      // 1) sigla + número identificam a impressão exata
      if (l.set && l.number) {
        const setIds = this.setCodes.get(l.set.toLowerCase()) ?? []
        const num = l.number.replace(/^0+/, '').toLowerCase()
        for (const sid of setIds) {
          for (const p of this.printings.values()) {
            if (p.set !== sid || p.localId.replace(/^0+/, '').toLowerCase() !== num) continue
            const card = this.cards.get(p.cardId)
            if (card) return { query: l.name, cardId: card.id, printingId: p.id, name: card.name }
          }
        }
      }
      // 2) pelo nome (em inglês ou no idioma do banco); vários "Pikachu": prefere legal no Standard e mais recente
      const candidates = nameKeys(l.name)
        .flatMap((k) => this.byName.get(k) ?? [])
        .map((id) => this.cards.get(id)!)
        .filter(Boolean)
      if (!candidates.length) return { query: l.name }
      candidates.sort((a, b) => Number(b.legal.standard) - Number(a.legal.standard) || (this.printings.get(b.printingIds[0])?.releasedAt ?? '').localeCompare(this.printings.get(a.printingIds[0])?.releasedAt ?? ''))
      const card = candidates[0]
      return { query: l.name, cardId: card.id, name: card.name }
    })
  }
}

/** Variações de nome para achar energias e cartas escritas de jeitos diferentes. */
function nameKeys(name: string): string[] {
  const n = normalize(name)
  const keys = new Set([n])
  if (n.startsWith('basic ')) keys.add(n.slice(6))
  else if (/ energy$/.test(n)) keys.add(`basic ${n}`)
  keys.add(n.replace(/\s*\(.*\)$/, ''))
  return [...keys]
}

function typeKey(c: PkmCard): number {
  if (c.category === 'Trainer') return 50
  if (c.category === 'Energy') return 60
  const i = PKM_TYPES.indexOf(c.types[0])
  return i < 0 ? 40 : i
}

function cmp(a: number, op: string, b: number): boolean {
  if (op === '<') return a < b
  if (op === '<=') return a <= b
  if (op === '>') return a > b
  if (op === '>=') return a >= b
  return a === b
}

/** Texto da busca: palavras do nome, `o:"texto"` para texto de ataques/habilidades, `hp>=120`. */
function parseText(text: string): { words: string[]; texts: string[]; hp: { op: string; value: number } | null } {
  const words: string[] = []
  const texts: string[] = []
  let hp: { op: string; value: number } | null = null
  const tokens = text.match(/\w+(?::|>=|<=|>|<|=)"[^"]*"|\w+(?::|>=|<=|>|<|=)\S+|"[^"]*"|\S+/g) ?? []
  for (const tok of tokens) {
    const m = tok.match(/^(\w+)(:|>=|<=|>|<|=)(.+)$/)
    if (m && ['o', 'text', 'texto'].includes(m[1].toLowerCase())) texts.push(normalize(m[3].replace(/"/g, '')))
    else if (m && ['hp', 'ps'].includes(m[1].toLowerCase()) && !isNaN(parseInt(m[3], 10))) hp = { op: m[2] === ':' ? '=' : m[2], value: parseInt(m[3], 10) }
    else words.push(normalize(tok.replace(/"/g, '')))
  }
  return { words, texts, hp }
}

export const pkmDb = new PokemonDatabase()
