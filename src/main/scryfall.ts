import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import { Readable, Transform } from 'stream'
import zlib from 'zlib'
import { databaseDir } from './paths'
import { db, type DbFile } from './cardDb'
import type { CardData, CardFace, DownloadProgress, LangCode, Legality, Printing } from '../shared/types'
import { fmtNum, t } from '../shared/i18n/index.ts'

const HEADERS = { 'User-Agent': 'KardTCGSimulator/0.1', Accept: 'application/json;q=0.9,*/*;q=0.8' }

/** Formatos cujas legalidades guardamos (economiza memória). */
const KEPT_FORMATS = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'historic', 'timeless', 'premodern', 'penny',
  'commander', 'duel', 'brawl', 'standardbrawl', 'oathbreaker', 'paupercommander', 'predh'
]

const SKIP_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'planar', 'scheme', 'vanguard', 'augment', 'host'])
const SKIP_SET_TYPES = new Set(['token', 'memorabilia', 'minigame'])

type ProgressFn = (p: DownloadProgress) => void

// Tipagem mínima dos objetos do Scryfall que usamos
interface SfFace {
  name: string
  printed_name?: string
  mana_cost?: string
  type_line?: string
  printed_type_line?: string
  oracle_text?: string
  printed_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  colors?: string[]
  oracle_id?: string
  image_uris?: Record<string, string>
}
interface SfCard extends SfFace {
  object?: string
  id: string
  oracle_id?: string
  lang: string
  layout: string
  cmc?: number
  color_identity?: string[]
  keywords?: string[]
  legalities?: Record<string, string>
  games?: string[]
  set: string
  set_name: string
  set_type?: string
  collector_number: string
  rarity: string
  released_at: string
  card_faces?: SfFace[]
  produced_mana?: string[]
  edhrec_rank?: number
  game_changer?: boolean
  artist?: string
  promo?: boolean
  full_art?: boolean
  textless?: boolean
  digital?: boolean
  oversized?: boolean
  border_color?: string
  frame_effects?: string[]
  variation?: boolean
  image_status?: string
  finishes?: string[]
}

class DbBuilder {
  cards = new Map<string, CardData>()
  printings = new Map<string, Printing>()
  /** Pontuação da impressão padrão em inglês. */
  private defaultScore = new Map<string, number>()
  private localizedLatest = new Map<string, string>()

  private oracleIdOf(c: SfCard): string | undefined {
    return c.oracle_id ?? c.card_faces?.[0]?.oracle_id
  }

  private accept(c: SfCard): boolean {
    if (c.object && c.object !== 'card') return false
    if (SKIP_LAYOUTS.has(c.layout)) return false
    if (c.set_type && SKIP_SET_TYPES.has(c.set_type)) return false
    if (c.oversized) return false
    const games = c.games ?? []
    if (games.length && !games.includes('paper') && !games.includes('mtgo')) return false
    return Boolean(this.oracleIdOf(c))
  }

  addCard(c: SfCard): void {
    if (!this.accept(c)) return
    const oracleId = this.oracleIdOf(c)!
    const printing = toPrinting(c, oracleId)
    this.printings.set(printing.id, printing)

    const score = printingScore(c) - (c.image_status === 'missing' || c.image_status === 'placeholder' ? 50 : 0)
    if (!this.cards.has(oracleId)) {
      this.cards.set(oracleId, toCardData(c, oracleId, printing.id))
      this.defaultScore.set(oracleId, score)
    } else if (c.lang === 'en' && score > (this.defaultScore.get(oracleId) ?? -Infinity)) {
      const existing = this.cards.get(oracleId)!
      existing.defaultPrintingId = printing.id
      existing.rarity = c.rarity
      this.defaultScore.set(oracleId, score)
    }
  }

