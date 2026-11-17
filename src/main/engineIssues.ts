// Guarda o relatório de problemas do motor (userData/engine-issues.json) e envia para o Supabase
// (tabela engine_issues), para o desenvolvedor ver os problemas das partidas de todos os jogadores.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { mergeIssues, issuesToMarkdown, toRemoteItem, type IssueInput, type RemoteIssueItem, type StoredIssue } from '../shared/engineIssues'
import type { EngineIssueKind } from '../shared/engine/types'
import { t } from '../shared/i18n/index.ts'
import { authConfigured, currentUser, supabaseClient } from './auth'
import { getSettings } from './settings'

export type IssueSource = 'local' | 'remote'

function file(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, data: unknown): void {
  try {
    const tmp = file(name) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, file(name))
  } catch (err) {
    console.error(`[issues] falha ao gravar ${name}:`, err)
  }
}

// ---------------- Relatório local ----------------

let cache: StoredIssue[] | null = null

export function listIssues(): StoredIssue[] {
  if (!cache) {
    const raw = readJson<{ issues?: StoredIssue[] }>('engine-issues.json', {})
    cache = Array.isArray(raw.issues) ? raw.issues : []
  }
  return cache
}

function save(list: StoredIssue[]): void {
  cache = list
  writeJson('engine-issues.json', { version: 1, issues: list })
}

export function recordIssues(inputs: IssueInput[]): void {
  if (!Array.isArray(inputs) || !inputs.length) return
  const list = inputs.slice(0, 200)
  save(mergeIssues(listIssues(), list, app.getVersion()))
  if (getSettings().shareEngineIssues !== false) {
    const now = new Date().toISOString()
    enqueueRemote(list.filter((ev) => ev && typeof ev.text === 'string' && ev.kind).map((ev) => toRemoteItem(ev, app.getVersion(), now)))
  }
}

/** Remove os problemas indicados (ou todos, sem lista). */
export function clearIssues(keys?: string[]): StoredIssue[] {
  if (!keys) save([])
  else {
    const set = new Set(keys)
    save(listIssues().filter((i) => !set.has(i.key)))
  }
  return listIssues()
}

// ---------------- Envio para o Supabase ----------------
// Fila persistente: o que não foi enviado (sem internet, sem login) vai na próxima oportunidade.

const OUTBOX = 'engine-issues-outbox.json'
const OUTBOX_MAX = 1000
let outbox: RemoteIssueItem[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function getOutbox(): RemoteIssueItem[] {
  if (!outbox) {
    const raw = readJson<RemoteIssueItem[]>(OUTBOX, [])
    outbox = Array.isArray(raw) ? raw : []
  }
  return outbox
}

function saveOutbox(): void {
  writeJson(OUTBOX, getOutbox())
}

function enqueueRemote(items: RemoteIssueItem[]): void {
  if (!items.length) return
  const box = getOutbox()
  box.push(...items)
  if (box.length > OUTBOX_MAX) box.splice(0, box.length - OUTBOX_MAX)
  saveOutbox()
  scheduleFlush(3000)
}

function scheduleFlush(ms: number): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushRemote()
  }, ms)
}

/** Envia a fila ao Supabase (só com login e com o envio ligado nas Configurações). */
export async function flushRemote(): Promise<void> {
  if (flushing || !getOutbox().length) return
  if (getSettings().shareEngineIssues === false) {
    // o jogador desligou o envio: descarta o que estava esperando
    outbox = []
    saveOutbox()
    return
  }
  if (!authConfigured() || !(await currentUser())) return
  flushing = true
  try {
    while (getOutbox().length) {
      const batch = getOutbox().slice(0, 100)
      const { error } = await supabaseClient().rpc('report_engine_issues', { items: batch })
      if (error) {
        // tabela ainda não criada no Supabase (schema.sql antigo) ou sem internet: tenta mais tarde
        console.warn('[issues] envio ao Supabase falhou:', error.message)
        scheduleFlush(5 * 60_000)
        return
      }
      getOutbox().splice(0, batch.length)
      saveOutbox()
    }
  } catch (err) {
    console.warn('[issues] envio ao Supabase falhou:', err)
    scheduleFlush(5 * 60_000)
  } finally {
    flushing = false
  }
}

// ---------------- Relatório da comunidade (administrador) ----------------

export async function remoteIsAdmin(): Promise<boolean> {
  if (!authConfigured() || !(await currentUser())) return false
  const { data, error } = await supabaseClient().rpc('is_app_admin')
  return !error && data === true
}

interface RemoteRow {
  key: string
  kind: EngineIssueKind
  card: string | null
  text: string
  count: number
  reporters: number
  first_seen: string
  last_seen: string
  app_version: string | null
  card_data: StoredIssue['cardData'] | null
  examples: StoredIssue['examples'] | null
}

export async function listRemoteIssues(): Promise<StoredIssue[]> {
  const { data, error } = await supabaseClient().rpc('list_engine_issues')
  if (error) throw new Error(error.message)
  return ((data ?? []) as RemoteRow[]).map((r) => ({
    key: r.key,
    kind: r.kind,
    card: r.card ?? undefined,
    text: r.text,
    count: r.count,
    reporters: Number(r.reporters) || undefined,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    appVersion: r.app_version ?? '?',
    cardData: r.card_data ?? undefined,
    examples: Array.isArray(r.examples) ? r.examples : []
  }))
}

export async function clearRemoteIssues(keys: string[]): Promise<StoredIssue[]> {
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await supabaseClient().from('engine_issues').delete().in('key', keys.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
  return listRemoteIssues()
}

// ---------------- Exportação ----------------

async function sourceList(source: IssueSource): Promise<StoredIssue[]> {
  return source === 'remote' ? listRemoteIssues() : listIssues()
}

export async function issuesMarkdown(fixedKeys: string[], source: IssueSource = 'local'): Promise<string> {
  return issuesToMarkdown(await sourceList(source), { appVersion: app.getVersion(), fixed: new Set(fixedKeys) })
}

/** Salva o relatório em Markdown num arquivo escolhido pelo usuário. */
export async function exportIssues(win: BrowserWindow | null, fixedKeys: string[], source: IssueSource = 'local'): Promise<string | null> {
  const md = await issuesMarkdown(fixedKeys, source)
  const suffix = source === 'remote' ? 'comunidade' : 'local'
  const opts = {
    title: t('Salvar relatório do motor'),
    defaultPath: path.join(app.getPath('documents'), `kard-relatorio-motor-${suffix}-${new Date().toISOString().slice(0, 10)}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, md, 'utf8')
  shell.showItemInFolder(r.filePath)
  return r.filePath
}
