import { net, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { imagesDir } from './paths'
import { db } from './cardDb'
import { readPlaymat } from './playmat'
import { getPkmImage } from './pokemon/pkmImages'
import { getGameImage } from './games/gameStore'
import { isGameId } from '../shared/games/registry'
import type { DownloadProgress, Printing } from '../shared/types'
import { t } from '../shared/i18n/index.ts'

const inflight = new Map<string, Promise<Buffer | null>>()

type Size = 'small' | 'normal' | 'large' | 'art'

function imageUrl(p: Printing, size: Size, face: number): string | undefined {
  if (face === 1) {
    if (size === 'small') return p.img.backSmall ?? p.img.backNormal
    if (size === 'large') return p.img.backLarge ?? p.img.backNormal
    return p.img.backNormal ?? p.img.backLarge
  }
  if (size === 'small') return p.img.small ?? p.img.normal
  if (size === 'large') return p.img.large ?? p.img.normal
  if (size === 'art') return p.img.artCrop ?? p.img.normal
  return p.img.normal ?? p.img.large
}

function cacheFile(id: string, size: Size, face: number): string {
  const dir = path.join(imagesDir(), id.slice(0, 2))
  return path.join(dir, `${id}_${size}_${face}.jpg`)
}

async function getImage(id: string, size: Size, face: number): Promise<Buffer | null> {
  const file = cacheFile(id, size, face)
  try {
    return await fs.promises.readFile(file)
  } catch {
    /* não está em cache */
  }
  const key = `${id}_${size}_${face}`
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    const p = db.getPrinting(id)
    if (!p) return null
    const url = imageUrl(p, size, face)
    if (!url) return null
    const res = await net.fetch(url, { headers: { 'User-Agent': 'KardTCGSimulator/0.1' } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, buf)
    return buf
  })()
    .catch(() => null)
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

export function registerImageProtocol(): void {
  protocol.handle('kard-img', async (request) => {
    try {
      const u = new URL(request.url)
      if (u.hostname === 'playmat') {
        const img = readPlaymat(decodeURIComponent(u.pathname.slice(1)))
        if (!img) return new Response('not found', { status: 404 })
        return new Response(new Uint8Array(img.data), { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } })
      }
      if (u.hostname === 'g') {
        const [, game, rawId, size = 'small'] = u.pathname.split('/')
        if (!isGameId(game)) return new Response('not found', { status: 404 })
        const img = await getGameImage(game, decodeURIComponent(rawId), size === 'large' ? 'large' : 'small')
        if (!img) return new Response('not found', { status: 404 })
        return new Response(new Uint8Array(img.data), { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } })
      }
      if (u.hostname === 'ptcg') {
        const [, rawId, q = 'low'] = u.pathname.split('/')
        const buf = await getPkmImage(decodeURIComponent(rawId), q === 'high' ? 'high' : 'low')
        if (!buf) return new Response('not found', { status: 404 })
        return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' } })
      }
      const [, id, size = 'normal', face = '0'] = u.pathname.split('/')
      const buf = await getImage(id, (['small', 'normal', 'large', 'art'].includes(size) ? size : 'normal') as Size, face === '1' ? 1 : 0)
      if (!buf) return new Response('not found', { status: 404 })
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' }
      })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

export async function prefetchImages(ids: string[], progress: (p: DownloadProgress) => void): Promise<number> {
  const unique = [...new Set(ids)].filter(Boolean)
  let done = 0
  let downloaded = 0
  const queue = [...unique]
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!
      const p = db.getPrinting(id)
      const faces = p?.img.backNormal ? [0, 1] : [0]
      for (const face of faces) {
        const existed = fs.existsSync(cacheFile(id, 'normal', face))
        const buf = await getImage(id, 'normal', face)
        if (buf && !existed) downloaded++
      }
      done++
      progress({ phase: 'images', current: done, total: unique.length, message: t('Baixando imagens: {done} de {total}', { done, total: unique.length }) })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  progress({ phase: 'done', current: unique.length, total: unique.length, message:
      downloaded === 1 ? t('1 imagem nova salva no cache.') : t('{n} imagens novas salvas no cache.', { n: downloaded }) })
  return downloaded
}

export async function clearImageCache(): Promise<void> {
  await fs.promises.rm(imagesDir(), { recursive: true, force: true })
  fs.mkdirSync(imagesDir(), { recursive: true })
}
