// Painel administrativo: chamadas às funções "admin_*" do Supabase (ver supabase/schema.sql).
// Toda função confere no servidor se quem chama é administrador; aqui só traduzimos os dados.
import type { AdminLogEntry, AdminResult, AdminStats, AdminUser, Announcement } from '../shared/types'
import { t } from '../shared/i18n/index.ts'
import { authConfigured, supabaseClient } from './auth'

function fail<T>(msg: string | undefined): AdminResult<T> {
  if (!msg) return { ok: false, error: t('Algo deu errado. Tente de novo.') }
  if (/apenas administradores/i.test(msg)) return { ok: false, error: t('Apenas administradores podem fazer isso.') }
  if (/could not find the function|does not exist|schema cache/i.test(msg)) return { ok: false, error: t('O painel ainda não foi configurado no Supabase: rode o supabase/schema.sql atualizado (veja SUPABASE.md).') }
  const known: Record<string, string> = {
    'você não pode banir a si mesmo': t('Você não pode banir a si mesmo.'),
    'tire o cargo de administrador antes de banir': t('Tire o cargo de administrador antes de banir.'),
    'o app precisa de pelo menos um administrador': t('O app precisa de pelo menos um administrador.'),
    'conta suspensa não pode ser administradora': t('Uma conta suspensa não pode ser administradora.'),
    'limite inválido': t('Limite inválido.'),
    'aviso longo demais': t('O aviso está longo demais (máximo 600 caracteres).')
  }
  for (const [k, v] of Object.entries(known)) if (msg.includes(k)) return { ok: false, error: v }
  return { ok: false, error: msg }
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<AdminResult<T>> {
  if (!authConfigured()) return { ok: false, error: t('Contas online não configuradas.') }
  try {
    const { data, error } = await supabaseClient().rpc(fn, args)
    if (error) return fail(error.message)
    return { ok: true, data: data as T }
  } catch (err) {
    return fail((err as Error).message)
  }
}

/** Situação da conta logada (admin / suspensa). Tolerante a um schema antigo sem a função. */
export async function accountStatus(): Promise<{ admin: boolean; banned: boolean; reason: string | null; until: string | null }> {
  const r = await rpc<{ admin?: boolean; banned?: boolean; reason?: string | null; until?: string | null }>('my_account_status')
  const d = r.ok ? r.data : undefined
  return { admin: d?.admin === true, banned: d?.banned === true, reason: d?.reason ?? null, until: d?.until ?? null }
}

export async function adminStats(): Promise<AdminResult<AdminStats>> {
  const r = await rpc<Record<string, unknown>>('admin_stats')
  if (!r.ok || !r.data) return { ok: false, error: r.error }
  const d = r.data
  const n = (k: string) => Number(d[k] ?? 0) || 0
  return {
    ok: true,
    data: {
      users: n('users'),
      new7d: n('new_7d'),
      active7d: n('active_7d'),
      admins: n('admins'),
      banned: n('banned'),
      aiToday: n('ai_today'),
      aiUsersToday: n('ai_users_today'),
      ai7d: n('ai_7d'),
      aiLimit: typeof d.ai_limit === 'number' ? d.ai_limit : null,
      friendships: n('friendships')
    }
  }
}

interface UserRow {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  email: string
  created_at: string
  last_sign_in_at: string | null
  is_admin: boolean
  banned: boolean
  ban_reason: string | null
  ban_until: string | null
  ai_today: number
  ai_7d: number | string
}

export async function adminUsers(q: string, sort: 'recent' | 'active' | 'ai', offset: number): Promise<AdminResult<AdminUser[]>> {
  const r = await rpc<UserRow[]>('admin_list_users', { q: String(q ?? '').slice(0, 80), sort, lim: 50, off: Math.max(0, offset | 0) })
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    data: (r.data ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      isAdmin: u.is_admin,
      banned: u.banned,
      banReason: u.ban_reason,
      banUntil: u.ban_until,
      aiToday: Number(u.ai_today) || 0,
      ai7d: Number(u.ai_7d) || 0
    }))
  }
}

export const adminSetAdmin = (id: string, make: boolean) => rpc('admin_set_admin', { target: id, make: Boolean(make) })
export const adminBan = (id: string, reason: string, days: number | null) => rpc('admin_ban', { target: id, reason: String(reason ?? '').slice(0, 300), days: days && days > 0 ? Math.floor(days) : null })
export const adminUnban = (id: string) => rpc('admin_unban', { target: id })
export const adminResetAi = (id: string) => rpc('admin_reset_ai', { target: id })

export async function adminSetAnnouncement(a: Announcement | null): Promise<AdminResult> {
  const v = a && a.text.trim() ? { text: a.text.trim().slice(0, 600), level: a.level === 'warning' ? 'warning' : 'info' } : null
  return rpc('admin_set_config', { k: 'announcement', v })
}

export async function adminSetAiLimit(limit: number | null): Promise<AdminResult> {
  return rpc('admin_set_config', { k: 'ai_daily_limit', v: limit === null ? null : Math.max(0, Math.min(10000, Math.floor(limit))) })
}

interface LogRow {
  id: number
  created_at: string
  admin_name: string
  action: string
  target_name: string | null
  details: Record<string, unknown> | null
}

export async function adminLog(): Promise<AdminResult<AdminLogEntry[]>> {
  const r = await rpc<LogRow[]>('admin_list_log', { lim: 200 })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, data: (r.data ?? []).map((l) => ({ id: l.id, createdAt: l.created_at, adminName: l.admin_name, action: l.action, targetName: l.target_name, details: l.details })) }
}

/** Aviso para todos os jogadores (funciona até sem login). */
export async function getAnnouncement(): Promise<Announcement | null> {
  const r = await rpc<{ text?: string; level?: string; updated_at?: string } | null>('get_announcement')
  const d = r.ok ? r.data : null
  if (!d?.text) return null
  return { text: d.text, level: d.level === 'warning' ? 'warning' : 'info', updatedAt: d.updated_at }
}

/** Ids dos administradores (selo nos perfis). */
export async function adminIds(): Promise<string[]> {
  const r = await rpc<string[] | { admin_ids: string }[]>('admin_ids')
  if (!r.ok || !Array.isArray(r.data)) return []
  return r.data.map((x) => (typeof x === 'string' ? x : x.admin_ids)).filter(Boolean)
}
