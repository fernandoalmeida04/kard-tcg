// Imagens das cartas de Pokémon (assets do TCGdex) com cache local em database/images/ptcg.
import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import { pkmDb } from './pkmDb'

const inflight = new Map<string, Promise<Buffer | null>>()

export type PkmImageQuality = 'low' | 'high'

/**
 * Busca a imagem de uma impressão: prefere a imagem no idioma do banco e cai para a em inglês.
 * `quality`: low (~250px, listas) ou high (~600px, detalhes).
 */
export async function getPkmImage(printingId: string, quality: PkmImageQuality): Promise<Buffer | null> {
  const safe = printingId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const file = path.join(pkmDb.imagesDir(), `${safe}_${quality}.webp`)
  try {
    return await fs.promises.readFile(file)
  } catch {
    /* não está em cache */
  }
  const key = `${safe}_${quality}`
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    const p = pkmDb.getPrinting(printingId)
    if (!p) return null
    for (const base of [p.localImage, p.image].filter(Boolean) as string[]) {
      const res = await net.fetch(`${base}/${quality}.webp`, { headers: { 'User-Agent': 'KardTCGSimulator/0.1' } })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      await fs.promises.writeFile(file, buf)
      return buf
    }
    return null
  })()
    .catch(() => null)
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}
