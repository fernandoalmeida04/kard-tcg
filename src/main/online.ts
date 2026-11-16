// Repetidor de mensagens das mesas online (Supabase Realtime: canais de broadcast + presença).
// O processo principal só entra/sai do canal e repassa mensagens; a lógica da mesa fica na interface.
import type { BrowserWindow } from 'electron'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { OnlinePresence } from '../shared/online/protocol'
import { t } from '../shared/i18n/index.ts'
import { currentUser, supabaseClient } from './auth'

let channel: RealtimeChannel | null = null
let win: BrowserWindow | null = null

export function initOnline(window: BrowserWindow): void {
  win = window
}

function emit(event: string, payload: unknown): void {
  win?.webContents.send(event, payload)
}

/** Entra no canal da mesa. Resolve quando a inscrição foi confirmada pelo servidor. */
export async function joinRoomChannel(code: string): Promise<{ ok: boolean; error?: string; userId?: string }> {
  await leaveRoomChannel()
  const user = await currentUser()
  if (!user) return { ok: false, error: t('Entre na sua conta para jogar online.') }
  const sb = supabaseClient()
  const ch = sb.channel(`kard-room-${code.toUpperCase()}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: user.id } }
  })
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => emit('online:msg', payload))
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState<OnlinePresence>()
    const online = Object.values(state)
      .flat()
      .map((p) => ({ userId: p.userId, username: p.username }))
    emit('online:presence', online)
  })
  channel = ch
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { ok: boolean; error?: string; userId?: string }) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    ch.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ userId: user.id, username: user.username ?? user.email })
        emit('online:status', 'connected')
        done({ ok: true, userId: user.id })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        emit('online:status', 'error')
        done({ ok: false, error: err?.message ?? t('Não foi possível conectar à mesa. Verifique sua internet.') })
      } else if (status === 'CLOSED') {
        emit('online:status', 'closed')
      }
    })
    setTimeout(() => done({ ok: false, error: t('Tempo esgotado ao conectar à mesa.') }), 15000)
  })
}

export async function sendRoomMessage(payload: unknown): Promise<boolean> {
  if (!channel) return false
  const r = await channel.send({ type: 'broadcast', event: 'msg', payload })
  return r === 'ok'
}

export async function leaveRoomChannel(): Promise<void> {
  if (!channel) return
  const ch = channel
  channel = null
  try {
    await ch.untrack()
  } catch {
    /* já desconectado */
  }
  await supabaseClient().removeChannel(ch)
}
