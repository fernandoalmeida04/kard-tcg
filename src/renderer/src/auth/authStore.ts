// Estado da conta do usuário na interface (o login acontece no processo principal).
import { create } from 'zustand'
import type { AuthUser } from '@shared/types'

interface AuthStore {
  configured: boolean
  user: AuthUser | null
  loaded: boolean
  /** Janela de login aberta (e em qual passo começa). */
  modal: 'login' | 'signup' | 'username' | null
  init: () => () => void
  open: (step: 'login' | 'signup' | 'username') => void
  close: () => void
  setUser: (u: AuthUser | null) => void
}

export const useAuth = create<AuthStore>((set, get) => ({
  configured: false,
  user: null,
  loaded: false,
  modal: null,
  init: () => {
    const api = window.kard.auth
    if (!api) {
      // app aberto com o processo principal antigo (precisa reiniciar)
      set({ loaded: true })
      return () => undefined
    }
    void api.configured().then((configured) => set({ configured }))
    void api.current().then((user) => {
      set({ user, loaded: true })
      // conta do Google ainda sem nome de usuário: pede para escolher
      if (user && !user.username) set({ modal: 'username' })
    })
    return api.onChange((user) => {
      set({ user })
      if (user && !user.username && !get().modal) set({ modal: 'username' })
    })
  },
  open: (step) => set({ modal: step }),
  close: () => set({ modal: null }),
  setUser: (user) => set({ user })
}))

/** Regras da senha forte (mostradas como lista de verificação no cadastro). */
export function passwordChecks(pw: string): { label: string; ok: boolean }[] {
  return [
    { label: 'Pelo menos 8 caracteres', ok: pw.length >= 8 },
    { label: 'Uma letra maiúscula', ok: /[A-Z]/.test(pw) },
    { label: 'Uma letra minúscula', ok: /[a-z]/.test(pw) },
    { label: 'Um número', ok: /\d/.test(pw) },
    { label: 'Um símbolo (ex.: ! @ # $ %)', ok: /[^A-Za-z0-9]/.test(pw) }
  ]
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
