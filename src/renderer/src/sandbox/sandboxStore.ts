// Partida da mesa livre (Magic e Pokémon) na interface: estado, histórico de ações (para o Juiz IA
// reconstruir a mesa), vereditos do juiz e o bot por IA.
import { create } from 'zustand'
import { createSandbox, performSandbox, cardName, type SAction, type SSetup, type SState, type SGame } from '@shared/sandbox'
import { botPrompt, judgePrompt, parseBot, parseJudge, type JudgeVerdict } from '@shared/sandbox/ai'
import { t } from '@shared/i18n'
import { useApp } from '../store'

export const PLAYER_COLORS = ['#e4572e', '#2f80ed', '#27ae60', '#f2c94c', '#9b51e0', '#ff7eb6', '#00b8a9', '#f2994a']

export interface SandboxMeta {
  game: SGame
  format: string
  /** Meu assento (local: 0). */
  mySeat: number
  /** Assentos controlados pelo bot (partida local). */
  bots: number[]
  deckNames: string[]
  online?: { code: string; isHost: boolean }
  setup: SSetup
}

export interface Verdict extends Partial<JudgeVerdict> {
  by: string
  loading?: boolean
  error?: string
}

interface SandboxStore {
  state: SState | null
  meta: SandboxMeta | null
  /** Ações aplicadas, na ordem (índice = seq). */
  history: { seat: number; action: SAction }[]
  verdicts: Record<number, Verdict>
  botBusy: boolean
  botError: string | null
  hover: string | null
  start: (setup: SSetup, meta: Omit<SandboxMeta, 'setup'>) => void
  restart: () => void
  quit: () => void
  /** Ação do jogador (online vai para o anfitrião). `seat`: só para o bot / modo dois lados. */
  act: (a: SAction, seat?: number) => boolean
  /** Aplica uma ação já aceita (usado pelo modo online). */
  applyAccepted: (seat: number, a: SAction) => string | null
  callJudge: (logId: number) => Promise<void>
  setVerdict: (logId: number, v: Verdict) => void
  setHover: (id: string | null) => void
  botTurn: () => Promise<void>
  botBlocks: () => Promise<void>
}

/** Mesa logo antes (ou depois) de uma ação, reconstruída a partir do setup + histórico. */
export function replayTo(setup: SSetup, history: { seat: number; action: SAction }[], count: number): SState {
  let st = createSandbox(setup)
  for (let i = 0; i < count && i < history.length; i++) st = performSandbox(st, history[i].seat, history[i].action).state
  return st
}

