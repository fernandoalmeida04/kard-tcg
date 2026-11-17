// Mesas online: lobby, anfitrião sequenciador e aplicação das jogadas em ordem.
// Veja o protocolo em src/shared/online/protocol.ts.
import { create } from 'zustand'
import type { Deck } from '@shared/types'
import { getFormat, isCommanderFormat } from '@shared/formats'
import type { GameCard } from '@shared/engine'
import { createSandbox, performSandbox, type SAction, type SSetup } from '@shared/sandbox'
import type { CompactCard, CompactDeck, LobbyPlayer, OnlineAct, OnlinePresence, OnlineSetup, RoomConfig, RoomMessage, RoomMode } from '@shared/online/protocol'
import { makeRoomCode, normalizeRoomCode } from '@shared/online/protocol'
import { t } from '@shared/i18n'
import { getCards, getPrintings } from '../cardCache'
import { finishOf } from '../components/common'
import { toGameCard } from '../game/gameCards'
import { getPkmFormat } from '@shared/pokemon/formats'
import { pkmDeckToGameCards } from '../pokemon/play/pkmSetup'
import { PLAYER_COLORS, registerOnline, useSandbox, type Verdict } from '../sandbox/sandboxStore'
import { useApp } from '../store'
import { useAuth } from '../auth/authStore'

export type OnlinePhase = 'idle' | 'connecting' | 'lobby' | 'game'

interface OnlineStore {
  phase: OnlinePhase
  error: string | null
  myId: string | null
  config: RoomConfig | null
  players: LobbyPlayer[]
  started: boolean
  presence: OnlinePresence[]
  /** Partida em andamento */
  setup: OnlineSetup | null
  mySeat: number | null
  acts: OnlineAct[]
  /** Ações recebidas fora de ordem, esperando as anteriores. */
  buffer: Record<number, OnlineAct>
  chat: { userId: string; username: string; text: string }[]
  /** Playmats recebidos dos outros jogadores (userId → data URL). */
  mats: Record<string, string>

  createRoom: (mode: RoomMode, format: string, tcg?: OnlineTcg) => Promise<void>
  joinRoom: (code: string) => Promise<void>
  leave: () => Promise<void>
  setDeck: (deck: Pick<Deck, 'name' | 'main'> & { commanders?: Deck['commanders'] }) => void
  setReady: (ready: boolean) => void
  kick: (userId: string) => void
  startGame: () => Promise<void>
  /** Cor do jogador no histórico. */
  setColor: (color: string) => void
  /** Jogada local (a interface da mesa chama isto em vez de aplicar direto). */
  submit: (action: SAction) => void
  sendChat: (text: string) => void
}

let unsubs: (() => void)[] = []
// playmat: o meu (já reduzido) e os que estão chegando em pedaços
let myMat: { id: string; data: string } | null | undefined
let lastMatSent = 0
const matAcc = new Map<string, { id: string; parts: string[] }>()
const MAT_CHUNK = 48_000

/** Envia o meu playmat para a mesa (em pedaços). */
async function shareMyMat(force = false): Promise<void> {
  const s = useOnline.getState()
  if (!s.myId) return
  if (!force && Date.now() - lastMatSent < 3000) return
  lastMatSent = Date.now()
  if (myMat === undefined) {
    try {
      const data = await window.kard.settings.playmatShareData()
      myMat = data ? { id: Math.random().toString(36).slice(2, 10), data } : null
    } catch {
      // app aberto antes da atualização (IPC novo só existe após reiniciar)
      myMat = null
    }
  }
  if (!myMat) return
  const total = Math.ceil(myMat.data.length / MAT_CHUNK)
  for (let i = 0; i < total; i++) {
    send({ type: 'mat', userId: s.myId, id: myMat.id, part: i, total, data: myMat.data.slice(i * MAT_CHUNK, (i + 1) * MAT_CHUNK) })
  }
}
let lobbyTimer: ReturnType<typeof setTimeout> | null = null
const pendingIntents = new Map<string, SAction>()

const isHost = () => {
  const s = useOnline.getState()
  return Boolean(s.myId && s.config && s.config.hostId === s.myId)
}

function send(msg: RoomMessage): void {
  void window.kard.online.send(msg)
}

function myName(): string {
  const u = useAuth.getState().user
  return u?.username ?? u?.email ?? t('Jogador')
}

