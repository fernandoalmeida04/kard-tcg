// "Meu Perfil": foto e informações da conta (salvas no Supabase), com campos que mudam conforme o
// TCG favorito. Também o cartão de perfil (só leitura) dos outros jogadores.
import { useEffect, useState } from 'react'
import type { AuthUser, ProfileInfo, PublicProfile, TcgId } from '@shared/types'
import { TCG_PROFILE, tcgProfileDef, type ProfileField } from '@shared/profileFields'
import { t } from '@shared/i18n'
import { Modal } from '../components/common'
import { useApp } from '../store'
import { USERNAME_RE, useAuth } from './authStore'
import { useProfiles } from '../online/profiles'
import { AdminBadge } from '../admin/adminIds'

/** Foto do usuário (ou a inicial do nome, sem foto). */
export function Avatar({ user, url, name, size = 24 }: { user?: AuthUser | null; url?: string | null; name?: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const src = url !== undefined ? url : user?.avatarUrl
  const label = name ?? user?.displayName ?? user?.username ?? user?.email ?? '?'
  useEffect(() => setBroken(false), [src])
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.45)) }
  if (src && !broken) return <img className="account-avatar img" src={src} alt="" style={style} onError={() => setBroken(true)} />
  return (
    <span className="account-avatar" style={style}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

const COLOR_NAMES: Record<string, string> = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde' }

/** Um campo específico do TCG (texto, ano, lista ou cores). */
function TcgFieldInput({ f, value, onChange }: { f: ProfileField; value: string | number | undefined; onChange: (v: string | number | undefined) => void }) {
  const year = new Date().getFullYear()
  if (f.kind === 'colors') {
    const cur = String(value ?? '')
    return (
      <div className="field">
        {t(f.label)}
        <div className="row" style={{ gap: 6, height: 34, alignItems: 'center' }}>
          {'WUBRG'.split('').map((c) => {
            const on = cur.includes(c)
            return (
              <button
                key={c}
                type="button"
                className={`color-toggle ${on ? 'on' : ''}`}
                title={t(COLOR_NAMES[c])}
                onClick={() => onChange(on ? cur.replace(c, '') : 'WUBRG'.split('').filter((x) => x === c || cur.includes(x)).join(''))}
              >
                <span className={`pip ${c}`} />
              </button>
            )
          })}
        </div>
      </div>
    )
  }
  if (f.kind === 'select') {
    return (
      <label className="field">
        {t(f.label)}
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{t('(nenhum)')}</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (f.kind === 'year') {
    return (
      <label className="field">
        {t(f.label)}
        <input type="number" min={f.minYear} max={year} value={value ?? ''} placeholder={String(year)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} />
      </label>
    )
  }
  return (
    <label className="field">
      {t(f.label)}
      <input value={String(value ?? '')} maxLength={f.max} placeholder={f.placeholder ? t(f.placeholder) : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Texto de exibição de um campo preenchido (cartão de perfil). */
function fieldText(f: ProfileField, v: string | number): React.ReactNode {
  if (f.kind === 'colors')
    return (
      <span className="row" style={{ gap: 3, display: 'inline-flex' }}>
        {String(v)
          .split('')
          .map((c) => (
            <span key={c} className={`pip ${c}`} title={t(COLOR_NAMES[c] ?? c)} />
          ))}
      </span>
    )
  if (f.kind === 'select') return t(f.options?.find((o) => o.value === v)?.label ?? String(v))
  return String(v)
}

export default function ProfileModal() {
  const open = useAuth((s) => s.profileOpen)
  const setOpen = useAuth((s) => s.setProfileOpen)
  const user = useAuth((s) => s.user)
  if (!open || !user) return null
  return <ProfileForm user={user} onClose={() => setOpen(false)} />
}

function ProfileForm({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const toast = useApp((s) => s.toast)
  const [p, setP] = useState<ProfileInfo | null>(null)
  const [username, setUsername] = useState(user.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null)

  useEffect(() => {
    void window.kard.auth.getProfile().then((r) => {
      if (r.ok && r.profile) {
        setP(r.profile)
        setUsername(r.profile.username ?? user.username ?? '')
      } else setError(r.error ?? t('Algo deu errado. Tente de novo.'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof ProfileInfo>(k: K, v: ProfileInfo[K]) => setP((cur) => (cur ? { ...cur, [k]: v } : cur))
  const setTcgField = (tcg: TcgId, key: string, v: string | number | undefined) =>
    setP((cur) => {
      if (!cur) return cur
      const vals = { ...(cur.tcgInfo[tcg] ?? {}) }
      if (v === undefined || v === '') delete vals[key]
      else vals[key] = v
      return { ...cur, tcgInfo: { ...cur.tcgInfo, [tcg]: vals } }
    })

  const photo = async (remove: boolean) => {
    setBusy('photo')
    setError(null)
    const r = remove ? await window.kard.auth.removeAvatar() : await window.kard.auth.chooseAvatar()
    setBusy(null)
    if (r.canceled) return
    if (!r.ok || !r.profile) {
      setError(r.error ?? t('Algo deu errado. Tente de novo.'))
      return
    }
    setP((cur) => (cur ? { ...cur, avatarUrl: r.profile!.avatarUrl } : r.profile!))
    toast(remove ? t('Foto removida.') : t('Foto de perfil atualizada.'), 'success')
  }

  const save = async () => {
    if (!p) return
    setError(null)
    const name = username.trim()
    const renamed = name !== (user.username ?? '')
    if (renamed && !USERNAME_RE.test(name)) {
      setError(t('O nome de usuário deve ter de 3 a 20 caracteres: letras, números ou _.'))
      return
    }
    setBusy('save')
    if (renamed) {
      const u = await window.kard.auth.setUsername(name)
      if (!u.ok) {
        setBusy(null)
        setError(u.error ?? t('Algo deu errado. Tente de novo.'))
        return
      }
    }
    const r = await window.kard.auth.saveProfile({
      displayName: p.displayName,
      bio: p.bio,
      location: p.location,
      favoriteTcg: p.favoriteTcg,
      tcgInfo: p.tcgInfo
    })
    setBusy(null)
    if (!r.ok) {
      setError(r.error ?? t('Algo deu errado. Tente de novo.'))
      return
    }
    toast(t('Perfil salvo.'), 'success')
    onClose()
  }

  const def = tcgProfileDef(p?.favoriteTcg)
  return (
    <Modal
      title={t('Meu Perfil')}
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn primary" disabled={!p || busy !== null} onClick={() => void save()}>
            {busy === 'save' ? t('Salvando...') : t('Salvar')}
          </button>
        </>
      }
    >
      {error && (
        <div className="small err" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      {!p ? (
        !error && <div className="small muted">{t('Carregando...')}</div>
      ) : (
        <div className="profile-grid">
          <div className="col profile-photo" style={{ gap: 8, alignItems: 'center' }}>
            <Avatar url={p.avatarUrl} name={p.displayName || username || user.email} size={128} />
            <button className="btn sm" disabled={busy !== null} onClick={() => void photo(false)}>
              🖼 {busy === 'photo' ? t('Enviando...') : p.avatarUrl ? t('Trocar foto…') : t('Escolher foto…')}
            </button>
            {p.avatarUrl && (
              <button className="btn sm danger" disabled={busy !== null} onClick={() => void photo(true)}>
                {t('Remover foto')}
              </button>
            )}
            <span className="small muted" style={{ textAlign: 'center' }}>
              {t('A foto é recortada no centro e reduzida para 256×256.')}
            </span>
            {p.memberSince && <span className="small muted">{t('Membro desde {date}', { date: new Date(p.memberSince).toLocaleDateString() })}</span>}
          </div>

          <div className="col" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <label className="field grow">
                {t('Nome de usuário')}
                <input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="field grow">
                {t('Nome de exibição')}
                <input value={p.displayName} maxLength={40} placeholder={t('Como você quer ser chamado')} onChange={(e) => set('displayName', e.target.value)} />
              </label>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <label className="field grow">
                E-mail
                <input value={user.email} disabled />
              </label>
              <label className="field grow">
                {t('Localização')}
                <input value={p.location} maxLength={60} placeholder={t('Cidade, país')} onChange={(e) => set('location', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>
                {t('Sobre você')} <span className="muted small">({p.bio.length}/300)</span>
              </span>
              <textarea value={p.bio} maxLength={300} rows={3} placeholder={t('Seus decks, o que gosta de jogar...')} onChange={(e) => set('bio', e.target.value)} />
            </label>

            <div className="profile-tcg">
              <div className="field">
                {t('TCG favorito')}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {TCG_PROFILE.map((d) => (
                    <button key={d.id} type="button" className={`btn sm ${p.favoriteTcg === d.id ? 'primary' : ''}`} onClick={() => set('favoriteTcg', p.favoriteTcg === d.id ? '' : d.id)}>
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
              {def ? (
                <div className="profile-tcg-fields">
                  {def.fields.map((f) => (
                    <TcgFieldInput key={`${def.id}-${f.key}`} f={f} value={p.tcgInfo[def.id]?.[f.key]} onChange={(v) => setTcgField(def.id, f.key, v)} />
                  ))}
                </div>
              ) : (
                <div className="small muted">{t('Escolha seu TCG favorito para mostrar mais informações no perfil.')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Cartão de perfil de outro jogador (só leitura). */
export function ProfileCardModal({ profile, onClose }: { profile: PublicProfile; onClose: () => void }) {
  const def = tcgProfileDef(profile.favoriteTcg)
  const vals = def ? profile.tcgInfo[def.id] ?? {} : {}
  const filled = def ? def.fields.filter((f) => vals[f.key] !== undefined && vals[f.key] !== '') : []
  const name = profile.displayName || profile.username || '?'
  return (
    <Modal title={t('Perfil de {name}', { name })} onClose={onClose} width={520}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <Avatar url={profile.avatarUrl} name={name} size={96} />
        <div className="col grow" style={{ gap: 6 }}>
          <div>
            <b style={{ fontSize: 18 }}>{name}</b>
            {profile.username && profile.displayName && <span className="muted"> @{profile.username}</span>}{' '}
            <AdminBadge userId={profile.userId} />
          </div>
          {profile.location && <div className="small muted">📍 {profile.location}</div>}
          {profile.memberSince && <div className="small muted">{t('Membro desde {date}', { date: new Date(profile.memberSince).toLocaleDateString() })}</div>}
          {profile.bio && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{profile.bio}</div>}
          {def && (
            <div className="profile-card-tcg">
              <div className="small muted">{t('TCG favorito')}</div>
              <b>{def.name}</b>
              {filled.map((f) => (
                <div key={f.key} className="small">
                  <span className="muted">{t(f.label)}:</span> {fieldText(f, vals[f.key])}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Cartão de perfil aberto pelo lobby/mesa online (clicando na foto ou no nome de um jogador). */
export function ProfileViewer() {
  const viewing = useProfiles((s) => s.viewing)
  const profile = useProfiles((s) => (s.viewing ? s.map[s.viewing] : undefined))
  if (!viewing || !profile) return null
  return <ProfileCardModal profile={profile} onClose={() => useProfiles.getState().view(null)} />
}
