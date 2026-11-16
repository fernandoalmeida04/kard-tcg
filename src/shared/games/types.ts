// Estrutura genérica para TCGs "simples" (ex.: Yu-Gi-Oh!): banco de cartas + decks.
// Cada jogo descreve suas regras num GameDef (shared/games/<jogo>/def.ts) e baixa os dados num
// downloader (main/games/<jogo>/download.ts). Banco, busca, decks, imagens e telas são genéricos.
//
// Regras de i18n: rótulos ficam em português e são traduzidos com t() na hora de exibir;
// funções do GameDef (typeLine, stats, validate...) já devolvem texto traduzido (chamam t() em tempo de execução).
import type { DeckCard, DownloadProgress } from '../types.ts'

export type GameId = 'ygo'

/** Carta "de regras" (reimpressões juntas). */
export interface GCard {
  id: string
  name: string
  localName?: string
  /** Tipo principal (id de GameDef.categories). Ex.: 'Monster' | 'Spell' | 'Trap'. */
  category: string
  /** Subtipo legível (em inglês, como vem da fonte). Ex.: 'Fusion Monster', 'Tamer', 'Event'. */
  subtype?: string
  /** Cores/atributos para ícones e filtros (ids de GameDef.colors). */
  colors: string[]
  /** Campos do jogo usados em filtros, ordenação e exibição (ex.: { level: 4, atk: 1800, race: 'Dragon' }). */
  fields: Record<string, string | number | string[] | undefined>
  /** Texto de regras (idioma original) e traduzido. */
  text: string
  localText?: string
  /** Texto secundário opcional (ex.: texto de Pêndulo). */
  text2?: string
  localText2?: string
  /** Formato → nº de cópias permitidas (0 = proibida). Formato ausente = GameDef.defaultLimit. */
  limits: Record<string, number>
  /** Formatos em que a carta NÃO pode ser usada (ex.: ainda não lançada no TCG). */
  notLegal?: string[]
  /** Seção do deck onde a carta entra por padrão (id de GameDef.sections). */
  section: string
  defaultPrintingId: string
  /** Impressões, da mais recente para a mais antiga. */
  printingIds: string[]
  releasedAt?: string
}

/** Uma impressão/arte específica. */
export interface GPrinting {
  id: string
  cardId: string
  set: string
  setName: string
  /** Código impresso na carta (ex.: 'LOB-EN001', 'OP01-001', 'BT1-010'). */
  code?: string
  rarity?: string
  releasedAt?: string
  /** URL completa da imagem grande e (opcional) pequena. */
  image?: string
  imageSmall?: string
  /** Imagem no idioma do banco, se existir. */
  localImage?: string
  /** Ex.: 'Arte alternativa', 'Paralela'. */
  variant?: string
}

export interface GSet {
  id: string
  name: string
  code?: string
  releasedAt: string
  cardCount: number
}

export interface GDbFile {
  version: number
  game: GameId
  lang: string
  updatedAt: string
  cards: GCard[]
  printings: GPrinting[]
  sets: GSet[]
}

export interface GCardSummary {
  id: string
  name: string
  displayName: string
  category: string
  subtype?: string
  colors: string[]
  fields: GCard['fields']
  section: string
  defaultPrintingId: string
}

