// Relatório de problemas do motor de regras.
// Durante as partidas o motor anota o que não conseguiu automatizar (texto de carta não entendido,
// consultas ao Juiz IA, ajustes manuais, erros internos...). O app agrega essas anotações num arquivo
// (pasta de dados do usuário) para o desenvolvedor corrigir o motor depois.
import type { EngineIssueEvent, EngineIssueKind } from './engine/types.ts'

/** Dados da carta guardados junto do problema: permitem conferir depois se o motor já entende o texto. */
export interface IssueCardData {
  name: string
  typeLine: string
  oracleText: string
  keywords: string[]
  producedMana?: string[]
  layout?: string
  faces?: { name: string; typeLine: string; oracleText: string }[]
}

/** Problema enviado pela interface para gravação. */
export interface IssueInput extends EngineIssueEvent {
  format?: string
  online?: boolean
  cardData?: IssueCardData
}

export interface IssueExample {
  at: string
  format?: string
  turn: number
  online?: boolean
  context?: string[]
}

/** Problema agregado (mesmo tipo + carta + texto = mesma entrada, com contador). */
export interface StoredIssue {
  key: string
  kind: EngineIssueKind
  card?: string
  text: string
  count: number
  firstSeen: string
  lastSeen: string
  /** Versão do app em que apareceu pela última vez. */
  appVersion: string
  cardData?: IssueCardData
  /** Até 3 ocorrências com o contexto (últimas linhas do registro). */
  examples: IssueExample[]
  /** Relatório da comunidade (Supabase): quantos jogadores diferentes viram o problema. */
  reporters?: number
}

/** Item enviado ao Supabase (função report_engine_issues). */
export interface RemoteIssueItem {
  key: string
  kind: EngineIssueKind
  card?: string
  text: string
  appVersion: string
  cardData?: IssueCardData
  example: IssueExample
}

export function toRemoteItem(ev: IssueInput, appVersion: string, now = new Date().toISOString()): RemoteIssueItem {
  return {
    key: issueKey(ev.kind, ev.card, ev.text),
    kind: ev.kind,
    card: ev.card,
    text: ev.text.slice(0, 3000),
    appVersion,
    cardData: ev.cardData,
    example: { at: now, format: ev.format, turn: ev.turn, online: ev.online, context: ev.context?.slice(-10).map((c) => c.slice(0, 400)) }
  }
}

export const ISSUE_KIND_LABEL: Record<EngineIssueKind, string> = {
  crash: 'Erro interno do motor',
  unknownPT: 'Poder/resistência desconhecidos',
  aiFailed: 'Juiz IA falhou',
  manual: 'Ajuste manual',
  userReport: 'Relato do jogador',
  botRejected: 'Jogada do bot recusada',
  unparsed: 'Texto não automatizado',
  aiJudge: 'Precisou do Juiz IA'
}

/** Ordem de gravidade (para listar e exportar). */
export const ISSUE_KIND_ORDER: EngineIssueKind[] = ['crash', 'userReport', 'unknownPT', 'aiFailed', 'manual', 'botRejected', 'unparsed', 'aiJudge']

export function issueKey(kind: EngineIssueKind, card: string | undefined, text: string): string {
  // ajustes e relatos variam muito no texto: agrupa por carta (ou pelo começo do texto)
  const norm = text.toLowerCase().replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${kind}|${card ?? ''}|${kind === 'userReport' || kind === 'crash' ? norm.slice(0, 120) : norm}`
}

/** Junta novos problemas à lista guardada. */
export function mergeIssues(list: StoredIssue[], inputs: IssueInput[], appVersion: string, now = new Date().toISOString()): StoredIssue[] {
  const byKey = new Map(list.map((i) => [i.key, i]))
  for (const ev of inputs) {
    if (!ev || typeof ev.text !== 'string' || !ev.kind) continue
    const key = issueKey(ev.kind, ev.card, ev.text)
    const example: IssueExample = { at: now, format: ev.format, turn: ev.turn, online: ev.online, context: ev.context?.slice(-10) }
    const cur = byKey.get(key)
    if (cur) {
      cur.count++
      cur.lastSeen = now
      cur.appVersion = appVersion
      if (ev.cardData) cur.cardData = ev.cardData
      cur.examples = [example, ...cur.examples].slice(0, 3)
    } else {
      byKey.set(key, {
        key,
        kind: ev.kind,
        card: ev.card,
        text: ev.text.slice(0, 3000),
        count: 1,
        firstSeen: now,
        lastSeen: now,
        appVersion,
        cardData: ev.cardData,
        examples: [example]
      })
    }
  }
  // limite de tamanho do arquivo: mantém os mais recentes
  return [...byKey.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 2000)
}

/** Relatório em Markdown, pensado para colar numa conversa com quem vai corrigir o motor. */
export function issuesToMarkdown(list: StoredIssue[], opts: { appVersion: string; fixed?: Set<string> }): string {
  const lines: string[] = []
  lines.push(`# Relatório do motor de regras — Kard ${opts.appVersion}`)
  lines.push('')
  lines.push(`Gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${list.length} problema(s) distintos.`)
  lines.push('')
  for (const kind of ISSUE_KIND_ORDER) {
    const items = list.filter((i) => i.kind === kind && !opts.fixed?.has(i.key)).sort((a, b) => b.count - a.count)
    if (!items.length) continue
    lines.push(`## ${ISSUE_KIND_LABEL[kind]} (${items.length})`)
    lines.push('')
    for (const i of items) {
      const who = i.reporters ? `, ${i.reporters} jogador(es)` : ''
      lines.push(`### ${i.card ?? '(sem carta)'} — ${i.count}×${who} (última: ${i.lastSeen.slice(0, 10)}, v${i.appVersion})`)
      lines.push('')
      lines.push('```')
      lines.push(i.text)
      lines.push('```')
      if (i.cardData) {
        lines.push(`Carta: **${i.cardData.name}** — ${i.cardData.typeLine}`)
        lines.push('')
        lines.push('> ' + (i.cardData.faces?.length ? i.cardData.faces.map((f) => `[${f.name}] ${f.oracleText}`).join(' // ') : i.cardData.oracleText).replace(/\n/g, '\n> '))
      }
      const ex = i.examples[0]
      if (ex?.context?.length) {
        lines.push('')
        lines.push(`Contexto (turno ${ex.turn}${ex.format ? `, ${ex.format}` : ''}${ex.online ? ', online' : ''}):`)
        for (const c of ex.context) lines.push(`- ${c}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}
