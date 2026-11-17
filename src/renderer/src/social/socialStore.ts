// Amigos na interface: lista, pedidos, quem está online e convites recebidos.
import { create } from 'zustand'
import type { FriendEntry, GameInvite } from '@shared/types'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { useOnline } from '../online/onlineStore'
import { useProfiles } from '../online/profiles'
import { useSandbox } from '../sandbox/sandboxStore'

interface SocialStore {
  userId: string | null
  loaded: boolean
  error: string | null
  friends: FriendEntry[]
  incoming: FriendEntry[]
  outgoing: FriendEntry[]
  online: string[]
  /** Convites recebidos ainda não respondidos. */
  invites: GameInvite[]
  start: (userId: string | null) => void
  refresh: () => Promise<void>
  acceptInvite: (inv: GameInvite) => Promise<void>
  dismissInvite: (inv: GameInvite) => void
}

let unsubs: (() => void)[] = []

/** Guarda os perfis no cache usado pelo cartão de perfil (lobby/mesa). */
function cacheProfiles(list: FriendEntry[]): void {
  const cur = useProfiles.getState()
  const map = { ...cur.map }
  const fetchedAt = { ...cur.fetchedAt }
  for (const f of list) {
    map[f.userId] = f.profile
    fetchedAt[f.userId] = Date.now()
  }
  useProfiles.setState({ map, fetchedAt })
}

const INVITE_TTL = 15 * 60_000

export const useSocial = create<SocialStore>((set, get) => ({
  userId: null,
  loaded: false,
  error: null,
  friends: [],
  incoming: [],
  outgoing: [],
  online: [],
  invites: [],

  start: (userId) => {
    if (userId === get().userId) return
    for (const u of unsubs) u()
    unsubs = []
    set({ userId, loaded: false, error: null, friends: [], incoming: [], outgoing: [], online: [], invites: [] })
    const api = window.kard.social
    if (!userId || !api) return
    unsubs = [
      api.onChanged(() => void get().refresh()),
      api.onOnline((online) => set({ online })),
      api.onInvite((inv) => {
        // novo convite do mesmo amigo substitui o anterior
        set({ invites: [inv, ...get().invites.filter((i) => i.fromUser !== inv.fromUser)].slice(0, 5) })
      })
    ]
    void get().refresh()
    void api.pendingInvites().then((list) => {
      const seen = new Set<string>()
      set({ invites: list.filter((i) => !seen.has(i.fromUser) && seen.add(i.fromUser)).slice(0, 5) })
    })
  },

  refresh: async () => {
    if (!get().userId || !window.kard.social) return
    const r = await window.kard.social.list()
    const all = [...r.friends, ...r.incoming, ...r.outgoing]
    cacheProfiles(all)
    set({ loaded: true, error: r.error ?? null, friends: r.friends, incoming: r.incoming, outgoing: r.outgoing, online: r.online })
  },

  acceptInvite: async (inv) => {
    set({ invites: get().invites.filter((i) => i.id !== inv.id) })
    void window.kard.social.dismissInvite(inv.id)
    if (Date.now() - new Date(inv.createdAt).getTime() > INVITE_TTL) {
      useApp.getState().toast(t('Este convite expirou.'), 'error')
      return
    }
    const online = useOnline.getState()
    if (online.phase !== 'idle') {
      if (online.config?.code === inv.roomCode) {
        useApp.getState().go('online')
        return
      }
      if (!confirm(online.phase === 'game' ? t('Sair da partida atual para entrar na mesa do convite? Você concede a partida.') : t('Sair da mesa atual para entrar na mesa do convite?'))) return
      // sair no meio da partida = conceder, para os outros não ficarem esperando
      const g = useSandbox.getState()
      if (online.phase === 'game' && g.state && g.state.winner === null) g.act({ t: 'concede' })
      await online.leave()
    }
    const app = useApp.getState()
    // mesas online existem para Magic e Pokémon (o jogo da mesa vem do anfitrião)
    if (app.settings?.tcg !== 'mtg' && app.settings?.tcg !== 'pokemon') await app.saveSettings({ tcg: 'mtg' })
    app.go('online')
    await useOnline.getState().joinRoom(inv.roomCode)
  },

  dismissInvite: (inv) => {
    set({ invites: get().invites.filter((i) => i.id !== inv.id) })
    void window.kard.social.dismissInvite(inv.id)
  }
}))