/** Converte o deck salvo para o formato compacto enviado pela rede. */
export function toCompactDeck(deck: Pick<Deck, 'name' | 'main'> & { commanders?: Deck['commanders'] }): CompactDeck {
  const c = (x: Deck['main'][number]): CompactCard => ({ o: x.oracleId, p: x.printingId, f: x.finish, q: x.qty })
  return { name: deck.name, commanders: (deck.commanders ?? []).map(c), main: deck.main.map(c) }
}

// ---------------- Mesa livre (Magic ou Pokémon) ----------------

export type OnlineTcg = 'mtg' | 'pokemon'

/** Monta as cartas da partida a partir do deck compacto, usando o banco local. */
async function compactToGameCards(d: CompactDeck): Promise<{ deck: GameCard[]; commanders: GameCard[]; missing: number }> {
  const all = [...d.commanders, ...d.main]
  const cards = await getCards(all.map((c) => c.o))
  const prints = await getPrintings(all.map((c) => c.p ?? cards[c.o]?.defaultPrintingId).filter(Boolean) as string[])
  let missing = 0
  const make = (c: CompactCard): GameCard | null => {
    const card = cards[c.o]
    if (!card) {
      missing++
      return null
    }
    const gc = toGameCard(card, c.p)
    const fin = finishOf(prints[gc.printingId ?? ''], c.f)
    if (fin) gc.finish = fin
    return gc
  }
  const deck: GameCard[] = []
  for (const c of d.main) for (let i = 0; i < c.q; i++) {
    const gc = make(c)
    if (gc) deck.push(gc)
  }
  const commanders = d.commanders.map(make).filter(Boolean) as GameCard[]
  return { deck, commanders, missing }
}

/** Setup da mesa livre a partir do setup da mesa online (cada computador monta as cartas pelo próprio banco). */
async function buildSandboxSetup(s: OnlineSetup): Promise<SSetup> {
  const game = s.tcg === 'pokemon' ? 'pokemon' : 'mtg'
  const players: SSetup['players'] = []
  for (const [i, p] of s.players.entries()) {
    const color = p.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]
    if (game === 'pokemon') {
      const g = await pkmDeckToGameCards(p.deck.main.map((c) => ({ cardId: c.o, printingId: c.p, qty: c.q })))
      if (g.missing) throw new Error(t('Faltam {n} cartas do deck de {name} no seu banco local. Atualize o banco de cartas de Pokémon.', { n: g.missing, name: p.username }))
      players.push({ name: p.username, color, isBot: false, deck: g.cards.map((x) => ({ card: x.card, printingId: x.printingId })) })
    } else {
      const g = await compactToGameCards(p.deck)
      if (g.missing) throw new Error(t('Faltam {n} cartas do deck de {name} no seu banco local. Atualize o banco de cartas (Download de cartas).', { n: g.missing, name: p.username }))
      players.push({ name: p.username, color, isBot: false, deck: g.deck.map((card) => ({ card, printingId: card.printingId })), commanders: g.commanders.map((card) => ({ card, printingId: card.printingId })) })
    }
  }
  return { game, format: s.format, seed: s.seed, firstPlayer: s.firstPlayer, startingLife: s.startingLife, freeMulligan: game === 'mtg' && /commander/i.test(s.format), players }
}

/** Aplica as ações recebidas em ordem; ações fora de ordem esperam no buffer. */
function drainActs(): void {
  const s = useOnline.getState()
  if (!useSandbox.getState().state) return
  const acts = [...s.acts]
  const buffer = { ...s.buffer }
  while (buffer[acts.length]) {
    const a = buffer[acts.length]
    delete buffer[acts.length]
    const err = useSandbox.getState().applyAccepted(a.seat, a.action as SAction)
    if (err) {
      // estado divergiu (não deveria acontecer): pede tudo de novo ao anfitrião
      console.warn('[online] ação recusada localmente, ressincronizando:', err, a)
      useOnline.setState({ buffer: {} })
      send({ type: 'sync-req', userId: s.myId!, fromSeq: 0 })
      return
    }
    acts.push(a)
  }
  useOnline.setState({ acts, buffer })
}

/** Anfitrião: aplica a jogada, numera e publica. */
function hostAccept(seat: number, action: SAction, nonce?: string): string | null {
  const err = useSandbox.getState().applyAccepted(seat, action)
  if (err) {
    if (nonce) send({ type: 'reject', seat, nonce, error: err })
    return err
  }
  const s = useOnline.getState()
  const act: OnlineAct = { seq: s.acts.length, seat, action }
  useOnline.setState({ acts: [...s.acts, act] })
  send({ type: 'act', ...act })
  return null
}

function broadcastLobby(): void {
  const s = useOnline.getState()
  if (!isHost() || !s.config) return
  send({ type: 'lobby', config: s.config, players: s.players, started: s.started })
}

