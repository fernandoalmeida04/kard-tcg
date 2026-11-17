import { safeStorage } from 'electron'
import fs from 'fs'
import { settingsFile } from './paths'
import type { Settings, SettingsUpdate } from '../shared/types'
import { DEFAULT_PKM_LAYOUT, normalizePkmLayout } from '../shared/types'
import { UI_LANGUAGES, setUiLang } from '../shared/i18n/index.ts'
import { DEFAULT_BOARD_LAYOUT, DEFAULT_MAT_LAYOUT, normalizeBoardLayout, normalizeMatLayout } from '../shared/board'

interface StoredSettings extends Omit<Settings, 'hasApiKey'> {
  apiKeyEnc?: string
  apiKeyPlain?: string
}

const DEFAULTS: StoredSettings = {
  tcg: 'mtg',
  uiLanguage: 'pt',
  cardLanguage: 'pt',
  aiJudgeEnabled: false,
  aiModel: 'claude-opus-5-5',
  botDelayMs: 700,
  autoPass: true,
  stopAtEveryStep: false,
  showCardText: true,
  playMode: 'click',
  boardLayout: DEFAULT_BOARD_LAYOUT,
  matLayout: DEFAULT_MAT_LAYOUT,
  playmatImage: null,
  playmatDim: 0.35,
  playmatBoth: false,
  shareEngineIssues: true,
  pkmLayout: DEFAULT_PKM_LAYOUT,
  drawAnimation: true
}

let current: StoredSettings | null = null

function load(): StoredSettings {
  if (current) return current
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    current = { ...DEFAULTS, ...raw }
  } catch {
    current = { ...DEFAULTS }
  }
  current!.boardLayout = normalizeBoardLayout(current!.boardLayout)
  current!.matLayout = normalizeMatLayout(current!.matLayout)
  if (!UI_LANGUAGES.some((l) => l.code === current!.uiLanguage)) current!.uiLanguage = 'pt'
  setUiLang(current!.uiLanguage)
  return current!
}

function persist(): void {
  fs.writeFileSync(settingsFile(), JSON.stringify(current, null, 2), 'utf8')
}

export function getSettings(): Settings {
  const s = load()
  const { apiKeyEnc, apiKeyPlain, ...rest } = s
  return { ...rest, hasApiKey: Boolean(apiKeyEnc || apiKeyPlain || process.env.ANTHROPIC_API_KEY) }
}

export function updateSettings(update: SettingsUpdate): Settings {
  const s = load()
  // a imagem do playmat só muda pelos fluxos próprios (escolher/remover arquivo)
  const { apiKey, playmatImage: _ignored, ...rest } = update as SettingsUpdate & { playmatImage?: unknown }
  Object.assign(s, rest)
  s.playmatDim = Math.min(0.85, Math.max(0, Number(s.playmatDim) || 0))
  if (rest.boardLayout) s.boardLayout = normalizeBoardLayout(rest.boardLayout)
  if (rest.matLayout) s.matLayout = normalizeMatLayout(rest.matLayout)
  s.pkmLayout = normalizePkmLayout(s.pkmLayout)
  s.drawAnimation = s.drawAnimation !== false
  if (s.playMode !== 'drag') s.playMode = 'click'
  if (!['mtg', 'pokemon', 'ygo'].includes(s.tcg)) s.tcg = 'mtg'
  if (!UI_LANGUAGES.some((l) => l.code === s.uiLanguage)) s.uiLanguage = 'pt'
  setUiLang(s.uiLanguage)
  if (apiKey !== undefined) {
    delete s.apiKeyEnc
    delete s.apiKeyPlain
    if (apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        s.apiKeyEnc = safeStorage.encryptString(apiKey.trim()).toString('base64')
      } else {
        s.apiKeyPlain = apiKey.trim()
      }
    }
  }
  persist()
  return getSettings()
}

/** Define o arquivo do playmat (nome dentro da pasta de playmat). */
export function setPlaymatImage(name: string | null): Settings {
  const s = load()
  s.playmatImage = name
  persist()
  return getSettings()
}

/** Chave da API da Anthropic: configurada no app ou variável de ambiente ANTHROPIC_API_KEY. */
export function getApiKey(): string | undefined {
  const s = load()
  if (s.apiKeyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'))
    } catch {
      return undefined
    }
  }
  return s.apiKeyPlain || process.env.ANTHROPIC_API_KEY || undefined
}
