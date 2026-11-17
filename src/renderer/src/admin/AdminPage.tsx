// Painel administrativo (só para administradores): visão geral, contas (banir, nomear admin, zerar IA),
// aviso para todos os jogadores, limite diário da IA e o registro do que cada admin fez.
// O que aparece aqui é conferido de novo no servidor (funções admin_* do Supabase).
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import type { AdminLogEntry, AdminStats, AdminUser, Announcement } from '@shared/types'
import { t } from '@shared/i18n'
import { Modal } from '../components/common'
import { useApp } from '../store'
import { useAuth } from '../auth/authStore'
import { Avatar } from '../auth/ProfileModal'
import { useAdminIds } from './adminIds'

export { useAdminIds }

type Tab = 'overview' | 'users' | 'settings' | 'log'

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

export default function AdminPage() {
  const user = useAuth((s) => s.user)
  const [tab, setTab] = useState<Tab>('overview')
  if (!user?.isAdmin) {
    return (
      <div className="page">
        <h1>{t('Administração')}</h1>
        <div className="panel muted">{t('Esta área é exclusiva para administradores.')}</div>
      </div>
    )
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('Visão geral') },
    { id: 'users', label: t('Contas') },
    { id: 'settings', label: t('Avisos e IA') },
    { id: 'log', label: t('Registro') }
  ]
  return (
    <div className="page admin-page" style={{ maxWidth: 1200 }}>
      <h1>🛡 {t('Administração')}</h1>
      <div className="sub">{t('Área exclusiva para administradores. Toda ação fica registrada.')}</div>
      <div className="tabs" style={{ marginBottom: 14 }}>
        {tabs.map((x) => (
          <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'log' && <LogTab />}
    </div>
  )
}

// ---------------- visão geral ----------------

function Overview() {
  const [s, setS] = useState<AdminStats | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    void window.kard.admin.stats().then((r) => (r.ok ? (setS(r.data!), setErr(null)) : setErr(r.error ?? null)))
  }, [])
  useEffect(load, [load])
  if (err) return <div className="panel error-text">{err}</div>
  if (!s) return <div className="muted">{t('Carregando...')}</div>
  const tiles: { label: string; value: string | number; hint?: string }[] = [
    { label: t('Contas'), value: s.users },
    { label: t('Novas (7 dias)'), value: s.new7d },
    { label: t('Entraram (7 dias)'), value: s.active7d },
    { label: t('Amizades'), value: s.friendships },
    { label: t('Administradores'), value: s.admins },
    { label: t('Suspensas'), value: s.banned },
    { label: t('Consultas à IA hoje'), value: s.aiToday, hint: t('{n} jogador(es)', { n: s.aiUsersToday }) },
    { label: t('Consultas à IA (7 dias)'), value: s.ai7d },
    { label: t('Limite diário da IA'), value: s.aiLimit ?? t('padrão'), hint: t('por jogador') }
  ]
  return (
    <>
      <div className="admin-tiles">
        {tiles.map((x) => (
          <div key={x.label} className="admin-tile">
            <div className="small muted">{x.label}</div>
            <div className="admin-tile-value">{x.value}</div>
            {x.hint && <div className="small muted">{x.hint}</div>}
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>
        {t('O plano gratuito do Groq aceita cerca de 1000 consultas por dia somando todos os jogadores.')}{' '}
        <button className="btn xs" onClick={load}>
          ↻ {t('Atualizar')}
        </button>
      </div>
    </>
  )
}

// ---------------- contas ----------------

function Users() {
  const me = useAuth((s) => s.user)
  const toast = useApp((s) => s.toast)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'recent' | 'active' | 'ai'>('recent')
  const [list, setList] = useState<AdminUser[]>([])
  const [offset, setOffset] = useState(0)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [banning, setBanning] = useState<AdminUser | null>(null)

  const load = useCallback(
    async (off = 0) => {
      setLoading(true)
      const r = await window.kard.admin.users(q, sort, off)
      setLoading(false)
      if (!r.ok) return toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
      const rows = r.data ?? []
      setList((cur) => (off ? [...cur, ...rows] : rows))
      setOffset(off + rows.length)
      setMore(rows.length === 50)
    },
    [q, sort, toast]
  )
  useEffect(() => {
    const timer = setTimeout(() => void load(0), 250)
    return () => clearTimeout(timer)
  }, [load])

  const run = async (p: Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    const r = await p
    if (!r.ok) return toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
    toast(okMsg, 'success')
    useAdminIds.getState().load()
    void load(0)
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar por nome, usuário ou e-mail')} style={{ minWidth: 240 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">{t('Mais novas')}</option>
          <option value="active">{t('Entraram por último')}</option>
          <option value="ai">{t('Mais uso da IA hoje')}</option>
        </select>
      </div>
      <div className="admin-users">
        <table>
          <thead>
            <tr>
              <th>{t('Jogador')}</th>
              <th>{t('E-mail')}</th>
              <th>{t('Criada')}</th>
              <th>{t('Último login')}</th>
              <th title={t('Consultas à IA hoje / 7 dias')}>{t('IA')}</th>
              <th>{t('Situação')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const name = u.displayName || u.username || '—'
              const self = u.id === me?.id
              return (
                <tr key={u.id} className={u.banned ? 'banned' : ''}>
                  <td>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Avatar url={u.avatarUrl} name={name} size={28} />
                      <div>
                        <b>{name}</b>
                        {u.username && <div className="small muted">@{u.username}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="small">{u.email}</td>
                  <td className="small">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="small">{fmtDate(u.lastSignInAt)}</td>
                  <td className="small">
                    {u.aiToday} / {u.ai7d}
                  </td>
                  <td>
                    {u.isAdmin && <span className="badge admin-badge">🛡 {t('Admin')}</span>}
                    {u.banned && (
                      <span className="badge err" title={u.banReason ?? ''}>
                        {u.banUntil ? t('Suspensa até {date}', { date: new Date(u.banUntil).toLocaleDateString() }) : t('Suspensa')}
                      </span>
                    )}
                    {!u.isAdmin && !u.banned && <span className="small muted">{t('Ativa')}</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {u.banned ? (
                        <button className="btn xs" onClick={() => void run(window.kard.admin.unban(u.id), t('Suspensão removida.'))}>
                          {t('Remover suspensão')}
                        </button>
                      ) : (
                        !u.isAdmin &&
                        !self && (
                          <button className="btn xs danger" onClick={() => setBanning(u)}>
                            {t('Suspender')}
                          </button>
                        )
                      )}
                      {!u.banned &&
                        (u.isAdmin ? (
                          <button
                            className="btn xs"
                            onClick={() => (self ? confirm(t('Tirar o seu próprio cargo de administrador? Você perde o acesso a este painel.')) : confirm(t('Tirar o cargo de administrador de {name}?', { name }))) && void run(window.kard.admin.setAdmin(u.id, false), t('Cargo removido.'))}
                          >
                            {t('Tirar admin')}
                          </button>
                        ) : (
                          <button className="btn xs" onClick={() => confirm(t('Tornar {name} administrador? Ele terá acesso a este painel, inclusive aos e-mails das contas.', { name })) && void run(window.kard.admin.setAdmin(u.id, true), t('{name} agora é administrador.', { name }))}>
                            {t('Tornar admin')}
                          </button>
                        ))}
                      {u.aiToday > 0 && (
                        <button className="btn xs" title={t('Zerar as consultas à IA de hoje')} onClick={() => void run(window.kard.admin.resetAi(u.id), t('Uso da IA de hoje zerado.'))}>
                          {t('Zerar IA')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!list.length && !loading && <div className="muted" style={{ padding: 12 }}>{t('Nenhuma conta encontrada.')}</div>}
      </div>
      {more && (
        <button className="btn" disabled={loading} onClick={() => void load(offset)}>
          {loading ? t('Carregando...') : t('Carregar mais')}
        </button>
      )}
      {banning && <BanDialog user={banning} onClose={() => setBanning(null)} onDone={(p) => void run(p, t('Conta suspensa.'))} />}
    </div>
  )
}

function BanDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (p: Promise<{ ok: boolean; error?: string }>) => void }) {
  const [reason, setReason] = useState('')
  const [days, setDays] = useState<number>(7)
  const name = user.displayName || user.username || user.email
  return (
    <Modal
      title={t('Suspender {name}', { name })}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="btn danger"
            disabled={!reason.trim()}
            onClick={() => {
              onDone(window.kard.admin.ban(user.id, reason.trim(), days || null))
              onClose()
            }}
          >
            {t('Suspender')}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <label className="field">
          {t('Motivo (o jogador vê esta mensagem)')}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} autoFocus />
        </label>
        <label className="field">
          {t('Duração')}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>{t('1 dia')}</option>
            <option value={7}>{t('7 dias')}</option>
            <option value={30}>{t('30 dias')}</option>
            <option value={0}>{t('Permanente')}</option>
          </select>
        </label>
        <div className="small muted">{t('A conta suspensa não usa a IA, não joga online, não aparece na busca e não pede amizade nem convida amigos.')}</div>
      </div>
    </Modal>
  )
}

// ---------------- avisos e IA ----------------

function SettingsTab() {
  const toast = useApp((s) => s.toast)
  const [ann, setAnn] = useState<Announcement>({ text: '', level: 'info' })
  const [limit, setLimit] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void Promise.all([window.kard.admin.announcement(), window.kard.admin.stats()]).then(([a, s]) => {
      if (a) setAnn(a)
      if (s.ok && s.data?.aiLimit !== null && s.data?.aiLimit !== undefined) setLimit(String(s.data.aiLimit))
      setLoaded(true)
    })
  }, [])
  if (!loaded) return <div className="muted">{t('Carregando...')}</div>
  const saveAnn = async (a: Announcement | null) => {
    const r = await window.kard.admin.setAnnouncement(a)
    if (!r.ok) return toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
    if (!a) setAnn({ text: '', level: 'info' })
    toast(a ? t('Aviso publicado para todos os jogadores.') : t('Aviso removido.'), 'success')
    void useAnnouncement.getState().load()
  }
  const saveLimit = async (v: number | null) => {
    const r = await window.kard.admin.setAiLimit(v)
    if (!r.ok) return toast(r.error ?? t('Algo deu errado. Tente de novo.'), 'error')
    if (v === null) setLimit('')
    toast(t('Limite da IA salvo.'), 'success')
  }
  return (
    <div className="col" style={{ gap: 16, maxWidth: 760 }}>
      <div className="panel">
        <h3>{t('Aviso para todos os jogadores')}</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          {t('Aparece no topo do app de todo mundo (novidades, manutenção, eventos). Cada jogador pode fechar; um aviso novo aparece de novo.')}
        </div>
        <textarea value={ann.text} onChange={(e) => setAnn({ ...ann, text: e.target.value })} maxLength={600} rows={3} style={{ width: '100%' }} placeholder={t('Ex.: Manutenção hoje às 22h. O jogo online pode cair por alguns minutos.')} />
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="check">
            <input type="radio" checked={ann.level === 'info'} onChange={() => setAnn({ ...ann, level: 'info' })} /> ℹ {t('Informação')}
          </label>
          <label className="check">
            <input type="radio" checked={ann.level === 'warning'} onChange={() => setAnn({ ...ann, level: 'warning' })} /> ⚠ {t('Alerta')}
          </label>
          <div className="grow" />
          <span className="small muted">{ann.text.length}/600</span>
          <button className="btn" onClick={() => void saveAnn(null)}>
            {t('Remover aviso')}
          </button>
          <button className="btn primary" disabled={!ann.text.trim()} onClick={() => void saveAnn(ann)}>
            {t('Publicar')}
          </button>
        </div>
      </div>
      <div className="panel">
        <h3>{t('Limite diário da IA por jogador')}</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          {t('Consultas ao Juiz IA e ao bot que cada jogador pode fazer por dia. Vazio = o padrão da Edge Function (AI_DAILY_LIMIT). 0 = IA desligada para todos.')}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="number" min={0} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} placeholder={t('padrão')} />
          <button className="btn primary" onClick={() => void saveLimit(limit.trim() === '' ? null : Number(limit))}>
            {t('Salvar')}
          </button>
          <button className="btn" onClick={() => void saveLimit(null)}>
            {t('Voltar ao padrão')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- registro ----------------

const ACTIONS: Record<string, string> = {
  ban: 'suspendeu',
  unban: 'removeu a suspensão de',
  admin_add: 'tornou administrador',
  admin_remove: 'tirou o cargo de administrador de',
  ai_reset: 'zerou a IA de hoje de',
  config: 'alterou a configuração'
}

function LogTab() {
  const [list, setList] = useState<AdminLogEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void window.kard.admin.log().then((r) => (r.ok ? setList(r.data ?? []) : setErr(r.error ?? null)))
  }, [])
  if (err) return <div className="panel error-text">{err}</div>
  if (!list) return <div className="muted">{t('Carregando...')}</div>
  if (!list.length) return <div className="panel muted">{t('Nenhuma ação registrada ainda.')}</div>
  const detail = (l: AdminLogEntry) => {
    const d = l.details ?? {}
    if (l.action === 'ban') return `${d.reason ? `“${String(d.reason)}”` : ''} ${d.days ? t('({n} dias)', { n: String(d.days) }) : t('(permanente)')}`
    if (l.action === 'config') return d.key === 'announcement' ? t('aviso: {text}', { text: (d.value as { text?: string } | null)?.text ?? t('removido') }) : t('limite da IA: {n}', { n: d.value === null ? t('padrão') : String(d.value) })
    return ''
  }
  return (
    <div className="admin-log">
      {list.map((l) => (
        <div key={l.id} className="admin-log-row">
          <span className="small muted">{fmtDate(l.createdAt)}</span>
          <span>
            <b>{l.adminName}</b> {t(ACTIONS[l.action] ?? l.action)} {l.targetName && <b>{l.targetName}</b>} <span className="small muted">{detail(l)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------- aviso para todos (faixa no topo do app) ----------------

export const useAnnouncement = create<{ a: Announcement | null; load: () => Promise<void> }>((set) => ({
  a: null,
  load: async () => {
    try {
      set({ a: (await window.kard.admin?.announcement()) ?? null })
    } catch {
      /* sem conexão */
    }
  }
}))

function dismissedKey(a: Announcement): string {
  return `kard-ann-${a.updatedAt ?? a.text.slice(0, 40)}`
}

export function AnnouncementBanner() {
  const a = useAnnouncement((s) => s.a)
  const [, force] = useState(0)
  useEffect(() => {
    void useAnnouncement.getState().load()
    // confere de tempos em tempos (avisos de manutenção chegam sem reiniciar o app)
    const timer = setInterval(() => void useAnnouncement.getState().load(), 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])
  if (!a) return null
  let dismissed = false
  try {
    dismissed = localStorage.getItem(dismissedKey(a)) === '1'
  } catch {
    /* armazenamento indisponível */
  }
  if (dismissed) return null
  return (
    <div className={`app-announcement ${a.level}`}>
      <span>{a.level === 'warning' ? '⚠' : '📣'}</span>
      <span className="grow" style={{ whiteSpace: 'pre-wrap' }}>
        {a.text}
      </span>
      <button
        className="btn xs ghost"
        onClick={() => {
          try {
            localStorage.setItem(dismissedKey(a), '1')
          } catch {
            /* armazenamento indisponível */
          }
          force((n) => n + 1)
        }}
        title={t('Fechar')}
      >
        ✕
      </button>
    </div>
  )
}

// ---------------- conta suspensa ----------------

export function BannedBanner() {
  const user = useAuth((s) => s.user)
  if (!user?.banned) return null
  return (
    <div className="app-announcement warning">
      <span>⛔</span>
      <span className="grow">
        <b>{user.banUntil ? t('Sua conta está suspensa até {date}.', { date: new Date(user.banUntil).toLocaleString() }) : t('Sua conta está suspensa.')}</b>{' '}
        {user.banReason && <>{t('Motivo: {reason}', { reason: user.banReason })} </>}
        {t('O jogo online, os amigos e a IA ficam indisponíveis; o resto do app continua funcionando.')}
      </span>
    </div>
  )
}