async function startFromSetup(setup: OnlineSetup, acts: OnlineAct[]): Promise<void> {
  const s = useOnline.getState()
  const mySeat = setup.players.findIndex((p) => p.userId === s.myId)
  if (mySeat < 0) {
    useOnline.setState({ error: t('Esta partida já começou sem você.') })
    return
  }
  try {
    const sb = await buildSandboxSetup(setup)
    let state = createSandbox(sb)
    const history: { seat: number; action: SAction }[] = []
    for (const a of acts) {
      const r = performSandbox(state, a.seat, a.action as SAction)
      if (r.error) throw new Error(t('Não foi possível reproduzir a partida ({error}).', { error: r.error }))
      state = r.state
      history.push({ seat: a.seat, action: a.action as SAction })
    }
    useOnline.setState({ phase: 'game', setup, mySeat, acts: [...acts], buffer: {}, started: true })
    useSandbox.setState({
      state,
      history,
      verdicts: {},
      botBusy: false,
      meta: { game: sb.game, format: setup.format, mySeat, bots: [], deckNames: setup.players.map((p) => p.deck.name), online: { code: s.config?.code ?? '', isHost: isHost() }, setup: sb }
    })
    useApp.getState().setInGame(true)
    // todos veem os playmats de todos: mando o meu e peço os dos outros
    await shareMyMat(true)
    send({ type: 'mat-req', userId: s.myId! })
  } catch (err) {
    useOnline.setState({ error: (err as Error).message })
  }
}

// a mesa livre envia jogadas e vereditos do juiz por aqui
registerOnline(
  (action) => useOnline.getState().submit(action),
  (logId, v) => {
    const s = useOnline.getState()
    if (s.myId) send({ type: 'judge', userId: s.myId, logId, verdict: { valid: Boolean(v.valid), title: v.title ?? '', explanation: v.explanation ?? '', by: v.by } })
  }
)

// sync recebido em pedaços
let syncAcc: { setup: OnlineSetup; acts: OnlineAct[] } | null = null

