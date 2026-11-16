// Controlador da partida na interface: aplica ações do humano, roda o bot, o auto-passe e o Juiz IA.
import { create } from 'zustand'
import {
  actingPlayer,
  activateInfo,
  availableManaCount,
  botAction,
  botFallback,
  castInfo,
  createGame,
  describeChosenTargets,
  hasInstantSpeedPlay,
  isAlive,
  livingPlayers,
  opponents,
  parseManaCost,
  performAction,
  recentLog,
  stateSummary,
  targetCandidates,
  type Action,
  type AttackTarget,
  type EffectBlock,
  type GameSetup,
  type GameState,
  type PlayerId,
  type TargetChoice,
  type TargetSpec
} from '@shared/engine'
import { useApp } from '../store'
import { t } from '@shared/i18n'
// Import circular (onlineStore também importa este módulo): usado só dentro de funções, nunca no topo.
import { useOnline } from '../online/onlineStore'

/** Assentos das partidas locais (teste de deck): humano no 0, bot no 1. */
export const HUMAN: PlayerId = 0
export const BOT: PlayerId = 1

/** Meu assento na mesa: o assento online ou o humano (0) nas partidas locais. */
export function mySeat(): PlayerId {
  return useGame.getState().meta?.online?.mySeat ?? HUMAN
}

/** Hook: meu assento. */
export function useMySeat(): PlayerId {
  return useGame((s) => s.meta?.online?.mySeat ?? HUMAN)
}

/** Assento do bot: só existe nas partidas locais. */
export function botSeat(): PlayerId | null {
  const m = useGame.getState().meta
  return m && !m.online ? BOT : null
}

/** Defensor padrão dos ataques: o escolhido (se ainda for um oponente vivo) ou o próximo oponente. */
export function currentDefender(state: GameState, me: PlayerId, chosen: PlayerId | null): PlayerId | null {
  const opps = opponents(state, me)
  if (chosen !== null && opps.includes(chosen)) return chosen
  return opps[0] ?? null
}

// Partidas online: evita reenviar a mesma jogada (ex.: o passe automático) enquanto o anfitrião não confirma.
let lastSubmit: { state: GameState; key: string; at: number } | null = null

export interface Selecting {
  kind: 'cast' | 'activate' | 'trigger'
  id?: string
  ability?: number
  face?: number
  mode?: number
  modes?: number[]
  x?: number
  extra?: string[]
  sourceId?: string
  specs: TargetSpec[]
  chosen: (TargetChoice | null)[]
  label: string
}

export interface PendingPrompt {
  kind: 'x' | 'mode' | 'cost'
  id: string
  face?: number
  ability?: number
  modes?: EffectBlock[]
  chooseCount?: number
  maxX?: number
  mode?: number | number[]
  x?: number
  forActivate?: boolean
  /** Custo adicional: cartas candidatas e quantidade. */
  costKind?: 'sacrifice' | 'discard'
  candidates?: string[]
  count?: number
  costText?: string
}

export interface GameMeta {
  format: string
  humanName: string
  botName: string
  humanDeck: string
  botDeck: string
  /** Teste sozinho: o oponente não joga (mantém a mão, passa, não ataca nem bloqueia). */
  goldfish?: boolean
  /** Partida online: código da mesa, meu assento e se sou o anfitrião. */
  online?: { code: string; mySeat: number; isHost: boolean }
  setup: GameSetup
}

interface ChatMsg {
  q: string
  a?: string
  error?: string
}

interface GameStore {
  state: GameState | null
  meta: GameMeta | null
  sel: Selecting | null
  prompt: PendingPrompt | null
  attackers: Record<string, AttackTarget>
  blocks: { blocker: string; attacker: string }[]
  pendingBlocker: string | null
  /** Oponente escolhido como alvo padrão dos ataques (null = próximo oponente). */
  defender: PlayerId | null
  hover: string | null
  aiBusy: boolean
  passUntilTurn: number | null
  chat: ChatMsg[]
  start: (setup: GameSetup, meta: Omit<GameMeta, 'setup'>) => void
  restart: () => void
  quit: () => void
  act: (a: Action, p?: PlayerId) => boolean
  beginCast: (id: string, face?: number) => void
  beginActivate: (id: string, ability: number) => void
  continuePrompt: (value: number | number[]) => void
  continueCost: (ids: string[]) => void
  chooseTarget: (t: TargetChoice | null) => void
  cancelSel: () => void
  setHover: (id: string | null) => void
  toggleAttacker: (id: string, target?: AttackTarget) => void
  setDefender: (p: PlayerId) => void
  setAllAttackers: (ids: string[]) => void
  pickBlocker: (id: string) => void
  assignBlock: (attackerId: string) => void
  removeBlock: (blockerId: string) => void
  passTurn: () => void
  botStep: () => void
  aiStep: () => Promise<void>
  ask: (q: string) => Promise<void>
}

