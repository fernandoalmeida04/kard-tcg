import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Settings } from '../shared/types'
import { getSettings, setPlaymatImage } from './settings'
import { t } from '../shared/i18n/index.ts'

const EXT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/** Imagens de playmat ficam na pasta de dados do usuário (sobrevivem a reinstalações). */
export function playmatDir(): string {
  const dir = path.join(app.getPath('userData'), 'playmat')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function clearDir(): void {
  for (const f of fs.readdirSync(playmatDir())) {
    try {
      fs.unlinkSync(path.join(playmatDir(), f))
    } catch {
      /* arquivo em uso: ignora */
    }
  }
}

/** Abre o seletor de arquivo e copia a imagem escolhida como playmat. */
export async function choosePlaymat(win: BrowserWindow | null): Promise<Settings> {
  const opts = {
    title: t('Escolher imagem do playmat'),
    properties: ['openFile' as const],
    filters: [{ name: t('Imagens'), extensions: Object.keys(EXT_TYPES).map((e) => e.slice(1)) }]
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return getSettings()
  const src = r.filePaths[0]
  const ext = path.extname(src).toLowerCase()
  if (!EXT_TYPES[ext]) return getSettings()
  clearDir()
  // nome novo a cada troca para o navegador não reaproveitar a imagem antiga do cache
  const name = `playmat-${Date.now()}${ext}`
  fs.copyFileSync(src, path.join(playmatDir(), name))
  return setPlaymatImage(name)
}

export function clearPlaymat(): Settings {
  clearDir()
  return setPlaymatImage(null)
}

/** Lê a imagem do playmat para o protocolo kard-img://playmat/<nome>. */
export function readPlaymat(name: string): { data: Buffer; type: string } | null {
  const safe = path.basename(name)
  const type = EXT_TYPES[path.extname(safe).toLowerCase()]
  if (!type) return null
  try {
    return { data: fs.readFileSync(path.join(playmatDir(), safe)), type }
  } catch {
    return null
  }
}
