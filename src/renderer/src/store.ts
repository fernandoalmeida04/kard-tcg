import { create } from 'zustand'
import type { DbStatus, DownloadProgress, Settings, SettingsUpdate } from '@shared/types'

export type Page = 'home' | 'database' | 'collection' | 'decks' | 'online' | 'editor' | 'play' | 'settings' | 'friends' | 'admin'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success' | 'judge'
}

interface AppStore {
  page: Page
  editingDeckId: string | null
  playDeckId: string | null
  inGame: boolean
  settings: Settings | null
  db: DbStatus | null
  progress: DownloadProgress | null
  toasts: Toast[]
  go: (page: Page, opts?: { deckId?: string }) => void
  setInGame: (v: boolean) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
  refreshDb: () => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (u: SettingsUpdate) => Promise<void>
  setProgress: (p: DownloadProgress | null) => void
}

let toastId = 0

export const useApp = create<AppStore>((set, get) => ({
  page: 'home',
  editingDeckId: null,
  playDeckId: null,
  inGame: false,
  settings: null,
  db: null,
  progress: null,
  toasts: [],
  go: (page, opts) =>
    set({
      page,
      editingDeckId: page === 'editor' ? (opts?.deckId ?? null) : get().editingDeckId,
      playDeckId: page === 'play' ? (opts?.deckId ?? get().playDeckId) : get().playDeckId
    }),
  setInGame: (v) => set({ inGame: v }),
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-5) })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  refreshDb: async () => set({ db: await window.kard.db.status() }),
  loadSettings: async () => set({ settings: await window.kard.settings.get() }),
  saveSettings: async (u) => set({ settings: await window.kard.settings.set(u) }),
  setProgress: (p) => set({ progress: p })
}))