let onlineSubmit: ((a: SAction) => void) | null = null
let onlineBroadcastVerdict: ((logId: number, v: Verdict) => void) | null = null
/** O modo online registra aqui como enviar jogadas e vereditos (evita import circular). */
export function registerOnline(submit: (a: SAction) => void, broadcast: (logId: number, v: Verdict) => void): void {
  onlineSubmit = submit
  onlineBroadcastVerdict = broadcast
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const useSandbox = create<SandboxStore>((set, get) => ({
  state: null,
  meta: null,
  history: [],
  verdicts: {},
  botBusy: false,
  botError: null,
  hover: null,

  start: (input, meta) => {
    // a semente e quem começa ficam fixos no setup: o Juiz IA reconstrói a mesa refazendo as ações
    // a partir dele, e sem isso o sorteio (e a ordem dos decks) sairia diferente
    const setup: SSetup = {
      ...input,
      seed: input.seed ?? Math.floor(Math.random() * 2 ** 31),
      firstPlayer: input.firstPlayer ?? Math.floor(Math.random() * input.players.length)
    }
    const state = createSandbox(setup)
    set({ state, meta: { ...meta, setup }, history: [], verdicts: {}, botBusy: false, botError: null, hover: null })
    // bot do Pokémon prepara o campo sozinho (Ativo, Banco e Prêmios) logo no começo
    if (setup.game === 'pokemon') for (const b of meta.bots) botSetupPokemon(b)
  },
  restart: () => {
    const m = get().meta
    if (!m) return
    get().start({ ...m.setup, seed: undefined, firstPlayer: undefined }, m)
  },
  quit: () => set({ state: null, meta: null, history: [], verdicts: {}, botBusy: false, hover: null }),

  act: (a, seat) => {
    const st = get().state
    const meta = get().meta
    if (!st || !meta) return false
    if (meta.online) {
      onlineSubmit?.(a)
      return true
    }
    const s = seat ?? meta.mySeat
    const r = performSandbox(st, s, a)
    if (r.error) {
      useApp.getState().toast(r.error, 'error')
      return false
    }
    set({ state: r.state, history: [...get().history, { seat: s, action: a }] })
    return true
  },

  applyAccepted: (seat, a) => {
    const st = get().state
    if (!st) return t('A partida não está em andamento.')
    const r = performSandbox(st, seat, a)
    if (r.error) return r.error
    set({ state: r.state, history: [...get().history, { seat, action: a }] })
    return null
  },

  callJudge: async (logId) => {
    const { state, meta, history } = get()
    if (!state || !meta) return
    const entry = state.log.find((e) => e.id === logId)
    if (!entry || entry.seq < 0) return
    const me = state.players[meta.mySeat]?.name ?? t('Jogador')
    get().setVerdict(logId, { by: me, loading: true })
    // segurança: a reconstrução tem que chegar exatamente à mesa atual; se não chegar, o juiz veria
    // outra partida (melhor avisar do que dar um veredito sobre a mesa errada)
    const full = replayTo(meta.setup, history, history.length)
    if (JSON.stringify(full.objects) !== JSON.stringify(state.objects) || full.log.length !== state.log.length) {
      get().setVerdict(logId, { by: me, error: t('Não foi possível reconstruir a mesa desta partida para o juiz (partida iniciada numa versão anterior?). Comece uma nova partida.') })
      return
    }
    const before = replayTo(meta.setup, history, entry.seq)
    const after = replayTo(meta.setup, history, entry.seq + 1)
    const act = history[entry.seq]
    const actor = entry.player !== undefined ? state.players[entry.player]?.name ?? '?' : '?'
    const { system, user } = judgePrompt(before, after, entry, act?.action ?? null, actor, act?.seat ?? entry.player ?? 0)
    const r = await window.kard.ai.complete({ system, user, json: true, maxTokens: 3000 })
    let v: Verdict
    if (!r.ok) v = { by: me, error: r.error ?? t('Falha ao consultar o Juiz IA.') }
    else {
      try {
        v = { by: me, ...parseJudge(r.text ?? '') }
      } catch {
        v = { by: me, error: t('O Juiz IA respondeu num formato inesperado. Tente de novo.') }
      }
    }
    get().setVerdict(logId, v)
    if (meta.online && !v.error) onlineBroadcastVerdict?.(logId, v)
  },

  setVerdict: (logId, v) => set({ verdicts: { ...get().verdicts, [logId]: v } }),
  setHover: (hover) => set({ hover }),

  // ---------------- bot por IA ----------------

  botTurn: async () => {
    const { state, meta } = get()
    if (!state || !meta || get().botBusy) return
    const seat = state.activePlayer
    if (!meta.bots.includes(seat) || state.winner !== null) return
    set({ botBusy: true, botError: null })
    const turn = state.turn
    let blocksAsked = false
    try {
      // até 2 consultas por turno (economiza a cota grátis): se o bot jogar uma moeda, ele vê o resultado e continua
      for (let round = 0; round < 2; round++) {
        const st = get().state
        if (!st || st.turn !== turn || st.activePlayer !== seat) break
        const { system, user } = botPrompt(st, seat, 'turn')
        const r = await window.kard.ai.complete({ system, user: round ? `${user}\n\n(Continue your turn from here. Do not repeat actions already in the log this turn.)` : user, json: true, maxTokens: 6000 })
        if (!r.ok) throw new Error(r.error ?? t('Falha ao consultar a IA do bot.'))
        const plan = parseBot(r.text ?? '')
        if (plan.say) get().act({ t: 'note', text: plan.say }, seat)
        let flipped = false
        for (const a of plan.actions) {
          if (!get().state || get().state!.turn !== turn) break
          const st2 = get().state!
          const describe = () => `${a.t}${'id' in a ? ` ${(a as { id: string }).id}` : ''}`
          if ('id' in a && !st2.objects[(a as { id: string }).id]) {
            get().act({ t: 'note', text: t('⚠ ação ignorada ({action}): carta inexistente.', { action: describe() }) }, seat)
            continue
          }
          const r2 = performSandbox(st2, seat, a)
          if (r2.error) {
            get().act({ t: 'note', text: t('⚠ ação ignorada ({action}): {error}', { action: describe(), error: r2.error }) }, seat)
            continue
          }
          set({ state: r2.state, history: [...get().history, { seat, action: a }] })
          await sleep(useApp.getState().settings?.botDelayMs ?? 700)
          if (a.t === 'step' && (a.to === 'declareBlockers' || a.to === 'combatDamage') && !blocksAsked) {
            blocksAsked = true
            await runBotBlocks()
          }
          if (a.t === 'coin') {
            flipped = true
            break
          }
        }
        if (!flipped) break
      }
    } catch (err) {
      set({ botError: (err as Error).message })
      useApp.getState().toast(t('Bot: {error}', { error: (err as Error).message }), 'error')
    } finally {
      const st = get().state
      if (st && st.turn === turn && st.activePlayer === seat && st.winner === null) get().act({ t: 'passTurn' }, seat)
      set({ botBusy: false })
    }
  },

  botBlocks: async () => {
    const { state, meta } = get()
    if (!state || !meta || get().botBusy) return
    if (!defendingBots(state, meta).length) return
    set({ botBusy: true, botError: null })
    try {
      await runBotBlocks()
    } catch (err) {
      set({ botError: (err as Error).message })
      useApp.getState().toast(t('Bot: {error}', { error: (err as Error).message }), 'error')
    } finally {
      set({ botBusy: false })
    }
  }
}))

/** Bots atacados agora (multijogador: só quem é alvo, ou um planeswalker dele, decide bloqueios). */
function defendingBots(state: SState, meta: SandboxMeta): number[] {
  const attackers = Object.values(state.objects).filter((o) => o.attacking)
  const targetOf = (o: (typeof attackers)[number]): number | null =>
    typeof o.attackTarget === 'number' ? o.attackTarget : typeof o.attackTarget === 'string' ? state.objects[o.attackTarget]?.owner ?? null : null
  return meta.bots.filter(
    (b) =>
      b !== state.activePlayer &&
      !state.players[b].conceded &&
      attackers.some((o) => {
        const tg = targetOf(o)
        return tg === b || (tg === null && state.players.length === 2)
      })
  )
}

/** Cada bot atacado escolhe os bloqueios (uma consulta à IA por bot). */
async function runBotBlocks(): Promise<void> {
  const g = useSandbox.getState()
  const st0 = g.state
  const meta = g.meta
  if (!st0 || !meta) return
  for (const seat of defendingBots(st0, meta)) {
    const st = useSandbox.getState().state
    if (!st) break
    const { system, user } = botPrompt(st, seat, 'blocks')
    const r = await window.kard.ai.complete({ system, user, json: true, maxTokens: 2500 })
    if (!r.ok) throw new Error(r.error ?? t('Falha ao consultar a IA do bot.'))
    const plan = parseBot(r.text ?? '')
    if (plan.say) useSandbox.getState().act({ t: 'note', text: plan.say }, seat)
    const blocks = plan.actions.filter((x) => x.t === 'block')
    for (const a of blocks) useSandbox.getState().act(a, seat)
    if (!blocks.length) useSandbox.getState().act({ t: 'note', text: t('Sem bloqueios.') }, seat)
  }
}

/** Preparação do bot no Pokémon (sem IA): Ativo = Básico com mais PS, resto no Banco, 6 Prêmios. */
function botSetupPokemon(seat: number, tries = 0): void {
  const g = useSandbox.getState()
  const st = g.state
  if (!st) return
  const pl = st.players[seat]
  const basics = pl.zones.hand
    .map((id) => st.objects[id])
    .filter((o) => 'category' in o.card && o.card.category === 'Pokemon' && (o.card.stage === 'Basic' || !o.card.evolveFrom))
    .sort((a, b) => (('hp' in b.card ? b.card.hp : 0) ?? 0) - (('hp' in a.card ? a.card.hp : 0) ?? 0))
  if (!basics.length) {
    // sem Básico na mão: mulligan (no máximo 10 vezes, para decks sem nenhum Básico)
    if (tries >= 10) return
    g.act({ t: 'mulligan' }, seat)
    botSetupPokemon(seat, tries + 1)
    return
  }
  g.act({ t: 'move', id: basics[0].id, to: 'active' }, seat)
  for (const o of basics.slice(1, 6)) g.act({ t: 'move', id: o.id, to: 'bench' }, seat)
  g.act({ t: 'setupPrizes' }, seat)
  g.act({ t: 'note', text: t('Preparei meu campo: {name} no Ativo.', { name: cardName(basics[0].card) }) }, seat)
}
