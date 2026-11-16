import type {
  CardData,
  CardDetails,
  CardSearchQuery,
  CardSearchResult,
  AuthResult,
  AuthUser,
  UpdateStatus,
  DbStatus,
  Deck,
  DeckSummary,
  DownloadProgress,
  JudgeAnswer,
  JudgeEffectRequest,
  JudgeEffectResponse,
  JudgeQuestionRequest,
  LangCode,
  NameResolution,
  Printing,
  SetInfo,
  Settings,
  SettingsUpdate
} from './types.ts'
import type {
  PkmCard,
  PkmCardDetails,
  PkmDbStatus,
  PkmDeck,
  PkmDeckSummary,
  PkmNameResolution,
  PkmPrinting,
  PkmSearchQuery,
  PkmSearchResult,
  PkmSetInfo
} from './pokemon/types.ts'
import type {
  GameId,
  GCard,
  GCardDetails,
  GDbStatus,
  GDeck,
  GDeckSummary,
  GNameResolution,
  GPrinting,
  GSearchQuery,
  GSearchResult,
  GSet
} from './games/types.ts'
import type { OnlinePresence, RoomMessage } from './online/protocol.ts'

export interface CandidateQuery {
  colors: string[]
  format?: string
  maxCmc?: number
  limit?: number
}