function judgeError(msg: string): void {
  useApp.getState().toast(msg, 'judge')
}

export const useGame = create<GameStore>((set, get) => ({
  state: null,
  meta: null,
  sel: null,
  prompt: null,
  attackers: {},
  blocks: [],
  pendingBlocker: null,
  defender: null,
  hover: null,
  aiBusy: false,
  passUntilTurn: null,
  chat: [],

  start: (setup, meta) => {
    const state = createGame(setup)
    set({ state, meta: { ...meta, setup }, sel: null, prompt: null, attackers: {}, blocks: [], pendingBlocker: null, defender: null, aiBusy: false, passUntilTurn: null, chat: [] })
  },
  restart: () => {
    const m = get().meta
    if (!m) return
    get().start({ ...m.setup, seed: undefined, firstPlayer: undefined }, m)
  },
  quit: () => set({ state: null, meta: null, sel: null, prompt: null }),

  act: (a, p) => {
    const st = get().state
    if (!st) return false
    const me = mySeat()
    const seat = p ?? me
    const clear: Partial<GameStore> = {}
    if (a.t === 'attack') clear.attackers = {}
    if (a.t === 'block') {
      clear.blocks = []
      clear.pendingBlocker = null
    }
    const online = get().meta?.online
    if (online) {
      // Online: a jogada vai para o anfitrião (onlineStore.submit), que valida e publica; o novo estado
      // chega por hostAccept/drainActs. Só o anfitrião age por outro assento (resultado do Juiz IA).
      if (seat !== me && !online.isHost) return false
      const key = `${seat}|${JSON.stringify(a)}`
      const now = Date.now()
      if (lastSubmit && lastSubmit.state === st && lastSubmit.key === key && now - lastSubmit.at < 4000) return true
      lastSubmit = { state: st, key, at: now }
      useOnline.getState().submit(a, seat)
      set(clear) // otimista: limpa as seleções da interface
      return true
    }
    const r = performAction(st, seat, a)
    if (r.error) {
      if (seat === me) judgeError(r.error)
      return false
    }
    set({ ...clear, state: r.state })
    return true
  },

  beginCast: (id, face = 0) => {
    const st = get().state
    if (!st) return
    const info = castInfo(st, mySeat(), id, face, undefined, 0)
    if (info.error && !(info.needsX && /Mana insuficiente|Not enough mana/i.test(info.error))) {
      judgeError(info.error)
      return
    }
    if (info.modes && info.modes.length > 1) {
      set({ prompt: { kind: 'mode', id, face, modes: info.modes, chooseCount: info.chooseCount } })
      return
    }
    if (info.needsX) {
      const pc = parseManaCost(info.cost)
      const maxX = Math.max(0, Math.floor((availableManaCount(st, mySeat()) - pc.generic - pc.reqs.length - info.tax) / Math.max(1, pc.x)))
      set({ prompt: { kind: 'x', id, face, maxX } })
      return
    }
    finishCastSetup(id, face, info.modes ? 0 : undefined, undefined)
  },

  continueCost: (ids) => {
    const pr = get().prompt
    if (!pr || pr.kind !== 'cost') return
    set({ prompt: null })
    finishCastSetup(pr.id, pr.face ?? 0, pr.mode, pr.x, ids)
  },

  beginActivate: (id, ability) => {
    const st = get().state
    if (!st) return
    const info = activateInfo(st, mySeat(), id, ability, 0)
    if (info.error && !info.needsX) {
      judgeError(info.error)
      return
    }
    if (info.needsX) {
      set({ prompt: { kind: 'x', id, ability, forActivate: true, maxX: 20 } })
      return
    }
    finishActivateSetup(id, ability, undefined)
  },

  continuePrompt: (value) => {
    const pr = get().prompt
    if (!pr) return
    set({ prompt: null })
    if (pr.kind === 'mode') {
      const st = get().state!
      const info = castInfo(st, mySeat(), pr.id, pr.face ?? 0, value, 0)
      if (info.needsX) {
        set({ prompt: { kind: 'x', id: pr.id, face: pr.face, mode: value, maxX: 20 } })
        return
      }
      finishCastSetup(pr.id, pr.face ?? 0, value, undefined)
      return
    }
    const x = typeof value === 'number' ? value : 0
    if (pr.forActivate) finishActivateSetup(pr.id, pr.ability!, x)
    else finishCastSetup(pr.id, pr.face ?? 0, pr.mode, x)
  },

  chooseTarget: (choice) => {
    const sel = get().sel
    const st = get().state
    if (!sel || !st) return
    const spec = sel.specs[sel.chosen.length]
    if (choice) {
      const ok = targetCandidates(st, mySeat(), spec, sel.sourceId).some((c) => JSON.stringify(c) === JSON.stringify(choice))
      if (!ok) {
        judgeError(t('Alvo inválido para "{target}".', { target: spec.text }))
        return
      }
    } else if (!spec.optional) return
    const chosen = [...sel.chosen, choice]
    if (chosen.length < sel.specs.length) {
      set({ sel: { ...sel, chosen } })
      return
    }
    set({ sel: null })
    if (sel.kind === 'cast') get().act({ t: 'cast', id: sel.id!, targets: chosen, x: sel.x, face: sel.face, mode: sel.mode, modes: sel.modes, extra: sel.extra })
    else if (sel.kind === 'activate') get().act({ t: 'activate', id: sel.id!, ability: sel.ability!, targets: chosen, x: sel.x })
    else get().act({ t: 'chooseTargets', targets: chosen })
  },

  cancelSel: () => {
    const sel = get().sel
    if (sel?.kind === 'trigger') return // gatilhos precisam de alvo
    set({ sel: null, prompt: null })
  },

  setHover: (id) => set({ hover: id }),

  toggleAttacker: (id, target) => {
    const st = get().state
    if (!st) return
    const cur = { ...get().attackers }
    if (cur[id] && !target) delete cur[id]
    else if (target) cur[id] = target
    else {
      const def = currentDefender(st, mySeat(), get().defender)
      if (def === null) return
      cur[id] = { kind: 'player', player: def }
    }
    set({ attackers: cur })
  },
  setDefender: (p) => set({ defender: p }),
  setAllAttackers: (ids) => {
    const st = get().state
    if (!st) return
    const def = currentDefender(st, mySeat(), get().defender)
    if (def === null) return
    const cur: Record<string, AttackTarget> = {}
    for (const id of ids) cur[id] = { kind: 'player', player: def }
    set({ attackers: cur })
  },
  pickBlocker: (id) => {
    const existing = get().blocks.find((b) => b.blocker === id)
    if (existing) {
      get().removeBlock(id)
      return
    }
    set({ pendingBlocker: get().pendingBlocker === id ? null : id })
  },
  assignBlock: (attackerId) => {
    const b = get().pendingBlocker
    if (!b) return
    set({ blocks: [...get().blocks.filter((x) => x.blocker !== b), { blocker: b, attacker: attackerId }], pendingBlocker: null })
  },
  removeBlock: (blockerId) => set({ blocks: get().blocks.filter((b) => b.blocker !== blockerId) }),

  passTurn: () => {
    const st = get().state
    if (!st) return
    set({ passUntilTurn: st.turn })
    const me = mySeat()
    if (st.priority === me && actingPlayer(st) === me) get().act({ t: 'pass' })
  },

  botStep: () => {
    const st = get().state
    // o bot só existe nas partidas locais
    if (!st || get().meta?.online || actingPlayer(st) !== BOT) return
    let a: Action | null
    try {
      a = get().meta?.goldfish ? botFallback(st, BOT) : botAction(st, BOT)
    } catch (err) {
      console.error('[bot] erro ao decidir a jogada:', err)
      a = botFallback(st, BOT)
    }
    if (!a) return
    const r = performAction(st, BOT, a)
    if (!r.error) {
      set({ state: r.state })
      return
    }
    console.warn('[bot] ação recusada pelo juiz:', r.error, a)
    const fb = performAction(st, BOT, botFallback(st, BOT))
    if (!fb.error) set({ state: fb.state })
    else console.error('[bot] fallback recusado:', fb.error)
  },

  aiStep: async () => {
    const st = get().state
    if (!st?.pendingAI || get().aiBusy) return
    const online = get().meta?.online
    // online: só o anfitrião consulta o Juiz IA; o resultado vira uma ação publicada para todos
    if (online && !online.isHost) return
    set({ aiBusy: true })
    const item = st.pendingAI.item
    const srcId = item.sourceId ?? item.objectId
    const card = srcId ? st.objects[srcId]?.card : undefined
    const res = await window.kard.judge.resolveEffect({
      cardName: card?.name ?? item.sourceName,
      cardText: card?.oracleText ?? item.block.text,
      effectText: st.pendingAI.text,
      controller: item.controller === mySeat() ? 'human' : 'bot',
      chosenTargets: describeChosenTargets(st, item.targets),
      stateSummary: stateSummary(st, item.controller)
    })
    set({ aiBusy: false })
    const cur = get().state
    if (!cur?.pendingAI) return
    // quem "age" é o controlador do efeito; se ele já foi eliminado, qualquer jogador vivo
    const seat = isAlive(cur, item.controller) ? item.controller : (livingPlayers(cur)[0] ?? item.controller)
    if (res.ok) get().act({ t: 'aiResolve', ops: res.operations, explanation: res.explanation }, seat)
    else {
      useApp.getState().toast(t('Juiz IA: {error}', { error: res.error ?? '' }), 'error')
      get().act({ t: 'aiSkip', reason: res.error ?? t('erro') }, seat)
    }
  },

  ask: async (q) => {
    const st = get().state
    if (!st) return
    const idx = get().chat.length
    set({ chat: [...get().chat, { q }] })
    const r = await window.kard.judge.ask({ question: q, stateSummary: stateSummary(st, mySeat()), recentLog: recentLog(st) })
    const chat = [...get().chat]
    chat[idx] = { q, a: r.ok ? r.answer : undefined, error: r.ok ? undefined : r.error }
    set({ chat })
  }
}))

