// Botão de conta na barra lateral: "Entrar / Cadastre-se" ou o nome do usuário com menu.
import { t } from '@shared/i18n'
import { useMenu } from '../components/common'
import { useApp } from '../store'
import { useAuth } from './authStore'
import { Avatar } from './ProfileModal'

export default function AccountButton() {
  const user = useAuth((s) => s.user)
  const loaded = useAuth((s) => s.loaded)
  const open = useAuth((s) => s.open)
  const setUser = useAuth((s) => s.setUser)
  const setProfileOpen = useAuth((s) => s.setProfileOpen)
  const openMenu = useMenu((s) => s.open)
  const toast = useApp((s) => s.toast)

  if (!loaded) return null

  if (!user) {
    return (
      <button className="account-btn" onClick={() => open('login')}>
        <span className="account-ico">👤</span>
        <span className="grow">{t('Entrar / Cadastre-se')}</span>
      </button>
    )
  }

  const name = user.displayName || user.username || user.email
  return (
    <button
      className="account-btn logged"
      title={user.email}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        openMenu(r.left, r.top - (user.isAdmin ? 170 : 140), [
          { header: user.email },
          { label: `👤 ${t('Meu Perfil')}`, onClick: () => setProfileOpen(true) },
          ...(user.isAdmin ? [{ label: `🛡 ${t('Painel administrativo')}`, onClick: () => useApp.getState().go('admin') }] : []),
          ...(user.username ? [] : [{ label: t('Escolher nome de usuário'), onClick: () => open('username') }]),
          {
            label: `⎋ ${t('Sair da conta')}`,
            onClick: async () => {
              await window.kard.auth.signOut()
              setUser(null)
              toast(t('Você saiu da sua conta.'), 'success')
            }
          }
        ])
      }}
    >
      <Avatar user={user} />
      <span className="grow account-name">{name}</span>
      <span className="muted">▾</span>
    </button>
  )
}