/** API exposta pelo preload em `window.kard`. */
export interface KardApi {
  app: {
    version(): Promise<string>
    updateStatus(): Promise<UpdateStatus>
    onUpdate(cb: (s: UpdateStatus) => void): () => void
    installUpdate(): Promise<void>
    openDatabaseFolder(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(update: SettingsUpdate): Promise<Settings>
    /** Abre o seletor de arquivo para a imagem do playmat. */
    choosePlaymat(): Promise<Settings>
    clearPlaymat(): Promise<Settings>
  }
  db: {
    status(): Promise<DbStatus>
    download(lang: LangCode): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
    onProgress(cb: (p: DownloadProgress) => void): () => void
    search(q: CardSearchQuery): Promise<CardSearchResult>
    sets(): Promise<SetInfo[]>
    details(oracleId: string): Promise<CardDetails | null>
    cards(oracleIds: string[]): Promise<Record<string, CardData>>
    printings(ids: string[]): Promise<Record<string, Printing>>
    resolveNames(lines: { name: string; set?: string; cn?: string }[]): Promise<NameResolution[]>
    candidates(q: CandidateQuery): Promise<CardData[]>
    basicLands(): Promise<Record<string, CardData>>
    prefetchImages(printingIds: string[]): Promise<{ ok: boolean; downloaded: number; error?: string }>
    clearImages(): Promise<void>
  }
  decks: {
    list(): Promise<DeckSummary[]>
    get(id: string): Promise<Deck | null>
    save(deck: Deck): Promise<Deck>
    remove(id: string): Promise<void>
  }
  /** Pokémon TCG: banco de cartas (TCGdex) e decks. */
  pkm: {
    status(): Promise<PkmDbStatus>
    download(lang: string): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
    onProgress(cb: (p: DownloadProgress) => void): () => void
    search(q: PkmSearchQuery): Promise<PkmSearchResult>
    sets(): Promise<PkmSetInfo[]>
    details(cardId: string): Promise<PkmCardDetails | null>
    cards(ids: string[]): Promise<Record<string, PkmCard>>
    printings(ids: string[]): Promise<Record<string, PkmPrinting>>
    resolveNames(lines: { name: string; set?: string; number?: string }[]): Promise<PkmNameResolution[]>
    decks: {
      list(): Promise<PkmDeckSummary[]>
      get(id: string): Promise<PkmDeck | null>
      save(deck: PkmDeck): Promise<PkmDeck>
      remove(id: string): Promise<void>
    }
  }
  /** Jogos genéricos (Yu-Gi-Oh!): banco de cartas e decks. Todas as chamadas recebem o jogo. */
  games: {
    status(game: GameId): Promise<GDbStatus>
    download(game: GameId, lang: string): Promise<{ ok: boolean; error?: string }>
    cancel(game: GameId): Promise<void>
    /** Progresso de download (todos os jogos; filtre por `game`). */
    onProgress(cb: (game: GameId, p: DownloadProgress) => void): () => void
    search(game: GameId, q: GSearchQuery): Promise<GSearchResult>
    sets(game: GameId): Promise<GSet[]>
    facet(game: GameId, key: string): Promise<string[]>
    details(game: GameId, cardId: string): Promise<GCardDetails | null>
    cards(game: GameId, ids: string[]): Promise<Record<string, GCard>>
    printings(game: GameId, ids: string[]): Promise<Record<string, GPrinting>>
    resolveNames(game: GameId, lines: { name?: string; code?: string }[]): Promise<GNameResolution[]>
    decks: {
      list(game: GameId): Promise<GDeckSummary[]>
      get(game: GameId, id: string): Promise<GDeck | null>
      save(deck: GDeck): Promise<GDeck>
      remove(game: GameId, id: string): Promise<void>
    }
  }
  /** Mesas online (Supabase Realtime). O processo principal só repassa mensagens. */
  online: {
    join(code: string): Promise<{ ok: boolean; error?: string; userId?: string }>
    send(msg: RoomMessage): Promise<boolean>
    leave(): Promise<void>
    onMessage(cb: (msg: RoomMessage) => void): () => void
    onPresence(cb: (online: OnlinePresence[]) => void): () => void
    onStatus(cb: (status: 'connected' | 'error' | 'closed') => void): () => void
  }
  /** Conta do usuário (Supabase). */
  auth: {
    /** Login configurado neste computador (.env com URL e chave do Supabase)? */
    configured(): Promise<boolean>
    current(): Promise<AuthUser | null>
    onChange(cb: (u: AuthUser | null) => void): () => void
    usernameAvailable(name: string): Promise<boolean>
    signUp(username: string, email: string, password: string): Promise<AuthResult>
    verifyCode(email: string, code: string): Promise<AuthResult>
    resendCode(email: string): Promise<AuthResult>
    signIn(email: string, password: string): Promise<AuthResult>
    signInWithGoogle(): Promise<AuthResult>
    setUsername(username: string): Promise<AuthResult>
    signOut(): Promise<void>
  }
  judge: {
    resolveEffect(req: JudgeEffectRequest): Promise<JudgeEffectResponse>
    ask(req: JudgeQuestionRequest): Promise<JudgeAnswer>
    test(): Promise<JudgeAnswer>
  }
}

export const IPC = {
  appVersion: 'app:version',
  updateStatus: 'update:get',
  updateEvent: 'update:status',
  updateInstall: 'update:install',
  openDbFolder: 'app:openDbFolder',
  openExternal: 'app:openExternal',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  playmatChoose: 'settings:playmatChoose',
  playmatClear: 'settings:playmatClear',
  dbStatus: 'db:status',
  dbDownload: 'db:download',
  dbCancel: 'db:cancel',
  dbProgress: 'db:progress',
  dbSearch: 'db:search',
  dbSets: 'db:sets',
  dbDetails: 'db:details',
  dbCards: 'db:cards',
  dbPrintings: 'db:printings',
  dbResolve: 'db:resolve',
  dbCandidates: 'db:candidates',
  dbBasics: 'db:basics',
  dbPrefetch: 'db:prefetch',
  dbClearImages: 'db:clearImages',
  decksList: 'decks:list',
  decksGet: 'decks:get',
  decksSave: 'decks:save',
  decksRemove: 'decks:remove',
  pkmStatus: 'pkm:status',
  pkmDownload: 'pkm:download',
  pkmCancel: 'pkm:cancel',
  pkmProgress: 'pkm:progress',
  pkmSearch: 'pkm:search',
  pkmSets: 'pkm:sets',
  pkmDetails: 'pkm:details',
  pkmCards: 'pkm:cards',
  pkmPrintings: 'pkm:printings',
  pkmResolve: 'pkm:resolve',
  pkmDecksList: 'pkm:decksList',
  pkmDecksGet: 'pkm:decksGet',
  pkmDecksSave: 'pkm:decksSave',
  pkmDecksRemove: 'pkm:decksRemove',
  gStatus: 'g:status',
  gDownload: 'g:download',
  gCancel: 'g:cancel',
  gProgress: 'g:progress',
  gSearch: 'g:search',
  gSets: 'g:sets',
  gFacet: 'g:facet',
  gDetails: 'g:details',
  gCards: 'g:cards',
  gPrintings: 'g:printings',
  gResolve: 'g:resolve',
  gDecksList: 'g:decksList',
  gDecksGet: 'g:decksGet',
  gDecksSave: 'g:decksSave',
  gDecksRemove: 'g:decksRemove',
  onlineJoin: 'online:join',
  onlineSend: 'online:send',
  onlineLeave: 'online:leave',
  onlineMsg: 'online:msg',
  onlinePresence: 'online:presence',
  onlineStatus: 'online:status',
  authConfigured: 'auth:configured',
  authCurrent: 'auth:current',
  authChanged: 'auth:changed',
  authUsernameAvailable: 'auth:usernameAvailable',
  authSignUp: 'auth:signUp',
  authVerify: 'auth:verify',
  authResend: 'auth:resend',
  authSignIn: 'auth:signIn',
  authGoogle: 'auth:google',
  authSetUsername: 'auth:setUsername',
  authSignOut: 'auth:signOut',
  judgeEffect: 'judge:effect',
  judgeAsk: 'judge:ask',
  judgeTest: 'judge:test'
} as const

/** URL da imagem de uma carta de Pokémon (cache local). quality: low (listas) ou high (detalhes). */
export function pkmImageUrl(printingId: string | undefined, quality: 'low' | 'high' = 'low'): string {
  return printingId ? `kard-img://ptcg/${encodeURIComponent(printingId)}/${quality}` : ''
}

/** URL da imagem de uma carta de jogo genérico (cache local). size: small (listas) ou large (detalhes). */
export function gameImageUrl(game: string, printingId: string | undefined, size: 'small' | 'large' = 'small'): string {
  return printingId ? `kard-img://g/${game}/${encodeURIComponent(printingId)}/${size}` : ''
}

/** URL da imagem de playmat do usuário. */
export function playmatImageUrl(name: string | null | undefined): string {
  return name ? `kard-img://playmat/${encodeURIComponent(name)}` : ''
}

/** URL do protocolo de imagens com cache local. size: small | normal | large | art. face: 0 frente, 1 verso. */
export function cardImageUrl(printingId: string | undefined, size: 'small' | 'normal' | 'large' | 'art' = 'normal', face = 0): string {
  if (!printingId) return ''
  return `kard-img://card/${printingId}/${size}/${face}`
}
