// Tipos compartilhados entre o processo principal (Electron) e a interface (React).
import type { BoardLayout, MatLayout } from './board.ts'
import type { UiLang } from './i18n/index.ts'

export type LangCode =
  | 'en'
  | 'pt'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'zhs'
  | 'zht'

export const LANGUAGES: { code: LangCode; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
  { code: 'zhs', label: '简体中文' },
  { code: 'zht', label: '繁體中文' }
]

export type Legality = 'legal' | 'restricted' | 'banned' | 'not_legal'

export interface CardFace {
  name: string
  localName?: string
  manaCost: string
  typeLine: string
  localTypeLine?: string
  oracleText: string
  localText?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  colors?: string[]
}

/** Dados de regras de uma carta (nível "oracle": um registro por carta, independente da edição). */
export interface CardData {
  oracleId: string
  name: string
  localName?: string
  manaCost: string
  cmc: number
  typeLine: string
  localTypeLine?: string
  oracleText: string
  localText?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  colors: string[]
  colorIdentity: string[]
  keywords: string[]
  legalities: Record<string, Legality>
  layout: string
  faces?: CardFace[]
  producedMana?: string[]
  /** Impressão padrão (mais recente em inglês, preferindo arte normal). */
  defaultPrintingId: string
  rarity: string
  edhrecRank?: number
  gameChanger?: boolean
}

/** Uma impressão (edição/arte) específica de uma carta. */
export interface Printing {
  id: string
  oracleId: string
  lang: string
  set: string
  setName: string
  collectorNumber: string
  rarity: string
  releasedAt: string
  localName?: string
  artist?: string
  /** URLs das imagens (Scryfall CDN). Para cartas dupla-face, `back*` é o verso. */
  img: {
    small?: string
    normal?: string
    large?: string
    artCrop?: string
    backNormal?: string
    backLarge?: string
    backSmall?: string
  }
  tags: string[]
  /** Acabamentos em que a impressão existe (Scryfall): nonfoil, foil, etched. Ausente em bancos antigos. */
  finishes?: string[]
}

/** Acabamento especial de uma cópia. */
/** Acabamento especial: foil/etched (Magic); foil = holo e reverse = reverse holo (Pokémon). */
export type CardFinish = 'foil' | 'etched' | 'reverse'

export interface CardSummary {
  oracleId: string
  name: string
  displayName: string
  manaCost: string
  cmc: number
  typeLine: string
  displayType: string
  colors: string[]
  colorIdentity: string[]
  rarity: string
  defaultPrintingId: string
  power?: string
  toughness?: string
  loyalty?: string
}

export type SortKey = 'name' | 'cmc' | 'color' | 'rarity' | 'edhrec' | 'type'

export interface CardSearchQuery {
  text?: string
  /** Cores (W,U,B,R,G,C) */
  colors?: string[]
  colorMode?: 'any' | 'all' | 'exact' | 'identity'
  types?: string[]
  cmcMin?: number
  cmcMax?: number
  format?: string
  rarity?: string[]
  /** Códigos de coleção (ex.: "dmu"). A carta precisa ter impressão em alguma delas. */
  sets?: string[]
  /** Identidade de cor máxima permitida (Commander). */
  identity?: string[]
  sort?: SortKey
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface SetInfo {
  code: string
  name: string
  releasedAt: string
  /** Quantidade de cartas distintas (oracle) com impressão na coleção. */
  cardCount: number
}

export interface CardSearchResult {
  total: number
  cards: CardSummary[]
}

export interface CardDetails {
  card: CardData
  printings: Printing[]
}

export interface DbStatus {
  ready: boolean
  loading: boolean
  path: string
  cardCount: number
  printingCount: number
  lang: LangCode
  updatedAt?: string
  bulkUpdatedAt?: string
  sizeBytes?: number
  imageCacheBytes?: number
  imageCount?: number
}

export interface DownloadProgress {
  phase: 'idle' | 'meta' | 'cards' | 'localized' | 'saving' | 'images' | 'done' | 'error' | 'cancelled'
  current: number
  total: number
  message: string
}

// ---------------- Decks ----------------

export type FormatId =
  | 'standard'
  | 'pioneer'
  | 'modern'
  | 'legacy'
  | 'vintage'
  | 'pauper'
  | 'historic'
  | 'timeless'
  | 'premodern'
  | 'penny'
  | 'commander'
  | 'duel'
  | 'brawl'
  | 'standardbrawl'
  | 'oathbreaker'
  | 'paupercommander'
  | 'predh'
  | 'limited'
  | 'casual'

export interface DeckCard {
  oracleId: string
  /** Impressão (arte) escolhida pelo jogador. */
  printingId?: string
  /** Acabamento escolhido (foil/etched). Impressões que só existem em foil ficam foil mesmo sem isso. */
  finish?: CardFinish
  qty: number
  /** Nome em cache para exibição rápida / importação. */
  name: string
}

export interface Deck {
  id: string
  name: string
  format: FormatId
  description?: string
  commanders: DeckCard[]
  main: DeckCard[]
  sideboard: DeckCard[]
  maybeboard: DeckCard[]
  coverPrintingId?: string
  createdAt: string
  updatedAt: string
}

export interface DeckSummary {
  id: string
  name: string
  format: FormatId
  cardCount: number
  coverPrintingId?: string
  colors: string[]
  updatedAt: string
}

export interface NameResolution {
  query: string
  oracleId?: string
  printingId?: string
  name?: string
}

// ---------------- Configurações ----------------

export type ClaudeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'

// ---------------- Atualização automática ----------------

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  error?: string
}

