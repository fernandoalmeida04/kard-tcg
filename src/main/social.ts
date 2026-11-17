// Amigos: busca, pedidos de amizade, presença (quem está online) e convites para partidas.
// Os dados ficam no Supabase (tabelas friendships e game_invites; ver supabase/schema.sql).
// Avisos em tempo real: pedidos e convites chegam pelo Realtime (postgres_changes); a presença usa
// um canal global "kard-presence" onde cada jogador logado aparece com o próprio id.
import type { BrowserWindow } from 'electron'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { FriendsState, FriendEntry, GameInvite, SocialResult, UserSearchResult } from '../shared/types'
import { t } from '../shared/i18n/index.ts'
import { authConfigured, supabaseClient } from './auth'
import { getPublicProfiles } from './profile'

let win: BrowserWindow | null = null
let myId: string | null = null
let presence: RealtimeChannel | null = null
let changes: RealtimeChannel | null = null
let onlineAll = new Set<string>()
let friendIds = new Set<string>()
let refreshTimer: ReturnType<typeof setInterval> | null = null

function emit(event: string, payload: unknown): void {
  win?.webContents.send(event, payload)
}

export function initSocial(window: BrowserWindow): void {
  win = window
}

function onlineFriends(): string[] {
  return [...friendIds].filter((id) => onlineAll.has(id))
}

function errorText(msg: string | undefined): string {
  if (!msg) return t('Algo deu errado. Tente de novo.')
  if (/function .* does not exist|schema cache|relation .* does not exist|Could not find/i.test(msg)) return t('O sistema de amigos ainda não foi configurado no Supabase: rode o supabase/schema.sql atualizado (veja SUPABASE.md).')
  if (/muitos pedidos/i.test(msg)) return t('Você tem pedidos de amizade pendentes demais. Aguarde respostas ou cancele alguns.')
  if (/só é possível convidar amigos/i.test(msg)) return t('Só é possível convidar amigos.')
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return t('Sem conexão com o servidor de contas. Verifique sua internet.')
  return msg
}

/** Liga presença e avisos para a conta logada (chamado no login e ao abrir o app). */
export async function startSocial(userId: string | null): Promise<void> {
  if (userId === myId) return
  await stopSocial()
  if (!userId || !authConfigured()) return
  myId = userId
  const sb = supabaseClient()

  presence = sb.channel('kard-presence', { config: { presence: { key: userId } } })
  presence.on('presence', { event: 'sync' }, () => {
    onlineAll = new Set(Object.keys(presence?.presenceState() ?? {}))
    emit('social:online', onlineFriends())
  })
  presence.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') await presence?.track({ userId })
  })

  const changed = () => emit('social:changed', null)
  changes = sb
    .channel(`kard-social-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `addressee=eq.${userId}` }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `requester=eq.${userId}` }, changed)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `to_user=eq.${userId}` }, (payload) => {
      const r = payload.new as { id: number; from_user: string; room_code: string; created_at: string }
      emit('social:invite', { id: r.id, fromUser: r.from_user, roomCode: r.room_code, createdAt: r.created_at } satisfies GameInvite)
    })
    .subscribe()

  // exclusões não chegam filtradas pelo Realtime: confere a lista de tempos em tempos
  refreshTimer = setInterval(changed, 90_000)
}

export async function stopSocial(): Promise<void> {
  myId = null
  onlineAll = new Set()
  friendIds = new Set()
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  const sb = authConfigured() ? supabaseClient() : null
  for (const ch of [presence, changes]) {
    if (!ch || !sb) continue
    try {
      await sb.removeChannel(ch)
    } catch {
      /* já desconectado */
    }
  }
  presence = null
  changes = null
  emit('social:online', [])
}

interface FriendRow {
  requester: string
  addressee: string
  status: 'pending' | 'accepted'
  created_at: string
}

export async function listFriends(): Promise<FriendsState> {
  const empty: FriendsState = { friends: [], incoming: [], outgoing: [], online: [] }
  if (!myId) return { ...empty, error: t('Você não está conectado.') }
  const me = myId
  const { data, error } = await supabaseClient().from('friendships').select('requester, addressee, status, created_at')
  if (error) return { ...empty, error: errorText(error.message) }
  const rows = (data ?? []) as FriendRow[]
  const others = rows.map((r) => (r.requester === me ? r.addressee : r.requester))
  const profiles = new Map<string, Awaited<ReturnType<typeof getPublicProfiles>>[number]>()
  for (let i = 0; i < others.length; i += 8) for (const p of await getPublicProfiles(others.slice(i, i + 8))) profiles.set(p.userId, p)
  const entry = (r: FriendRow): FriendEntry | null => {
    const other = r.requester === me ? r.addressee : r.requester
    const profile = profiles.get(other)
    return profile ? { userId: other, since: r.created_at, profile } : null
  }
  const state: FriendsState = {
    friends: rows.filter((r) => r.status === 'accepted').map(entry).filter(Boolean) as FriendEntry[],
    incoming: rows.filter((r) => r.status === 'pending' && r.addressee === me).map(entry).filter(Boolean) as FriendEntry[],
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester === me).map(entry).filter(Boolean) as FriendEntry[],
    online: []
  }
  friendIds = new Set(state.friends.map((f) => f.userId))
  state.online = onlineFriends()
  return state
}

export async function searchUsers(q: string): Promise<{ results: UserSearchResult[]; error?: string }> {
  if (!myId) return { results: [], error: t('Você não está conectado.') }
  const term = String(q ?? '').trim().slice(0, 40)
  if (term.length < 2) return { results: [] }
  const { data, error } = await supabaseClient().rpc('search_users', { q: term })
  if (error) return { results: [], error: errorText(error.message) }
  return {
    results: ((data ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]).map((r) => ({
      userId: r.id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url
    }))
  }
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<SocialResult> {
  if (!myId) return { ok: false, error: t('Você não está conectado.') }
  const { data, error } = await supabaseClient().rpc(fn, args)
  if (error) return { ok: false, error: errorText(error.message) }
  return { ok: true, status: typeof data === 'string' ? data : undefined }
}

export const sendFriendRequest = (userId: string) => rpc('send_friend_request', { target: userId })
export const respondFriendRequest = (userId: string, accept: boolean) => rpc('respond_friend_request', { other: userId, accept: Boolean(accept) })
export const removeFriend = (userId: string) => rpc('remove_friend', { other: userId })
export const inviteFriend = (userId: string, code: string) => rpc('invite_friend', { target: userId, code: String(code ?? '').toUpperCase() })
export const dismissInvite = (id: number) => rpc('dismiss_invite', { invite_id: Number(id) })

/** Convites recebidos nos últimos 15 minutos (para quem abriu o app depois do convite). */
export async function pendingInvites(): Promise<GameInvite[]> {
  if (!myId) return []
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data, error } = await supabaseClient()
    .from('game_invites')
    .select('id, from_user, room_code, created_at')
    .eq('to_user', myId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) return []
  return ((data ?? []) as { id: number; from_user: string; room_code: string; created_at: string }[]).map((r) => ({ id: r.id, fromUser: r.from_user, roomCode: r.room_code, createdAt: r.created_at }))
}
