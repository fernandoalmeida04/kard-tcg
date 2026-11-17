// Botão flutuante de amigos (canto inferior direito): abre um mini menu com pedidos, amigos online,
// convite rápido para a mesa atual e busca para adicionar amigos.
import { useEffect, useRef, useState } from 'react'
import type { FriendEntry, UserSearchResult } from '@shared/types'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { useAuth } from '../auth/authStore'
import { Avatar } from '../auth/ProfileModal'
import { loadProfiles, useProfiles } from '../online/profiles'
import { useOnline } from '../online/onlineStore'
import { useSocial } from './socialStore'

/** Busca de jogadores enquanto digita (mínimo 2 letras, com pequena espera). */
export function useUserSearch(q: string): { results: UserSearchResult[] | null; error: string | null } {
  const [results, setResults] = useState<UserSearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults(null)
      setError(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void window.kard.social.search(term).then((r) => {
        if (!alive) return
        setResults(r.results)
        setError(r.error ?? null)
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])
  return { results, error }
}

const nameOf = (p: { displayName?: string | null; username?: string | null }) => p.displayName || p.username || '?'

export function FriendsDock() {
  const user = useAuth((s) => s.user)
  const openAuth = useAuth((s) => s.open)
  const s = useSocial()
  const go = useApp((x) => x.go)
  const toast = useApp((x) => x.toast)
  const view = useProfiles((x) => x.view)
  const room = useOnline((x) => (x.phase === 'lobby' && x.config ? x.config.code : null))
  // (zustand 5: o seletor precisa devolver sempre a mesma referência; criar uma lista nova aqui
  // causaria um laço infinito de renderização)
  const players = useOnline((x) => x.players)
  const seated = players.map((p) => p.userId)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showOffline, setShowOffline] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [invited, setInvited] = useState<Record<string, boolean>>({})
  const { results, error } = useUserSearch(adding ? q : '')
  const ref = useRef<HTMLDivElement>(null)

  // fecha clicando fora ou com Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) void useSocial.getState().refresh()
    else {
      setAdding(false)
      setQ('')
    }
  }, [open])

  // convites já enviados valem só para a mesa atual
  useEffect(() => setInvited({}), [room])

  const onlineSet = new Set(s.online)
  const online = s.friends.filter((f) => onlineSet.has(f.userId)).sort((a, b) => nameOf(a.profile).localeCompare(nameOf(b.profile)))
  const offline = s.friends.filter((f) => !onlineSet.has(f.userId)).sort((a, b) => nameOf(a.profile).localeCompare(nameOf(b.profile)))

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; status?: string }>, success?: (st?: string) => string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
    else if (success) toast(success(r.status), 'success')
    await useSocial.getState().refresh()
    return r.ok
  }

  const profile = (id: string) => {
    loadProfiles([id])
    view(id)
  }

  const Row = ({ f, children }: { f: FriendEntry; children?: React.ReactNode }) => (
    <div className="dock-row">
      <button className="avatar-btn" title={t('Ver perfil')} onClick={() => profile(f.userId)}>
        <Avatar url={f.profile.avatarUrl} name={nameOf(f.profile)} size={28} />
      </button>
      <span className="grow friend-name" onClick={() => profile(f.userId)}>
        {nameOf(f.profile)}
      </span>
      {children}
    </div>
  )

  const InviteBtn = ({ f }: { f: FriendEntry }) =>
    room && !seated.includes(f.userId) ? (
      <button
        className="btn xs primary"
        disabled={busy || invited[f.userId]}
        title={t('Convidar para a mesa {code}', { code: room })}
        onClick={() =>
          void run(() => window.kard.social.invite(f.userId, room), () => t('Convite enviado para {name}.', { name: nameOf(f.profile) })).then((ok) => ok && setInvited((x) => ({ ...x, [f.userId]: true })))
        }
      >
        {invited[f.userId] ? '✓' : '✉'}
      </button>
    ) : null

  const relation = (id: string) =>
    s.friends.some((f) => f.userId === id) ? 'friend' : s.incoming.some((f) => f.userId === id) ? 'incoming' : s.outgoing.some((f) => f.userId === id) ? 'outgoing' : null

  return (
    <div className="friends-dock" ref={ref}>
      {open && (
        <div className="dock-panel">
          <div className="dock-head">
            <b>{t('Amigos')}</b>
            {user && <span className="small muted">{t('{n} online', { n: online.length })}</span>}
            <span className="grow" />
            {user && (
              <button
                className="link-btn small"
                onClick={() => {
                  setOpen(false)
                  go('friends')
                }}
              >
                {t('Ver tudo')}
              </button>
            )}
            <button className="icon-btn" onClick={() => setOpen(false)} title={t('Fechar')}>
              ✕
            </button>
          </div>

          {!user ? (
            <div className="dock-body">
              <div className="small muted" style={{ marginBottom: 8 }}>
                {t('Entre na sua conta para adicionar amigos e convidá-los para partidas.')}
              </div>
              <button className="btn sm primary" onClick={() => openAuth('login')}>
                {t('Entrar / Cadastre-se')}
              </button>
            </div>
          ) : (
            <div className="dock-body">
              {s.error && <div className="small err">{s.error}</div>}
              {room && <div className="small muted dock-hint">{t('Mesa {code}: clique em ✉ para convidar.', { code: room })}</div>}

              {s.incoming.length > 0 && (
                <div className="dock-section">
                  <div className="dock-title">
                    {t('Pedidos de amizade')} <span className="badge warn">{s.incoming.length}</span>
                  </div>
                  {s.incoming.map((f) => (
                    <Row key={f.userId} f={f}>
                      <button className="btn xs success" disabled={busy} title={t('Aceitar')} onClick={() => void run(() => window.kard.social.respond(f.userId, true), () => t('Agora vocês são amigos!'))}>
                        ✓
                      </button>
                      <button className="btn xs" disabled={busy} title={t('Recusar')} onClick={() => void run(() => window.kard.social.respond(f.userId, false))}>
                        ✕
                      </button>
                    </Row>
                  ))}
                </div>
              )}

              <div className="dock-section">
                <div className="dock-title">{t('Online')}</div>
                {!s.loaded && !s.error && <div className="small muted">{t('Carregando...')}</div>}
                {s.loaded && !online.length && <div className="small muted">{s.friends.length ? t('Nenhum amigo online agora.') : t('Você ainda não tem amigos adicionados.')}</div>}
                {online.map((f) => (
                  <Row key={f.userId} f={f}>
                    <span className="presence-dot on" />
                    <InviteBtn f={f} />
                  </Row>
                ))}
              </div>

              {offline.length > 0 && (
                <div className="dock-section">
                  <button className="dock-title link-like" onClick={() => setShowOffline((v) => !v)}>
                    {showOffline ? '▾' : '▸'} {t('Offline ({n})', { n: offline.length })}
                  </button>
                  {showOffline &&
                    offline.map((f) => (
                      <Row key={f.userId} f={f}>
                        <InviteBtn f={f} />
                      </Row>
                    ))}
                </div>
              )}

              <div className="dock-section">
                {!adding ? (
                  <button className="btn sm" style={{ width: '100%' }} onClick={() => setAdding(true)}>
                    + {t('Adicionar amigo')}
                  </button>
                ) : (
                  <>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Nome de usuário ou de exibição...')} autoFocus style={{ width: '100%' }} />
                    {error && <div className="small err">{error}</div>}
                    {results && !results.length && !error && <div className="small muted">{t('Nenhum jogador encontrado.')}</div>}
                    {results?.slice(0, 6).map((r) => {
                      const rel = relation(r.userId)
                      return (
                        <div key={r.userId} className="dock-row">
                          <button className="avatar-btn" onClick={() => profile(r.userId)} title={t('Ver perfil')}>
                            <Avatar url={r.avatarUrl} name={r.displayName || r.username} size={26} />
                          </button>
                          <span className="grow friend-name" onClick={() => profile(r.userId)}>
                            {r.displayName || r.username}
                            {r.displayName && <span className="muted small"> @{r.username}</span>}
                          </span>
                          {rel === 'friend' ? (
                            <span className="badge ok">{t('Amigo')}</span>
                          ) : rel === 'outgoing' ? (
                            <span className="badge">{t('Pedido enviado')}</span>
                          ) : (
                            <button
                              className="btn xs primary"
                              disabled={busy}
                              title={rel === 'incoming' ? t('Aceitar') : t('Adicionar')}
                              onClick={() =>
                                void run(() => window.kard.social.request(r.userId), (st) =>
                                  st === 'accepted' ? t('Agora vocês são amigos!') : st === 'already' ? t('Vocês já são amigos (ou o pedido já foi enviado).') : t('Pedido de amizade enviado para {name}.', { name: r.displayName || r.username })
                                )
                              }
                            >
                              {rel === 'incoming' ? '✓' : '+'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <button className={`dock-fab ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} title={t('Amigos')} aria-label={t('Amigos')}>
        <span className="dock-fab-ico">👥</span>
        {user && (
          <span className="dock-fab-count">
            <span className={`presence-dot ${online.length ? 'on' : ''}`} />
            {online.length}
          </span>
        )}
        {s.incoming.length > 0 && <span className="dock-fab-alert">{s.incoming.length}</span>}
      </button>
    </div>
  )
}