  addLocalized(c: SfCard): void {
    if (!this.accept(c)) return
    const oracleId = this.oracleIdOf(c)!
    const card = this.cards.get(oracleId)
    if (!card) return
    const printing = toPrinting(c, oracleId)
    const hasImage = c.image_status !== 'missing' && c.image_status !== 'placeholder'
    if (hasImage) this.printings.set(printing.id, printing)

    // A impressão localizada mais recente define o nome/texto traduzidos e a imagem padrão
    const prevId = this.localizedLatest.get(oracleId)
    const prev = prevId ? this.printings.get(prevId) : undefined
    const better = !prev || printingScore(c) + dateScore(c.released_at) > printingScoreFromPrinting(prev) + dateScore(prev.releasedAt)
    if (better) {
      if (hasImage) {
        this.localizedLatest.set(oracleId, printing.id)
        card.defaultPrintingId = printing.id
      }
      const faces = c.card_faces
      card.localName = faces?.length ? faces.map((f) => f.printed_name ?? f.name).join(' // ') : c.printed_name
      card.localTypeLine = faces?.length ? faces.map((f) => f.printed_type_line ?? f.type_line ?? '').join(' // ') : c.printed_type_line
      card.localText = faces?.length ? faces.map((f) => f.printed_text ?? '').join('\n—\n') : c.printed_text
      if (faces && card.faces) {
        faces.forEach((f, i) => {
          if (card.faces![i]) {
            card.faces![i].localName = f.printed_name
            card.faces![i].localTypeLine = f.printed_type_line
            card.faces![i].localText = f.printed_text
          }
        })
      }
    }
  }

  finish(lang: LangCode, bulkUpdatedAt?: string): DbFile {
    return {
      version: 1,
      lang,
      updatedAt: new Date().toISOString(),
      bulkUpdatedAt,
      cards: [...this.cards.values()],
      printings: [...this.printings.values()]
    }
  }
}

function dateScore(d: string): number {
  // datas mais recentes valem mais (0..1)
  const t = Date.parse(d || '1993-01-01')
  return isNaN(t) ? 0 : (t - Date.parse('1993-01-01')) / (Date.parse('2040-01-01') - Date.parse('1993-01-01'))
}

function printingScore(c: SfCard): number {
  let s = 0
  if (!c.promo) s += 4
  if (!c.full_art) s += 1
  if (!c.textless) s += 1
  if (c.border_color !== 'borderless') s += 1
  if (!(c.frame_effects ?? []).some((f) => ['showcase', 'extendedart', 'etched', 'inverted'].includes(f))) s += 2
  if (!c.variation) s += 1
  if (!c.digital) s += 2
  if (c.set_type === 'expansion' || c.set_type === 'core') s += 2
  return s + dateScore(c.released_at)
}

function printingScoreFromPrinting(p: Printing): number {
  let s = 0
  if (!p.tags.includes('promo')) s += 4
  if (!p.tags.includes('full-art')) s += 1
  if (!p.tags.includes('textless')) s += 1
  if (!p.tags.includes('borderless')) s += 1
  if (!p.tags.some((t) => ['showcase', 'extended', 'etched'].includes(t))) s += 2
  if (!p.tags.includes('variation')) s += 1
  return s + 2
}

function toPrinting(c: SfCard, oracleId: string): Printing {
  const front = c.image_uris ?? c.card_faces?.[0]?.image_uris
  const back = c.image_uris ? undefined : c.card_faces?.[1]?.image_uris
  const tags: string[] = []
  if (c.promo) tags.push('promo')
  if (c.full_art) tags.push('full-art')
  if (c.textless) tags.push('textless')
  if (c.border_color === 'borderless') tags.push('borderless')
  if (c.variation) tags.push('variation')
  for (const fe of c.frame_effects ?? []) {
    if (fe === 'showcase') tags.push('showcase')
    if (fe === 'extendedart') tags.push('extended')
    if (fe === 'etched') tags.push('etched')
  }
  const localName = c.lang !== 'en' ? (c.card_faces?.length ? c.card_faces.map((f) => f.printed_name ?? f.name).join(' // ') : c.printed_name) : undefined
  return {
    id: c.id,
    oracleId,
    lang: c.lang,
    set: c.set,
    setName: c.set_name,
    collectorNumber: c.collector_number,
    rarity: c.rarity,
    releasedAt: c.released_at,
    localName,
    artist: c.artist,
    img: {
      small: front?.small,
      normal: front?.normal,
      large: front?.large,
      artCrop: front?.art_crop,
      backSmall: back?.small,
      backNormal: back?.normal,
      backLarge: back?.large
    },
    tags,
    finishes: c.finishes
  }
}

function toFace(f: SfFace): CardFace {
  return {
    name: f.name,
    manaCost: f.mana_cost ?? '',
    typeLine: f.type_line ?? '',
    oracleText: f.oracle_text ?? '',
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    colors: f.colors
  }
}

