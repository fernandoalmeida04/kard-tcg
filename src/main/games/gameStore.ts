// Download, decks e imagens dos jogos genéricos.
import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import { decksDir } from '../paths'
import type { DownloadProgress } from '../../shared/types'
import type { GameDownloader, GameId, GDbFile, GDeck, GDeckSummary } from '../../shared/games/types'
import { gCount } from '../../shared/games/helpers'
import { fmtNum, t } from '../../shared/i18n/index.ts'
import { GAME_DB_VERSION, gameDb } from './gameDb'
import { download as ygoDownload } from './ygo/download'

const DOWNLOADERS: Record<GameId, GameDownloader> = { ygo: ygoDownload }

// ---------------- Download ----------------

const aborts = new Map<GameId, AbortController>()

export function cancelGameDownload(game: GameId): void {
  aborts.get(game)?.abort()
}

export async function downloadGameDatabase(game: GameId, lang: string, progress: (p: DownloadProgress) => void): Promise<void> {
  if (aborts.has(game)) throw new Error(t('Um download já está em andamento.'))
  const ctrl = new AbortController()
  aborts.set(game, ctrl)
  try {
    const { cards, printings, sets } = await DOWNLOADERS[game](lang, ctrl.signal, progress)
    progress({ phase: 'saving', current: 0, total: 1, message: t('Montando e salvando o banco local...') })
    const db = gameDb(game)
    const data: GDbFile = { version: GAME_DB_VERSION, game, lang, updatedAt: new Date().toISOString(), cards, printings, sets }
    await fs.promises.writeFile(db.file(), JSON.stringify(data), 'utf8')
    db.loadFromData(data)
    progress({
      phase: 'done',
      current: 1,
      total: 1,
      message: t('Pronto! {cards} cartas e {printings} impressões salvas.', { cards: fmtNum(cards.length), printings: fmtNum(printings.length) })
    })
  } catch (err) {
    if (ctrl.signal.aborted) progress({ phase: 'cancelled', current: 0, total: 0, message: t('Download cancelado.') })
    else progress({ phase: 'error', current: 0, total: 0, message: t('Erro: {message}', { message: (err as Error).message }) })
    throw err
  } finally {
    aborts.delete(game)
  }
}

// ---------------- Decks (um JSON por deck em decks/<jogo>) ----------------

function deckDir(game: GameId): string {
  const d = path.join(decksDir(), game)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function deckFile(game: GameId, id: string): string {
  return path.join(deckDir(game), `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)
}

export function listGameDecks(game: GameId): GDeckSummary[] {
  const out: GDeckSummary[] = []
  const db = gameDb(game)
  for (const f of fs.readdirSync(deckDir(game))) {
    if (!f.endsWith('.json')) continue
    try {
      const deck = JSON.parse(fs.readFileSync(path.join(deckDir(game), f), 'utf8')) as GDeck
      const all = Object.values(deck.sections).flat()
      const cards = db.cardsByIds(all.map((c) => c.oracleId))
      const colors = new Set<string>()
      for (const c of all) cards[c.oracleId]?.colors.forEach((x) => colors.add(x))
      out.push({
        id: deck.id,
        game,
        name: deck.name,
        format: deck.format,
        cardCount: Object.values(deck.sections).reduce((s, l) => s + gCount(l), 0),
        coverPrintingId: deck.coverPrintingId ?? all[0]?.printingId ?? cards[all[0]?.oracleId]?.defaultPrintingId,
        colors: [...colors],
        updatedAt: deck.updatedAt
      })
    } catch {
      /* arquivo corrompido: ignora */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getGameDeck(game: GameId, id: string): GDeck | null {
  try {
    return JSON.parse(fs.readFileSync(deckFile(game, id), 'utf8')) as GDeck
  } catch {
    return null
  }
}

export function saveGameDeck(deck: GDeck): GDeck {
  const saved: GDeck = { ...deck, updatedAt: new Date().toISOString() }
  fs.writeFileSync(deckFile(deck.game, deck.id), JSON.stringify(saved, null, 2), 'utf8')
  return saved
}

export function removeGameDeck(game: GameId, id: string): void {
  try {
    fs.unlinkSync(deckFile(game, id))
  } catch {
    /* já removido */
  }
}

// ---------------- Imagens (cache local em database/images/<jogo>) ----------------

const inflight = new Map<string, Promise<{ data: Buffer; type: string } | null>>()

/** kard-img://g/<jogo>/<impressão>/<small|large> */
export async function getGameImage(game: GameId, printingId: string, size: 'small' | 'large'): Promise<{ data: Buffer; type: string } | null> {
  const db = gameDb(game)
  const safe = printingId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const base = path.join(db.imagesDir(), `${safe}_${size}`)
  for (const ext of ['jpg', 'png', 'webp']) {
    try {
      return { data: await fs.promises.readFile(`${base}.${ext}`), type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }
    } catch {
      /* não está em cache */
    }
  }
  const key = `${game}/${safe}_${size}`
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    const p = db.getPrinting(printingId)
    if (!p) return null
    const urls = (size === 'small' ? [p.imageSmall, p.localImage, p.image] : [p.localImage, p.image, p.imageSmall]).filter(Boolean) as string[]
    for (const url of urls) {
      const res = await net.fetch(url, { headers: { 'User-Agent': 'KardTCGSimulator/0.1' } })
      if (!res.ok) continue
      const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
      const data = Buffer.from(await res.arrayBuffer())
      await fs.promises.writeFile(`${base}.${ext}`, data)
      return { data, type }
    }
    return null
  })()
    .catch(() => null)
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}