async function onMessage(msg: RoomMessage): Promise<void> {
  const s = useOnline.getState()
  const host = isHost()
  switch (msg.type) {
    case 'hello': {
      if (!host || !s.config) return
      if (!s.started && !s.players.some((p) => p.userId === msg.userId) && s.players.length < s.config.maxPlayers) {
        const used = s.players.map((p) => p.color)
        const color = PLAYER_COLORS.find((c) => !used.includes(c)) ?? PLAYER_COLORS[s.players.length % PLAYER_COLORS.length]
        useOnline.setState({ players: [...s.players, { userId: msg.userId, username: msg.username, ready: false, color }] })
      }
      broadcastLobby()
      return
    }
    case 'lobby': {
      if (host) return
      if (lobbyTimer) clearTimeout(lobbyTimer)
      const seated = msg.players.some((p) => p.userId === s.myId)
      if (!seated && !msg.started && msg.players.length >= msg.config.maxPlayers) {
        useOnline.setState({ error: t('Esta mesa está cheia.') })
        await useOnline.getState().leave()
        return
      }
      useOnline.setState({ config: msg.config, players: msg.players, started: msg.started, phase: s.phase === 'connecting' ? 'lobby' : s.phase })
      // entrou (ou voltou) numa partida já iniciada: pede o histórico
      if (msg.started && seated && s.phase !== 'game') send({ type: 'sync-req', userId: s.myId!, fromSeq: 0 })
      return
    }
    case 'deck':
    case 'ready':
    case 'color': {
      if (!host) return
      const players = s.players.map((p) => (p.userId !== msg.userId ? p : msg.type === 'deck' ? { ...p, deck: msg.deck, ready: false } : msg.type === 'color' ? { ...p, color: msg.color } : { ...p, ready: msg.ready }))
      useOnline.setState({ players })
      broadcastLobby()
      return
    }
    case 'leave': {
      if (!host) return
      if (!s.started) {
        useOnline.setState({ players: s.players.filter((p) => p.userId !== msg.userId) })
        broadcastLobby()
      }
      return
    }
    case 'kick': {
      if (msg.userId === s.myId) {
        useOnline.setState({ error: t('Você foi removido da mesa pelo anfitrião.') })
        await useOnline.getState().leave()
      }
      return
    }
    case 'start': {
      if (host) return
      await startFromSetup(msg.setup, [])
      return
    }
    case 'intent': {
      if (!host) return
      hostAccept(msg.seat, msg.action as SAction, msg.nonce)
      return
    }
    case 'act': {
      if (host || s.phase !== 'game') return
      if (msg.seq < s.acts.length) return
      pendingIntents.forEach((_, nonce) => pendingIntents.delete(nonce))
      useOnline.setState({ buffer: { ...useOnline.getState().buffer, [msg.seq]: { seq: msg.seq, seat: msg.seat, action: msg.action } } })
      drainActs()
      return
    }
    case 'reject': {
      if (msg.seat !== s.mySeat || !pendingIntents.has(msg.nonce)) return
      pendingIntents.delete(msg.nonce)
      useApp.getState().toast(msg.error, 'judge')
      return
    }
    case 'sync-req': {
      if (!host || !s.setup) return
      const acts = s.acts.slice(msg.fromSeq)
      // em pedaços para não passar do limite de tamanho das mensagens
      const CHUNK = 150
      for (let i = 0; i < Math.max(1, acts.length); i += CHUNK) {
        send({ type: 'sync', to: msg.userId, setup: s.setup, acts: acts.slice(i, i + CHUNK), final: i + CHUNK >= acts.length })
      }
      return
    }
    case 'sync': {
      if (host || msg.to !== s.myId) return
      syncAcc = syncAcc ? { setup: msg.setup, acts: [...syncAcc.acts, ...msg.acts] } : { setup: msg.setup, acts: [...msg.acts] }
      if (msg.final) {
        const acc = syncAcc
        syncAcc = null
        await startFromSetup(acc.setup, acc.acts)
      }
      return
    }
    case 'mat': {
      if (msg.userId === s.myId || typeof msg.data !== 'string' || msg.total > 40) return
      let acc = matAcc.get(msg.userId)
      if (!acc || acc.id !== msg.id) {
        acc = { id: msg.id, parts: new Array(msg.total).fill('') }
        matAcc.set(msg.userId, acc)
      }
      acc.parts[msg.part] = msg.data
      if (acc.parts.every(Boolean)) {
        matAcc.delete(msg.userId)
        const url = acc.parts.join('')
        if (url.startsWith('data:image/')) useOnline.setState({ mats: { ...useOnline.getState().mats, [msg.userId]: url } })
      }
      return
    }
    case 'mat-req': {
      if (msg.userId !== s.myId && s.phase === 'game') await shareMyMat()
      return
    }
    case 'judge': {
      if (msg.userId === s.myId) return
      const v: Verdict = { valid: msg.verdict.valid, title: msg.verdict.title, explanation: msg.verdict.explanation, by: msg.verdict.by }
      useSandbox.getState().setVerdict(msg.logId, v)
      return
    }
    case 'chat': {
      useOnline.setState({ chat: [...s.chat, { userId: msg.userId, username: msg.username, text: msg.text }].slice(-100) })
      return
    }
  }
}

async function connect(code: string): Promise<boolean> {
  for (const u of unsubs) u()
  unsubs = [
    window.kard.online.onMessage((m) => void onMessage(m)),
    window.kard.online.onPresence((presence) => useOnline.setState({ presence })),
    window.kard.online.onStatus((st) => {
      if (st === 'error') useOnline.setState({ error: t('A conexão com a mesa caiu. Tentando reconectar...') })
    })
  ]
  const r = await window.kard.online.join(code)
  if (!r.ok) {
    useOnline.setState({ phase: 'idle', error: r.error ?? t('Não foi possível conectar à mesa.') })
    return false
  }
  useOnline.setState({ myId: r.userId ?? null })
  return true
}

const EMPTY = {
  phase: 'idle' as OnlinePhase,
  config: null,
  players: [],
  started: false,
  presence: [],
  setup: null,
  mySeat: null,
  acts: [],
  buffer: {},
  chat: [],
  mats: {}
}