function finishCastSetup(id: string, face: number, modeSel: number | number[] | undefined, x: number | undefined, extra?: string[]): void {
  const g = useGame.getState()
  const st = g.state
  if (!st) return
  const info = castInfo(st, mySeat(), id, face, modeSel, x ?? 0)
  if (info.error) {
    judgeError(info.error)
    return
  }
  // custo adicional (sacrificar/descartar): pergunta antes dos alvos
  if (info.extraCost && !extra) {
    useGame.setState({
      prompt: { kind: 'cost', id, face, mode: modeSel, x, costKind: info.extraCost.kind, candidates: info.extraCost.candidates, count: info.extraCost.count, costText: info.extraCost.text }
    })
    return
  }
  const mode = typeof modeSel === 'number' ? modeSel : undefined
  const modes = Array.isArray(modeSel) ? modeSel : undefined
  const name = st.objects[id]?.card.displayName ?? ''
  if (info.block.targets.length === 0) {
    g.act({ t: 'cast', id, targets: [], x, face, mode, modes, extra })
    return
  }
  useGame.setState({ sel: { kind: 'cast', id, face, mode, modes, x, extra, sourceId: id, specs: info.block.targets, chosen: [], label: name } })
}

function finishActivateSetup(id: string, ability: number, x: number | undefined): void {
  const g = useGame.getState()
  const st = g.state
  if (!st) return
  const info = activateInfo(st, mySeat(), id, ability, x ?? 0)
  if (info.error) {
    judgeError(info.error)
    return
  }
  if (info.block.targets.length === 0) {
    g.act({ t: 'activate', id, ability, targets: [], x })
    return
  }
  useGame.setState({ sel: { kind: 'activate', id, ability, x, sourceId: id, specs: info.block.targets, chosen: [], label: st.objects[id]?.card.displayName ?? '' } })
}

/** Decide se o jogador `me` (por padrão, o meu assento) deve passar a prioridade automaticamente. */
export function shouldAutoPass(st: GameState, opts: { autoPass: boolean; stopAtEveryStep: boolean; passUntilTurn: number | null }, me: PlayerId = mySeat()): boolean {
  if (st.choices.length || st.awaiting || st.pendingAI || st.priority !== me) return false
  if (opts.passUntilTurn !== null && opts.passUntilTurn === st.turn) return true
  if (!opts.autoPass || opts.stopAtEveryStep) return false
  const top = st.stack[st.stack.length - 1]
  const canRespond = hasInstantSpeedPlay(st, me)
  if (top) return top.controller === me ? true : !canRespond
  if (st.activePlayer === me) {
    if (st.step === 'main1' || st.step === 'main2') return false
    if (st.step === 'declareBlockers' && st.combat?.blockersDeclared) return !canRespond
    return true
  }
  if (st.step === 'declareAttackers' && st.combat?.attackers.length) return !canRespond
  if (st.step === 'end') return !canRespond
  return true
}
