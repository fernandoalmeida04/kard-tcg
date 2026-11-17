// Motor de regras do Pokémon TCG (regras atuais): preparação, turnos, energia, evolução, recuo,
// Treinadores, ataques (Fraqueza/Resistência, moedas, efeitos), Condições Especiais, nocaute e prêmios.
// Determinístico: toda aleatoriedade (embaralhar, moedas) vem de `state.rng`.
import type { PkmCard, PkmType } from '../pokemon/types.ts'
import type { EngineIssueKind } from '../engine/types.ts'
import { t } from '../i18n/index.ts'
import { basicEnergyType, hasRuleBox, parseCardRules, prizeValue } from './effects.ts'
import type {
  CardFilter,
  InPlay,
  ParsedCardRules,
  PAction,
  PActionResult,
  PChoice,
  PEffect,
  PGameSetup,
  PGameState,
  PLogEntry,
  PManualOp,
  PokeRef,

  PSeat,
  Resolving,
  SpecialCondition
} from './types.ts'

export const HAND_SIZE = 7
export const PRIZES = 6
export const BENCH_MAX = 5

// ============================================================
// Utilidades
// ============================================================

function clone<T>(x: T): T {
  return structuredClone(x)
}

function rand(state: PGameState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let r = state.rng
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296
}

function shuffle(state: PGameState, arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

function coin(state: PGameState, p: PSeat, why?: string): boolean {
  const heads = rand(state) < 0.5
  log(state, 'coin', why ? t('🪙 {name} jogou uma moeda ({why}): {r}.', { name: pname(state, p), why, r: heads ? t('cara') : t('coroa') }) : t('🪙 {name} jogou uma moeda: {r}.', { name: pname(state, p), r: heads ? t('cara') : t('coroa') }), p)
  return heads
}

export function log(state: PGameState, kind: PLogEntry['kind'], text: string, player?: PSeat): void {
  const last = state.log.length ? state.log[state.log.length - 1].id : 0
  state.log.push({ id: last + 1, turn: state.turn, kind, text, player })
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600)
}

export function recordIssue(state: PGameState, kind: EngineIssueKind, text: string, card?: string, context = state.log.slice(-6).map((e) => e.text)): void {
  const issues = (state.issues ??= [])
  issues.push({ kind, card, text: text.slice(0, 600), turn: state.turn, context })
  state.issueSeq = (state.issueSeq ?? 0) + 1
  if (issues.length > 300) issues.splice(0, issues.length - 300)
}

function pname(state: PGameState, p: PSeat): string {
  return state.players[p]?.name ?? '?'
}

export function opp(p: PSeat): PSeat {
  return p === 0 ? 1 : 0
}

/** Nome para exibir (localizado quando houver). */
export function cardName(c: PkmCard): string {
  return c.localName ?? c.name
}

export function objName(state: PGameState, id: string): string {
  const o = state.objects[id]
  return o ? cardName(o.card) : '?'
}

const rulesCache = new Map<string, ParsedCardRules>()
/** Regras interpretadas de uma carta (com cache; a interpretação é pura). */
export function rulesOf(c: PkmCard): ParsedCardRules {
  let r = rulesCache.get(c.id)
  if (!r) {
    r = parseCardRules(c)
    rulesCache.set(c.id, r)
  }
  return r
}

// ============================================================
// Pokémon em jogo
// ============================================================

export interface InPlayRef {
  ip: InPlay
  owner: PSeat
  where: 'active' | 'bench'
  index: number
}

export function findInPlay(state: PGameState, id: string): InPlayRef | null {
  for (const pl of state.players) {
    if (pl.active?.id === id) return { ip: pl.active, owner: pl.id, where: 'active', index: 0 }
    const i = pl.bench.findIndex((b) => b.id === id)
    if (i >= 0) return { ip: pl.bench[i], owner: pl.id, where: 'bench', index: i }
  }
  return null
}

export function inPlayOf(state: PGameState, p: PSeat): InPlay[] {
  const pl = state.players[p]
  return [...(pl.active ? [pl.active] : []), ...pl.bench]
}

export function topCard(state: PGameState, ip: InPlay): PkmCard {
  return state.objects[ip.id].card
}

export function maxHp(state: PGameState, ip: InPlay): number {
  const base = topCard(state, ip).hp ?? 0
  const tool = ip.tool ? rulesOf(state.objects[ip.tool].card).toolHp ?? 0 : 0
  return base + tool
}

export function remainingHp(state: PGameState, ip: InPlay): number {
  return Math.max(0, maxHp(state, ip) - ip.damage)
}

/** Unidades de energia fornecidas pelas Energias ligadas ('any' = qualquer tipo). */
export function energyUnits(state: PGameState, ip: InPlay): (PkmType | 'any')[] {
  const out: (PkmType | 'any')[] = []
  for (const id of ip.energy) out.push(...(rulesOf(state.objects[id].card).energyProvides ?? ['Colorless']))
  return out
}

