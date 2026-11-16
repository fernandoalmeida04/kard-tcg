// Atualização automática pelo GitHub Releases (só no app instalado; em desenvolvimento não faz nada).
// Para publicar uma versão: aumentar "version" no package.json e rodar `npm run release` (precisa de GH_TOKEN).
import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

let status: UpdateStatus = { state: 'idle' }
let win: BrowserWindow | null = null

function emit(s: UpdateStatus): void {
  status = s
  win?.webContents.send('update:status', s)
}

export function updateStatus(): UpdateStatus {
  return status
}

export function initUpdater(window: BrowserWindow): void {
  win = window
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => emit({ state: 'idle' }))
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => emit({ state: 'error', error: err?.message ?? String(err) }))
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
  // primeira verificação logo após abrir; depois a cada 2 horas
  setTimeout(check, 5000)
  setInterval(check, 2 * 60 * 60 * 1000)
}

/** Fecha o app e instala a versão baixada. */
export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}