function toCardData(c: SfCard, oracleId: string, printingId: string): CardData {
  const faces = c.card_faces?.map(toFace)
  const legalities: Record<string, Legality> = {}
  for (const k of KEPT_FORMATS) {
    const v = c.legalities?.[k]
    if (v && v !== 'not_legal') legalities[k] = v as Legality
  }
  const first = faces?.[0]
  return {
    oracleId,
    name: c.name,
    manaCost: c.mana_cost ?? first?.manaCost ?? '',
    cmc: c.cmc ?? 0,
    typeLine: c.type_line ?? faces?.map((f) => f.typeLine).join(' // ') ?? '',
    oracleText: c.oracle_text ?? faces?.map((f) => f.oracleText).join('\n—\n') ?? '',
    power: c.power ?? first?.power,
    toughness: c.toughness ?? first?.toughness,
    loyalty: c.loyalty ?? first?.loyalty,
    defense: c.defense ?? first?.defense,
    colors: c.colors ?? first?.colors ?? [],
    colorIdentity: c.color_identity ?? [],
    keywords: c.keywords ?? [],
    legalities,
    layout: c.layout,
    faces,
    producedMana: c.produced_mana,
    defaultPrintingId: printingId,
    rarity: c.rarity,
    edhrecRank: c.edhrec_rank,
    gameChanger: c.game_changer
  }
}

// ----------------- Download -----------------

let abort: AbortController | null = null
let running = false

export function cancelDownload(): void {
  abort?.abort()
}

export function isDownloading(): boolean {
  return running
}

async function fetchJson<T>(url: string, signal: AbortSignal, attempt = 0): Promise<T> {
  const res = await net.fetch(url, { headers: HEADERS, signal })
  if (res.status === 429 && attempt < 5) {
    await sleep(1000 * (attempt + 1))
    return fetchJson(url, signal, attempt + 1)
  }
  if (res.status === 404) return { object: 'list', data: [], has_more: false, total_cards: 0 } as T
  if (!res.ok) throw new Error(t('Scryfall respondeu {status} em {url}', { status: res.status, url }))
  return (await res.json()) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Lê um fluxo de texto com objetos JSON — tanto JSONL (um por linha) quanto um array JSON —
 * emitindo cada objeto de nível de registro sem carregar o arquivo inteiro na memória.
 */
async function parseJsonStream(stream: AsyncIterable<Buffer | string>, onObject: (o: SfCard) => void): Promise<number> {
  const decoder = new TextDecoder('utf-8')
  let recordDepth = -1
  let depth = 0
  let inStr = false
  let esc = false
  let inObj = false
  let buf = ''
  let count = 0
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let segStart = inObj ? 0 : -1
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i)
      if (inStr) {
        if (esc) esc = false
        else if (ch === 92) esc = true
        else if (ch === 34) inStr = false
        continue
      }
      if (ch === 34) {
        inStr = true
        continue
      }
      if (recordDepth < 0) {
        if (ch === 91) recordDepth = 1 // '[' => array JSON
        else if (ch === 123) recordDepth = 0 // '{' => JSONL
      }
      if (ch === 123 || ch === 91) {
        if (ch === 123 && depth === recordDepth) {
          inObj = true
          segStart = i
          buf = ''
        }
        depth++
      } else if (ch === 125 || ch === 93) {
        depth--
        if (ch === 125 && inObj && depth === recordDepth) {
          buf += text.slice(segStart, i + 1)
          try {
            onObject(JSON.parse(buf))
            count++
          } catch {
            /* registro inválido: ignora */
          }
          buf = ''
          inObj = false
          segStart = -1
        }
      }
    }
    if (inObj && segStart >= 0) buf += text.slice(segStart)
  }
  return count
}

function gunzipIfNeeded(): Transform {
  let decided = false
  let gunzip: zlib.Gunzip | null = null
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!decided) {
        decided = true
        if (chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b) {
          gunzip = zlib.createGunzip()
          gunzip.on('data', (d) => t.push(d))
          gunzip.on('error', (e) => t.destroy(e))
        }
      }
      if (gunzip) gunzip.write(chunk, cb)
      else cb(null, chunk)
    },
    flush(cb) {
      if (gunzip) {
        gunzip.once('end', () => cb())
        gunzip.end()
      } else cb()
    }
  })
  return t
}

