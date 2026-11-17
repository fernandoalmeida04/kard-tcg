// Quem é administrador (selo "Administrador" nos perfis). Carregado uma vez por login.
import { create } from 'zustand'
import { t } from '@shared/i18n'

export const useAdminIds = create<{ ids: string[]; load: () => void }>((set) => ({
  ids: [],
  load: () => {
    void window.kard.admin
      ?.adminIds()
      .then((ids) => set({ ids }))
      .catch(() => undefined)
  }
}))

export function AdminBadge({ userId }: { userId: string }) {
  const isAdmin = useAdminIds((s) => s.ids.includes(userId))
  if (!isAdmin) return null
  return <span className="badge admin-badge">🛡 {t('Administrador')}</span>
}