export interface GSearchQuery {
  text?: string
  /** campo → valores aceitos (OU). Campos especiais: 'category', 'subtype', 'colors'. */
  filters?: Record<string, string[]>
  /** campo numérico → faixa. */
  ranges?: Record<string, { min?: number; max?: number }>
  /** Só cartas permitidas (limite > 0) neste formato. */
  format?: string
  sets?: string[]
  /** id de GameDef.sorts (ou 'name' / 'release'). */
  sort?: string
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface GSearchResult {
  total: number
  cards: GCardSummary[]
}

export interface GCardDetails {
  card: GCard
  printings: GPrinting[]
}

export interface GDbStatus {
  ready: boolean
  loading: boolean
  cardCount: number
  printingCount: number
  setCount: number
  lang: string
  updatedAt?: string
  sizeBytes?: number
  imageCacheBytes?: number
  imageCount?: number
}

export interface GDeck {
  id: string
  game: GameId
  name: string
  format: string
  description?: string
  /** seção (id de GameDef.sections) → cartas. `DeckCard.oracleId` guarda o id da GCard. */
  sections: Record<string, DeckCard[]>
  maybeboard: DeckCard[]
  coverPrintingId?: string
  createdAt: string
  updatedAt: string
}

export interface GDeckSummary {
  id: string
  game: GameId
  name: string
  format: string
  cardCount: number
  coverPrintingId?: string
  colors: string[]
  updatedAt: string
}

export interface GNameResolution {
  query: string
  cardId?: string
  printingId?: string
  name?: string
}

export interface GParsedLine {
  qty: number
  /** Nome, código impresso (ex.: 'OP01-016') ou id da fonte (ex.: passcode do Yu-Gi-Oh!). */
  name?: string
  code?: string
  /** Seção indicada na lista (id de GameDef.sections) ou 'maybeboard'. */
  section?: string
}

export interface GValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  /** seção → total de cartas */
  counts: Record<string, number>
}

export interface GFilterDef {
  /** Campo: 'category' | 'subtype' | 'colors' | chave de GCard.fields. */
  key: string
  label: string
  kind: 'select' | 'multi' | 'range'
  /** Opções fixas (rótulo em português). Sem opções em select/multi: usar os valores distintos do banco. */
  options?: { value: string; label: string }[]
  /** Só mostrar o filtro quando a categoria escolhida estiver nesta lista. */
  categories?: string[]
}

export interface GameDef {
  id: GameId
  name: string
  short: string
  /** Símbolo usado no seletor de jogos. */
  ico: string
  /** Créditos/fonte dos dados (exibidos na página do banco). */
  source: { name: string; url: string; note: string }
  /** Idiomas disponíveis para download (o primeiro é o padrão). */
  languages: { code: string; label: string }[]
  categories: { id: string; label: string }[]
  /** Cores/atributos: id → rótulo e cor CSS (para ícones e filtros). */
  colors: { id: string; label: string; css: string }[]
  /** Seções do deck (ex.: Principal 40–60, Extra 0–15, Side 0–15). */
  sections: { id: string; label: string; min: number; max: number }[]
  /** Cópias por carta quando o formato não diz outra coisa. */
  defaultLimit: number
  formats: { id: string; name: string; description: string }[]
  filters: GFilterDef[]
  /** Ordenações extras (além de nome e mais recente). `field` numérico de GCard.fields. */
  sorts: { id: string; label: string; field: string; dir?: 'asc' | 'desc' }[]
  /** Linha de tipo traduzida (ex.: "Monstro de Efeito · Dragão · Nível 8"). */
  typeLine(card: GCard): string
  /** Estatísticas para detalhes/pré-visualização (ex.: ATK 3000 / DEF 2500). */
  stats(card: GCard): { label: string; value: string }[]
  /** Grupo/subtítulo de uma carta na lista do deck (ex.: "Monstros", "Magias"). */
  groupOf(card: GCard): string
  validate(deck: GDeck, cards: Record<string, GCard>): GValidation
  parseText(text: string): GParsedLine[]
  exportText(deck: GDeck, cards: Record<string, GCard>, printings: Record<string, GPrinting>): string
  /** Exemplo de lista para o placeholder da importação. */
  exampleList: string
  /** Proporção da imagem (largura/altura). */
  aspect: number
}

/** Baixa e normaliza o banco de um jogo (processo principal). Use `fetch` global (Node 18+), não APIs do Electron. */
export type GameDownloader = (
  lang: string,
  signal: AbortSignal,
  progress: (p: DownloadProgress) => void
) => Promise<{ cards: GCard[]; printings: GPrinting[]; sets: GSet[] }>