interface BulkEntry {
  type: string
  updated_at: string
  download_uri?: string
  jsonl_download_uri?: string
  size?: number
  compressed_size?: number
}

export async function downloadDatabase(lang: LangCode, progress: ProgressFn): Promise<void> {
  if (running) throw new Error(t('Um download já está em andamento.'))
  running = true
  abort = new AbortController()
  const signal = abort.signal
  try {
    progress({ phase: 'meta', current: 0, total: 0, message: t('Consultando o Scryfall...') })
    const bulk = await fetchJson<{ data: BulkEntry[] }>('https://api.scryfall.com/bulk-data', signal)
    const entry = bulk.data.find((d) => d.type === 'default_cards')
    if (!entry) throw new Error(t('Arquivo "default_cards" não encontrado no Scryfall.'))
    const url = entry.jsonl_download_uri ?? entry.download_uri
    if (!url) throw new Error(t('URL de download do Scryfall não encontrada.'))
    const total = entry.compressed_size ?? entry.size ?? 0

    const res = await net.fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal })
    if (!res.ok || !res.body) throw new Error(t('Falha ao baixar cartas ({status}).', { status: res.status }))

    const builder = new DbBuilder()
    let received = 0
    let lastReport = 0
    const counter = new Transform({
      transform(chunk: Buffer, _e, cb) {
        received += chunk.length
        const now = Date.now()
        if (now - lastReport > 250) {
          lastReport = now
          progress({
            phase: 'cards',
            current: received,
            total,
            message: t('Baixando cartas em inglês (dados de regras)... {mb} MB — {count} cartas', {
              mb: (received / 1048576).toFixed(1),
              count: fmtNum(builder.cards.size)
            })
          })
        }
        cb(null, chunk)
      }
    })
    const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream<Uint8Array>)
    const pipeline = nodeStream.pipe(counter).pipe(gunzipIfNeeded())
    nodeStream.on('error', (e) => pipeline.destroy(e))
    counter.on('error', (e) => pipeline.destroy(e))
    await parseJsonStream(pipeline, (o) => builder.addCard(o))

    if (lang !== 'en') {
      await downloadLocalized(lang, builder, progress, signal)
    }

    progress({ phase: 'saving', current: 0, total: 1, message: t('Salvando banco de dados local...') })
    const data = builder.finish(lang, entry.updated_at)
    const file = path.join(databaseDir(), 'cards.json')
    const tmp = file + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.promises.rename(tmp, file)
    db.loadFromData(data)
    progress({
      phase: 'done',
      current: 1,
      total: 1,
      message: t('Pronto! {cards} cartas e {printings} impressões salvas.', { cards: fmtNum(data.cards.length), printings: fmtNum(data.printings.length) })
    })
  } catch (err) {
    if (signal.aborted) {
      progress({ phase: 'cancelled', current: 0, total: 0, message: t('Download cancelado.') })
    } else {
      progress({ phase: 'error', current: 0, total: 0, message: t('Erro: {message}', { message: (err as Error).message }) })
    }
    throw err
  } finally {
    running = false
    abort = null
  }
}

async function downloadLocalized(lang: LangCode, builder: DbBuilder, progress: ProgressFn, signal: AbortSignal): Promise<void> {
  let url: string | null =
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`lang:${lang}`)}&unique=prints&include_extras=false&include_variations=true&order=released&dir=desc`
  let done = 0
  let total = 0
  progress({ phase: 'localized', current: 0, total: 1, message: t('Buscando cartas no idioma "{lang}"...', { lang }) })
  while (url) {
    if (signal.aborted) throw new Error('cancelado')
    const page: { data: SfCard[]; has_more: boolean; next_page?: string; total_cards?: number } = await fetchJson(url, signal)
    total = page.total_cards ?? total
    for (const c of page.data) builder.addLocalized(c)
    done += page.data.length
    progress({
      phase: 'localized',
      current: done,
      total: Math.max(total, done),
      message: t('Baixando traduções ({lang}): {done} de {total}', { lang, done: fmtNum(done), total: fmtNum(total) })
    })
    url = page.has_more && page.next_page ? page.next_page : null
    await sleep(110) // respeita o limite de requisições do Scryfall
  }
}
