// Perfis públicos dos jogadores das mesas online (foto, nome de exibição, TCG favorito...).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { PublicProfile } from '@shared/types'

interface ProfileCache {
  map: Record<string, PublicProfile>
  fetchedAt: Record<string, number>
  /** Cartão de perfil aberto (userId). */
  viewing: string | null
  view: (userId: string | null) => void
}

export const useProfiles = create<ProfileCache>((set) => ({
  map: {},
  fetchedAt: {},
  viewing: null,
  view: (viewing) => set({ viewing })
}))

const MAX_AGE = 2 * 60_000
const inFlight = new Set<string>()

/** Busca os perfis que faltam (ou estão velhos) para os ids indicados. */
export function loadProfiles(ids: string[]): void {
  const s = useProfiles.getState()
  const now = Date.now()
  const need = [...new Set(ids)].filter((id) => id && !inFlight.has(id) && now - (s.fetchedAt[id] ?? 0) > MAX_AGE).slice(0, 8)
  if (!need.length || !window.kard.auth?.getPublicProfiles) return
  need.forEach((id) => inFlight.add(id))
  window.kard.auth
    .getPublicProfiles(need)
    .then((list) => {
      const cur = useProfiles.getState()
      const map = { ...cur.map }
      const fetchedAt = { ...cur.fetchedAt }
      for (const id of need) fetchedAt[id] = Date.now()
      for (const p of list) map[p.userId] = p
      useProfiles.setState({ map, fetchedAt })
    })
    .catch(() => undefined)
    .finally(() => need.forEach((id) => inFlight.delete(id)))
}

/** Hook: perfis dos jogadores indicados (carrega os que faltam). */
export function usePlayerProfiles(ids: string[]): Record<string, PublicProfile> {
  const key = ids.join(',')
  useEffect(() => {
    loadProfiles(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useProfiles((s) => s.map)
}
