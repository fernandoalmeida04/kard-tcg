import { app } from 'electron'
import fs from 'fs'
import path from 'path'

let cachedDbDir: string | null = null

function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.write-test')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Pasta `database` do programa.
 * - Instalado: ao lado do executável (ex.: %LOCALAPPDATA%\Programs\Kard\database).
 * - Desenvolvimento (VS Code): na raiz do projeto.
 * Se a pasta de instalação não permitir escrita (ex.: Program Files), usa a pasta de dados do usuário.
 */
export function databaseDir(): string {
  if (cachedDbDir) return cachedDbDir
  const preferred = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'database')
    : path.join(app.getAppPath(), 'database')
  cachedDbDir = isWritable(preferred) ? preferred : path.join(app.getPath('userData'), 'database')
  fs.mkdirSync(cachedDbDir, { recursive: true })
  return cachedDbDir
}

export function imagesDir(): string {
  const dir = path.join(databaseDir(), 'images')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Decks e configurações ficam na pasta de dados do usuário para sobreviver a reinstalações. */
export function decksDir(): string {
  const dir = path.join(app.getPath('userData'), 'decks')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function dirSize(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const s = dirSize(p)
        bytes += s.bytes
        files += s.files
      } else {
        bytes += fs.statSync(p).size
        files++
      }
    }
  } catch {
    /* pasta ainda não existe */
  }
  return { bytes, files }
}
