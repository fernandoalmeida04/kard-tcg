// Botão de conta na barra lateral: "Entrar / Cadastre-se" ou o nome do usuário com menu.
import { t } from '@shared/i18n'
import { useMenu } from '../components/common'
import { useApp } from '../store'
import { useAuth } from './authStore'

export default function AccountButton() {
  const user = useAuth((s) => s.user)
  const loaded = useAuth((s) => s.loaded)
  const open = useAuth((s) => s.open)
  const setUser = useAuth((s) => s.setUser)
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

  const name = user.username ?? user.email
  return (
    <button
      className="account-btn logged"
      title={user.email}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        openMenu(r.left, r.top - 110, [
          { header: user.email },
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
      <span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span>
      <span className="grow account-name">{name}</span>
      <span className="muted">▾</span>
    </button>
  )
}
