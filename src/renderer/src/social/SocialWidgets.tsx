// Peças do sistema de amigos usadas em outras telas: avisos de convite e "Convidar amigos" no lobby.
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { Avatar } from '../auth/ProfileModal'
import { loadProfiles, useProfiles } from '../online/profiles'
import { useSocial } from './socialStore'

/** Convites recebidos: cartões no canto da tela com "Entrar" e "Recusar". */
export function InviteToasts() {
  const invites = useSocial((s) => s.invites)
  const accept = useSocial((s) => s.acceptInvite)
  const dismiss = useSocial((s) => s.dismissInvite)
  const profiles = useProfiles((s) => s.map)
  useEffect(() => {
    loadProfiles(invites.map((i) => i.fromUser))
  }, [invites])
  if (!invites.length) return null
  return (
    <div className="invite-toasts">
      {invites.map((inv) => {
        const p = profiles[inv.fromUser]
        const name = p?.displayName || p?.username || t('Um amigo')
        return (
          <div key={inv.id} className="invite-toast">
            <Avatar url={p?.avatarUrl ?? null} name={name} size={40} />
            <div className="col grow" style={{ gap: 2 }}>
              <b>{t('{name} convidou você para uma partida', { name })}</b>
              <span className="small muted">{t('Mesa {code}', { code: inv.roomCode })}</span>
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                <button className="btn sm primary" onClick={() => void accept(inv)}>
                  {t('Entrar na mesa')}
                </button>
                <button className="btn sm" onClick={() => dismiss(inv)}>
                  {t('Recusar')}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Lobby da mesa: lista os amigos (online primeiro) com o botão "Convidar". */
export function InviteFriendsPanel({ roomCode, seatedIds, full }: { roomCode: string; seatedIds: string[]; full: boolean }) {
  const friends = useSocial((s) => s.friends)
  const online = useSocial((s) => s.online)
  const loaded = useSocial((s) => s.loaded)
  const toast = useApp((s) => s.toast)
  const go = useApp((s) => s.go)
  const view = useProfiles((s) => s.view)
  const [sent, setSent] = useState<Record<string, boolean>>({})
  useEffect(() => {
    void useSocial.getState().refresh()
  }, [])
  const onlineSet = new Set(online)
  const list = friends
    .filter((f) => !seatedIds.includes(f.userId))
    .sort((a, b) => Number(onlineSet.has(b.userId)) - Number(onlineSet.has(a.userId)))
  const invite = async (id: string, name: string) => {
    const r = await window.kard.social.invite(id, roomCode)
    if (!r.ok) {
      toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
      return
    }
    setSent((s) => ({ ...s, [id]: true }))
    toast(t('Convite enviado para {name}.', { name }), 'success')
  }
  return (
    <div className="panel">
      <h3>
        {t('Convidar amigos')} <span className="muted small">({t('{n} online', { n: list.filter((f) => onlineSet.has(f.userId)).length })})</span>
      </h3>
      {loaded && !friends.length && (
        <div className="small muted">
          {t('Você ainda não tem amigos adicionados.')}{' '}
          <button className="link-btn" onClick={() => go('friends')}>
            {t('Adicionar amigos')}
          </button>
        </div>
      )}
      {full && list.length > 0 && <div className="small muted" style={{ marginBottom: 6 }}>{t('A mesa está cheia.')}</div>}
      <div className="col" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
        {list.map((f) => {
          const name = f.profile.displayName || f.profile.username || '?'
          const on = onlineSet.has(f.userId)
          return (
            <div key={f.userId} className="friend-row">
              <button className="avatar-btn" title={t('Ver perfil')} onClick={() => view(f.userId)}>
                <Avatar url={f.profile.avatarUrl} name={name} size={28} />
              </button>
              <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className={`presence-dot ${on ? 'on' : ''}`} style={{ display: 'inline-block', marginRight: 6 }} />
                {name}
              </span>
              <button className="btn sm primary" disabled={full || sent[f.userId]} onClick={() => void invite(f.userId, name)}>
                {sent[f.userId] ? t('Convidado') : `✉ ${t('Convidar')}`}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