export const useOnline = create<OnlineStore>((set, get) => ({
  ...EMPTY,
  error: null,
  myId: null,

  createRoom: async (mode, format, tcg = 'mtg') => {
    myMat = undefined
    set({ ...EMPTY, phase: 'connecting', error: null })
    const code = makeRoomCode()
    if (!(await connect(code))) return
    const myId = get().myId!
    const config: RoomConfig = { code, mode: tcg === 'pokemon' ? 'duel' : mode, format: format as RoomConfig['format'], maxPlayers: mode === 'commander' && tcg !== 'pokemon' ? 4 : 2, hostId: myId, tcg }
    set({ phase: 'lobby', config, players: [{ userId: myId, username: myName(), ready: false, color: PLAYER_COLORS[1] }] })
    broadcastLobby()
  },

  joinRoom: async (raw) => {
    const code = normalizeRoomCode(raw)
    if (code.length !== 6) {
      set({ error: t('O código da mesa tem 6 caracteres.') })
      return
    }
    myMat = undefined
    set({ ...EMPTY, phase: 'connecting', error: null })
    if (!(await connect(code))) return
    send({ type: 'hello', userId: get().myId!, username: myName() })
    // sem resposta do anfitrião: a mesa não existe (ou ele saiu)
    lobbyTimer = setTimeout(() => {
      if (get().phase === 'connecting') {
        set({ phase: 'idle', error: t('Mesa {code} não encontrada. Confira o código ou peça ao anfitrião para abrir a mesa de novo.', { code }) })
        void window.kard.online.leave()
      }
    }, 8000)
  },

  leave: async () => {
    const s = get()
    if (s.myId && s.config) send({ type: 'leave', userId: s.myId })
    for (const u of unsubs) u()
    unsubs = []
    await window.kard.online.leave()
    if (s.phase === 'game') {
      useSandbox.getState().quit()
      useApp.getState().setInGame(false)
    }
    set({ ...EMPTY })
  },

  setDeck: (deck) => {
    const s = get()
    if (!s.myId) return
    const compact = toCompactDeck(deck)
    if (isHost()) {
      set({ players: s.players.map((p) => (p.userId === s.myId ? { ...p, deck: compact, ready: false } : p)) })
      broadcastLobby()
    } else send({ type: 'deck', userId: s.myId, deck: compact })
  },

  setReady: (ready) => {
    const s = get()
    if (!s.myId) return
    if (isHost()) {
      set({ players: s.players.map((p) => (p.userId === s.myId ? { ...p, ready } : p)) })
      broadcastLobby()
    } else send({ type: 'ready', userId: s.myId, ready })
  },

  kick: (userId) => {
    if (!isHost()) return
    send({ type: 'kick', userId })
    set({ players: get().players.filter((p) => p.userId !== userId) })
    broadcastLobby()
  },

  startGame: async () => {
    const s = get()
    if (!isHost() || !s.config) return
    if (s.players.length < 2) {
      set({ error: t('São necessários pelo menos 2 jogadores.') })
      return
    }
    if (s.players.some((p) => !p.deck || !p.ready)) {
      set({ error: t('Todos precisam escolher um deck e marcar "Pronto".') })
      return
    }
    const pokemon = s.config.tcg === 'pokemon'
    const fmt = getFormat(s.config.format)
    const setup: OnlineSetup = {
      seed: Math.floor(Math.random() * 2 ** 31),
      firstPlayer: Math.floor(Math.random() * s.players.length),
      format: pokemon ? getPkmFormat(s.config.format).name : fmt.name,
      startingLife: pokemon ? 0 : s.config.mode === 'commander' && s.players.length > 2 ? 40 : fmt.startingLife,
      players: s.players.map((p, i) => ({ userId: p.userId, username: p.username, deck: p.deck!, color: p.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length] })),
      tcg: s.config.tcg ?? 'mtg'
    }
    set({ started: true, setup })
    broadcastLobby()
    send({ type: 'start', setup })
    await startFromSetup(setup, [])
  },

  submit: (action) => {
    const s = get()
    if (s.phase !== 'game' || s.mySeat === null) return
    if (isHost()) {
      const err = hostAccept(s.mySeat, action)
      if (err) useApp.getState().toast(err, 'error')
      return
    }
    const nonce = Math.random().toString(36).slice(2, 10)
    pendingIntents.set(nonce, action)
    send({ type: 'intent', seat: s.mySeat, nonce, action })
  },

  setColor: (color) => {
    const s = get()
    if (!s.myId) return
    if (isHost()) {
      set({ players: s.players.map((p) => (p.userId === s.myId ? { ...p, color } : p)) })
      broadcastLobby()
    } else send({ type: 'color', userId: s.myId, color })
  },

  sendChat: (text) => {
    const s = get()
    const msg = text.trim().slice(0, 300)
    if (!msg || !s.myId) return
    const entry = { userId: s.myId, username: myName(), text: msg }
    set({ chat: [...s.chat, entry].slice(-100) })
    send({ type: 'chat', ...entry })
  }
}))

/** Formatos permitidos em cada modo de mesa. */
export function formatsForMode(mode: RoomMode): string[] {
  return mode === 'commander' ? ['commander'] : ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'historic', 'timeless', 'premodern', 'penny', 'duel', 'casual']
}

export { isCommanderFormat }