/** As energias pagam o custo? (tipos específicos primeiro; Incolor aceita qualquer uma) */
export function canPay(units: (PkmType | 'any')[], cost: PkmType[]): boolean {
  const pool = [...units]
  const specific = cost.filter((c) => c !== 'Colorless')
  for (const need of specific) {
    let i = pool.indexOf(need)
    if (i < 0) i = pool.indexOf('any')
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return pool.length >= cost.length - specific.length
}

function isBasicPokemon(c: PkmCard): boolean {
  return c.category === 'Pokemon' && (c.stage === 'Basic' || (!c.stage && !c.evolveFrom))
}

export function matchesFilter(c: PkmCard, f: CardFilter): boolean {
  if (f.category && c.category !== f.category) return false
  if (f.basicPokemon && !isBasicPokemon(c)) return false
  if (f.basicEnergy && !(c.category === 'Energy' && c.energyType !== 'Special')) return false
  if (f.trainerType && c.trainerType !== f.trainerType) return false
  if (f.type) {
    if (c.category === 'Energy' && basicEnergyType(c) !== f.type) return false
    if (c.category === 'Pokemon' && !c.types.includes(f.type)) return false
  }
  if (f.noRuleBox && hasRuleBox(c)) return false
  return true
}

/** Remove condições especiais (ao ir para o Banco ou evoluir). */
function clearConditions(ip: InPlay): void {
  ip.condition = undefined
  ip.poisoned = undefined
  ip.burned = undefined
  ip.paralyzedTurn = undefined
}

function newInPlay(state: PGameState, id: string): InPlay {
  return { id, stack: [id], energy: [], damage: 0, playedTurn: state.turn }
}

// ============================================================
// Criação da partida
// ============================================================

export function createGame(setup: PGameSetup): PGameState {
  if (setup.players.length !== 2) throw new Error(t('Uma partida de Pokémon tem 2 jogadores.'))
  const state: PGameState = {
    game: 'pokemon',
    format: setup.format,
    turn: 0,
    firstPlayer: 0,
    activePlayer: 0,
    step: 'setup',
    players: setup.players.map((ps, i) => ({
      id: i,
      name: ps.name,
      isBot: ps.isBot,
      deck: [],
      hand: [],
      discard: [],
      prizes: [],
      lostZone: [],
      active: null,
      bench: [],
      mulligans: 0,
      energyAttached: false,
      supporterPlayed: false,
      stadiumPlayed: false,
      retreated: false,
      abilitiesUsed: [],
      lost: false
    })),
    objects: {},
    stadium: null,
    choices: [],
    resolving: null,
    log: [],
    winner: null,
    nextId: 1,
    rng: (setup.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    evolutions: setup.evolutions ?? {}
  }
  setup.players.forEach((ps, p) => {
    for (const gc of ps.deck) {
      const id = `o${state.nextId++}`
      state.objects[id] = { id, owner: p, card: gc.card, printingId: gc.printingId }
      state.players[p].deck.push(id)
    }
    shuffle(state, state.players[p].deck)
  })
  state.firstPlayer = setup.firstPlayer ?? (rand(state) < 0.5 ? 0 : 1)
  state.activePlayer = state.firstPlayer
  log(state, 'turn', t('Partida iniciada ({format}). Sorteio: {name} começa.', { format: setup.format, name: pname(state, state.firstPlayer) }))
  for (const pl of state.players) {
    drawN(state, pl.id, HAND_SIZE, true)
    // mulligan obrigatório: sem Pokémon Básico na mão, revela, embaralha e compra 7 de novo
    for (let tries = 0; tries < 30 && !pl.hand.some((id) => isBasicPokemon(state.objects[id].card)); tries++) {
      if (!pl.deck.some((id) => isBasicPokemon(state.objects[id].card))) break
      pl.mulligans++
      log(state, 'action', t('{name} não tem Pokémon Básico na mão: mulligan ({n}).', { name: pl.name, n: pl.mulligans }), pl.id)
      pl.deck.push(...pl.hand)
      pl.hand = []
      shuffle(state, pl.deck)
      drawN(state, pl.id, HAND_SIZE, true)
    }
    if (!pl.hand.some((id) => isBasicPokemon(state.objects[id].card))) {
      pl.lost = true
      log(state, 'judge', t('{name} não tem nenhum Pokémon Básico no deck e perde a partida.', { name: pl.name }), pl.id)
    }
    // prêmios: as 6 cartas do topo, viradas para baixo
    pl.prizes = pl.deck.splice(0, Math.min(PRIZES, pl.deck.length))
  }
  if (state.players.some((pl) => pl.lost)) {
    finishByLoss(state)
    return state
  }
  for (const pl of state.players) state.choices.push({ kind: 'setup', player: pl.id })
  return state
}

function drawN(state: PGameState, p: PSeat, n: number, quiet = false): number {
  const pl = state.players[p]
  let drawn = 0
  for (let i = 0; i < n && pl.deck.length; i++) {
    pl.hand.push(pl.deck.shift()!)
    drawn++
  }
  if (!quiet && drawn) log(state, 'action', drawn === 1 ? t('{name} compra 1 carta.', { name: pl.name }) : t('{name} compra {n} cartas.', { name: pl.name, n: drawn }), p)
  return drawn
}

// ============================================================
// Turnos
// ============================================================

function startTurn(state: PGameState, p: PSeat): void {
  state.turn++
  state.activePlayer = p
  state.step = 'main'
  const pl = state.players[p]
  pl.energyAttached = false
  pl.supporterPlayed = false
  pl.stadiumPlayed = false
  pl.retreated = false
  pl.abilitiesUsed = []
  log(state, 'turn', t('— Turno {n} · {name} —', { n: state.turn, name: pl.name }))
  if (!pl.deck.length) {
    pl.lost = true
    pl.deckedOut = true
    log(state, 'judge', t('{name} não tem cartas para comprar e perde a partida.', { name: pl.name }), p)
    finishByLoss(state)
    return
  }
  drawN(state, p, 1)
}

function endTurn(state: PGameState): void {
  const p = state.activePlayer
  log(state, 'info', t('{name} encerra o turno.', { name: pname(state, p) }), p)
  pokemonCheckup(state)
  if (state.winner !== null) return
  state.pendingNext = true
}

/** Verificação Pokémon (entre os turnos): Envenenado, Queimado, Adormecido, Paralisado. */
function pokemonCheckup(state: PGameState): void {
  for (const pl of state.players) {
    const ip = pl.active
    if (!ip) continue
    const name = objName(state, ip.id)
    if (ip.poisoned) {
      ip.damage += 10
      log(state, 'judge', t('{name} está Envenenado e recebe 1 contador de dano.', { name }), pl.id)
    }
    if (ip.burned) {
      ip.damage += 20
      log(state, 'judge', t('{name} está Queimado e recebe 2 contadores de dano.', { name }), pl.id)
      if (coin(state, pl.id, t('Queimado'))) {
        ip.burned = undefined
        log(state, 'judge', t('{name} não está mais Queimado.', { name }), pl.id)
      }
    }
    if (ip.condition === 'asleep' && coin(state, pl.id, t('Adormecido'))) {
      ip.condition = undefined
      log(state, 'judge', t('{name} acordou.', { name }), pl.id)
    }
    if (ip.condition === 'paralyzed' && pl.id === state.activePlayer && (ip.paralyzedTurn ?? 0) < state.turn) {
      ip.condition = undefined
      ip.paralyzedTurn = undefined
      log(state, 'judge', t('{name} não está mais Paralisado.', { name }), pl.id)
    }
    if (ip.condition === 'paralyzed' && pl.id === state.activePlayer && ip.paralyzedTurn === state.turn) {
      // paralisado durante o próprio turno: sai na verificação do próximo turno dele
    }
  }
  checkKnockouts(state)
}

function finishByLoss(state: PGameState): void {
  const losers = state.players.filter((pl) => pl.lost)
  if (losers.length >= 2) state.winner = 'draw'
  else if (losers.length === 1) state.winner = opp(losers[0].id)
  if (state.winner !== null) {
    state.step = 'over'
    state.choices = []
    state.resolving = null
    state.pendingNext = false
    log(state, 'judge', state.winner === 'draw' ? t('A partida terminou empatada.') : t('🏆 {name} venceu a partida.', { name: pname(state, state.winner) }))
  }
}

/** Nocautes: Pokémon com dano ≥ PS vão para o descarte e o oponente pega prêmios. */
function checkKnockouts(state: PGameState): void {
  const prizesTaken: Record<number, number> = { 0: 0, 1: 0 }
  for (const pl of state.players) {
    for (const ip of inPlayOf(state, pl.id)) {
      if (ip.damage < maxHp(state, ip)) continue
      const c = topCard(state, ip)
      log(state, 'combat', t('{name} foi Nocauteado!', { name: cardName(c) }), pl.id)
      prizesTaken[opp(pl.id)] += prizeValue(c)
      removeInPlay(state, ip, 'discard')
    }
  }
  for (const p of [0, 1]) {
    const n = prizesTaken[p]
    if (!n) continue
    const pl = state.players[p]
    const taken = pl.prizes.splice(0, Math.min(n, pl.prizes.length))
    pl.hand.push(...taken)
    log(state, 'action', taken.length === 1 ? t('{name} pega 1 carta de Prêmio ({left} restantes).', { name: pl.name, left: pl.prizes.length }) : t('{name} pega {n} cartas de Prêmio ({left} restantes).', { name: pl.name, n: taken.length, left: pl.prizes.length }), p)
  }
  checkWinner(state)
  if (state.winner !== null) return
  // quem ficou sem Pokémon Ativo escolhe um do Banco
  for (const pl of state.players) {
    if (!pl.active && pl.bench.length && !state.choices.some((c) => c.kind === 'promote' && c.player === pl.id)) {
      state.choices.push({ kind: 'promote', player: pl.id })
    }
  }
}

function checkWinner(state: PGameState): void {
  if (state.step === 'setup') return
  for (const pl of state.players) {
    if (!pl.active && !pl.bench.length) {
      pl.lost = true
      log(state, 'judge', t('{name} não tem mais Pokémon em jogo.', { name: pl.name }), pl.id)
    }
  }
  for (const pl of state.players) {
    if (!pl.prizes.length && !state.players[opp(pl.id)].lost) {
      state.players[opp(pl.id)].lost = true
      log(state, 'judge', t('{name} pegou todas as cartas de Prêmio!', { name: pl.name }), pl.id)
    }
  }
  if (state.players.some((pl) => pl.lost)) finishByLoss(state)
}

/** Tira um Pokémon de jogo: as cartas da pilha e as ligadas vão para `dest` (Energias e Ferramenta sempre para o descarte). */
function removeInPlay(state: PGameState, ip: InPlay, dest: 'discard' | 'hand' | 'deckTop' | 'deckBottom' | 'lostZone'): void {
  const ref = findInPlay(state, ip.id)
  if (!ref) return
  const pl = state.players[ref.owner]
  if (ref.where === 'active') pl.active = null
  else pl.bench.splice(ref.index, 1)
  const owner = (id: string) => state.players[state.objects[id].owner]
  for (const id of [...ip.energy, ...(ip.tool ? [ip.tool] : [])]) owner(id).discard.push(id)
  for (const id of ip.stack) {
    const o = owner(id)
    if (dest === 'discard') o.discard.push(id)
    else if (dest === 'hand') o.hand.push(id)
    else if (dest === 'deckTop') o.deck.unshift(id)
    else if (dest === 'deckBottom') o.deck.push(id)
    else o.lostZone.push(id)
  }
}

// ============================================================
// Ações
// ============================================================

export function performAction(input: PGameState, p: PSeat, action: PAction): PActionResult {
  const state = clone(input)
  try {
    const err = apply(state, p, action)
    if (err) return { state: input, error: err }
    settle(state)
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    return { state: input, error: t('Erro interno do motor ao processar a jogada; ela foi desfeita. O problema foi registrado no relatório do motor.'), crash: msg.slice(0, 3000) }
  }
  return { state }
}

/** Avança o jogo até precisar de uma decisão de alguém. */
function settle(state: PGameState): void {
  for (let guard = 0; guard < 50; guard++) {
    if (state.winner !== null) return
    if (state.choices.length) return
    if (state.resolving) {
      continueResolution(state)
      continue
    }
    if (state.step === 'setup') {
      finishSetup(state)
      continue
    }
    if (state.pendingNext) {
      state.pendingNext = false
      startTurn(state, opp(state.activePlayer))
      continue
    }
    return
  }
}

function finishSetup(state: PGameState): void {
  // ofertas de compra extra pelos mulligans do oponente (uma vez)
  if (!state.extraOffered) {
    state.extraOffered = true
    for (const pl of state.players) {
      const o = state.players[opp(pl.id)]
      if (o.mulligans > 0) state.choices.push({ kind: 'extraDraw', player: pl.id, max: o.mulligans })
    }
    log(state, 'info', t('Os Pokémon são revelados.'))
    if (state.choices.length) return
  }
  state.step = 'main'
  startTurn(state, state.firstPlayer)
}

function apply(state: PGameState, p: PSeat, a: PAction): string | null {
  if (!state.players[p]) return t('Jogador inválido.')
  if (a.t === 'concede') {
    if (state.winner !== null) return t('A partida terminou.')
    state.players[p].lost = true
    log(state, 'judge', t('{name} concede a partida.', { name: pname(state, p) }), p)
    finishByLoss(state)
    return null
  }
  if (a.t === 'manual') return applyManual(state, p, a.op)
  if (state.winner !== null) return t('A partida terminou.')
  if (a.t === 'setup' || a.t === 'extraDraw' || a.t === 'chooseCards' || a.t === 'chooseInPlay' || a.t === 'chooseYesNo') return applyChoice(state, p, a)
  if (state.choices.length) return t('Há uma escolha pendente.')
  if (state.resolving) return t('Aguarde o efeito terminar.')
  if (state.step !== 'main') return t('A partida ainda não começou.')
  if (state.activePlayer !== p) return t('Não é o seu turno.')
  const pl = state.players[p]
  switch (a.t) {
    case 'playBasic': {
      const e = checkPlayBasic(state, p, a.id)
      if (e) return e
      pl.hand.splice(pl.hand.indexOf(a.id), 1)
      const ip = newInPlay(state, a.id)
      if (!pl.active) pl.active = ip
      else pl.bench.push(ip)
      log(state, 'action', t('{player} coloca {name} no Banco.', { player: pl.name, name: objName(state, a.id) }), p)
      return null
    }
    case 'evolve': {
      const e = checkEvolve(state, p, a.id, a.target)
      if (e) return e
      pl.hand.splice(pl.hand.indexOf(a.id), 1)
      evolveInto(state, findInPlay(state, a.target)!.ip, a.id)
      return null
    }
    case 'attachEnergy': {
      const e = checkAttach(state, p, a.id, a.target)
      if (e) return e
      pl.hand.splice(pl.hand.indexOf(a.id), 1)
      const ip = findInPlay(state, a.target)!.ip
      ip.energy.push(a.id)
      pl.energyAttached = true
      log(state, 'action', t('{player} liga {energy} em {name}.', { player: pl.name, energy: objName(state, a.id), name: objName(state, ip.id) }), p)
      const extra = rulesOf(state.objects[a.id].card).trainer
      if (extra?.unsupported.length) {
        log(state, 'judge', t('Efeito extra de {name} não automatizado: "{text}". Use ajustes manuais se necessário.', { name: objName(state, a.id), text: extra.unsupported.join(' ') }), p)
        recordIssue(state, 'unparsed', extra.unsupported.join(' '), state.objects[a.id].card.name)
      }
      return null
    }
    case 'playTrainer':
      return playTrainer(state, p, a.id, a.target)
    case 'retreat':
      return retreat(state, p, a.to, a.energy)
    case 'useAbility':
      return useAbility(state, p, a.id, a.index)
    case 'attack':
      return attack(state, p, a.index)
    case 'endTurn':
      endTurn(state)
      return null
  }
  return t('Ação desconhecida.')
}

export function checkPlayBasic(state: PGameState, p: PSeat, id: string): string | null {
  const pl = state.players[p]
  if (!pl.hand.includes(id)) return t('A carta não está na sua mão.')
  if (!isBasicPokemon(state.objects[id].card)) return t('Só Pokémon Básicos podem ser colocados no Banco.')
  if (pl.active && pl.bench.length >= BENCH_MAX) return t('Seu Banco está cheio (máximo {n}).', { n: BENCH_MAX })
  return null
}

export function checkEvolve(state: PGameState, p: PSeat, id: string, target: string): string | null {
  const pl = state.players[p]
  if (!pl.hand.includes(id)) return t('A carta não está na sua mão.')
  const c = state.objects[id].card
  if (c.category !== 'Pokemon' || !c.evolveFrom) return t('Esta carta não é uma evolução.')
  const ref = findInPlay(state, target)
  if (!ref || ref.owner !== p) return t('Escolha um dos seus Pokémon.')
  if (topCard(state, ref.ip).name !== c.evolveFrom) return t('{name} evolui de {from}.', { name: cardName(c), from: c.localEvolveFrom ?? c.evolveFrom })
  if (state.turn <= 2) return t('Ninguém pode evoluir no primeiro turno de cada jogador.')
  if (ref.ip.playedTurn === state.turn || ref.ip.evolvedTurn === state.turn) return t('Este Pokémon entrou em jogo ou evoluiu neste turno.')
  return null
}

function evolveInto(state: PGameState, ip: InPlay, cardId: string): void {
  const from = objName(state, ip.id)
  ip.stack.push(cardId)
  ip.id = cardId
  ip.evolvedTurn = state.turn
  clearConditions(ip)
  ip.cantAttackUntil = undefined
  ip.cantRetreatUntil = undefined
  log(state, 'action', t('{player} evolui {from} para {name}.', { player: pname(state, state.objects[cardId].owner), from, name: objName(state, cardId) }), state.objects[cardId].owner)
}

export function checkAttach(state: PGameState, p: PSeat, id: string, target: string): string | null {
  const pl = state.players[p]
  if (!pl.hand.includes(id)) return t('A carta não está na sua mão.')
  if (state.objects[id].card.category !== 'Energy') return t('Esta carta não é uma Energia.')
  if (pl.energyAttached) return t('Você já ligou uma Energia neste turno.')
  const ref = findInPlay(state, target)
  if (!ref || ref.owner !== p) return t('Escolha um dos seus Pokémon.')
  return null
}

export function checkTrainer(state: PGameState, p: PSeat, id: string, target?: string): string | null {
  const pl = state.players[p]
  if (!pl.hand.includes(id)) return t('A carta não está na sua mão.')
  const c = state.objects[id].card
  if (c.category !== 'Trainer') return t('Esta carta não é um Treinador.')
  if (c.trainerType === 'Supporter') {
    if (pl.supporterPlayed) return t('Você já jogou um Apoiador neste turno.')
    if (state.turn === 1) return t('Quem começa não pode jogar Apoiador no primeiro turno.')
  }
  if (c.trainerType === 'Stadium') {
    if (pl.stadiumPlayed) return t('Você já jogou um Estádio neste turno.')
    if (state.stadium && state.objects[state.stadium].card.name === c.name) return t('Já há um Estádio com esse nome em jogo.')
  }
  if (c.trainerType === 'Tool') {
    const ref = target ? findInPlay(state, target) : null
    if (!ref || ref.owner !== p) return t('Escolha um dos seus Pokémon para ligar a Ferramenta.')
    if (ref.ip.tool) return t('Este Pokémon já tem uma Ferramenta.')
  }
  const tr = rulesOf(c).trainer
  const first = tr?.effects[0]
  if (first?.k === 'discardFromHand' && first.cost && pl.hand.length - 1 < first.n) return t('Você precisa descartar {n} carta(s) da mão para jogar esta carta.', { n: first.n })
  if (first?.k === 'rareCandy' && !rareCandyOptions(state, p).length) return t('Você não tem um Pokémon Básico e um Estágio 2 que combinem para o Doce Raro.')
  if (tr?.effects.some((e) => e.k === 'switchOwnActive') && !pl.bench.length) return t('Você não tem Pokémon no Banco.')
  if (tr?.effects.some((e) => e.k === 'gust') && !state.players[opp(p)].bench.length) return t('O oponente não tem Pokémon no Banco.')
  return null
}

function playTrainer(state: PGameState, p: PSeat, id: string, target?: string): string | null {
  const e = checkTrainer(state, p, id, target)
  if (e) return e
  const pl = state.players[p]
  const c = state.objects[id].card
  pl.hand.splice(pl.hand.indexOf(id), 1)
  if (c.trainerType === 'Supporter') pl.supporterPlayed = true
  if (c.trainerType === 'Stadium') {
    pl.stadiumPlayed = true
    if (state.stadium) {
      const old = state.stadium
      state.players[state.objects[old].owner].discard.push(old)
      log(state, 'action', t('{name} vai para o descarte.', { name: objName(state, old) }))
    }
    state.stadium = id
    log(state, 'action', t('{player} joga o Estádio {name}.', { player: pl.name, name: cardName(c) }), p)
    noteUnsupported(state, id, rulesOf(c).trainer?.unsupported ?? [])
    return null
  }
  if (c.trainerType === 'Tool') {
    const ip = findInPlay(state, target!)!.ip
    ip.tool = id
    log(state, 'action', t('{player} liga a Ferramenta {name} em {target}.', { player: pl.name, name: cardName(c), target: objName(state, ip.id) }), p)
    noteUnsupported(state, id, rulesOf(c).trainer?.unsupported ?? [])
    return null
  }
  log(state, 'action', t('{player} joga {name}.', { player: pl.name, name: cardName(c) }), p)
  const tr = rulesOf(c).trainer ?? { effects: [], unsupported: [] }
  noteUnsupported(state, id, tr.unsupported)
  state.resolving = { source: id, sourceName: cardName(c), controller: p, kind: 'trainer', effects: tr.effects, next: 0, trainerId: id }
  return null
}

function noteUnsupported(state: PGameState, id: string, parts: string[]): void {
  if (!parts.length) return
  const o = state.objects[id]
  log(state, 'judge', t('Parte do efeito de {name} não é automatizada: "{text}". Use ajustes manuais.', { name: cardName(o.card), text: parts.join(' ') }), o.owner)
  recordIssue(state, 'unparsed', parts.join(' '), o.card.name)
}

/** Energias a descartar para recuar (escolha automática: as que fornecem menos unidades primeiro). */
export function autoRetreatEnergy(state: PGameState, ip: InPlay): string[] | null {
  const cost = topCard(state, ip).retreat ?? 0
  if (cost <= 0) return []
  const sorted = [...ip.energy].sort((a, b) => (rulesOf(state.objects[a].card).energyProvides?.length ?? 1) - (rulesOf(state.objects[b].card).energyProvides?.length ?? 1))
  const out: string[] = []
  let units = 0
  for (const id of sorted) {
    if (units >= cost) break
    out.push(id)
    units += rulesOf(state.objects[id].card).energyProvides?.length ?? 1
  }
  return units >= cost ? out : null
}

export function checkRetreat(state: PGameState, p: PSeat, to?: string): string | null {
  const pl = state.players[p]
  const ip = pl.active
  if (!ip) return t('Você não tem Pokémon Ativo.')
  if (pl.retreated) return t('Você já recuou neste turno.')
  if (!pl.bench.length) return t('Você não tem Pokémon no Banco.')
  if (ip.condition === 'asleep' || ip.condition === 'paralyzed') return t('Pokémon Adormecido ou Paralisado não pode recuar.')
  if ((ip.cantRetreatUntil ?? 0) >= state.turn) return t('Este Pokémon não pode recuar neste turno.')
  if (to && !pl.bench.some((b) => b.id === to)) return t('Escolha um Pokémon do seu Banco.')
  if (!autoRetreatEnergy(state, ip)) return t('Energia insuficiente para pagar o custo de recuo ({n}).', { n: topCard(state, ip).retreat ?? 0 })
  return null
}

function retreat(state: PGameState, p: PSeat, to: string, energy?: string[]): string | null {
  const e = checkRetreat(state, p, to)
  if (e) return e
  const pl = state.players[p]
  const ip = pl.active!
  let pay = autoRetreatEnergy(state, ip)!
  if (energy?.length) {
    const units = energy.reduce((s, id) => s + (ip.energy.includes(id) ? (rulesOf(state.objects[id].card).energyProvides?.length ?? 1) : 0), 0)
    if (energy.every((id) => ip.energy.includes(id)) && units >= (topCard(state, ip).retreat ?? 0)) pay = energy
  }
  for (const id of pay) {
    ip.energy.splice(ip.energy.indexOf(id), 1)
    pl.discard.push(id)
  }
  switchActive(state, p, to)
  pl.retreated = true
  log(state, 'action', t('{player} recua {name} (descarta {n} Energia(s)).', { player: pl.name, name: objName(state, ip.id), n: pay.length }), p)
  return null
}

/** Troca o Ativo com um Pokémon do Banco (condições do que sai são removidas). */
function switchActive(state: PGameState, p: PSeat, benchId: string): void {
  const pl = state.players[p]
  const i = pl.bench.findIndex((b) => b.id === benchId)
  if (i < 0) return
  const incoming = pl.bench[i]
  const outgoing = pl.active
  if (outgoing) {
    clearConditions(outgoing)
    pl.bench[i] = outgoing
  } else pl.bench.splice(i, 1)
  pl.active = incoming
  log(state, 'action', t('{name} vai para o Ativo.', { name: objName(state, incoming.id) }), p)
}

function useAbility(state: PGameState, p: PSeat, id: string, index: number): string | null {
  const ref = findInPlay(state, id)
  if (!ref || ref.owner !== p) return t('Escolha um dos seus Pokémon.')
  const c = topCard(state, ref.ip)
  const ab = c.abilities[index]
  if (!ab) return t('Habilidade inválida.')
  const key = `${id}:${index}`
  const parsed = rulesOf(c).abilities[index]
  if (state.players[p].abilitiesUsed.includes(key)) return t('Você já usou esta habilidade neste turno.')
  state.players[p].abilitiesUsed.push(key)
  log(state, 'action', t('{player} usa a habilidade {ability} de {name}.', { player: pname(state, p), ability: ab.localName ?? ab.name, name: cardName(c) }), p)
  if (!parsed.effects.length || parsed.unsupported.length) {
    log(state, 'judge', t('Habilidade não automatizada: "{text}". Aplique o efeito com ajustes manuais.', { text: ab.localEffect ?? ab.effect }), p)
    recordIssue(state, 'unparsed', `${ab.name}: ${ab.effect}`, c.name)
    if (!parsed.effects.length) return null
  }
  state.resolving = { source: id, sourceName: ab.localName ?? ab.name, controller: p, kind: 'ability', effects: parsed.effects, next: 0 }
  return null
}

// ---------------- Ataque ----------------

export function attackError(state: PGameState, p: PSeat, index: number): string | null {
  const pl = state.players[p]
  const ip = pl.active
  if (!ip) return t('Você não tem Pokémon Ativo.')
  const c = topCard(state, ip)
  const a = c.attacks[index]
  if (!a) return t('Ataque inválido.')
  if (state.turn === 1) return t('Quem começa não pode atacar no primeiro turno.')
  if (state.attackedTurn === state.turn) return t('Você já atacou neste turno.')
  if (ip.condition === 'asleep' || ip.condition === 'paralyzed') return t('Pokémon Adormecido ou Paralisado não pode atacar.')
  if ((ip.cantAttackUntil ?? 0) >= state.turn) return t('Este Pokémon não pode atacar neste turno.')
  if (!canPay(energyUnits(state, ip), a.cost)) return t('Energia insuficiente para {name}.', { name: a.localName ?? a.name })
  return null
}

function baseDamageOf(dmg: string | undefined): number {
  const n = parseInt(String(dmg ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

function attack(state: PGameState, p: PSeat, index: number): string | null {
  const e = attackError(state, p, index)
  if (e) return e
  const pl = state.players[p]
  const ip = pl.active!
  const c = topCard(state, ip)
  const a = c.attacks[index]
  state.attackedTurn = state.turn
  log(state, 'combat', t('{name} usa {attack}!', { name: cardName(c), attack: a.localName ?? a.name }), p)
  const parsed = rulesOf(c).attacks[index]
  if (parsed.unsupported.length) {
    log(state, 'judge', t('Parte do ataque não é automatizada: "{text}". Use ajustes manuais.', { text: parsed.unsupported.join(' ') }), p)
    recordIssue(state, 'unparsed', `${a.name}: ${parsed.unsupported.join(' ')}`, c.name)
  }
  // Confuso: moeda; coroa = 3 contadores de dano nele mesmo e o ataque não acontece
  if (ip.condition === 'confused' && !coin(state, p, t('Confuso'))) {
    ip.damage += 30
    log(state, 'judge', t('{name} está Confuso e se machuca (3 contadores de dano).', { name: cardName(c) }), p)
    checkKnockouts(state)
    if (state.winner === null) endTurn(state)
    return null
  }
  // modificadores de dano
  let damage = baseDamageOf(a.damage)
  let fails = false
  let ignoreRes = false
  let ignoreWR = false
  const target = state.players[opp(p)].active
  for (const ef of parsed.effects) {
    switch (ef.k) {
      case 'coinMore':
      case 'coinTimes': {
        let heads = 0
        if (ef.untilTails) {
          for (let g = 0; g < 50 && coin(state, p); g++) heads++
        } else for (let i = 0; i < ef.coins; i++) if (coin(state, p)) heads++
        damage = ef.k === 'coinTimes' ? ef.amount * heads : damage + ef.amount * heads
        break
      }
      case 'coinFail':
        if (!coin(state, p)) fails = true
        break
      case 'moreIfDamaged':
        if (ip.damage > 0) damage += ef.amount
        break
      case 'morePerEnergy':
        damage += ef.amount * (ef.who === 'self' ? energyUnits(state, ip).length : target ? energyUnits(state, target).length : 0)
        break
      case 'morePerDamageCounterOpp':
        if (target) damage += ef.amount * Math.floor(target.damage / 10)
        break
      case 'perCounterSelf':
        damage = (ef.replace ? 0 : damage) + ef.amount * Math.floor(ip.damage / 10)
        break
      case 'morePerBench': {
        const n = (ef.who !== 'opp' ? pl.bench.length : 0) + (ef.who !== 'self' ? state.players[opp(p)].bench.length : 0)
        damage += ef.amount * n
        break
      }
      case 'moreIfOppDamaged':
        if (target && target.damage > 0) damage += ef.amount
        break
      case 'moreIfStadium':
        if (state.stadium) damage += ef.amount
        break
      case 'moreIfOppCondition':
        if (target && (ef.cond === 'any' ? Boolean(target.condition || target.poisoned || target.burned) : ef.cond === 'poisoned' ? target.poisoned : ef.cond === 'burned' ? target.burned : target.condition === ef.cond)) damage += ef.amount
        break
      case 'moreIfOppEvolved':
        if (target && target.stack.length > 1) damage += ef.amount
        break
      case 'ignoreResistance':
        ignoreRes = true
        break
      case 'ignoreWeaknessResistance':
        ignoreWR = true
        break
    }
  }
  if (fails) {
    log(state, 'combat', t('O ataque não fez nada.'), p)
    checkKnockouts(state)
    if (state.winner === null) endTurn(state)
    return null
  }
  if (target && (damage > 0 || baseDamageOf(a.damage) > 0)) {
    // Ferramenta de dano
    if (ip.tool) damage += rulesOf(state.objects[ip.tool].card).toolDamage ?? 0
    dealAttackDamage(state, p, ip, target, damage, { applyWR: !ignoreWR, applyRes: !ignoreRes && !ignoreWR })
  }
  const post = parsed.effects.filter((ef) => !DAMAGE_MODS.has(ef.k))
  state.resolving = { source: ip.id, sourceName: a.localName ?? a.name, controller: p, kind: 'attack', effects: post, next: 0, endsTurn: true, attackName: a.name }
  return null
}

const DAMAGE_MODS = new Set(['coinMore', 'coinTimes', 'coinFail', 'moreIfDamaged', 'morePerEnergy', 'morePerDamageCounterOpp', 'perCounterSelf', 'morePerBench', 'moreIfOppDamaged', 'moreIfStadium', 'moreIfOppCondition', 'moreIfOppEvolved', 'ignoreResistance', 'ignoreWeaknessResistance'])

/** Dano de ataque no Ativo do oponente (com Fraqueza/Resistência e efeitos de proteção). */
function dealAttackDamage(state: PGameState, p: PSeat, attacker: InPlay, target: InPlay, amount: number, o: { applyWR: boolean; applyRes: boolean }): void {
  const ac = topCard(state, attacker)
  const tc = topCard(state, target)
  let dmg = amount
  if (o.applyWR) {
    for (const w of tc.weaknesses) {
      if (!ac.types.includes(w.type)) continue
      const v = w.value.replace('−', '-')
      if (/^[x×]\s*2$/i.test(v)) dmg *= 2
      else dmg += parseInt(v.replace(/[^\d]/g, ''), 10) || 0
    }
  }
  if (o.applyRes) {
    for (const r of tc.resistances) {
      if (ac.types.includes(r.type)) dmg -= parseInt(r.value.replace(/[^\d]/g, ''), 10) || 0
    }
  }
  if ((target.preventAllUntil ?? 0) >= state.turn) {
    log(state, 'combat', t('Todo o dano em {name} é prevenido.', { name: cardName(tc) }), p)
    return
  }
  if (target.reduceDamage && target.reduceDamage.until >= state.turn) dmg -= target.reduceDamage.n
  dmg = Math.max(0, Math.floor(dmg / 10) * 10)
  target.damage += dmg
  log(state, 'combat', t('{name} causa {n} de dano em {target}.', { name: cardName(ac), n: dmg, target: cardName(tc) }), p)
}

/** Dano de efeito (sem Fraqueza/Resistência, como no Banco). */
function dealPlainDamage(state: PGameState, p: PSeat, target: InPlay, amount: number): void {
  if ((target.preventAllUntil ?? 0) >= state.turn && state.resolving?.kind === 'attack' && findInPlay(state, target.id)?.owner !== p) {
    log(state, 'combat', t('Todo o dano em {name} é prevenido.', { name: objName(state, target.id) }), p)
    return
  }
  target.damage += amount
  log(state, 'combat', t('{name} recebe {n} de dano.', { name: objName(state, target.id), n: amount }), p)
}

// ============================================================
// Resolução de efeitos (com escolhas)
// ============================================================

function continueResolution(state: PGameState): void {
  const r = state.resolving
  if (!r) return
  while (r.next < r.effects.length) {
    if (state.winner !== null) return
    const ef = r.effects[r.next]
    const res = stepEffect(state, r, ef, undefined)
    if (res === 'wait') return
    r.next++
    r.sub = 0
  }
  finishResolution(state)
}

function finishResolution(state: PGameState): void {
  const r = state.resolving!
  state.resolving = null
  if (r.trainerId) {
    const o = state.objects[r.trainerId]
    state.players[o.owner].discard.push(r.trainerId)
  }
  checkKnockouts(state)
  if (state.winner !== null) return
  if (r.endsTurn) endTurn(state)
}

function gatePasses(state: PGameState, r: Resolving, gate: 'heads' | 'tails' | undefined): boolean {
  if (!gate) return true
  if (r.lastCoin === undefined) r.lastCoin = coin(state, r.controller)
  return gate === 'heads' ? r.lastCoin : !r.lastCoin
}

function selfOf(state: PGameState, r: Resolving): InPlay | null {
  if (r.kind === 'trainer') return state.players[r.controller].active
  return findInPlay(state, r.source)?.ip ?? state.players[r.controller].active
}

function candidatesFor(state: PGameState, r: Resolving, ref: PokeRef): string[] {
  const me = r.controller
  const o = opp(me)
  switch (ref) {
    case 'chooseOwn':
      return inPlayOf(state, me).map((x) => x.id)
    case 'chooseOwnBench':
      return state.players[me].bench.map((x) => x.id)
    case 'chooseOpp':
      return inPlayOf(state, o).map((x) => x.id)
    case 'chooseOppBench':
      return state.players[o].bench.map((x) => x.id)
    default:
      return []
  }
}

type Answer = { ids?: string[]; id?: string | null; yes?: boolean }

/** Executa um efeito. 'wait' = criou uma escolha e precisa da resposta (chamado de novo com `ans`). */
function stepEffect(state: PGameState, r: Resolving, ef: PEffect, ans: Answer | undefined): 'done' | 'wait' {
  const me = r.controller
  const o = opp(me)
  const pl = state.players[me]
  const op = state.players[o]
  const ask = (ch: PChoice): 'wait' => {
    state.choices.push(ch)
    r.waiting = true
    return 'wait'
  }
  if ('gate' in ef && ef.gate && !ans && !gatePasses(state, r, ef.gate)) return 'done'
  switch (ef.k) {
    case 'flip':
      r.lastCoin = coin(state, me)
      return 'done'
    case 'damage': {
      if (ef.target === 'eachOppBench' || ef.target === 'eachOwnBench' || ef.target === 'eachOpp') {
        const list = ef.target === 'eachOppBench' ? op.bench : ef.target === 'eachOwnBench' ? pl.bench : inPlayOf(state, o)
        for (const ip of [...list]) {
          if (ef.target === 'eachOpp' && ip === op.active) {
            const self = selfOf(state, r)
            if (self) dealAttackDamage(state, me, self, ip, ef.amount, { applyWR: true, applyRes: true })
          } else dealPlainDamage(state, me, ip, ef.amount)
        }
        return 'done'
      }
      if (ef.target === 'oppActive') {
        if (op.active) dealPlainDamage(state, me, op.active, ef.amount)
        return 'done'
      }
      const cands = candidatesFor(state, r, ef.target)
      if (!cands.length) return 'done'
      if (!ans) return ask({ kind: 'inPlay', player: me, candidates: cands, optional: false, prompt: t('Escolha o Pokémon que recebe {n} de dano.', { n: ef.amount }) })
      const tgt = ans.id ? findInPlay(state, ans.id) : null
      if (tgt) {
        const self = selfOf(state, r)
        if (tgt.where === 'active' && tgt.owner === o && self && r.kind === 'attack') dealAttackDamage(state, me, self, tgt.ip, ef.amount, { applyWR: true, applyRes: true })
        else dealPlainDamage(state, me, tgt.ip, ef.amount)
      }
      // vários alvos: repete a escolha
      r.sub = (r.sub ?? 0) + 1
      if (r.sub < (ef.count ?? 1) && candidatesFor(state, r, ef.target).length) {
        return ask({ kind: 'inPlay', player: me, candidates: candidatesFor(state, r, ef.target), optional: false, prompt: t('Escolha o Pokémon que recebe {n} de dano.', { n: ef.amount }) })
      }
      return 'done'
    }
    case 'selfDamage': {
      const self = selfOf(state, r)
      if (self) {
        self.damage += ef.amount
        log(state, 'combat', t('{name} causa {n} de dano a si mesmo.', { name: objName(state, self.id), n: ef.amount }), me)
      }
      return 'done'
    }
    case 'heal': {
      const doHeal = (ip: InPlay) => {
        const n = Math.min(ip.damage, ef.amount)
        ip.damage -= n
        if (n) log(state, 'action', t('{name} é curado em {n}.', { name: objName(state, ip.id), n }), me)
      }
      if (ef.target === 'self') {
        const self = selfOf(state, r)
        if (self) doHeal(self)
        return 'done'
      }
      if (ef.target === 'eachOwn') {
        inPlayOf(state, me).forEach(doHeal)
        return 'done'
      }
      const cands = candidatesFor(state, r, ef.target)
      if (!cands.length) return 'done'
      if (!ans) return ask({ kind: 'inPlay', player: me, candidates: cands, optional: false, prompt: t('Escolha o Pokémon a curar ({n}).', { n: ef.amount }) })
      const tgt = ans.id ? findInPlay(state, ans.id) : null
      if (tgt) doHeal(tgt.ip)
      return 'done'
    }
    case 'condition': {
      const ip = ef.target === 'self' ? selfOf(state, r) : op.active
      if (!ip) return 'done'
      if (ef.target !== 'self' && (ip.preventAllUntil ?? 0) >= state.turn) return 'done'
      const name = objName(state, ip.id)
      const owner = findInPlay(state, ip.id)!.owner
      if (ef.cond === 'poisoned') ip.poisoned = true
      else if (ef.cond === 'burned') ip.burned = true
      else {
        ip.condition = ef.cond as SpecialCondition
        if (ef.cond === 'paralyzed') ip.paralyzedTurn = state.turn
      }
      const label: Record<string, string> = { asleep: t('Adormecido'), confused: t('Confuso'), paralyzed: t('Paralisado'), poisoned: t('Envenenado'), burned: t('Queimado') }
      log(state, 'judge', t('{name} agora está {cond}.', { name, cond: label[ef.cond] }), owner)
      return 'done'
    }
    case 'draw':
      drawN(state, me, ef.n)
      return 'done'
    case 'drawUntil':
      drawN(state, me, Math.max(0, ef.n - pl.hand.length))
      return 'done'
    case 'discardHandDraw':
      pl.discard.push(...pl.hand)
      pl.hand = []
      log(state, 'action', t('{name} descarta a mão.', { name: pl.name }), me)
      drawN(state, me, ef.n)
      return 'done'
    case 'shuffleHandDraw':
      pl.deck.push(...pl.hand)
      pl.hand = []
      shuffle(state, pl.deck)
      log(state, 'action', t('{name} embaralha a mão no deck.', { name: pl.name }), me)
      if (ef.n) drawN(state, me, ef.n)
      return 'done'
    case 'discardEnergy': {
      const ip = ef.from === 'self' ? selfOf(state, r) : op.active
      if (!ip || !ip.energy.length) return 'done'
      const owner = findInPlay(state, ip.id)!.owner
      const eligible = ip.energy.filter((id) => !ef.type || basicEnergyType(state.objects[id].card) === ef.type || rulesOf(state.objects[id].card).energyProvides?.includes(ef.type))
      const count = ef.count === 'all' ? eligible.length : Math.min(ef.count, eligible.length)
      if (!count) return 'done'
      let chosen: string[]
      if (count >= eligible.length) chosen = eligible
      else if (!ans) return ask({ kind: 'energy', player: me, pokemon: ip.id, candidates: eligible, count, prompt: t('Escolha {n} Energia(s) para descartar de {name}.', { n: count, name: objName(state, ip.id) }) })
      else chosen = (ans.ids ?? []).filter((id) => eligible.includes(id)).slice(0, count)
      for (const id of chosen) {
        ip.energy.splice(ip.energy.indexOf(id), 1)
        state.players[state.objects[id].owner].discard.push(id)
      }
      log(state, 'action', t('{n} Energia(s) de {name} vão para o descarte.', { n: chosen.length, name: objName(state, ip.id) }), owner)
      return 'done'
    }
    case 'cantAttackNext': {
      const self = selfOf(state, r)
      if (self) self.cantAttackUntil = state.turn + 2
      return 'done'
    }
    case 'oppCantRetreat':
      if (op.active) op.active.cantRetreatUntil = state.turn + 1
      return 'done'
    case 'reduceDamageNext': {
      const self = selfOf(state, r)
      if (self) self.reduceDamage = { n: ef.amount, until: state.turn + 1 }
      return 'done'
    }
    case 'preventAllNext': {
      const self = selfOf(state, r)
      if (self) {
        self.preventAllUntil = state.turn + 1
        log(state, 'judge', t('Durante o próximo turno do oponente, ataques não causam dano nem efeitos em {name}.', { name: objName(state, self.id) }), me)
      }
      return 'done'
    }
    case 'switchSelf':
    case 'switchOwnActive': {
      if (!pl.bench.length || !pl.active) return 'done'
      if (!ans) return ask({ kind: 'inPlay', player: me, candidates: pl.bench.map((b) => b.id), optional: ef.k === 'switchSelf' && ef.optional, prompt: t('Escolha o Pokémon do Banco que vai para o Ativo.') })
      if (ans.id) switchActive(state, me, ans.id)
      return 'done'
    }
    case 'gust': {
      if (!op.bench.length) return 'done'
      if (!ans) return ask({ kind: 'inPlay', player: me, candidates: op.bench.map((b) => b.id), optional: false, prompt: t('Escolha o Pokémon do Banco do oponente que vai para o Ativo.') })
      if (ans.id) switchActive(state, o, ans.id)
      return 'done'
    }
    case 'oppSwitches': {
      if (!op.bench.length) return 'done'
      if (!ans) return ask({ kind: 'inPlay', player: o, candidates: op.bench.map((b) => b.id), optional: false, prompt: t('Escolha o Pokémon do seu Banco que vai para o Ativo.') })
      if (ans.id) switchActive(state, o, ans.id)
      return 'done'
    }
    case 'millOpp':
    case 'millSelf': {
      const who = ef.k === 'millOpp' ? op : pl
      const cards = who.deck.splice(0, ef.n)
      who.discard.push(...cards)
      if (cards.length) log(state, 'action', t('{n} carta(s) do topo do deck de {name} vão para o descarte.', { n: cards.length, name: who.name }), who.id)
      return 'done'
    }
    case 'discardRandomOpp': {
      if (!op.hand.length) return 'done'
      const id = op.hand.splice(Math.floor(rand(state) * op.hand.length), 1)[0]
      op.discard.push(id)
      log(state, 'action', t('{name} descarta {card} (aleatória) da mão.', { name: op.name, card: objName(state, id) }), o)
      return 'done'
    }
    case 'search': {
      const cands = pl.deck.filter((id) => matchesFilter(state.objects[id].card, ef.filter))
      const room = ef.dest === 'bench' ? Math.max(0, BENCH_MAX - pl.bench.length - (pl.active ? 0 : -1)) : ef.max
      const max = Math.min(ef.max, room, cands.length)
      if (!ans) {
        if (!pl.deck.length) return 'done'
        return ask({ kind: 'cards', player: me, zone: 'deck', owner: me, candidates: cands, shown: [...pl.deck], min: 0, max, prompt: t('Procure no seu deck: escolha até {n} carta(s).', { n: max }) })
      }
      const picked = (ans.ids ?? []).filter((id) => cands.includes(id)).slice(0, max)
      for (const id of picked) {
        pl.deck.splice(pl.deck.indexOf(id), 1)
        if (ef.dest === 'hand') pl.hand.push(id)
        else {
          const ip = newInPlay(state, id)
          if (!pl.active) pl.active = ip
          else pl.bench.push(ip)
        }
      }
      shuffle(state, pl.deck)
      log(state, 'action', ef.dest === 'hand' ? t('{name} pega {n} carta(s) do deck para a mão e embaralha.', { name: pl.name, n: picked.length }) : t('{name} coloca {n} Pokémon do deck no Banco e embaralha.', { name: pl.name, n: picked.length }), me)
      if (picked.length) log(state, 'info', picked.map((id) => objName(state, id)).join(', '), me)
      return 'done'
    }
    case 'fromDiscard': {
      const cands = pl.discard.filter((id) => matchesFilter(state.objects[id].card, ef.filter))
      if (!cands.length) return 'done'
      const max = Math.min(ef.max, cands.length)
      if (!ans) return ask({ kind: 'cards', player: me, zone: 'discard', owner: me, candidates: cands, shown: [...pl.discard], min: 0, max, prompt: t('Escolha até {n} carta(s) do seu descarte.', { n: max }) })
      const picked = (ans.ids ?? []).filter((id) => cands.includes(id)).slice(0, max)
      for (const id of picked) {
        pl.discard.splice(pl.discard.indexOf(id), 1)
        if (ef.dest === 'hand') pl.hand.push(id)
        else pl.deck.push(id)
      }
      if (ef.dest === 'deck') shuffle(state, pl.deck)
      log(state, 'action', ef.dest === 'hand' ? t('{name} pega {n} carta(s) do descarte para a mão.', { name: pl.name, n: picked.length }) : t('{name} embaralha {n} carta(s) do descarte no deck.', { name: pl.name, n: picked.length }), me)
      return 'done'
    }
    case 'discardFromHand': {
      const cands = [...pl.hand]
      const n = Math.min(ef.n, cands.length)
      if (!n) {
        if (ef.cost) r.next = r.effects.length - 1 // custo não pago: o resto não acontece
        return 'done'
      }
      if (!ans) return ask({ kind: 'cards', player: me, zone: 'hand', owner: me, candidates: cands, shown: cands, min: n, max: n, prompt: t('Escolha {n} carta(s) da mão para descartar.', { n }) })
      const picked = (ans.ids ?? []).filter((id) => pl.hand.includes(id)).slice(0, n)
      for (const id of picked) {
        pl.hand.splice(pl.hand.indexOf(id), 1)
        pl.discard.push(id)
      }
      log(state, 'action', t('{name} descarta {n} carta(s) da mão.', { name: pl.name, n: picked.length }), me)
      return 'done'
    }
    case 'rareCandy': {
      const opts = rareCandyOptions(state, me)
      if (!opts.length) return 'done'
      if (!ans) {
        const stage2 = [...new Set(opts.map((x) => x.stage2))]
        return ask({ kind: 'cards', player: me, zone: 'hand', owner: me, candidates: stage2, shown: [...pl.hand], min: 1, max: 1, prompt: t('Doce Raro: escolha o Pokémon Estágio 2 da sua mão.') })
      }
      if (ans.ids) {
        r.picked = ans.ids[0]
        const basics = opts.filter((x) => x.stage2 === r.picked).map((x) => x.basic)
        if (!basics.length) return 'done'
        return ask({ kind: 'inPlay', player: me, candidates: basics, optional: false, prompt: t('Doce Raro: escolha o Pokémon Básico que vai evoluir.') })
      }
      if (ans.id && r.picked && pl.hand.includes(r.picked)) {
        pl.hand.splice(pl.hand.indexOf(r.picked), 1)
        evolveInto(state, findInPlay(state, ans.id)!.ip, r.picked)
      }
      return 'done'
    }
    case 'attachFromDiscard':
    case 'shuffleIntoDeckSelf':
      return 'done'
  }
  return 'done'
}

/** Pares (Básico em jogo, Estágio 2 na mão) válidos para o Doce Raro. */
export function rareCandyOptions(state: PGameState, p: PSeat): { basic: string; stage2: string }[] {
  if (state.turn <= 2) return []
  const pl = state.players[p]
  const out: { basic: string; stage2: string }[] = []
  for (const hid of pl.hand) {
    const c = state.objects[hid].card
    if (c.category !== 'Pokemon' || c.stage !== 'Stage2' || !c.evolveFrom) continue
    const basicName = state.evolutions[c.evolveFrom]
    if (!basicName) continue
    for (const ip of inPlayOf(state, p)) {
      const top = topCard(state, ip)
      if (top.name === basicName && ip.stack.length === 1 && ip.playedTurn !== state.turn) out.push({ basic: ip.id, stage2: hid })
    }
  }
  return out
}

// ============================================================
// Escolhas
// ============================================================

/** Escolha pendente para o jogador (a da preparação é simultânea). */
export function currentChoice(state: PGameState, p?: PSeat): PChoice | null {
  if (p !== undefined && state.step === 'setup') return state.choices.find((c) => c.player === p) ?? null
  return state.choices[0] ?? null
}

/** O jogador precisa agir agora? */
export function canAct(state: PGameState, p: PSeat): boolean {
  if (state.winner !== null) return false
  if (state.step === 'setup') return state.choices.some((c) => c.player === p)
  if (state.choices.length) return state.choices[0].player === p
  if (state.resolving) return false
  return state.activePlayer === p
}

function applyChoice(state: PGameState, p: PSeat, a: PAction): string | null {
  const idx = state.step === 'setup' ? state.choices.findIndex((c) => c.player === p) : 0
  const ch = state.choices[idx]
  if (!ch) return t('Não há escolha pendente.')
  if (ch.player !== p) return t('Aguarde a escolha do outro jogador.')
  const pl = state.players[p]
  const done = () => state.choices.splice(idx, 1)
  switch (ch.kind) {
    case 'setup': {
      if (a.t !== 'setup') return t('Escolha seu Pokémon Ativo e o Banco.')
      const ids = [a.active, ...a.bench]
      if (new Set(ids).size !== ids.length) return t('Escolha cada carta uma vez só.')
      if (a.bench.length > BENCH_MAX) return t('No máximo {n} Pokémon no Banco.', { n: BENCH_MAX })
      if (!ids.every((id) => pl.hand.includes(id) && isBasicPokemon(state.objects[id].card))) return t('Só Pokémon Básicos da sua mão.')
      for (const id of ids) pl.hand.splice(pl.hand.indexOf(id), 1)
      pl.active = newInPlay(state, a.active)
      pl.bench = a.bench.map((id) => newInPlay(state, id))
      log(state, 'action', t('{name} prepara seus Pokémon ({n} no Banco).', { name: pl.name, n: a.bench.length }), p)
      done()
      return null
    }
    case 'extraDraw': {
      if (a.t !== 'extraDraw') return t('Escolha quantas cartas comprar.')
      const n = Math.max(0, Math.min(ch.max, Math.floor(a.n)))
      if (n) drawN(state, p, n)
      done()
      return null
    }
    case 'promote': {
      if (a.t !== 'chooseInPlay' || !a.id || !pl.bench.some((b) => b.id === a.id)) return t('Escolha um Pokémon do seu Banco.')
      switchActive(state, p, a.id)
      done()
      return null
    }
    case 'inPlay': {
      if (a.t !== 'chooseInPlay') return t('Escolha um Pokémon.')
      if (a.id === null && !ch.optional) return t('Escolha um Pokémon.')
      if (a.id !== null && !ch.candidates.includes(a.id)) return t('Escolha um dos Pokémon indicados.')
      done()
      return resume(state, { id: a.id })
    }
    case 'cards': {
      if (a.t !== 'chooseCards') return t('Escolha as cartas.')
      const ids = [...new Set(a.ids)]
      if (ids.length < ch.min || ids.length > ch.max) return ch.min === ch.max ? t('Escolha exatamente {n} carta(s).', { n: ch.min }) : t('Escolha até {n} carta(s).', { n: ch.max })
      if (!ids.every((id) => ch.candidates.includes(id))) return t('Escolha entre as cartas indicadas.')
      done()
      return resume(state, { ids })
    }
    case 'energy': {
      if (a.t !== 'chooseCards') return t('Escolha as Energias.')
      const ids = [...new Set(a.ids)]
      if (ids.length !== ch.count || !ids.every((id) => ch.candidates.includes(id))) return t('Escolha {n} Energia(s).', { n: ch.count })
      done()
      return resume(state, { ids })
    }
    case 'yesNo': {
      if (a.t !== 'chooseYesNo') return t('Responda sim ou não.')
      done()
      return resume(state, { yes: a.yes })
    }
  }
  return null
}

function resume(state: PGameState, ans: Answer): string | null {
  const r = state.resolving
  if (!r) return null
  r.waiting = false
  const ef = r.effects[r.next]
  const res = stepEffect(state, r, ef, ans)
  if (res === 'done') {
    r.next++
    r.sub = 0
  }
  return null
}

// ============================================================
// Ajustes manuais
// ============================================================

/** Onde está uma carta (zona e dono). */
function locate(state: PGameState, id: string): { owner: PSeat; zone: string } | null {
  for (const pl of state.players) {
    for (const z of ['hand', 'deck', 'discard', 'prizes', 'lostZone'] as const) if (pl[z].includes(id)) return { owner: pl.id, zone: z }
    for (const ip of inPlayOf(state, pl.id)) {
      if (ip.stack.includes(id)) return { owner: pl.id, zone: 'pokemon' }
      if (ip.energy.includes(id) || ip.tool === id) return { owner: pl.id, zone: 'attached' }
    }
  }
  if (state.stadium === id) return { owner: state.objects[id].owner, zone: 'stadium' }
  return null
}

function applyManual(state: PGameState, p: PSeat, op: PManualOp): string | null {
  const err = applyManualOp(state, p, op)
  if (!err) {
    const id = 'id' in op ? op.id : undefined
    recordIssue(state, 'manual', state.log[state.log.length - 1]?.text ?? op.op, id ? state.objects[id]?.card.name : undefined, state.log.slice(-9, -1).map((e) => e.text))
    if (state.step === 'main') checkKnockouts(state)
  }
  return err
}

function applyManualOp(state: PGameState, p: PSeat, op: PManualOp): string | null {
  const me = pname(state, p)
  switch (op.op) {
    case 'damage': {
      const ref = findInPlay(state, op.id)
      if (!ref) return t('Pokémon inválido.')
      ref.ip.damage = Math.max(0, ref.ip.damage + op.delta)
      log(state, 'manual', t('Ajuste manual ({player}): dano em {name} agora é {n}.', { player: me, name: objName(state, op.id), n: ref.ip.damage }), p)
      return null
    }
    case 'condition': {
      const ref = findInPlay(state, op.id)
      if (!ref) return t('Pokémon inválido.')
      if (op.cond === 'clear') clearConditions(ref.ip)
      else if (op.cond === 'poisoned') ref.ip.poisoned = !ref.ip.poisoned
      else if (op.cond === 'burned') ref.ip.burned = !ref.ip.burned
      else {
        ref.ip.condition = ref.ip.condition === op.cond ? undefined : op.cond
        if (op.cond === 'paralyzed') ref.ip.paralyzedTurn = state.turn
      }
      log(state, 'manual', t('Ajuste manual ({player}): condição de {name} alterada.', { player: me, name: objName(state, op.id) }), p)
      return null
    }
    case 'move': {
      const loc = locate(state, op.id)
      if (!loc) return t('Carta inválida.')
      const owner = state.players[state.objects[op.id].owner]
      if (loc.zone === 'pokemon') {
        const ref = inPlayOf(state, loc.owner).find((ip) => ip.stack.includes(op.id))!
        removeInPlay(state, ref, op.to === 'discard' ? 'discard' : op.to)
      } else {
        if (loc.zone === 'attached') {
          for (const ip of inPlayOf(state, loc.owner)) {
            if (ip.tool === op.id) ip.tool = undefined
            const i = ip.energy.indexOf(op.id)
            if (i >= 0) ip.energy.splice(i, 1)
          }
        } else if (loc.zone === 'stadium') state.stadium = null
        else {
          const list = state.players[loc.owner][loc.zone as 'hand']
          list.splice(list.indexOf(op.id), 1)
        }
        if (op.to === 'hand') owner.hand.push(op.id)
        else if (op.to === 'discard') owner.discard.push(op.id)
        else if (op.to === 'deckTop') owner.deck.unshift(op.id)
        else if (op.to === 'deckBottom') owner.deck.push(op.id)
        else owner.lostZone.push(op.id)
      }
      const dest: Record<string, string> = { hand: t('a mão'), discard: t('o descarte'), deckTop: t('o topo do deck'), deckBottom: t('o fundo do deck'), lostZone: t('a Zona Perdida') }
      log(state, 'manual', t('Ajuste manual ({player}): {name} vai para {dest}.', { player: me, name: objName(state, op.id), dest: dest[op.to] }), p)
      return null
    }
    case 'takePrize': {
      const pl = state.players[op.player]
      if (!pl?.prizes.length) return t('Não há cartas de Prêmio.')
      pl.hand.push(pl.prizes.shift()!)
      log(state, 'manual', t('Ajuste manual ({player}): {name} pega 1 carta de Prêmio.', { player: me, name: pl.name }), p)
      if (!pl.prizes.length) checkWinner(state)
      return null
    }
    case 'draw': {
      const pl = state.players[op.player]
      if (!pl) return t('Jogador inválido.')
      drawN(state, op.player, 1, true)
      log(state, 'manual', t('Ajuste manual ({player}): {name} compra 1 carta.', { player: me, name: pl.name }), p)
      return null
    }
    case 'shuffle': {
      const pl = state.players[op.player]
      if (!pl) return t('Jogador inválido.')
      shuffle(state, pl.deck)
      log(state, 'manual', t('Ajuste manual ({player}): deck de {name} embaralhado.', { player: me, name: pl.name }), p)
      return null
    }
  }
  return null
}

// ============================================================
// Consultas para a interface e o bot
// ============================================================

export interface HandOption {
  label: string
  action?: PAction
  /** Precisa escolher um Pokémon meu (evoluir, Energia, Ferramenta). */
  needsTarget?: 'evolve' | 'attach' | 'tool'
  targets?: string[]
  error?: string
}

/** O que dá para fazer com uma carta da mão agora. */
export function handOptions(state: PGameState, p: PSeat, id: string): HandOption[] {
  const c = state.objects[id]?.card
  if (!c) return []
  const mine = inPlayOf(state, p)
  if (c.category === 'Pokemon') {
    const out: HandOption[] = []
    if (isBasicPokemon(c)) out.push({ label: t('Colocar no Banco'), action: { t: 'playBasic', id }, error: checkPlayBasic(state, p, id) ?? undefined })
    if (c.evolveFrom) {
      const targets = mine.filter((ip) => !checkEvolve(state, p, id, ip.id)).map((ip) => ip.id)
      out.push({ label: t('Evoluir'), needsTarget: 'evolve', targets, error: targets.length ? undefined : checkEvolve(state, p, id, mine.find((ip) => topCard(state, ip).name === c.evolveFrom)?.id ?? '') ?? t('Nenhum Pokémon para evoluir.') })
    }
    return out
  }
  if (c.category === 'Energy') {
    const targets = mine.map((ip) => ip.id)
    return [{ label: t('Ligar a um Pokémon'), needsTarget: 'attach', targets, error: (checkAttach(state, p, id, targets[0] ?? '') ?? undefined) }]
  }
  if (c.trainerType === 'Tool') {
    const targets = mine.filter((ip) => !ip.tool).map((ip) => ip.id)
    return [{ label: t('Ligar a um Pokémon'), needsTarget: 'tool', targets, error: targets.length ? (checkTrainer(state, p, id, targets[0]) ?? undefined) : t('Nenhum Pokémon sem Ferramenta.') }]
  }
  return [{ label: t('Jogar'), action: { t: 'playTrainer', id }, error: checkTrainer(state, p, id) ?? undefined }]
}

export { isBasicPokemon, prizeValue }
