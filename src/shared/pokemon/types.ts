// Tipos do Pokémon TCG (banco de cartas e decks). Independentes dos tipos de Magic.
import type { CardFinish, DeckCard } from '../types.ts'

/** Tipos de energia/Pokémon (nomes em inglês do TCGdex são a referência). */
export type PkmType = 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic' | 'Fighting' | 'Darkness' | 'Metal' | 'Fairy' | 'Dragon' | 'Colorless'

export const PKM_TYPES: PkmType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless']

/** Nome em português de cada tipo (traduzido para outros idiomas com t() ao exibir). */
export const PKM_TYPE_LABEL: Record<PkmType, string> = {
  Grass: 'Planta',
  Fire: 'Fogo',
  Water: 'Água',
  Lightning: 'Elétrico',
  Psychic: 'Psíquico',
  Fighting: 'Lutador',
  Darkness: 'Escuridão',
  Metal: 'Metal',
  Fairy: 'Fada',
  Dragon: 'Dragão',
  Colorless: 'Incolor'
}

export type PkmCategory = 'Pokemon' | 'Trainer' | 'Energy'

export const PKM_CATEGORY_LABEL: Record<PkmCategory, string> = { Pokemon: 'Pokémon', Trainer: 'Treinador', Energy: 'Energia' }

export const PKM_STAGE_LABEL: Record<string, string> = {
  Basic: 'Básico',
  Stage1: 'Estágio 1',
  Stage2: 'Estágio 2',
  VMAX: 'VMAX',
  VSTAR: 'V-ASTRO',
  MEGA: 'Mega',
  BREAK: 'TURBO',
  RESTORED: 'Restaurado',
  Baby: 'Bebê',
  'LEVEL-UP': 'Nível X',
  'V-UNION': 'V-UNIÃO'
}

export const PKM_TRAINER_LABEL: Record<string, string> = {
  Item: 'Item',
  Supporter: 'Apoiador',
  Stadium: 'Estádio',
  Tool: 'Ferramenta Pokémon',
  'Technical Machine': 'Máquina Técnica',
  "Rocket's Secret Machine": 'Máquina Secreta da Equipe Rocket'
}

export interface PkmAttack {
  name: string
  localName?: string
  cost: PkmType[]
  damage?: string
  effect?: string
  localEffect?: string
}

export interface PkmAbility {
  /** Ex.: "Ability", "Poké-Power", "Poké-Body". */
  type: string
  name: string
  localName?: string
  effect: string
  localEffect?: string
}

/** Carta "de regras": junta reimpressões com o mesmo nome e o mesmo texto (como o oracle do Magic). */
export interface PkmCard {
  id: string
  name: string
  localName?: string
  category: PkmCategory
  hp?: number
  types: PkmType[]
  /** Basic, Stage1, Stage2, VMAX, VSTAR, MEGA... (Pokémon) */
  stage?: string
  evolveFrom?: string
  localEvolveFrom?: string
  /** ex, V, GX, EX, TAG TEAM-GX... */
  suffix?: string
  retreat?: number
  weaknesses: { type: PkmType; value: string }[]
  resistances: { type: PkmType; value: string }[]
  attacks: PkmAttack[]
  abilities: PkmAbility[]
  /** Item, Supporter, Stadium, Tool... (Treinador) */
  trainerType?: string
  /** Normal (básica) ou Special (Energia) */
  energyType?: string
  /** Texto de Treinador/Energia. */
  effect?: string
  localEffect?: string
  /** Legal em algum formato se QUALQUER impressão for (regra de reimpressões). */
  legal: { standard: boolean; expanded: boolean }
  /** ACE SPEC (máx. 1 por deck). */
  aceSpec?: boolean
  /** Pokémon Radiante (máx. 1 por deck). */
  radiant?: boolean
  /** Prisma ◇ (máx. 1 de cada nome). */
  prismStar?: boolean
  regulationMarks: string[]
  dexId?: number[]
  defaultPrintingId: string
  /** Impressões (ids), da mais recente para a mais antiga. */
  printingIds: string[]
}

/** Uma impressão específica (coleção + número). O id é o id do TCGdex (ex.: "sv01-025"). */
export interface PkmPrinting {
  id: string
  cardId: string
  set: string
  setName: string
  /** Sigla da coleção usada no Pokémon TCG Live (ex.: "SVI"). */
  setCode?: string
  localId: string
  rarity: string
  illustrator?: string
  regulationMark?: string
  releasedAt: string
  /** Base da URL da imagem em inglês (sem /high.webp). */
  image?: string
  /** Base da URL da imagem no idioma do banco, se existir. */
  localImage?: string
  localName?: string
  variants: { normal: boolean; reverse: boolean; holo: boolean; firstEdition: boolean }
  legal: { standard: boolean; expanded: boolean }
}

export interface PkmSetInfo {
  id: string
  name: string
  code?: string
  serie: string
  releasedAt: string
  cardCount: number
}

export interface PkmCardSummary {
  id: string
  name: string
  displayName: string
  category: PkmCategory
  types: PkmType[]
  hp?: number
  stage?: string
  trainerType?: string
  energyType?: string
  suffix?: string
  defaultPrintingId: string
  /** Imagem da impressão padrão (para mostrar sem pedir a impressão). */
  hasImage: boolean
}

export type PkmSortKey = 'name' | 'type' | 'hp' | 'release' | 'category'

export interface PkmSearchQuery {
  text?: string
  categories?: PkmCategory[]
  types?: PkmType[]
  stage?: string
  trainerType?: string
  energyType?: string
  suffix?: string
  format?: PkmFormatId
  sets?: string[]
  regulationMarks?: string[]
  hpMin?: number
  hpMax?: number
  sort?: PkmSortKey
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface PkmSearchResult {
  total: number
  cards: PkmCardSummary[]
}

export interface PkmCardDetails {
  card: PkmCard
  printings: PkmPrinting[]
}

export interface PkmDbStatus {
  ready: boolean
  loading: boolean
  cardCount: number
  printingCount: number
  setCount: number
  /** Idioma dos nomes/textos/imagens localizados (código do TCGdex). */
  lang: string
  updatedAt?: string
  sizeBytes?: number
  imageCacheBytes?: number
  imageCount?: number
}

export type PkmFormatId = 'standard' | 'expanded' | 'unlimited' | 'casual'

export interface PkmDeck {
  id: string
  name: string
  format: PkmFormatId
  description?: string
  /** `oracleId` guarda o id da carta (PkmCard.id). */
  main: DeckCard[]
  maybeboard: DeckCard[]
  coverPrintingId?: string
  createdAt: string
  updatedAt: string
}

export interface PkmDeckSummary {
  id: string
  name: string
  format: PkmFormatId
  cardCount: number
  coverPrintingId?: string
  types: PkmType[]
  updatedAt: string
}

export interface PkmNameResolution {
  query: string
  cardId?: string
  printingId?: string
  name?: string
}

/** Idiomas do TCGdex com cartas do TCG físico. */
export const PKM_DB_LANGUAGES: { code: string; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' }
]

export type { CardFinish }
