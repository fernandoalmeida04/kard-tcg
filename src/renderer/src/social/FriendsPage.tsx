// Página "Amigos": procurar jogadores, pedidos de amizade, lista de amigos (online primeiro) e convites.
import { useEffect, useState } from 'react'
import type { FriendEntry } from '@shared/types'
import { tcgProfileDef } from '@shared/profileFields'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { useAuth } from '../auth/authStore'
import { Avatar } from '../auth/ProfileModal'
import { useProfiles, loadProfiles } from '../online/profiles'
import { useOnline } from '../online/onlineStore'
import { useSocial } from './socialStore'
import { useUserSearch } from './FriendsDock'

function displayName(p: { displayName?: string | null; username?: string | null }): string {
  return p.displayName || p.username || '?'
}

export default function FriendsPage() {
  const user = useAuth((s) => s.user)
  const openAuth = useAuth((s) => s.open)
  const s = useSocial()
  const toast = useApp((x) => x.toast)
  const view = useProfiles((x) => x.view)
  const room = useOnline((x) => (x.phase === 'lobby' && x.config ? x.config.code : null))
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void useSocial.getState().refresh()
  }, [])

  const { results, error: searchError } = useUserSearch(q)

  if (!user) {
    return (
      <div className="page">
        <h1>{t('Amigos')}</h1>
        <div className="panel">
          <p>{t('Entre na sua conta para adicionar amigos e convidá-los para partidas.')}</p>
          <button className="btn primary" onClick={() => openAuth('login')}>
            {t('Entrar / Cadastre-se')}
          </button>
        </div>
      </div>
    )
  }

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; status?: string }>, success?: (status?: string) => string) => {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (!r.ok) toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
    else if (success) toast(success(r.status), 'success')
    await useSocial.getState().refresh()
  }

  const relation = (id: string): 'friend' | 'incoming' | 'outgoing' | null =>
    s.friends.some((f) => f.userId === id) ? 'friend' : s.incoming.some((f) => f.userId === id) ? 'incoming' : s.outgoing.some((f) => f.userId === id) ? 'outgoing' : null

  const onlineSet = new Set(s.online)
  const friends = [...s.friends].sort((a, b) => Number(onlineSet.has(b.userId)) - Number(onlineSet.has(a.userId)) || displayName(a.profile).localeCompare(displayName(b.profile)))

  const openProfile = (id: string) => {
    loadProfiles([id])
    view(id)
  }

  const Person = ({ f, children }: { f: FriendEntry; children?: React.ReactNode }) => {
    const fav = tcgProfileDef(f.profile.favoriteTcg)
    const on = onlineSet.has(f.userId)
    return (
      <div className="friend-row">
        <button className="avatar-btn" title={t('Ver perfil')} onClick={() => openProfile(f.userId)}>
          <Avatar url={f.profile.avatarUrl} name={displayName(f.profile)} size={36} />
        </button>
        <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
          <span className="friend-name" onClick={() => openProfile(f.userId)}>
            {displayName(f.profile)}
            {f.profile.displayName && f.profile.username && <span className="muted small"> @{f.profile.username}</span>}
          </span>
          <span className="small muted">
            {s.friends.includes(f) && (
              <>
                <span className={`presence-dot ${on ? 'on' : ''}`} style={{ display: 'inline-block', marginRight: 5 }} />
                {on ? t('Online') : t('Offline')}
                {fav ? ` · ${fav.name}` : ''}
              </>
            )}
          </span>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="page">
      <h1>{t('Amigos')}</h1>
      <div className="sub">
        {t('{n} de {total} amigo(s) online', { n: s.online.length, total: s.friends.length })}
        {room && ` · ${t('Você está na mesa {code}: convide amigos online com o botão "Convidar".', { code: room })}`}
      </div>
      {s.error && <div className="panel err small" style={{ marginBottom: 12 }}>{s.error}</div>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div className="col grow" style={{ gap: 16, minWidth: 320 }}>
          {s.incoming.length > 0 && (
            <div className="panel">
              <h3>
                {t('Pedidos de amizade')} <span className="badge warn">{s.incoming.length}</span>
              </h3>
              <div className="col" style={{ gap: 4 }}>
                {s.incoming.map((f) => (
                  <Person key={f.userId} f={f}>
                    <button className="btn sm success" disabled={busy !== null} onClick={() => void act(`acc-${f.userId}`, () => window.kard.social.respond(f.userId, true), () => t('Agora vocês são amigos!'))}>
                      ✓ {t('Aceitar')}
                    </button>
                    <button className="btn sm" disabled={busy !== null} onClick={() => void act(`rej-${f.userId}`, () => window.kard.social.respond(f.userId, false))}>
                      {t('Recusar')}
                    </button>
                  </Person>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>{t('Meus amigos')}</h3>
            {!s.loaded && !s.error && <div className="small muted">{t('Carregando...')}</div>}
            {s.loaded && !friends.length && <div className="small muted">{t('Você ainda não tem amigos adicionados. Procure jogadores pelo nome ao lado.')}</div>}
            <div className="col" style={{ gap: 4 }}>
              {friends.map((f) => (
                <Person key={f.userId} f={f}>
                  {room && (
                    <button
                      className="btn sm primary"
                      disabled={busy !== null}
                      title={onlineSet.has(f.userId) ? undefined : t('O convite fica guardado por 15 minutos se seu amigo abrir o app.')}
                      onClick={() => void act(`inv-${f.userId}`, () => window.kard.social.invite(f.userId, room), () => t('Convite enviado para {name}.', { name: displayName(f.profile) }))}
                    >
                      ✉ {t('Convidar')}
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title={t('Desfazer amizade')}
                    disabled={busy !== null}
                    onClick={() => confirm(t('Desfazer a amizade com {name}?', { name: displayName(f.profile) })) && void act(`rm-${f.userId}`, () => window.kard.social.remove(f.userId))}
                  >
                    ✕
                  </button>
                </Person>
              ))}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16, width: 380, maxWidth: '100%' }}>
          <div className="panel">
            <h3>{t('Adicionar amigo')}</h3>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Nome de usuário ou de exibição...')} style={{ width: '100%' }} autoFocus />
            {searchError && <div className="small err" style={{ marginTop: 8 }}>{searchError}</div>}
            {results && !results.length && !searchError && <div className="small muted" style={{ marginTop: 8 }}>{t('Nenhum jogador encontrado.')}</div>}
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              {results?.map((r) => {
                const rel = relation(r.userId)
                return (
                  <div key={r.userId} className="friend-row">
                    <button className="avatar-btn" title={t('Ver perfil')} onClick={() => openProfile(r.userId)}>
                      <Avatar url={r.avatarUrl} name={r.displayName || r.username} size={32} />
                    </button>
                    <span className="grow friend-name" onClick={() => openProfile(r.userId)}>
                      {r.displayName || r.username}
                      {r.displayName && <span className="muted small"> @{r.username}</span>}
                    </span>
                    {rel === 'friend' ? (
                      <span className="badge ok">{t('Amigo')}</span>
                    ) : rel === 'outgoing' ? (
                      <span className="badge">{t('Pedido enviado')}</span>
                    ) : (
                      <button
                        className="btn sm primary"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`add-${r.userId}`, () => window.kard.social.request(r.userId), (st) =>
                            st === 'accepted' ? t('Agora vocês são amigos!') : st === 'already' ? t('Vocês já são amigos (ou o pedido já foi enviado).') : t('Pedido de amizade enviado para {name}.', { name: r.displayName || r.username })
                          )
                        }
                      >
                        {rel === 'incoming' ? `✓ ${t('Aceitar')}` : `+ ${t('Adicionar')}`}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {s.outgoing.length > 0 && (
            <div className="panel">
              <h3>{t('Pedidos enviados')}</h3>
              <div className="col" style={{ gap: 4 }}>
                {s.outgoing.map((f) => (
                  <Person key={f.userId} f={f}>
                    <button className="btn sm" disabled={busy !== null} onClick={() => void act(`cancel-${f.userId}`, () => window.kard.social.remove(f.userId))}>
                      {t('Cancelar')}
                    </button>
                  </Person>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
