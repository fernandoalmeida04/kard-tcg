// Campos do perfil que dependem do TCG favorito ("Meu Perfil").
// A interface monta o formulário a partir daqui, e o processo principal valida com as mesmas regras.
import type { TcgId } from './types.ts'
import { FORMATS } from './formats.ts'
import { PKM_FORMATS } from './pokemon/formats.ts'
import { def as ygoDef } from './games/ygo/def.ts'

export type ProfileFieldKind = 'text' | 'year' | 'select' | 'colors'

export interface ProfileField {
  key: string
  /** Texto em português (chave do t()). */
  label: string
  kind: ProfileFieldKind
  placeholder?: string
  /** text: tamanho máximo. */
  max?: number
  /** year: primeiro ano possível (lançamento do jogo). */
  minYear?: number
  /** select: valor guardado + rótulo em português. */
  options?: { value: string; label: string }[]
}

export interface TcgProfileDef {
  id: TcgId
  name: string
  fields: ProfileField[]
}

/** Valores por TCG: { mtg: { colors: 'WU', since: 2005 }, pokemon: { pokemon: 'Pikachu' } } */
export type TcgProfileInfo = Partial<Record<TcgId, Record<string, string | number>>>

export const TCG_PROFILE: TcgProfileDef[] = [
  {
    id: 'mtg',
    name: 'Magic: The Gathering',
    fields: [
      { key: 'colors', label: 'Cores favoritas', kind: 'colors' },
      { key: 'format', label: 'Formato favorito', kind: 'select', options: FORMATS.map((f) => ({ value: f.id, label: f.name })) },
      { key: 'since', label: 'Jogando Magic desde', kind: 'year', minYear: 1993 },
      { key: 'card', label: 'Carta favorita', kind: 'text', max: 80, placeholder: 'Ex.: Lightning Bolt' }
    ]
  },
  {
    id: 'pokemon',
    name: 'Pokémon TCG',
    fields: [
      { key: 'pokemon', label: 'Pokémon favorito', kind: 'text', max: 40, placeholder: 'Ex.: Pikachu' },
      {
        key: 'type',
        label: 'Tipo favorito',
        kind: 'select',
        options: [
          { value: 'Grass', label: 'Planta' },
          { value: 'Fire', label: 'Fogo' },
          { value: 'Water', label: 'Água' },
          { value: 'Lightning', label: 'Elétrico' },
          { value: 'Psychic', label: 'Psíquico' },
          { value: 'Fighting', label: 'Lutador' },
          { value: 'Darkness', label: 'Escuridão' },
          { value: 'Metal', label: 'Metal' },
          { value: 'Dragon', label: 'Dragão' },
          { value: 'Fairy', label: 'Fada' },
          { value: 'Colorless', label: 'Incolor' }
        ]
      },
      { key: 'format', label: 'Formato favorito', kind: 'select', options: PKM_FORMATS.map((f) => ({ value: f.id, label: f.name })) },
      { key: 'since', label: 'Jogando Pokémon TCG desde', kind: 'year', minYear: 1996 }
    ]
  },
  {
    id: 'ygo',
    name: 'Yu-Gi-Oh!',
    fields: [
      { key: 'monster', label: 'Monstro favorito', kind: 'text', max: 60, placeholder: 'Ex.: Dark Magician' },
      { key: 'archetype', label: 'Arquétipo favorito', kind: 'text', max: 40, placeholder: 'Ex.: Blue-Eyes' },
      {
        key: 'attribute',
        label: 'Atributo favorito',
        kind: 'select',
        options: [
          { value: 'DARK', label: 'Trevas' },
          { value: 'LIGHT', label: 'Luz' },
          { value: 'EARTH', label: 'Terra' },
          { value: 'WATER', label: 'Água' },
          { value: 'FIRE', label: 'Fogo' },
          { value: 'WIND', label: 'Vento' },
          { value: 'DIVINE', label: 'Divino' }
        ]
      },
      { key: 'format', label: 'Formato favorito', kind: 'select', options: ygoDef.formats.map((f) => ({ value: f.id, label: f.name })) },
      { key: 'since', label: 'Jogando Yu-Gi-Oh! desde', kind: 'year', minYear: 1999 }
    ]
  }
]

export function tcgProfileDef(id: string | null | undefined): TcgProfileDef | undefined {
  return TCG_PROFILE.find((d) => d.id === id)
}

/** Limpa e valida os valores (descarta campos desconhecidos, vazios ou inválidos). */
export function sanitizeTcgInfo(input: unknown, currentYear = new Date().getFullYear()): TcgProfileInfo {
  const out: TcgProfileInfo = {}
  if (!input || typeof input !== 'object') return out
  for (const def of TCG_PROFILE) {
    const src = (input as Record<string, unknown>)[def.id]
    if (!src || typeof src !== 'object') continue
    const vals: Record<string, string | number> = {}
    for (const f of def.fields) {
      const v = (src as Record<string, unknown>)[f.key]
      if (v === undefined || v === null || v === '') continue
      if (f.kind === 'text') {
        const s = String(v).replace(/\s+/g, ' ').trim().slice(0, f.max ?? 60)
        if (s) vals[f.key] = s
      } else if (f.kind === 'year') {
        const n = Number(v)
        if (Number.isInteger(n) && n >= (f.minYear ?? 1990) && n <= currentYear) vals[f.key] = n
      } else if (f.kind === 'select') {
        if (f.options?.some((o) => o.value === v)) vals[f.key] = String(v)
      } else if (f.kind === 'colors') {
        const set = new Set(String(v).toUpperCase())
        const s = 'WUBRG'.split('').filter((c) => set.has(c)).join('')
        if (s) vals[f.key] = s
      }
    }
    if (Object.keys(vals).length) out[def.id] = vals
  }
  return out
}