// ---------------- Contas (Supabase) ----------------

export interface AuthUser {
  id: string
  email: string
  /** null em contas novas do Google até a pessoa escolher um nome. */
  username: string | null
  /** 'email' ou 'google'. */
  provider: string
}

export interface AuthResult {
  ok: boolean
  error?: string
  /** É preciso digitar o código enviado por e-mail. */
  needsCode?: boolean
  user?: AuthUser | null
}

/** Jogo de cartas ativo no programa. */
export type TcgId = 'mtg' | 'pokemon' | 'ygo'

export interface Settings {
  /** Jogo de cartas selecionado (Magic é o único com suporte completo por enquanto). */
  tcg: TcgId
  /** Idioma da interface do programa. */
  uiLanguage: UiLang
  cardLanguage: LangCode
  aiJudgeEnabled: boolean
  aiModel: ClaudeModel
  hasApiKey: boolean
  botDelayMs: number
  autoPass: boolean
  stopAtEveryStep: boolean
  showCardText: boolean
  /** Como jogar cartas da mão: clicar (vai direto) ou arrastar até a zona. */
  playMode: 'click' | 'drag'
  /** Organização dos tipos de permanente dentro do Battlefield. */
  boardLayout: BoardLayout
  /** Posição das áreas do playmat (campo de batalha, terrenos, vida, cemitério...). */
  matLayout: MatLayout
  /** Arquivo da imagem de fundo do playmat (na pasta de dados do usuário); null = sem imagem. */
  playmatImage: string | null
  /** Quanto escurecer a imagem do playmat (0 a 0.85) para as cartas continuarem legíveis. */
  playmatDim: number
  /** Usar a imagem também no lado do oponente. */
  playmatBoth: boolean
}

export interface SettingsUpdate extends Partial<Omit<Settings, 'hasApiKey' | 'playmatImage'>> {
  apiKey?: string | null
}

// ---------------- Juiz IA (Claude) ----------------

export type JudgeOpKind =
  | 'damage'
  | 'destroy'
  | 'exile'
  | 'bounce'
  | 'draw'
  | 'discard'
  | 'gain_life'
  | 'lose_life'
  | 'pump'
  | 'add_counters'
  | 'create_token'
  | 'tap'
  | 'untap'
  | 'mill'
  | 'sacrifice'
  | 'graveyard_to_hand'
  | 'graveyard_to_battlefield'
  | 'add_mana'
  | 'none'

export interface JudgeOp {
  op: JudgeOpKind
  target_object_ids: string[]
  target_players: ('controller' | 'opponent')[]
  amount: number
  power: number
  toughness: number
  token_name: string
  token_types: string
  colors: string[]
  keywords: string[]
  mana: string
}

export interface JudgeEffectRequest {
  cardName: string
  cardText: string
  effectText: string
  controller: 'human' | 'bot'
  chosenTargets: string
  stateSummary: string
}

export interface JudgeEffectResponse {
  ok: boolean
  error?: string
  explanation: string
  operations: JudgeOp[]
}

export interface JudgeQuestionRequest {
  question: string
  stateSummary: string
  recentLog: string
}

export interface JudgeAnswer {
  ok: boolean
  error?: string
  answer: string
}
