// Motor de regras do Kard: estado, validação de jogadas, pilha, combate e ações baseadas em estado.
// Toda jogada passa por `performAction`, que valida (o "juiz") e só então aplica.

import type { JudgeOp } from '../types.ts'
import { t } from '../i18n/index.ts'
import { parseCard } from './parser.ts'
import { emptyPool, parseManaCost, planPayment, type ManaSourceInfo } from './mana.ts'
import {
  STEP_LABEL,
  STEP_ORDER,
  type Action,
  type ActionResult,
  type Amount,
  type CountExpr,
  type AttackTarget,
  type DamageTo,
  type Effect,
  type EffectBlock,
  type GameCard,
  type GameObject,
  type GameSetup,
  type GameState,
  type LogEntry,
  type ManaPool,
  type ManualOp,
  type ObjRef,
  type ParsedCard,
  type PendingChoice,
  type PendingTrigger,
  type PlayerId,
  type PlayerState,
  type StackItem,
  type Step,
  type TargetChoice,
  type TargetSpec,
  type TokenDef,
  type TriggerEvent,
  type Who
} from './types.ts'

export const FACE_LAYOUTS = ['modal_dfc', 'transform', 'adventure', 'split', 'flip', 'reversible_card']
const HAND_SIZE = 7

// ============================================================
// Utilidades
// ============================================================

function clone<T>(x: T): T {
  return structuredClone(x)
}

function rand(state: GameState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffleArray<T>(state: GameState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// ---------------- Jogadores (2 a 4, todos contra todos) ----------------

/** O jogador ainda está na partida? */
export function isAlive(state: GameState, p: PlayerId): boolean {
  const pl = state.players[p]
  return Boolean(pl) && !pl.lost
}

/** Jogadores ainda na partida, em ordem de assento. */
export function livingPlayers(state: GameState): PlayerId[] {
  return state.players.filter((pl) => !pl.lost).map((pl) => pl.id)
}

/** Próximo jogador vivo depois de `p` na ordem dos assentos (o próprio `p` se ninguém mais estiver vivo). */
export function nextPlayer(state: GameState, p: PlayerId): PlayerId {
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const q = (p + i) % n
    if (!state.players[q].lost) return q
  }
  return p
}

/** Oponentes vivos de `p`, em ordem de turno começando pelo jogador depois de `p`. */
export function opponents(state: GameState, p: PlayerId): PlayerId[] {
  const n = state.players.length
  const out: PlayerId[] = []
  for (let i = 1; i < n; i++) {
    const q = (p + i) % n
    if (!state.players[q].lost) out.push(q)
  }
  return out
}

/** Jogadores vivos em ordem APNAP: o jogador ativo primeiro, depois os outros em ordem de turno. */
export function apnapOrder(state: GameState): PlayerId[] {
  const ap = state.activePlayer
  return isAlive(state, ap) ? [ap, ...opponents(state, ap)] : opponents(state, ap)
}

/** Quantos turnos faltam até o próximo turno de `p` (sem contar turnos extras): 1..n vivos. */
function turnsUntilNextTurnOf(state: GameState, p: PlayerId): number {
  let q = state.activePlayer
  const n = Math.max(1, livingPlayers(state).length)
  for (let d = 1; d <= n; d++) {
    q = nextPlayer(state, q)
    if (q === p) return d
  }
  return n
}

/** Jogador ativo ou, se ele já saiu da partida, o próximo jogador vivo. */
function apOrNext(state: GameState): PlayerId {
  return isAlive(state, state.activePlayer) ? state.activePlayer : nextPlayer(state, state.activePlayer)
}

export function log(state: GameState, kind: LogEntry['kind'], text: string, player?: PlayerId): void {
  // id determinístico (depende só do estado): o último id + 1
  const last = state.log.length ? state.log[state.log.length - 1].id : 0
  state.log.push({ id: last + 1, turn: state.turn, kind, text, player })
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600)
}

function pname(state: GameState, p: PlayerId): string {
  return state.players[p].name
}

export function objName(state: GameState, id: string | undefined): string {
  if (!id) return '?'
  const o = state.objects[id]
  if (!o) return '?'
  const f = faceOf(o)
  return f?.displayName ?? o.card.displayName
}

// ============================================================
// Características
// ============================================================

export function faceOf(o: GameObject) {
  if (o.card.faces && FACE_LAYOUTS.includes(o.card.layout)) return o.card.faces[o.face] ?? o.card.faces[0]
  return null
}

export function typeLineOf(o: GameObject): string {
  return faceOf(o)?.typeLine ?? o.card.typeLine
}

export function manaCostOf(o: GameObject, face = o.face): string {
  if (o.card.faces && FACE_LAYOUTS.includes(o.card.layout)) return o.card.faces[face]?.manaCost ?? o.card.manaCost
  return o.card.manaCost
}

export function hasType(o: GameObject, t: string): boolean {
  return new RegExp(`\\b${t}\\b`, 'i').test(typeLineOf(o))
}

export function isCreature(o: GameObject): boolean {
  return hasType(o, 'Creature')
}

export function isLand(o: GameObject): boolean {
  return hasType(o, 'Land')
}

function parseFace(card: GameCard, face: number): ParsedCard {
  if (card.faces && FACE_LAYOUTS.includes(card.layout)) {
    const f = card.faces[face] ?? card.faces[0]
    return parseCard({ name: f.name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: card.keywords, producedMana: card.producedMana })
  }
  return parseCard({ name: card.name, typeLine: card.typeLine, oracleText: card.oracleText, keywords: card.keywords, producedMana: card.producedMana })
}

function basePT(o: GameObject): { p: number; t: number } {
  const f = faceOf(o)
  const ps = f?.power ?? o.card.power
  const ts = f?.toughness ?? o.card.toughness
  const num = (s?: string) => {
    if (!s) return 0
    const n = parseInt(s.replace(/[^0-9-]/g, ''), 10)
    return isNaN(n) ? 0 : n
  }
  return { p: num(ps), t: num(ts) }
}

function attachedTo(state: GameState, id: string): GameObject[] {
  return state.battlefield.map((x) => state.objects[x]).filter((x) => x && x.attachedTo === id)
}

/** Avalia contagens como "o número de terrenos que você controla". */
export function countFor(state: GameState, p: PlayerId, ce: CountExpr, selfId?: string): number {
  const mine = () => state.battlefield.map((id) => state.objects[id]).filter((x) => x && x.controller === p)
  switch (ce) {
    case 'lands':
      return mine().filter(isLand).length
    case 'creatures':
      return mine().filter(isCreature).length
    case 'otherCreatures':
      return mine().filter((x) => isCreature(x) && x.id !== selfId).length
    case 'artifacts':
      return mine().filter((x) => hasType(x, 'Artifact')).length
    case 'enchantments':
      return mine().filter((x) => hasType(x, 'Enchantment')).length
    case 'hand':
      return state.players[p].hand.length
    case 'graveyard':
      return state.players[p].graveyard.length
    case 'creatureCardsGraveyard':
      return state.players[p].graveyard.filter((id) => /\bCreature\b/.test(state.objects[id]?.card.typeLine ?? '')).length
    case 'forests':
      return mine().filter((x) => hasType(x, 'Forest')).length
    case 'swamps':
      return mine().filter((x) => hasType(x, 'Swamp')).length
    case 'islands':
      return mine().filter((x) => hasType(x, 'Island')).length
    case 'mountains':
      return mine().filter((x) => hasType(x, 'Mountain')).length
    case 'plains':
      return mine().filter((x) => hasType(x, 'Plains')).length
  }
}

function anthemsFor(state: GameState, o: GameObject): { power: number; toughness: number; keywords: string[] } {
  const out = { power: 0, toughness: 0, keywords: [] as string[] }
  for (const sid of state.battlefield) {
    const s = state.objects[sid]
    if (!s) continue
    for (const st of s.parsed.statics) {
      if (st.k !== 'anthem') continue
      if (st.filter.other && s.id === o.id) continue
      let filter = st.filter
      if (filter.subtype === '$chosen') {
        if (!s.chosenType) continue
        filter = { ...filter, subtype: s.chosenType }
      }
      if (!objMatches(state, o, filter, s.controller, s.id)) continue
      out.power += st.power
      out.toughness += st.toughness
      out.keywords.push(...st.keywords)
    }
  }
  return out
}

function selfDynamic(state: GameState, o: GameObject): { p: number; t: number; cda: boolean } {
  let p = 0
  let t = 0
  let cda = false
  if (o.zone === 'battlefield' && o.parsed.ptFrom) {
    const n = countFor(state, o.controller, o.parsed.ptFrom, o.id)
    p = n
    t = n
    cda = true
  }
  if (o.zone === 'battlefield' && o.parsed.selfBuffPer) {
    const n = countFor(state, o.controller, o.parsed.selfBuffPer.count, o.id)
    p += n * o.parsed.selfBuffPer.power
    t += n * o.parsed.selfBuffPer.toughness
  }
  return { p, t, cda }
}

export function power(state: GameState, o: GameObject): number {
  const dyn = selfDynamic(state, o)
  let p = (dyn.cda ? 0 : basePT(o).p) + dyn.p + (o.counters['+1/+1'] ?? 0) - (o.counters['-1/-1'] ?? 0)
  for (const m of o.mods) p += m.power
  for (const a of attachedTo(state, o.id)) for (const st of a.parsed.statics) if (st.k === 'attachedBuff') p += st.power
  p += anthemsFor(state, o).power
  return p
}

export function toughness(state: GameState, o: GameObject): number {
  const dyn = selfDynamic(state, o)
  let t = (dyn.cda ? 0 : basePT(o).t) + dyn.t + (o.counters['+1/+1'] ?? 0) - (o.counters['-1/-1'] ?? 0)
  for (const m of o.mods) t += m.toughness
  for (const a of attachedTo(state, o.id)) for (const st of a.parsed.statics) if (st.k === 'attachedBuff') t += st.toughness
  t += anthemsFor(state, o).toughness
  return t
}

export function keywordsOf(state: GameState, o: GameObject): string[] {
  const set = new Set(o.parsed.keywords)
  for (const k of o.grants ?? []) set.add(k)
  for (const m of o.mods) m.keywords.forEach((k) => set.add(k))
  for (const a of attachedTo(state, o.id)) for (const st of a.parsed.statics) if (st.k === 'attachedBuff') st.keywords.forEach((k) => set.add(k))
  if (o.zone === 'battlefield') anthemsFor(state, o).keywords.forEach((k) => set.add(k))
  return [...set]
}

export function hasKw(state: GameState, o: GameObject, kw: string): boolean {
  return keywordsOf(state, o).includes(kw)
}

function locks(state: GameState, o: GameObject) {
  const out = { cantAttack: o.parsed.cantAttack, cantBlock: o.parsed.cantBlock, noUntap: false, noActivate: false }
  for (const a of attachedTo(state, o.id)) {
    for (const st of a.parsed.statics) {
      if (st.k === 'attachedLock') {
        out.cantAttack ||= st.cantAttack
        out.cantBlock ||= st.cantBlock
        out.noUntap ||= st.noUntap
        out.noActivate ||= st.noActivate
      }
    }
  }
  return out
}

/** Verifica se um objeto atende a um filtro/especificação de alvo, do ponto de vista de `viewer`. */
export function objMatches(state: GameState, o: GameObject, spec: TargetSpec, viewer: PlayerId, sourceId?: string): boolean {
  const tl = typeLineOf(o)
  if (spec.objTypes.length) {
    const ok = spec.objTypes.some((t) => {
      switch (t) {
        case 'permanent':
          return o.zone === 'battlefield' || !/\b(Instant|Sorcery)\b/.test(tl)
        case 'nonland':
          return !/\bLand\b/.test(tl)
        case 'noncreature':
          return !/\bCreature\b/.test(tl)
        default:
          return new RegExp(`\\b${t}\\b`, 'i').test(tl)
      }
    })
    if (!ok) return false
  }
  if (spec.controller === 'you' && o.controller !== viewer) return false
  if (spec.controller === 'opponent' && o.controller === viewer) return false
  if (spec.other && o.id === sourceId) return false
  const colors = faceOf(o)?.colors ?? o.card.colors
  if (spec.nonColors?.some((c) => colors.includes(c))) return false
  if (spec.colors && !spec.colors.some((c) => colors.includes(c))) return false
  if (spec.subtype && !new RegExp(`\\b${spec.subtype}\\b`, 'i').test(tl)) return false
  if (spec.nonbasic && /\bBasic\b/.test(tl)) return false
  if (spec.nonLegendary && /\bLegendary\b/.test(tl)) return false
  if (spec.nonToken && o.isToken) return false
  if (o.zone === 'battlefield') {
    if (spec.flying && !hasKw(state, o, 'flying')) return false
    if (spec.noFlying && hasKw(state, o, 'flying')) return false
    if (spec.tapped && !o.tapped) return false
    if (spec.untapped && o.tapped) return false
    const inCombat = state.combat
    if (spec.attacking && !inCombat?.attackers.some((a) => a.id === o.id)) return false
    if (spec.blocking && !inCombat?.blockers.some((b) => b.blocker === o.id)) return false
    if (spec.attackingOrBlocking && !inCombat?.attackers.some((a) => a.id === o.id) && !inCombat?.blockers.some((b) => b.blocker === o.id)) return false
    if (spec.maxPower !== undefined && power(state, o) > spec.maxPower) return false
    if (spec.minPower !== undefined && power(state, o) < spec.minPower) return false
    if (spec.maxToughness !== undefined && toughness(state, o) > spec.maxToughness) return false
  }
  if (spec.maxCmc !== undefined && o.card.cmc > spec.maxCmc) return false
  return true
}

// ============================================================
// Criação da partida
// ============================================================

function newObject(state: GameState, card: GameCard, owner: PlayerId, zone: GameObject['zone'], extra: Partial<GameObject> = {}): GameObject {
  const id = `o${state.nextId++}`
  const obj: GameObject = {
    id,
    owner,
    controller: owner,
    zone,
    card,
    face: 0,
    parsed: parseFace(card, 0),
    tapped: false,
    sick: false,
    damage: 0,
    deathtouched: false,
    counters: {},
    mods: [],
    isCommander: false,
    isToken: Boolean(card.token),
    timestamp: state.timestamp++,
    ...extra
  }
  state.objects[id] = obj
  return obj
}

function newPlayer(id: PlayerId, name: string, isBot: boolean, life: number): PlayerState {
  return {
    id,
    name,
    isBot,
    life,
    poison: 0,
    library: [],
    hand: [],
    graveyard: [],
    exile: [],
    command: [],
    pool: emptyPool(),
    landsPlayed: 0,
    commanderCasts: {},
    commanderDamage: {},
    drewFromEmpty: false,
    lost: false,
    mulligans: 0,
    kept: false
  }
}

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4

export function createGame(setup: GameSetup): GameState {
  const n = setup.players.length
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(t('Uma partida precisa de {min} a {max} jogadores (recebidos: {n}).', { min: MIN_PLAYERS, max: MAX_PLAYERS, n }))
  if (setup.firstPlayer !== undefined && (!Number.isInteger(setup.firstPlayer) || setup.firstPlayer < 0 || setup.firstPlayer >= n)) {
    throw new Error(t('Jogador inicial inválido: {n}.', { n: setup.firstPlayer }))
  }
  const state: GameState = {
    format: setup.format,
    commanderGame: setup.players.some((p) => p.commanders.length > 0),
    turn: 0,
    firstPlayer: 0,
    activePlayer: 0,
    step: 'mulligan',
    priority: 0,
    passes: 0,
    players: setup.players.map((ps, i) => newPlayer(i, ps.name, ps.isBot, setup.startingLife)),
    objects: {},
    battlefield: [],
    stack: [],
    combat: null,
    awaiting: null,
    choices: [],
    pendingTriggers: [],
    resolving: null,
    pendingAI: null,
    log: [],
    winner: null,
    nextId: 1,
    rng: (setup.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    timestamp: 1,
    aiEnabled: setup.aiEnabled,
    monarch: null,
    extraTurns: setup.players.map(() => 0),
    delayed: []
  }
  setup.players.forEach((ps, p) => {
    for (const c of ps.deck) state.players[p].library.push(newObject(state, c, p, 'library').id)
    for (const c of ps.commanders) state.players[p].command.push(newObject(state, c, p, 'command', { isCommander: true }).id)
    shuffleArray(state, state.players[p].library)
  })
  // sorteio (com 2 jogadores consome o gerador exatamente como antes: rand < 0.5 → assento 0)
  state.firstPlayer = setup.firstPlayer ?? Math.min(n - 1, Math.floor(rand(state) * n))
  state.activePlayer = state.firstPlayer
  log(state, 'turn', t('Partida iniciada ({format}). Sorteio: {name} começa jogando.', { format: setup.format, name: pname(state, state.firstPlayer) }))
  for (let p = 0; p < n; p++) drawCards(state, p, HAND_SIZE, true)
  // mulligans: cada jogador decide em ordem de turno, começando pelo primeiro jogador
  for (let i = 0; i < n; i++) state.choices.push({ kind: 'mulligan', player: (state.firstPlayer + i) % n })
  return state
}

// ============================================================
// Zonas
// ============================================================

function zoneList(state: GameState, o: GameObject): string[] | null {
  const pl = state.players[o.owner]
  switch (o.zone) {
    case 'library':
      return pl.library
    case 'hand':
      return pl.hand
    case 'graveyard':
      return pl.graveyard
    case 'exile':
      return pl.exile
    case 'command':
      return pl.command
    case 'battlefield':
      return state.battlefield
    default:
      return null
  }
}

function removeFromZone(state: GameState, o: GameObject): void {
  const list = zoneList(state, o)
  if (list) {
    const i = list.indexOf(o.id)
    if (i >= 0) list.splice(i, 1)
  }
}

function drawCards(state: GameState, p: PlayerId, n: number, silent = false): number {
  const pl = state.players[p]
  let drawn = 0
  for (let i = 0; i < n; i++) {
    const id = pl.library.shift()
    if (!id) {
      pl.drewFromEmpty = true
      log(state, 'judge', t('{name} tentou comprar de um grimório vazio.', { name: pl.name }), p)
      break
    }
    state.objects[id].zone = 'hand'
    pl.hand.push(id)
    drawn++
  }
  if (!silent && drawn) log(state, 'action', drawn > 1 ? t('{name} compra {n} cartas.', { name: pl.name, n: drawn }) : t('{name} compra {n} carta.', { name: pl.name, n: drawn }), p)
  return drawn
}

interface MoveOpts {
  x?: number
  bottom?: boolean
  tapped?: boolean
  controller?: PlayerId
  attachTo?: string
  face?: number
}

export function moveObject(state: GameState, id: string, to: GameObject['zone'], opts: MoveOpts = {}): void {
  const o = state.objects[id]
  if (!o) return
  const from = o.zone
  if (from === 'battlefield') leaveBattlefield(state, o, to)
  removeFromZone(state, o)
  if (from === 'stack') {
    // remove o item de pilha correspondente, se ainda existir
    const si = state.stack.findIndex((s) => s.objectId === id)
    if (si >= 0) state.stack.splice(si, 1)
  }
  let dest = to
  if (o.isCommander && (dest === 'graveyard' || dest === 'exile')) {
    dest = 'command'
    log(state, 'judge', t('{name} é um comandante e volta para a zona de comando.', { name: objName(state, id) }))
  }
  if (o.isToken && from === 'battlefield' && dest !== 'battlefield') {
    delete state.objects[id]
    return
  }
  o.zone = dest
  o.tapped = false
  o.damage = 0
  o.deathtouched = false
  o.counters = {}
  o.mods = []
  o.attachedTo = undefined
  o.sick = false
  if (dest !== 'battlefield' && dest !== 'stack' && o.face !== 0) {
    o.face = 0
    o.parsed = parseFace(o.card, 0)
  }
  o.controller = o.owner
  o.originalController = undefined
  o.eotController = undefined
  o.regen = 0
  o.grants = undefined
  o.playableBy = undefined
  o.playableUntil = undefined
  o.chosenType = undefined
  const pl = state.players[o.owner]
  switch (dest) {
    case 'library':
      if (opts.bottom) pl.library.push(id)
      else pl.library.unshift(id)
      break
    case 'hand':
      pl.hand.push(id)
      break
    case 'graveyard':
      pl.graveyard.push(id)
      break
    case 'exile':
      pl.exile.push(id)
      break
    case 'command':
      pl.command.push(id)
      break
    case 'battlefield':
      if (opts.face !== undefined && opts.face !== o.face) {
        o.face = opts.face
        o.parsed = parseFace(o.card, opts.face)
      }
      state.battlefield.push(id)
      enterBattlefield(state, o, opts)
      break
    case 'stack':
      break
  }
}

function leaveBattlefield(state: GameState, o: GameObject, to: GameObject['zone']): void {
  const wasCreature = isCreature(o)
  if (state.combat) {
    state.combat.attackers = state.combat.attackers.filter((a) => a.id !== o.id)
    // bloqueadores mantêm o registro (a criatura atacante continua "bloqueada"), mas sem o objeto
  }
  // Aura de controle: devolve o controle da criatura encantada
  if (o.attachedTo && o.parsed.statics.some((s) => s.k === 'attachedControl')) {
    const t = state.objects[o.attachedTo]
    if (t && t.originalController !== undefined) {
      t.controller = isAlive(state, t.originalController) ? t.originalController : t.owner
      t.originalController = undefined
    }
  }
  for (const tr of o.parsed.triggers) {
    if ((tr.event === 'dies' && to === 'graveyard' && wasCreature) || tr.event === 'ltb') {
      state.pendingTriggers.push({ controller: o.controller, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
    }
  }
  if (to === 'graveyard' && wasCreature) log(state, 'action', t('{name} morre.', { name: objName(state, o.id) }), o.controller)
}

function enterBattlefield(state: GameState, o: GameObject, opts: MoveOpts): void {
  o.controller = opts.controller ?? o.owner
  o.tapped = Boolean(opts.tapped) || o.parsed.entersTapped
  o.sick = true
  o.timestamp = state.timestamp++
  if (opts.attachTo) o.attachedTo = opts.attachTo
  const loyalty = faceOf(o)?.loyalty ?? o.card.loyalty
  if (hasType(o, 'Planeswalker') && loyalty) o.counters.loyalty = parseInt(loyalty, 10) || 0
  if (o.parsed.entersWithCounters !== undefined) {
    const ec = o.parsed.entersWithCounters
    const n = ec === 'X' ? (opts.x ?? 0) : typeof ec === 'object' ? countFor(state, o.controller, ec.per, o.id) * ec.mult : ec
    if (n > 0) o.counters['+1/+1'] = (o.counters['+1/+1'] ?? 0) + n
  }
  const cond = o.parsed.entersTappedUnless
  if (cond && !opts.tapped) {
    const otherLands = state.battlefield.map((id) => state.objects[id]).filter((x) => x && x.id !== o.id && x.controller === o.controller && isLand(x))
    let untapped = true
    if (cond.kind === 'controlType') untapped = otherLands.some((l) => cond.types.some((t) => new RegExp(`\\b${t}\\b`).test(typeLineOf(l))))
    else if (cond.kind === 'fewLands') untapped = otherLands.length <= cond.max
    else if (cond.kind === 'manyLands') untapped = otherLands.length >= cond.min
    else if (cond.kind === 'manyBasics') untapped = otherLands.filter((l) => /\bBasic\b/.test(typeLineOf(l))).length >= cond.min
    else if (cond.kind === 'legendaryCreature') untapped = state.battlefield.some((id) => { const x = state.objects[id]; return x && x.controller === o.controller && isCreature(x) && hasType(x, 'Legendary') })
    else if (cond.kind === 'lowLife') untapped = state.players.some((p) => !p.lost && p.life <= cond.max)
    else untapped = opponents(state, o.controller).length >= 2 // "unless you have two or more opponents"
    o.tapped = !untapped
    if (!untapped) log(state, 'judge', t('{name} entra virado (condição não cumprida).', { name: objName(state, o.id) }), o.controller)
  }
  if (o.parsed.shockLife && !opts.tapped) {
    const pl = state.players[o.controller]
    const cost = o.parsed.shockLife
    if (pl.life > cost + 6) {
      pl.life -= cost
      o.tapped = false
      log(state, 'judge', t('{player} paga {n} de vida para {name} entrar desvirado.', { player: pl.name, n: cost, name: objName(state, o.id) }), o.controller)
    } else {
      o.tapped = true
      log(state, 'judge', t('{name} entra virado (vida baixa demais para pagar {n}).', { name: objName(state, o.id), n: cost }), o.controller)
    }
  }
  if (o.parsed.chooseCreatureType) {
    // escolhe o tipo de criatura mais comum entre as cartas do controlador
    const counts = new Map<string, number>()
    for (const obj of Object.values(state.objects)) {
      if (obj.owner !== o.controller) continue
      const tl = obj.card.typeLine
      const sub = tl.split('—')[1]
      if (!/\bCreature\b/.test(tl) || !sub) continue
      for (const t of sub.trim().split(/\s+/)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    o.chosenType = best?.[0] ?? 'Human'
    log(state, 'judge', t('{name}: tipo de criatura escolhido — {type}.', { name: objName(state, o.id), type: o.chosenType ?? '' }), o.controller)
  }
  if (isLand(o)) {
    for (const sid of state.battlefield) {
      const s = state.objects[sid]
      if (!s || s.controller !== o.controller) continue
      for (const tr of s.parsed.triggers) {
        if (tr.event === 'landfall') state.pendingTriggers.push({ controller: s.controller, sourceId: s.id, sourceName: objName(state, s.id), ability: tr, printingId: s.card.printingId })
      }
    }
  }
  // Aura de controle
  if (o.attachedTo && o.parsed.statics.some((s) => s.k === 'attachedControl')) {
    const t = state.objects[o.attachedTo]
    if (t && t.controller !== o.controller) {
      t.originalController = t.controller
      t.controller = o.controller
      t.sick = true
    }
  }
  for (const tr of o.parsed.triggers) {
    if (tr.event === 'etb') state.pendingTriggers.push({ controller: o.controller, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
  }
  if (isCreature(o)) {
    for (const sid of state.battlefield) {
      const s = state.objects[sid]
      if (!s || s.id === o.id) continue
      for (const tr of s.parsed.triggers) {
        if (tr.event !== 'otherCreatureEtb') continue
        if (tr.creatureFilter === 'you' && o.controller !== s.controller) continue
        state.pendingTriggers.push({ controller: s.controller, sourceId: s.id, sourceName: objName(state, s.id), ability: tr, printingId: s.card.printingId })
      }
    }
  }
  if (o.parsed.unsupported.length && !o.isToken) {
    log(state, 'judge', t('Habilidades de {name} não automatizadas pelo motor: "{text}". Use ajustes manuais se necessário.', { name: objName(state, o.id), text: o.parsed.unsupported.join(' / ') }))
  }
}

function createToken(state: GameState, controller: PlayerId, def: TokenDef): GameObject {
  const texts: Record<string, string> = {
    treasure: '{T}, Sacrifice this artifact: Add one mana of any color.',
    food: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    clue: '{2}, Sacrifice this artifact: Draw a card.',
    blood: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'
  }
  const kind = def.kind ?? 'creature'
  const card: GameCard = {
    oracleId: `token-${def.name}`,
    name: def.name,
    displayName: def.name,
    manaCost: '',
    cmc: 0,
    typeLine: kind === 'creature' ? `Token ${def.types}` : `Token ${def.types}`,
    displayType: kind === 'creature' ? t('Ficha de {types}', { types: def.types }) : t('Ficha — {types}', { types: def.types }),
    oracleText: texts[kind] ?? '',
    displayText: texts[kind] ?? def.keywords.join(', '),
    power: def.power !== undefined ? String(def.power) : undefined,
    toughness: def.toughness !== undefined ? String(def.toughness) : undefined,
    colors: def.colors,
    colorIdentity: def.colors,
    keywords: def.keywords.map((k) => k[0].toUpperCase() + k.slice(1)),
    layout: 'token',
    token: true
  }
  const o = newObject(state, card, controller, 'battlefield', { isToken: true })
  o.zone = 'battlefield'
  state.battlefield.push(o.id)
  enterBattlefield(state, o, { controller })
  return o
}

// ============================================================
// Mana
// ============================================================

export function manaSources(state: GameState, p: PlayerId): ManaSourceInfo[] {
  const out: ManaSourceInfo[] = []
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || o.controller !== p || o.tapped) continue
    const ab = o.parsed.mana.find((m) => m.cost.tap && !m.cost.mana && !m.cost.discard)
    if (!ab) continue
    if (isCreature(o) && o.sick && !hasKw(state, o, 'haste')) continue
    if (locks(state, o).noActivate) continue
    const flex = Math.max(...ab.units.map((u) => u.length))
    out.push({
      id,
      units: ab.units,
      sacrifice: ab.cost.sacrificeSelf,
      life: ab.cost.payLife,
      priority: (ab.cost.sacrificeSelf ? 100 : 0) + (isCreature(o) ? 20 : 0) + (ab.cost.payLife ? 10 : 0) + flex
    })
  }
  return out
}

function commanderTax(state: GameState, o: GameObject): number {
  if (!o.isCommander || o.zone !== 'command') return 0
  return 2 * (state.players[o.owner].commanderCasts[o.id] ?? 0)
}

/** Redução de custo genérico vinda de permanentes ("Instant and sorcery spells you cast cost {1} less"). */
function costReductionFor(state: GameState, p: PlayerId, typeLine: string): number {
  let n = 0
  for (const id of state.battlefield) {
    const s = state.objects[id]
    if (!s || s.controller !== p) continue
    for (const st of s.parsed.statics) {
      if (st.k !== 'costReduction') continue
      const ok =
        st.types.length === 0 ||
        st.types.some((t) => (t === 'noncreature' ? !/\bCreature\b/.test(typeLine) : t === 'historic' ? /\b(Legendary|Artifact|Saga)\b/.test(typeLine) : new RegExp(`\\b${t}\\b`, 'i').test(typeLine)))
      if (ok) n += st.amount
    }
  }
  return n
}

function payMana(state: GameState, p: PlayerId, cost: string, x: number, extraGeneric: number): string | null {
  const pl = state.players[p]
  const plan = planPayment(parseManaCost(cost), x, extraGeneric, pl.pool, manaSources(state, p), pl.life)
  if (!plan) return t('Mana insuficiente para pagar {cost}.', { cost: `${cost || '{0}'}${extraGeneric ? ` + {${extraGeneric}}` : ''}${x ? ` (X=${x})` : ''}` })
  for (const id of plan.tap) state.objects[id].tapped = true
  for (const c of Object.keys(plan.produced) as (keyof ManaPool)[]) pl.pool[c] += plan.produced[c] - plan.consumed[c]
  pl.life -= plan.life
  for (const id of plan.sacrifice) moveObject(state, id, 'graveyard')
  return null
}

function canAfford(state: GameState, p: PlayerId, cost: string, x: number, extraGeneric: number): boolean {
  const pl = state.players[p]
  return planPayment(parseManaCost(cost), x, extraGeneric, pl.pool, manaSources(state, p), pl.life) !== null
}

function emptyPools(state: GameState): void {
  for (const pl of state.players) pl.pool = emptyPool()
}

// ============================================================
// Alvos
// ============================================================

export function isLegalTarget(state: GameState, controller: PlayerId, spec: TargetSpec, choice: TargetChoice, sourceId?: string): boolean {
  if (choice.kind === 'player') {
    if (spec.players === 'none') return false
    if (spec.players === 'opponent' && choice.player === controller) return false
    if (spec.players === 'you' && choice.player !== controller) return false
    return isAlive(state, choice.player)
  }
  if (choice.kind === 'stack') {
    if (spec.zone !== 'stack') return false
    const item = state.stack.find((s) => s.id === choice.id)
    if (!item) return false
    if (spec.controller === 'you' && item.controller !== controller) return false
    if (spec.controller === 'opponent' && item.controller === controller) return false
    if (spec.spellTypes === 'ability') return item.kind !== 'spell'
    if (item.kind !== 'spell') return false
    const o = item.objectId ? state.objects[item.objectId] : undefined
    if (!o) return item.isCopy === true && (spec.spellTypes === 'any' || spec.spellTypes === 'instantSorcery' || spec.spellTypes === 'noncreature')
    const tl = typeLineOf(o)
    if (spec.spellTypes === 'creature' && !/Creature/.test(tl)) return false
    if (spec.spellTypes === 'noncreature' && /Creature/.test(tl)) return false
    if (spec.spellTypes === 'instantSorcery' && !/Instant|Sorcery/.test(tl)) return false
    return true
  }
  const o = state.objects[choice.id]
  if (!o) return false
  if (spec.zone === 'graveyard') {
    if (o.zone !== 'graveyard') return false
    if (spec.controller === 'you' && o.owner !== controller) return false
    return objMatches(state, o, { ...spec, controller: undefined }, controller, sourceId)
  }
  if (spec.zone !== 'battlefield' || o.zone !== 'battlefield') return false
  if (spec.objTypes.length === 0) return false
  if (o.controller !== controller && (hasKw(state, o, 'hexproof') || hasKw(state, o, 'shroud'))) return false
  if (o.controller === controller && hasKw(state, o, 'shroud')) return false
  return objMatches(state, o, spec, controller, sourceId)
}

export function targetCandidates(state: GameState, controller: PlayerId, spec: TargetSpec, sourceId?: string): TargetChoice[] {
  const out: TargetChoice[] = []
  for (let p = 0; p < state.players.length; p++) {
    const c: TargetChoice = { kind: 'player', player: p }
    if (isLegalTarget(state, controller, spec, c, sourceId)) out.push(c)
  }
  if (spec.zone === 'battlefield') {
    for (const id of state.battlefield) {
      const c: TargetChoice = { kind: 'object', id }
      if (isLegalTarget(state, controller, spec, c, sourceId)) out.push(c)
    }
  } else if (spec.zone === 'stack') {
    for (const s of state.stack) {
      const c: TargetChoice = { kind: 'stack', id: s.id }
      if (isLegalTarget(state, controller, spec, c, sourceId)) out.push(c)
    }
  } else {
    for (let p = 0; p < state.players.length; p++) {
      for (const id of state.players[p].graveyard) {
        const c: TargetChoice = { kind: 'object', id }
        if (isLegalTarget(state, controller, spec, c, sourceId)) out.push(c)
      }
    }
  }
  return out
}

function validateTargets(state: GameState, controller: PlayerId, specs: TargetSpec[], targets: (TargetChoice | null)[], sourceId?: string): string | null {
  const used = new Set<string>()
  for (let i = 0; i < specs.length; i++) {
    const tg = targets[i] ?? null
    const spec = specs[i]
    if (!tg) {
      if (spec.optional) continue
      if (targetCandidates(state, controller, spec, sourceId).length === 0) return t('Não há alvos válidos para "{text}".', { text: spec.text })
      return t('Escolha um alvo para "{text}".', { text: spec.text })
    }
    if (!isLegalTarget(state, controller, spec, tg, sourceId)) return t('Alvo inválido para "{text}".', { text: spec.text })
    const key = tg.kind === 'player' ? `p${tg.player}` : tg.id
    // o mesmo objeto não pode ser escolhido duas vezes para a mesma palavra "alvo" repetida (up to N)
    if (used.has(key) && specs[i].text === specs[i - 1]?.text) return t('O mesmo alvo não pode ser escolhido duas vezes.')
    used.add(key)
  }
  return null
}

// ============================================================
// Checagens de momento (timing)
// ============================================================

function busy(state: GameState): string | null {
  if (state.winner !== null) return t('A partida terminou.')
  if (state.step === 'mulligan') return t('Aguardando os mulligans.')
  if (state.choices.length) return t('Há uma escolha pendente.')
  if (state.pendingAI) return t('Aguardando o Juiz IA resolver um efeito.')
  if (state.awaiting) return state.awaiting.kind === 'attackers' ? t('Declare os atacantes primeiro.') : t('Declare os bloqueadores primeiro.')
  return null
}

function sorceryTiming(state: GameState, p: PlayerId, land = false): string | null {
  if (state.activePlayer !== p) return land ? t('Só é possível no seu turno (jogar terreno).') : t('Só é possível no seu turno (velocidade de feitiço).')
  if (state.step !== 'main1' && state.step !== 'main2') return land ? t('Só é possível na fase principal (jogar terreno).') : t('Só é possível na fase principal (velocidade de feitiço).')
  if (state.stack.length) return land ? t('A pilha precisa estar vazia (jogar terreno).') : t('A pilha precisa estar vazia (velocidade de feitiço).')
  return null
}

function priorityCheck(state: GameState, p: PlayerId): string | null {
  const b = busy(state)
  if (b) return b
  if (state.priority !== p) return t('Você não tem prioridade agora.')
  return null
}

function extraLands(state: GameState, p: PlayerId): number {
  let n = 0
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (o && o.controller === p) n += o.parsed.statics.filter((s) => s.k === 'extraLand').length
  }
  return n
}

export function landFaceOf(o: GameObject): number | null {
  if (!o.card.faces || !FACE_LAYOUTS.includes(o.card.layout)) return /\bLand\b/.test(o.card.typeLine) ? 0 : null
  const i = o.card.faces.findIndex((f) => /\bLand\b/.test(f.typeLine))
  return i >= 0 ? i : null
}

export function checkPlayLand(state: GameState, p: PlayerId, id: string, face?: number): string | null {
  const o = state.objects[id]
  if (!o || o.owner !== p || (o.zone !== 'hand' && !canPlayFromExile(state, o, p))) return t('Essa carta não está na sua mão.')
  const lf = face ?? landFaceOf(o)
  if (lf === null || lf === undefined) return t('Essa carta não é um terreno.')
  const f = o.card.faces && FACE_LAYOUTS.includes(o.card.layout) ? o.card.faces[lf] : null
  if (!/\bLand\b/.test(f?.typeLine ?? o.card.typeLine)) return t('Essa face não é um terreno.')
  const pc = priorityCheck(state, p)
  if (pc) return pc
  const st = sorceryTiming(state, p, true)
  if (st) return st
  const max = 1 + extraLands(state, p)
  if (state.players[p].landsPlayed >= max) return t('Você já jogou um terreno neste turno.')
  return null
}

export interface CastInfo {
  error: string | null
  block: EffectBlock
  modes?: EffectBlock[]
  chooseCount: number
  needsX: boolean
  isPermanent: boolean
  cost: string
  tax: number
  /** O erro é falta de mana (dado estruturado: não dependa do texto do erro, que é traduzido). */
  manaShort?: boolean
  /** Custo adicional obrigatório (sacrificar / descartar). */
  extraCost?: { kind: 'sacrifice' | 'discard'; count: number; candidates: string[]; text: string }
}

/** Desloca os índices de alvo de um efeito (para juntar modos de "escolha dois"). */
function shiftEffect(e: Effect, off: number): Effect {
  const shRef = (r: ObjRef): ObjRef => (r.ref === 'target' ? { ...r, indices: r.indices.map((i) => i + off) } : r)
  const shWho = (w: Who): Who => (w.k === 'target' || w.k === 'controllerOf' ? { ...w, index: w.index + off } : w)
  const c = { ...e } as Record<string, unknown>
  for (const key of ['what', 'a', 'b']) if (c[key]) c[key] = shRef(c[key] as ObjRef)
  if (c.to) {
    const to = c.to as DamageTo
    c.to = to.ref === 'player' ? { ...to, who: shWho(to.who) } : shRef(to)
  }
  if (c.who) c.who = shWho(c.who as Who)
  if (typeof c.index === 'number') c.index = (c.index as number) + off
  return c as unknown as Effect
}

export function combineBlocks(blocks: EffectBlock[]): EffectBlock {
  const out: EffectBlock = { effects: [], targets: [], unsupported: [], text: blocks.map((b) => b.text).join(' / ') }
  for (const b of blocks) {
    const off = out.targets.length
    out.targets.push(...b.targets)
    out.effects.push(...b.effects.map((e) => shiftEffect(e, off)))
    out.unsupported.push(...b.unsupported)
  }
  return out
}

function blockForCast(o: GameObject, parsed: ParsedCard, mode?: number | number[]): EffectBlock {
  if (parsed.aura) return { effects: [], targets: [parsed.aura], unsupported: [], text: o.card.oracleText }
  if (parsed.spell) {
    if (parsed.spell.modes) {
      const idx = Array.isArray(mode) ? mode : [mode ?? 0]
      const chosen = idx.map((i) => parsed.spell!.modes![i]).filter(Boolean)
      const base = combineBlocks(chosen.length ? chosen : [parsed.spell.modes[0]])
      return combineBlocks([base, { effects: parsed.spell.effects, targets: [], unsupported: parsed.spell.unsupported, text: '' }])
    }
    return parsed.spell
  }
  return { effects: [], targets: [], unsupported: [], text: '' }
}

function canPlayFromExile(state: GameState, o: GameObject, p: PlayerId): boolean {
  return o.zone === 'exile' && o.playableBy === p && o.playableUntil !== undefined && state.turn <= o.playableUntil
}

/** Pré-verificação de uma conjuração (sem alvos) — usada pela interface e pelo bot. */
export function castInfo(state: GameState, p: PlayerId, id: string, face = 0, mode?: number | number[], x = 0): CastInfo {
  const o = state.objects[id]
  const empty: EffectBlock = { effects: [], targets: [], unsupported: [], text: '' }
  const fail = (error: string): CastInfo => ({ error, block: empty, chooseCount: 1, needsX: false, isPermanent: false, cost: '', tax: 0 })
  if (!o) return fail(t('Carta inexistente.'))
  const fromCommand = o.zone === 'command' && o.isCommander && o.owner === p
  if (!(o.zone === 'hand' && o.owner === p) && !fromCommand && !canPlayFromExile(state, o, p)) return fail(t('Essa carta não está na sua mão.'))
  const usable = o.card.faces && FACE_LAYOUTS.includes(o.card.layout) && ['modal_dfc', 'split'].includes(o.card.layout) ? face : 0
  const f = o.card.faces && FACE_LAYOUTS.includes(o.card.layout) ? o.card.faces[usable] : null
  const tl = f?.typeLine ?? o.card.typeLine
  if (/\bLand\b/.test(tl) && !/\b(Creature|Artifact|Instant|Sorcery)\b/.test(tl)) return fail(t('Terrenos são jogados, não conjurados.'))
  const parsed = usable === o.face ? o.parsed : parseFace(o.card, usable)
  const isInstant = /\bInstant\b/.test(tl) || parsed.keywords.includes('flash')
  const cost = manaCostOf(o, usable)
  const tax = (fromCommand ? commanderTax(state, o) : 0) - costReductionFor(state, p, tl)
  const block = blockForCast(o, parsed, mode)
  const info: CastInfo = {
    error: null,
    block,
    modes: parsed.spell?.modes,
    chooseCount: parsed.spell?.chooseCount ?? 1,
    needsX: /\{X\}/.test(cost),
    isPermanent: !/\b(Instant|Sorcery)\b/.test(tl),
    cost,
    tax
  }
  const ac = parsed.additionalCost
  if (ac) {
    if (ac.kind === 'sacrifice') {
      const candidates = state.battlefield.filter((bid) => {
        const b = state.objects[bid]
        return b && b.controller === p && objMatches(state, b, { ...ac.filter, controller: undefined }, p)
      })
      info.extraCost = { kind: 'sacrifice', count: 1, candidates, text: ac.text }
    } else {
      info.extraCost = { kind: 'discard', count: ac.n, candidates: state.players[p].hand.filter((h) => h !== id), text: ac.text }
    }
  }
  const pc = priorityCheck(state, p)
  if (pc) return { ...info, error: pc }
  if (!isInstant) {
    const st = sorceryTiming(state, p)
    if (st) return { ...info, error: st }
  }
  if (info.extraCost && info.extraCost.candidates.length < info.extraCost.count) return { ...info, error: t('Custo adicional impossível de pagar: {text}', { text: info.extraCost.text }) }
  if (!canAfford(state, p, cost, x, tax)) {
    const name = f?.displayName ?? o.card.displayName
    const error =
      tax > 0
        ? t('Mana insuficiente para conjurar {name} ({cost} + {{tax}} de imposto de comandante).', { name, cost, tax })
        : t('Mana insuficiente para conjurar {name} ({cost}).', { name, cost })
    return { ...info, error, manaShort: true }
  }
  for (const spec of block.targets) {
    if (!spec.optional && targetCandidates(state, p, spec, id).length === 0) return { ...info, error: t('Não há alvos válidos para "{text}".', { text: spec.text }) }
  }
  return info
}

export interface ActivateInfo {
  error: string | null
  block: EffectBlock
  needsX: boolean
}

export function activateInfo(state: GameState, p: PlayerId, id: string, index: number, x = 0): ActivateInfo {
  const o = state.objects[id]
  const empty: EffectBlock = { effects: [], targets: [], unsupported: [], text: '' }
  if (!o) return { error: t('Objeto inexistente.'), block: empty, needsX: false }
  const ab = o.parsed.activated[index]
  if (!ab) return { error: t('Habilidade inexistente.'), block: empty, needsX: false }
  const info: ActivateInfo = { error: null, block: ab, needsX: /\{X\}/.test(ab.cost.mana) }
  const pc = priorityCheck(state, p)
  if (pc) return { ...info, error: pc }
  if (ab.fromHand) {
    if (o.zone !== 'hand' || o.owner !== p) return { ...info, error: t('Essa habilidade só pode ser ativada da mão.') }
  } else {
    if (o.zone !== 'battlefield' || o.controller !== p) return { ...info, error: t('Você não controla essa permanente.') }
    if (locks(state, o).noActivate) return { ...info, error: t('As habilidades ativadas dessa permanente não podem ser ativadas.') }
  }
  if (ab.sorcerySpeed) {
    const st = sorceryTiming(state, p)
    if (st) return { ...info, error: st }
  }
  if (ab.isLoyalty) {
    if (o.loyaltyUsedTurn === state.turn) return { ...info, error: t('Apenas uma habilidade de lealdade por turno em cada planeswalker.') }
    const loy = o.counters.loyalty ?? 0
    if ((ab.cost.loyalty ?? 0) < 0 && loy + (ab.cost.loyalty ?? 0) < 0) return { ...info, error: t('Lealdade insuficiente.') }
  }
  if (ab.cost.tap) {
    if (o.tapped) return { ...info, error: t('Essa permanente já está virada.') }
    if (isCreature(o) && o.sick && !hasKw(state, o, 'haste')) return { ...info, error: t('Criatura com enjoo de invocação não pode usar habilidades com {T}.') }
  }
  if (ab.cost.payLife && state.players[p].life < ab.cost.payLife) return { ...info, error: t('Vida insuficiente.') }
  if (ab.cost.discard && state.players[p].hand.filter((h) => h !== id).length < ab.cost.discard && !ab.fromHand) return { ...info, error: t('Você precisa descartar uma carta.') }
  if (!canAfford(state, p, ab.cost.mana, x, 0)) return { ...info, error: t('Mana insuficiente ({cost}).', { cost: ab.cost.mana }) }
  for (const spec of ab.targets) {
    if (!spec.optional && targetCandidates(state, p, spec, id).filter((t) => !(t.kind === 'object' && t.id === id && ab.isEquip)).length === 0) {
      return { ...info, error: t('Não há alvos válidos para "{text}".', { text: spec.text }) }
    }
  }
  return info
}

// ============================================================
// Combate: quem pode atacar/bloquear
// ============================================================

export function canAttack(state: GameState, o: GameObject): boolean {
  return (
    o.zone === 'battlefield' &&
    isCreature(o) &&
    o.controller === state.activePlayer &&
    !o.tapped &&
    (!o.sick || hasKw(state, o, 'haste')) &&
    !hasKw(state, o, 'defender') &&
    !locks(state, o).cantAttack
  )
}

export function potentialAttackers(state: GameState, p: PlayerId): GameObject[] {
  if (state.activePlayer !== p) return []
  return state.battlefield.map((id) => state.objects[id]).filter((o) => o && canAttack(state, o))
}

export function canBlockAny(state: GameState, o: GameObject): boolean {
  return o.zone === 'battlefield' && isCreature(o) && !o.tapped && !locks(state, o).cantBlock
}

export function canBlock(state: GameState, blocker: GameObject, attacker: GameObject): string | null {
  if (!canBlockAny(state, blocker)) return t('{name} não pode bloquear.', { name: objName(state, blocker.id) })
  if (attacker.parsed.unblockable || hasKw(state, attacker, 'unblockable')) return t('{name} não pode ser bloqueada.', { name: objName(state, attacker.id) })
  if (hasKw(state, attacker, 'flying') && !hasKw(state, blocker, 'flying') && !hasKw(state, blocker, 'reach')) {
    return t('{name} tem Voar: só pode ser bloqueada por criaturas com Voar ou Alcance.', { name: objName(state, attacker.id) })
  }
  if (hasKw(state, attacker, 'shadow') && !hasKw(state, blocker, 'shadow')) return t('{name} tem Sombra.', { name: objName(state, attacker.id) })
  return null
}

/** Jogador defensor para um alvo de ataque: o jogador atacado ou o controlador do planeswalker atacado. */
export function attackTargetDefender(state: GameState, target: AttackTarget): PlayerId | null {
  if (target.kind === 'player') return state.players[target.player] ? target.player : null
  const pw = state.objects[target.id]
  return pw && pw.zone === 'battlefield' ? pw.controller : null
}

/** Alvos de ataque legais para `p`: cada oponente vivo e cada planeswalker que um oponente controla. */
export function attackTargets(state: GameState, p: PlayerId): AttackTarget[] {
  const out: AttackTarget[] = []
  for (const q of opponents(state, p)) {
    out.push({ kind: 'player', player: q })
    for (const id of state.battlefield) {
      const o = state.objects[id]
      if (o && o.controller === q && hasType(o, 'Planeswalker')) out.push({ kind: 'planeswalker', id })
    }
  }
  return out
}

/** Jogador defensor de uma criatura atacante no combate atual (null se ela não está atacando). */
export function defendingPlayerOf(state: GameState, attackerId: string): PlayerId | null {
  const a = state.combat?.attackers.find((x) => x.id === attackerId)
  if (!a) return null
  return a.defender ?? attackTargetDefender(state, a.target)
}

/** Atacantes (ids) que estão atacando `defender` ou um planeswalker dele. */
export function attackersAgainst(state: GameState, defender: PlayerId): string[] {
  const c = state.combat
  if (!c) return []
  return c.attackers.filter((a) => (a.defender ?? attackTargetDefender(state, a.target)) === defender).map((a) => a.id)
}

function hasAnyBlock(state: GameState, defender: PlayerId): boolean {
  const c = state.combat
  if (!c) return false
  const attackers = attackersAgainst(state, defender)
  const blockers = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === defender && canBlockAny(state, o))
  return blockers.some((b) => attackers.some((a) => state.objects[a] && !canBlock(state, b, state.objects[a])))
}

// ============================================================
// Gatilhos
// ============================================================

function fireEvent(state: GameState, event: TriggerEvent, filterObj: (o: GameObject) => boolean): void {
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || !filterObj(o)) continue
    for (const tr of o.parsed.triggers) {
      if (tr.event === event) state.pendingTriggers.push({ controller: o.controller, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
    }
  }
}

function fireCastTriggers(state: GameState, caster: PlayerId, spell: GameObject): void {
  const tl = typeLineOf(spell)
  const isCreatureSpell = /Creature/.test(tl)
  const isIS = /Instant|Sorcery/.test(tl)
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || o.controller !== caster) continue
    if (!isCreatureSpell && hasKw(state, o, 'prowess')) {
      state.pendingTriggers.push({
        controller: caster,
        sourceId: o.id,
        sourceName: objName(state, o.id),
        printingId: o.card.printingId,
        ability: { event: 'castSpell', effects: [{ k: 'pump', what: { ref: 'self' }, power: 1, toughness: 1, keywords: [] }], targets: [], unsupported: [], text: t('Destreza (+1/+1 até o fim do turno)') }
      })
    }
    for (const tr of o.parsed.triggers) {
      if (tr.event !== 'castSpell') continue
      const f = tr.spellFilter ?? 'any'
      if (f === 'noncreature' && isCreatureSpell) continue
      if (f === 'creature' && !isCreatureSpell) continue
      if (f === 'instantSorcery' && !isIS) continue
      state.pendingTriggers.push({ controller: caster, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
    }
  }
}

function pushTriggerToStack(state: GameState, trig: PendingTrigger, targets: (TargetChoice | null)[]): void {
  state.stack.push({
    id: `s${state.nextId++}`,
    kind: 'trigger',
    sourceId: trig.sourceId,
    sourceName: trig.sourceName,
    controller: trig.controller,
    block: trig.ability,
    targets,
    x: 0,
    isPermanentSpell: false,
    printingId: trig.printingId
  })
  log(state, 'action', t('Habilidade disparada de {name} vai para a pilha.', { name: trig.sourceName }), trig.controller)
}

/** Coloca os gatilhos pendentes na pilha (jogador ativo primeiro). Pode criar escolhas de alvo. */
function flushTriggers(state: GameState): void {
  const order = apnapOrder(state)
  state.pendingTriggers = state.pendingTriggers.filter((tr) => isAlive(state, tr.controller))
  state.pendingTriggers.sort((a, b) => order.indexOf(a.controller) - order.indexOf(b.controller))
  while (state.pendingTriggers.length) {
    const trig = state.pendingTriggers.shift()!
    if (trig.ability.modes?.length) {
      const anyMode = trig.ability.modes.some((m) => m.targets.every((s) => s.optional || targetCandidates(state, trig.controller, s, trig.sourceId).length > 0))
      if (!anyMode) {
        log(state, 'judge', t('Nenhum modo da habilidade de {name} tem alvos válidos; ela é removida.', { name: trig.sourceName }))
        continue
      }
      state.choices.push({ kind: 'mode', player: trig.controller, trigger: trig })
      return
    }
    const specs = trig.ability.targets
    if (specs.length === 0) {
      pushTriggerToStack(state, trig, [])
      continue
    }
    const anyLegal = specs.every((s) => s.optional || targetCandidates(state, trig.controller, s, trig.sourceId).length > 0)
    if (!anyLegal) {
      log(state, 'judge', t('A habilidade de {name} não tem alvos válidos e é removida.', { name: trig.sourceName }))
      continue
    }
    state.choices.push({ kind: 'targets', player: trig.controller, trigger: trig })
    return
  }
}

// ============================================================
// Resolução
// ============================================================

function amt(state: GameState, item: StackItem, a: Amount): number {
  if (a === 'X') return item.x
  if (typeof a === 'object') return countFor(state, item.controller, a.per, item.sourceId) * a.mult
  return a
}

function touch(item: StackItem, id: string): void {
  item.touched = [...(item.touched ?? []), id]
}

/** "creature", "instant or sorcery", "permanent", "noncreature"... contra a linha de tipo. */
function cardTypeMatch(typeLine: string, types: string[]): boolean {
  return types.some((t) => {
    if (t === 'card' || t === '') return true
    if (t === 'permanent') return !/\b(Instant|Sorcery)\b/.test(typeLine)
    if (t === 'nonland') return !/\bLand\b/.test(typeLine)
    if (t === 'noncreature') return !/\bCreature\b/.test(typeLine)
    if (t === 'historic') return /\b(Legendary|Artifact|Saga)\b/.test(typeLine)
    return new RegExp(`\\b${t}\\b`, 'i').test(typeLine)
  })
}

function targetLegalNow(state: GameState, item: StackItem, index: number): TargetChoice | null {
  const t = item.targets[index]
  const spec = item.block.targets[index]
  if (!t || !spec) return null
  return isLegalTarget(state, item.controller, spec, t, item.sourceId ?? item.objectId) ? t : null
}

/**
 * "Defending player" / "that player" (sem antecedente) para um item da pilha: o jogador que a criatura-fonte
 * está atacando (ou atacou neste combate). Fora de combate, ou se a fonte não ataca, usa o próximo oponente
 * vivo do controlador na ordem de turno (simplificação: o texto não deixa o controlador escolher).
 */
function defendingFor(state: GameState, item: StackItem): PlayerId | null {
  const src = item.sourceId ?? item.objectId
  if (src) {
    const d = defendingPlayerOf(state, src)
    if (d !== null && isAlive(state, d)) return d
  }
  return opponents(state, item.controller)[0] ?? null
}

function resolveWho(state: GameState, item: StackItem, who: Who): PlayerId[] {
  switch (who.k) {
    case 'you':
      return [item.controller]
    case 'opponent':
      return opponents(state, item.controller)
    case 'each':
      return apnapOrder(state)
    case 'defending': {
      const d = defendingFor(state, item)
      return d === null ? [] : [d]
    }
    case 'target': {
      const t = targetLegalNow(state, item, who.index)
      return t && t.kind === 'player' ? [t.player] : []
    }
    case 'controllerOf': {
      const t = item.targets[who.index]
      if (t && t.kind === 'object' && state.objects[t.id]) return [state.objects[t.id].controller]
      if (t && t.kind === 'player') return [t.player]
      return []
    }
  }
}

function resolveObjs(state: GameState, item: StackItem, ref: ObjRef): string[] {
  const src = item.sourceId ?? item.objectId
  switch (ref.ref) {
    case 'target': {
      const out: string[] = []
      for (const i of ref.indices) {
        const t = targetLegalNow(state, item, i)
        if (t && t.kind === 'object') out.push(t.id)
        else {
          // alvo que esta mesma resolução trouxe ao campo (ex.: "devolva ... ao campo. Ela ganha ímpeto.")
          const raw = item.targets[i]
          if (raw && raw.kind === 'object' && item.touched?.includes(raw.id) && state.objects[raw.id]?.zone === 'battlefield') out.push(raw.id)
        }
      }
      return out
    }
    case 'created':
      return (item.touched ?? []).filter((id) => state.objects[id]?.zone === 'battlefield')
    case 'self':
      return src && state.objects[src]?.zone === 'battlefield' ? [src] : []
    case 'all':
      return state.battlefield.filter((id) => {
        const o = state.objects[id]
        return o && objMatches(state, o, ref.filter, item.controller, src)
      })
    case 'enchanted':
    case 'equipped': {
      const s = src ? state.objects[src] : undefined
      return s?.attachedTo && state.objects[s.attachedTo] ? [s.attachedTo] : []
    }
  }
}

function damageObject(state: GameState, target: GameObject, n: number, source?: GameObject): void {
  if (n <= 0) return
  if (hasType(target, 'Planeswalker') && !isCreature(target)) {
    target.counters.loyalty = (target.counters.loyalty ?? 0) - n
  } else {
    target.damage += n
    if (source && hasKw(state, source, 'deathtouch')) target.deathtouched = true
  }
  if (source && hasKw(state, source, 'lifelink')) gainLife(state, source.controller, n)
}

function damagePlayer(state: GameState, p: PlayerId, n: number, source?: GameObject, combat = false): void {
  if (n <= 0) return
  state.players[p].life -= n
  if (source && hasKw(state, source, 'lifelink')) gainLife(state, source.controller, n)
  if (combat && source?.isCommander) {
    state.players[p].commanderDamage[source.id] = (state.players[p].commanderDamage[source.id] ?? 0) + n
  }
}

/** Ganho de vida (dispara "whenever you gain life"). */
function gainLife(state: GameState, p: PlayerId, n: number): void {
  if (n <= 0) return
  state.players[p].life += n
  fireEvent(state, 'lifeGain', (o) => o.controller === p)
}

/** Usa um escudo de regeneração, se houver. Retorna true se a permanente foi regenerada. */
function tryRegenerate(state: GameState, o: GameObject): boolean {
  if (!o.regen || o.regen <= 0) return false
  o.regen--
  o.tapped = true
  o.damage = 0
  o.deathtouched = false
  if (state.combat) {
    state.combat.attackers = state.combat.attackers.filter((a) => a.id !== o.id)
    state.combat.blockers = state.combat.blockers.filter((b) => b.blocker !== o.id)
  }
  log(state, 'judge', t('{name} regenera.', { name: objName(state, o.id) }), o.controller)
  return true
}

function destroy(state: GameState, id: string): void {
  const o = state.objects[id]
  if (!o || o.zone !== 'battlefield') return
  if (hasKw(state, o, 'indestructible')) {
    log(state, 'judge', t('{name} é indestrutível.', { name: objName(state, id) }))
    return
  }
  if (tryRegenerate(state, o)) return
  moveObject(state, id, 'graveyard')
}

function chooseManaColor(state: GameState, p: PlayerId): keyof ManaPool {
  const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const id of state.players[p].hand) {
    for (const s of state.objects[id].card.manaCost.match(/\{[WUBRG]\}/g) ?? []) counts[s[1]]++
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return (best && best[1] > 0 ? best[0] : 'C') as keyof ManaPool
}

/** Aplica um efeito. Retorna true se criou uma escolha pendente (a resolução pausa). */
function applyEffect(state: GameState, item: StackItem, eff: Effect): boolean {
  const ctrl = item.controller
  const src = item.sourceId ?? item.objectId
  const srcObj = src ? state.objects[src] : undefined
  switch (eff.k) {
    case 'damage': {
      const n = amt(state, item, eff.amount)
      const to: DamageTo = eff.to
      if (to.ref === 'player') {
        for (const p of resolveWho(state, item, to.who)) {
          damagePlayer(state, p, n, srcObj)
          log(state, 'action', t('{source} causa {n} de dano a {target}.', { source: item.sourceName, n, target: pname(state, p) }), ctrl)
        }
      } else if (to.ref === 'target') {
        for (const i of to.indices) {
          const tgt = targetLegalNow(state, item, i)
          if (!tgt) continue
          if (tgt.kind === 'player') {
            damagePlayer(state, tgt.player, n, srcObj)
            log(state, 'action', t('{source} causa {n} de dano a {target}.', { source: item.sourceName, n, target: pname(state, tgt.player) }), ctrl)
          } else if (tgt.kind === 'object') {
            damageObject(state, state.objects[tgt.id], n, srcObj)
            log(state, 'action', t('{source} causa {n} de dano a {target}.', { source: item.sourceName, n, target: objName(state, tgt.id) }), ctrl)
          }
        }
      } else {
        for (const id of resolveObjs(state, item, to)) {
          damageObject(state, state.objects[id], n, srcObj)
          log(state, 'action', t('{source} causa {n} de dano a {target}.', { source: item.sourceName, n, target: objName(state, id) }), ctrl)
        }
      }
      return false
    }
    case 'draw':
      for (const p of resolveWho(state, item, eff.who)) drawCards(state, p, amt(state, item, eff.amount))
      return false
    case 'discard': {
      let created = false
      for (const p of resolveWho(state, item, eff.who)) {
        const hand = state.players[p].hand
        const n = Math.min(amt(state, item, eff.amount), hand.length)
        if (n <= 0) continue
        if (eff.random) {
          for (let i = 0; i < n; i++) {
            const id = hand[Math.floor(rand(state) * hand.length)]
            moveObject(state, id, 'graveyard')
            log(state, 'action', t('{player} descarta {name} aleatoriamente.', { player: pname(state, p), name: objName(state, id) }), p)
          }
        } else {
          state.choices.push({ kind: 'discard', player: p, count: n, reason: item.sourceName })
          created = true
        }
      }
      return created
    }
    case 'gainLife':
      for (const p of resolveWho(state, item, eff.who)) {
        gainLife(state, p, amt(state, item, eff.amount))
        log(state, 'action', t('{player} ganha {n} de vida.', { player: pname(state, p), n: amt(state, item, eff.amount) }), p)
      }
      return false
    case 'loseLife':
      for (const p of resolveWho(state, item, eff.who)) {
        state.players[p].life -= amt(state, item, eff.amount)
        log(state, 'action', t('{player} perde {n} de vida.', { player: pname(state, p), n: amt(state, item, eff.amount) }), p)
      }
      return false
    case 'mill':
      for (const p of resolveWho(state, item, eff.who)) {
        const n = amt(state, item, eff.amount)
        for (let i = 0; i < n; i++) {
          const id = state.players[p].library[0]
          if (!id) break
          moveObject(state, id, 'graveyard')
        }
        log(state, 'action', n === 1 ? t('{player} coloca a carta do topo do grimório no cemitério.', { player: pname(state, p) }) : t('{player} coloca as {n} cartas do topo do grimório no cemitério.', { player: pname(state, p), n }), p)
      }
      return false
    case 'destroy':
      for (const id of resolveObjs(state, item, eff.what)) destroy(state, id)
      return false
    case 'exile':
      for (const id of resolveObjs(state, item, eff.what)) {
        log(state, 'action', t('{name} é exilada.', { name: objName(state, id) }), ctrl)
        moveObject(state, id, 'exile')
      }
      return false
    case 'bounce':
      for (const id of resolveObjs(state, item, eff.what)) {
        log(state, 'action', t('{name} volta para a mão do dono.', { name: objName(state, id) }), ctrl)
        moveObject(state, id, 'hand')
      }
      return false
    case 'tap':
    case 'untap':
      for (const id of resolveObjs(state, item, eff.what)) state.objects[id].tapped = eff.k === 'tap'
      return false
    case 'pump': {
      const pw = eff.power === 'X' ? (eff.negative ? -item.x : item.x) : amt(state, item, eff.power)
      const tg = eff.toughness === 'X' ? (eff.negative ? -item.x : item.x) : amt(state, item, eff.toughness)
      for (const id of resolveObjs(state, item, eff.what)) {
        state.objects[id].mods.push({ power: pw, toughness: tg, keywords: eff.keywords })
        if (pw || tg) log(state, 'action', t('{name} recebe {p}/{t} até o fim do turno.', { name: objName(state, id), p: `${pw >= 0 ? '+' : ''}${pw}`, t: `${tg >= 0 ? '+' : ''}${tg}` }), ctrl)
        if (eff.keywords.length) log(state, 'action', t('{name} ganha {keywords} até o fim do turno.', { name: objName(state, id), keywords: eff.keywords.join(', ') }), ctrl)
      }
      return false
    }
    case 'counters':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        o.counters[eff.counter] = (o.counters[eff.counter] ?? 0) + amt(state, item, eff.n)
        log(state, 'action', t('{name} recebe {n} marcador(es) {counter}.', { name: objName(state, id), n: amt(state, item, eff.n), counter: eff.counter }), ctrl)
      }
      return false
    case 'token': {
      const n = amt(state, item, eff.n)
      for (const p of resolveWho(state, item, eff.who)) {
        for (let i = 0; i < n; i++) touch(item, createToken(state, p, eff.token).id)
        log(state, 'action', t('{player} cria {n} ficha(s) {token}.', { player: pname(state, p), n, token: `${eff.token.name}${eff.token.power !== undefined ? ` ${eff.token.power}/${eff.token.toughness}` : ''}` }), p)
      }
      return false
    }
    case 'counterSpell': {
      const tgt = targetLegalNow(state, item, eff.index)
      if (!tgt || tgt.kind !== 'stack') return false
      const target = state.stack.find((s) => s.id === tgt.id)
      if (!target) return false
      if (eff.unlessPay) {
        const payer = target.controller
        if (canAfford(state, payer, `{${eff.unlessPay}}`, 0, 0)) {
          payMana(state, payer, `{${eff.unlessPay}}`, 0, 0)
          log(state, 'judge', t('{player} paga {{n}} e {name} não é anulada.', { player: pname(state, payer), n: eff.unlessPay, name: target.sourceName }), payer)
          return false
        }
      }
      counterStackItem(state, target)
      return false
    }
    case 'scry': {
      const n = Math.min(amt(state, item, eff.n), state.players[ctrl].library.length)
      if (n <= 0) return false
      state.choices.push({ kind: 'scry', player: ctrl, cards: state.players[ctrl].library.slice(0, n), surveil: Boolean(eff.surveil) })
      return true
    }
    case 'search': {
      const lib = state.players[ctrl].library
      const candidates = lib.filter((id) => {
        const o = state.objects[id]
        const tl = o.card.typeLine
        if (eff.cardTypes) return eff.cardTypes.length === 0 || cardTypeMatch(tl, eff.cardTypes)
        if (!/\bLand\b/.test(tl)) return false
        if (eff.basic && !/\bBasic\b/.test(tl)) return false
        if (eff.landTypes && !eff.landTypes.some((t) => new RegExp(`\\b${t}\\b`).test(tl))) return false
        return true
      })
      if (candidates.length === 0) {
        shuffleArray(state, lib)
        log(state, 'action', t('{player} procura no grimório mas não encontra cartas válidas e o embaralha.', { player: pname(state, ctrl) }), ctrl)
        return false
      }
      state.choices.push({ kind: 'search', player: ctrl, candidates, count: Math.min(eff.n, candidates.length), dest: eff.dest, tapped: eff.tapped })
      return true
    }
    case 'addMana': {
      const pool = state.players[ctrl].pool
      for (const c of eff.mana) pool[c as keyof ManaPool]++
      for (let i = 0; i < (eff.anyColor ?? 0); i++) pool[chooseManaColor(state, ctrl)]++
      if (eff.oneOf?.length) {
        const best = chooseManaColor(state, ctrl)
        pool[(eff.oneOf.includes(best) ? best : eff.oneOf[0]) as keyof ManaPool]++
      }
      return false
    }
    case 'graveyardReturn': {
      const tgt = targetLegalNow(state, item, eff.index)
      if (!tgt || tgt.kind !== 'object') return false
      log(state, 'action', eff.dest === 'hand' ? t('{name} volta do cemitério para a mão.', { name: objName(state, tgt.id) }) : t('{name} volta do cemitério para o campo de batalha.', { name: objName(state, tgt.id) }), ctrl)
      moveObject(state, tgt.id, eff.dest === 'hand' ? 'hand' : 'battlefield', { controller: ctrl })
      if (eff.dest === 'battlefield') touch(item, tgt.id)
      return false
    }
    case 'proliferate': {
      let n = 0
      for (const id of state.battlefield) {
        const o = state.objects[id]
        if (!o) continue
        for (const k of Object.keys(o.counters)) {
          if (!o.counters[k]) continue
          const good = k !== '-1/-1'
          if ((o.controller === ctrl) === good) {
            o.counters[k]++
            n++
          }
        }
      }
      for (const q of opponents(state, ctrl)) {
        const foe = state.players[q]
        if (foe.poison > 0) {
          foe.poison++
          n++
        }
      }
      log(state, 'action', t('{player} prolifera ({n} marcador(es) adicionados).', { player: pname(state, ctrl), n }), ctrl)
      return false
    }
    case 'returnOwn': {
      const candidates = state.battlefield.filter((id) => {
        const o = state.objects[id]
        return o && o.controller === ctrl && objMatches(state, o, { ...eff.filter, controller: undefined }, ctrl)
      })
      if (!candidates.length) return false
      state.choices.push({ kind: 'returnOwn', player: ctrl, candidates, count: 1 })
      return true
    }
    case 'fog':
      state.fogTurn = state.turn
      log(state, 'action', t('Todo o dano de combate deste turno será prevenido.'), ctrl)
      return false
    case 'extraTurn':
      state.extraTurns ??= state.players.map(() => 0)
      state.extraTurns[ctrl]++
      log(state, 'action', t('{player} jogará um turno extra depois deste.', { player: pname(state, ctrl) }), ctrl)
      return false
    case 'regenerate':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        o.regen = (o.regen ?? 0) + 1
        log(state, 'action', t('{name} recebe um escudo de regeneração.', { name: objName(state, id) }), ctrl)
      }
      return false
    case 'flicker':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        const owner = o.owner
        log(state, 'action', t('{name} é exilada e volta ao campo de batalha.', { name: objName(state, id) }), ctrl)
        moveObject(state, id, 'exile')
        if (state.objects[id]) {
          moveObject(state, id, 'battlefield', { controller: eff.yourControl ? ctrl : owner })
          touch(item, id)
        }
      }
      return false
    case 'transform':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        if (o.card.layout !== 'transform' || !o.card.faces || o.card.faces.length < 2) continue
        o.face = o.face === 0 ? 1 : 0
        o.parsed = parseFace(o.card, o.face)
        log(state, 'action', t('{name} se transforma em {other}.', { name: o.card.faces[o.face === 0 ? 1 : 0].displayName, other: objName(state, id) }), ctrl)
      }
      return false
    case 'monarch':
      state.monarch = ctrl
      log(state, 'action', t('{player} se torna o monarca.', { player: pname(state, ctrl) }), ctrl)
      return false
    case 'copyStack': {
      const tgt = targetLegalNow(state, item, eff.index)
      if (!tgt || tgt.kind !== 'stack') return false
      const orig = state.stack.find((s) => s.id === tgt.id)
      if (!orig || orig.isPermanentSpell) return false
      state.stack.push({ ...clone(orig), id: `s${state.nextId++}`, objectId: undefined, isCopy: true, controller: ctrl, sourceName: t('{name} (cópia)', { name: orig.sourceName }) })
      log(state, 'action', t('{player} copia {name}.', { player: pname(state, ctrl), name: orig.sourceName }), ctrl)
      return false
    }
    case 'copyToken':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        const copy = newObject(state, { ...clone(o.card), token: true }, ctrl, 'battlefield', { isToken: true, face: o.face })
        copy.parsed = parseFace(copy.card, copy.face)
        state.battlefield.push(copy.id)
        enterBattlefield(state, copy, { controller: ctrl })
        touch(item, copy.id)
        log(state, 'action', t('{player} cria uma ficha que é cópia de {name}.', { player: pname(state, ctrl), name: objName(state, id) }), ctrl)
      }
      return false
    case 'grant':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        o.grants = [...new Set([...(o.grants ?? []), ...eff.keywords])]
        log(state, 'action', t('{name} ganha {keywords}.', { name: objName(state, id), keywords: eff.keywords.join(', ') }), ctrl)
      }
      return false
    case 'delayed': {
      const ids = resolveObjs(state, item, eff.what)
      if (ids.length) {
        state.delayed ??= []
        state.delayed.push({ controller: ctrl, ids, action: eff.action, afterTurn: state.turn, afterStep: state.step })
      }
      return false
    }
    case 'impulse': {
      const n = amt(state, item, eff.n)
      const until = eff.until === 'thisTurn' ? state.turn : state.turn + turnsUntilNextTurnOf(state, ctrl)
      const names: string[] = []
      for (let i = 0; i < n; i++) {
        const id = state.players[ctrl].library[0]
        if (!id) break
        moveObject(state, id, 'exile')
        const o = state.objects[id]
        o.playableBy = ctrl
        o.playableUntil = until
        names.push(objName(state, id))
      }
      log(state, 'action', eff.until === 'thisTurn'
          ? t('{player} exila {cards} do topo do grimório e pode jogá-las neste turno.', { player: pname(state, ctrl), cards: names.join(', ') || t('nada') })
          : t('{player} exila {cards} do topo do grimório e pode jogá-las até o fim do próximo turno.', { player: pname(state, ctrl), cards: names.join(', ') || t('nada') }), ctrl)
      return false
    }
    case 'dig': {
      const lib = state.players[ctrl].library
      const cards = lib.slice(0, amt(state, item, eff.n))
      if (!cards.length) return false
      const eligible = cards.filter((id) => !eff.cardTypes || cardTypeMatch(state.objects[id].card.typeLine, eff.cardTypes))
      state.choices.push({ kind: 'dig', player: ctrl, cards, eligible, take: eff.take, dest: eff.dest, rest: eff.rest })
      return true
    }
    case 'putLandFromHand': {
      const candidates = state.players[ctrl].hand.filter((id) => /\bLand\b/.test(state.objects[id].card.typeLine))
      if (!candidates.length) return false
      state.choices.push({ kind: 'handLand', player: ctrl, candidates })
      return true
    }
    case 'sacrifice': {
      let created = false
      for (const p of resolveWho(state, item, eff.who)) {
        const candidates = state.battlefield.filter((id) => {
          const o = state.objects[id]
          return o && o.controller === p && objMatches(state, o, { ...eff.filter, controller: undefined }, p)
        })
        if (candidates.length === 0) continue
        state.choices.push({ kind: 'sacrifice', player: p, candidates, count: 1 })
        created = true
      }
      return created
    }
    case 'sacrificeSelf':
      if (src && state.objects[src]?.zone === 'battlefield') moveObject(state, src, 'graveyard')
      return false
    case 'discardChosen': {
      let created = false
      for (const p of resolveWho(state, item, eff.who)) {
        const hand = state.players[p].hand
        log(state, 'action', t('{player} revela a mão: {cards}.', { player: pname(state, p), cards: hand.map((id) => objName(state, id)).join(', ') || t('(vazia)') }), p)
        const candidates = hand.filter((id) => {
          const tl = typeLineOf(state.objects[id])
          switch (eff.filter) {
            case 'nonland':
              return !/\bLand\b/.test(tl)
            case 'noncreatureNonland':
              return !/\bLand\b/.test(tl) && !/\bCreature\b/.test(tl)
            case 'creature':
              return /\bCreature\b/.test(tl)
            case 'instantSorcery':
              return /\b(Instant|Sorcery)\b/.test(tl)
            default:
              return true
          }
        })
        if (!candidates.length) continue
        state.choices.push({ kind: 'pickDiscard', player: ctrl, target: p, candidates, revealed: [...hand] })
        created = true
      }
      return created
    }
    case 'gainControl':
      for (const id of resolveObjs(state, item, eff.what)) {
        const o = state.objects[id]
        if (o.controller === ctrl) continue
        if (eff.untilEOT && o.eotController === undefined) o.eotController = o.controller
        o.controller = ctrl
        o.sick = true
        log(state, 'action', eff.untilEOT ? t('{player} ganha o controle de {name} até o fim do turno.', { player: pname(state, ctrl), name: objName(state, id) }) : t('{player} ganha o controle de {name}.', { player: pname(state, ctrl), name: objName(state, id) }), ctrl)
      }
      return false
    case 'fight': {
      const a = resolveObjs(state, item, eff.a)[0]
      const b = resolveObjs(state, item, eff.b)[0]
      if (!a || !b) return false
      const A = state.objects[a]
      const B = state.objects[b]
      damageObject(state, B, power(state, A), A)
      if (!eff.oneSided) damageObject(state, A, power(state, B), B)
      log(state, 'action', eff.oneSided ? t('{a} causa dano igual ao seu poder a {b}.', { a: objName(state, a), b: objName(state, b) }) : t('{a} luta com {b}.', { a: objName(state, a), b: objName(state, b) }), ctrl)
      return false
    }
  }
}

function counterStackItem(state: GameState, target: StackItem): void {
  const i = state.stack.indexOf(target)
  if (i >= 0) state.stack.splice(i, 1)
  log(state, 'action', t('{name} é anulada.', { name: target.sourceName }), target.controller)
  if (target.kind === 'spell' && target.objectId && state.objects[target.objectId]) {
    const o = state.objects[target.objectId]
    o.zone = 'stack'
    moveObject(state, target.objectId, 'graveyard')
  }
}

function resolveTop(state: GameState): void {
  const item = state.stack.pop()
  if (!item) return
  // Checagem de alvos: se todos os alvos ficaram ilegais, a mágica/habilidade não resolve
  const specs = item.block.targets
  if (specs.length > 0 && item.targets.some(Boolean)) {
    const anyLegal = specs.some((_, i) => targetLegalNow(state, item, i) !== null)
    if (!anyLegal) {
      log(state, 'judge', t('{name} não resolve: todos os alvos se tornaram ilegais.', { name: item.sourceName }), item.controller)
      if (item.kind === 'spell' && item.objectId) moveObject(state, item.objectId, 'graveyard')
      return
    }
  }
  log(state, 'action', t('{name} resolve.', { name: item.sourceName }), item.controller)
  if (item.kind === 'spell' && item.isPermanentSpell && item.objectId) {
    const o = state.objects[item.objectId]
    if (!o) return
    const attachTo = o.parsed.aura ? (item.targets[0]?.kind === 'object' ? item.targets[0].id : undefined) : undefined
    if (o.parsed.aura && !attachTo) {
      moveObject(state, o.id, 'graveyard')
      return
    }
    moveObject(state, o.id, 'battlefield', { controller: item.controller, attachTo, face: o.face, x: item.x })
    return
  }
  if (item.equip) {
    const tgt = targetLegalNow(state, item, 0)
    const s = item.sourceId ? state.objects[item.sourceId] : undefined
    if (tgt && tgt.kind === 'object' && s && s.zone === 'battlefield') {
      s.attachedTo = tgt.id
      log(state, 'action', t('{name} é equipado em {target}.', { name: objName(state, s.id), target: objName(state, tgt.id) }), item.controller)
    }
    return
  }
  state.resolving = { item, next: 0 }
  continueResolution(state)
}

function continueResolution(state: GameState): void {
  const r = state.resolving
  if (!r) return
  while (r.next < r.item.block.effects.length) {
    const eff = r.item.block.effects[r.next++]
    const paused = applyEffect(state, r.item, eff)
    if (paused) return
  }
  if (r.item.block.unsupported.length && !r.aiDone) {
    r.aiDone = true
    const text = r.item.block.unsupported.join(' ')
    if (state.aiEnabled) {
      state.pendingAI = { item: r.item, text }
      log(state, 'ai', t('Juiz IA consultado para resolver: "{text}"', { text }), r.item.controller)
      return
    }
    log(state, 'judge', t('Parte do efeito de {name} não é automatizada: "{text}". Ative o Juiz IA (Configurações) ou use ajustes manuais.', { name: r.item.sourceName, text }), r.item.controller)
  }
  finishResolution(state, r.item)
  state.resolving = null
}

function finishResolution(state: GameState, item: StackItem): void {
  if (item.kind === 'spell' && item.objectId) {
    const o = state.objects[item.objectId]
    if (o && o.zone === 'stack') moveObject(state, item.objectId, 'graveyard')
  }
}

// ============================================================
// Ações baseadas em estado (SBA)
// ============================================================

function checkSBA(state: GameState): void {
  for (let guard = 0; guard < 20; guard++) {
    let changed = false
    // jogadores
    for (const pl of state.players) {
      if (pl.lost) continue
      let reason = ''
      if (pl.life <= 0) reason = '{name} perde a partida: ficou com 0 ou menos de vida.'
      else if (pl.drewFromEmpty) reason = '{name} perde a partida: precisou comprar de um grimório vazio.'
      else if (pl.poison >= 10) reason = '{name} perde a partida: recebeu 10 marcadores de veneno.'
      else if (state.commanderGame && Object.values(pl.commanderDamage).some((d) => d >= 21)) reason = '{name} perde a partida: recebeu 21 de dano de um mesmo comandante.'
      if (reason) {
        pl.lost = true
        log(state, 'judge', t(reason, { name: pl.name }), pl.id)
      }
    }
    // derrotas ainda não processadas (SBA acima ou concessão): todas são simultâneas
    const newlyLost = state.players.filter((p) => p.lost && p.eliminatedTurn === undefined)
    if (newlyLost.length) {
      for (const pl of newlyLost) pl.eliminatedTurn = state.turn
      const alive = livingPlayers(state)
      if (alive.length <= 1) {
        // fim de jogo: o último jogador vivo vence (ou empate se todos os restantes perderam juntos).
        // Os objetos dos perdedores ficam onde estão (a mesa final continua visível).
        state.winner = alive.length === 1 ? alive[0] : 'draw'
        log(state, 'turn', state.winner === 'draw' ? t('A partida terminou empatada.') : t('{name} venceu a partida!', { name: pname(state, state.winner) }))
        return
      }
      for (const pl of newlyLost) eliminatePlayer(state, pl.id)
      changed = true
    }
    for (const id of [...state.battlefield]) {
      const o = state.objects[id]
      if (!o) continue
      // marcadores +1/+1 e -1/-1 se anulam
      const pc = o.counters['+1/+1'] ?? 0
      const mc = o.counters['-1/-1'] ?? 0
      if (pc && mc) {
        const k = Math.min(pc, mc)
        o.counters['+1/+1'] = pc - k
        o.counters['-1/-1'] = mc - k
      }
      if (isCreature(o)) {
        const tough = toughness(state, o)
        if (tough <= 0) {
          log(state, 'judge', t('{name} tem resistência {n} e vai para o cemitério.', { name: objName(state, id), n: tough }))
          moveObject(state, id, 'graveyard')
          changed = true
          continue
        }
        if ((o.damage >= tough || (o.deathtouched && o.damage > 0)) && !hasKw(state, o, 'indestructible')) {
          if (!tryRegenerate(state, o)) moveObject(state, id, 'graveyard')
          changed = true
          continue
        }
      }
      if (hasType(o, 'Planeswalker') && !isCreature(o) && (o.counters.loyalty ?? 0) <= 0) {
        log(state, 'judge', t('{name} ficou sem lealdade e vai para o cemitério.', { name: objName(state, id) }))
        moveObject(state, id, 'graveyard')
        changed = true
        continue
      }
      if (o.parsed.aura) {
        const host = o.attachedTo ? state.objects[o.attachedTo] : undefined
        if (!host || host.zone !== 'battlefield' || !objMatches(state, host, { ...o.parsed.aura, controller: o.parsed.aura.controller }, o.controller)) {
          log(state, 'judge', t('{name} não está encantando um objeto válido e vai para o cemitério.', { name: objName(state, id) }))
          moveObject(state, id, 'graveyard')
          changed = true
          continue
        }
      }
      if (hasType(o, 'Equipment') && o.attachedTo) {
        const t = state.objects[o.attachedTo]
        if (!t || t.zone !== 'battlefield' || !isCreature(t)) {
          o.attachedTo = undefined
          changed = true
        }
      }
    }
    // regra das lendas
    const legends = new Map<string, GameObject[]>()
    for (const id of state.battlefield) {
      const o = state.objects[id]
      if (!o || !hasType(o, 'Legendary')) continue
      const key = `${o.controller}:${o.card.name}`
      legends.set(key, [...(legends.get(key) ?? []), o])
    }
    for (const group of legends.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => b.timestamp - a.timestamp)
      for (const o of group.slice(1)) {
        log(state, 'judge', t('Regra das lendas: {name} vai para o cemitério.', { name: objName(state, o.id) }))
        moveObject(state, o.id, 'graveyard')
        changed = true
      }
    }
    if (!changed) return
  }
}

/**
 * Remove da partida um jogador que perdeu (a partida continua com os demais):
 * todos os objetos que ele possui saem do jogo, o controle de objetos alheios que ele controlava volta aos donos,
 * e escolhas, gatilhos, itens da pilha, ataques e declarações dele são descartados.
 */
function eliminatePlayer(state: GameState, p: PlayerId): void {
  const pl = state.players[p]
  log(state, 'judge', t('{name} foi eliminado da partida.', { name: pl.name }), p)
  // controle de objetos alheios volta aos donos
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || o.owner === p || o.controller !== p) continue
    o.controller = o.owner
    o.eotController = undefined
    o.originalController = undefined
    o.sick = true
    log(state, 'judge', t('O controle de {name} volta para {player}.', { name: objName(state, id), player: pname(state, o.owner) }))
  }
  // combate: criaturas que atacavam o jogador (ou planeswalkers dele) são removidas do combate
  const c = state.combat
  if (c) {
    c.attackers = c.attackers.filter((a) => (a.defender ?? attackTargetDefender(state, a.target)) !== p)
    c.blockers = c.blockers.filter((b) => c.attackers.some((a) => a.id === b.attacker) && state.objects[b.blocker]?.owner !== p)
    if (c.pendingDefenders) c.pendingDefenders = c.pendingDefenders.filter((d) => d !== p)
  }
  // itens da pilha que ele controla ou cujas cartas ele possui
  state.stack = state.stack.filter((s) => s.controller !== p && !(s.objectId && state.objects[s.objectId]?.owner === p))
  if (state.resolving && state.resolving.item.controller === p) state.resolving = null
  if (state.pendingAI && state.pendingAI.item.controller === p) state.pendingAI = null
  // objetos que ele possui saem do jogo (sem gatilhos de "deixar o campo")
  const owned = Object.values(state.objects).filter((o) => o.owner === p)
  const ownedIds = new Set(owned.map((o) => o.id))
  state.battlefield = state.battlefield.filter((id) => !ownedIds.has(id))
  for (const id of ownedIds) delete state.objects[id]
  pl.library = []
  pl.hand = []
  pl.graveyard = []
  pl.exile = []
  pl.command = []
  pl.pool = emptyPool()
  if (c) c.attackers = c.attackers.filter((a) => state.objects[a.id])
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o) continue
    if (o.attachedTo && !state.objects[o.attachedTo]) o.attachedTo = undefined
    // controle por Aura que saiu do jogo termina
    if (o.originalController !== undefined) {
      const stillControlled = attachedTo(state, o.id).some((a) => a.parsed.statics.some((s) => s.k === 'attachedControl'))
      if (!stillControlled) {
        o.controller = isAlive(state, o.originalController) ? o.originalController : o.owner
        o.originalController = undefined
      }
    }
  }
  for (const id of [...state.players.flatMap((q) => q.exile)]) {
    const o = state.objects[id]
    if (o && o.playableBy === p) {
      o.playableBy = undefined
      o.playableUntil = undefined
    }
  }
  // escolhas, gatilhos e efeitos atrasados dele
  state.choices = state.choices.filter((ch) => ch.player !== p && !(ch.kind === 'pickDiscard' && ch.target === p))
  for (const ch of state.choices) {
    // objetos que saíram do jogo deixam de ser opções
    const exists = (id: string) => state.objects[id] !== undefined
    if ('candidates' in ch) ch.candidates = ch.candidates.filter(exists)
    if (ch.kind === 'scry' || ch.kind === 'dig') ch.cards = ch.cards.filter(exists)
    if (ch.kind === 'dig') ch.eligible = ch.eligible.filter(exists)
    if (ch.kind === 'sacrifice' || ch.kind === 'returnOwn' || ch.kind === 'search') ch.count = Math.min(ch.count, ch.candidates.length)
  }
  state.choices = state.choices.filter((ch) => !(('candidates' in ch && ch.candidates.length === 0) || ((ch.kind === 'scry' || ch.kind === 'dig') && ch.cards.length === 0)))
  state.pendingTriggers = state.pendingTriggers.filter((tr) => tr.controller !== p)
  state.delayed = (state.delayed ?? []).filter((d) => d.controller !== p).map((d) => ({ ...d, ids: d.ids.filter((id) => state.objects[id]) }))
  if (state.extraTurns) state.extraTurns[p] = 0
  if (state.monarch === p) {
    state.monarch = apOrNext(state)
    log(state, 'judge', t('{player} se torna o monarca.', { player: pname(state, state.monarch) }), state.monarch)
  }
  // declarações e prioridade
  if (state.activePlayer === p) {
    // o turno do jogador eliminado termina assim que a pilha esvaziar (ver settle)
    state.combat = null
    if (state.awaiting) state.awaiting = null
  } else if (state.awaiting?.kind === 'blockers' && state.awaiting.player === p) {
    promptNextDefender(state)
  }
  state.passes = 0
  state.priority = apOrNext(state)
}

// ============================================================
// Estrutura de turno
// ============================================================

function settle(state: GameState): void {
  for (let guard = 0; guard < 50; guard++) {
    checkSBA(state)
    if (state.winner !== null) return
    if (state.step === 'mulligan') {
      // todos os mulligans resolvidos (um jogador pode ter concedido durante os mulligans)
      if (!state.choices.length) startGameAfterMulligans(state)
      return
    }
    if (state.choices.length || state.pendingAI || state.awaiting) return
    if (state.resolving) {
      continueResolution(state)
      continue
    }
    if (state.pendingTriggers.length) {
      flushTriggers(state)
      continue
    }
    if (!isAlive(state, state.activePlayer) && state.stack.length === 0) {
      // o jogador ativo saiu da partida: o turno dele termina e o próximo jogador vivo começa o seu
      log(state, 'judge', t('O turno de {name} termina porque ele saiu da partida.', { name: pname(state, state.activePlayer) }))
      finishCleanup(state)
      return
    }
    return
  }
}

function startGameAfterMulligans(state: GameState): void {
  state.turn = 1
  if (!isAlive(state, state.firstPlayer)) state.firstPlayer = nextPlayer(state, state.firstPlayer)
  state.activePlayer = state.firstPlayer
  log(state, 'turn', t('— Turno {n} · {name} —', { n: 1, name: pname(state, state.activePlayer) }))
  enterStep(state, 'untap')
}

function nextTurn(state: GameState): void {
  state.turn++
  const extra = state.extraTurns ?? []
  if (isAlive(state, state.activePlayer) && (extra[state.activePlayer] ?? 0) > 0) {
    extra[state.activePlayer]--
    log(state, 'judge', t('{name} joga um turno extra.', { name: pname(state, state.activePlayer) }))
  } else state.activePlayer = nextPlayer(state, state.activePlayer)
  state.combat = null
  log(state, 'turn', t('— Turno {n} · {name} —', { n: state.turn, name: pname(state, state.activePlayer) }))
  enterStep(state, 'untap')
}

function enterStep(state: GameState, step: Step): void {
  emptyPools(state)
  state.step = step
  state.passes = 0
  state.priority = state.activePlayer
  const ap = state.activePlayer
  const apState = state.players[ap]
  switch (step) {
    case 'untap':
      for (const id of state.battlefield) {
        const o = state.objects[id]
        if (!o || o.controller !== ap) continue
        o.sick = false
        if (o.tapped && !locks(state, o).noUntap && !o.parsed.noUntapSelf) o.tapped = false
      }
      apState.landsPlayed = 0
      enterStep(state, 'upkeep')
      return
    case 'upkeep':
      fireEvent(state, 'upkeep', (o) => o.controller === ap)
      fireEvent(state, 'eachUpkeep', () => true)
      break
    case 'draw':
      if (!(state.turn === 1 && ap === state.firstPlayer)) drawCards(state, ap, 1)
      else log(state, 'judge', t('{name} começou a partida e não compra no primeiro turno.', { name: apState.name }), ap)
      break
    case 'beginCombat':
      if (potentialAttackers(state, ap).length === 0) {
        enterStep(state, 'main2')
        return
      }
      state.combat = { attackers: [], blockers: [], blockersDeclared: false, damageDealt: false, firstStrikeDone: false }
      fireEvent(state, 'beginCombat', (o) => o.controller === ap)
      break
    case 'declareAttackers':
      if (!state.combat) state.combat = { attackers: [], blockers: [], blockersDeclared: false, damageDealt: false, firstStrikeDone: false }
      if (potentialAttackers(state, ap).length === 0) {
        state.combat = null
        enterStep(state, 'main2')
        return
      }
      state.awaiting = { kind: 'attackers', player: ap }
      return
    case 'declareBlockers': {
      const c = state.combat
      if (!c || c.attackers.length === 0) {
        enterStep(state, 'endCombat')
        return
      }
      // cada jogador atacado declara bloqueadores, em ordem de turno a partir do jogador ativo
      c.pendingDefenders = opponents(state, ap).filter((d) => attackersAgainst(state, d).length > 0)
      if (promptNextDefender(state)) return
      break
    }
    case 'combatDamage':
      dealCombatDamage(state)
      break
    case 'endCombat':
      break
    case 'main2':
      state.combat = null
      break
    case 'end': {
      fireEvent(state, 'endStep', (o) => o.controller === ap)
      fireEvent(state, 'eachEndStep', () => true)
      // ações atrasadas ("sacrifique-a no início da próxima etapa final")
      const due = (state.delayed ?? []).filter((d) => !(d.afterTurn === state.turn && d.afterStep === 'end'))
      state.delayed = (state.delayed ?? []).filter((d) => !due.includes(d))
      for (const d of due) {
        for (const id of d.ids) {
          const o = state.objects[id]
          if (!o || o.zone !== 'battlefield') continue
          log(state, 'judge', t(d.action === 'sacrifice' ? '{name} é sacrificada (efeito atrasado).' : d.action === 'exile' ? '{name} é exilada (efeito atrasado).' : '{name} volta para a mão (efeito atrasado).', { name: objName(state, id) }), d.controller)
          moveObject(state, id, d.action === 'sacrifice' ? 'graveyard' : d.action === 'exile' ? 'exile' : 'hand')
        }
      }
      if (state.monarch === ap) {
        log(state, 'judge', t('{name} é o monarca e compra uma carta.', { name: apState.name }), ap)
        drawCards(state, ap, 1, true)
      }
      break
    }
    case 'cleanup': {
      const noMax = state.battlefield.some((id) => state.objects[id]?.controller === ap && state.objects[id].parsed.statics.some((s) => s.k === 'noMaxHandSize'))
      const excess = noMax ? 0 : apState.hand.length - HAND_SIZE
      if (excess > 0) {
        state.choices.push({ kind: 'discard', player: ap, count: excess, reason: t('tamanho máximo de mão') })
        return
      }
      finishCleanup(state)
      return
    }
  }
  settle(state)
}

function finishCleanup(state: GameState): void {
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o) continue
    o.damage = 0
    o.deathtouched = false
    o.mods = []
    o.regen = 0
    if (o.eotController !== undefined) {
      o.controller = isAlive(state, o.eotController) ? o.eotController : o.owner
      o.eotController = undefined
      log(state, 'judge', t('O controle de {name} volta para {player}.', { name: objName(state, o.id), player: pname(state, o.controller) }))
    }
  }
  nextTurn(state)
}

/**
 * Passa a declaração de bloqueadores ao próximo defensor pendente que tem algum bloqueio possível
 * (defensores sem bloqueios possíveis são pulados). Retorna true se alguém precisa declarar agora;
 * caso contrário encerra a declaração de bloqueadores.
 */
function promptNextDefender(state: GameState): boolean {
  const c = state.combat
  state.awaiting = null
  if (!c) return false
  const queue = c.pendingDefenders ?? []
  while (queue.length) {
    const d = queue[0]
    if (isAlive(state, d) && attackersAgainst(state, d).length > 0) {
      if (hasAnyBlock(state, d)) {
        state.awaiting = { kind: 'blockers', player: d }
        return true
      }
      log(state, 'combat', t('{name} não tem bloqueadores possíveis.', { name: pname(state, d) }), d)
    }
    queue.shift()
  }
  c.pendingDefenders = queue
  c.blockersDeclared = true
  return false
}

function advanceStep(state: GameState): void {
  if (state.step === 'cleanup') {
    finishCleanup(state)
    return
  }
  const idx = STEP_ORDER.indexOf(state.step)
  const next = STEP_ORDER[idx + 1] ?? 'cleanup'
  enterStep(state, next)
}

/** Passa a prioridade. A pilha resolve / a etapa termina só quando todos os jogadores vivos passam em sequência. */
function passPriority(state: GameState, p: PlayerId): void {
  state.passes++
  if (state.passes >= livingPlayers(state).length) {
    state.passes = 0
    if (state.stack.length) {
      resolveTop(state)
      state.priority = apOrNext(state)
      settle(state)
    } else if (!isAlive(state, state.activePlayer)) {
      settle(state)
    } else {
      advanceStep(state)
    }
  } else {
    state.priority = nextPlayer(state, p)
  }
}

// ============================================================
// Dano de combate
// ============================================================

function dealCombatDamage(state: GameState): void {
  const c = state.combat
  if (!c) return
  const participants = [...c.attackers.map((a) => a.id), ...c.blockers.map((b) => b.blocker)].map((id) => state.objects[id]).filter((o) => o && o.zone === 'battlefield')
  const anyFirst = participants.some((o) => hasKw(state, o, 'first strike') || hasKw(state, o, 'double strike'))
  if (anyFirst) {
    damageStep(state, 'first')
    checkSBA(state)
    if (state.winner !== null || !state.combat) return
  }
  damageStep(state, anyFirst ? 'regular' : 'all')
  c.damageDealt = true
}

function dealsIn(state: GameState, o: GameObject, phase: 'first' | 'regular' | 'all'): boolean {
  if (phase === 'all') return true
  const fs = hasKw(state, o, 'first strike')
  const ds = hasKw(state, o, 'double strike')
  if (phase === 'first') return fs || ds
  return !fs || ds
}

function damageStep(state: GameState, phase: 'first' | 'regular' | 'all'): void {
  const c = state.combat!
  type Ev = { source: GameObject; to: { kind: 'obj'; id: string } | { kind: 'player'; p: PlayerId }; n: number }
  const events: Ev[] = []
  for (const atk of c.attackers) {
    const a = state.objects[atk.id]
    if (!a || a.zone !== 'battlefield') continue
    const declared = c.blockers.filter((b) => b.attacker === a.id)
    const blockers = declared.map((b) => state.objects[b.blocker]).filter((b) => b && b.zone === 'battlefield')
    if (dealsIn(state, a, phase)) {
      let remaining = power(state, a)
      const trample = hasKw(state, a, 'trample')
      const dt = hasKw(state, a, 'deathtouch')
      const toDefender = (n: number) => {
        if (n <= 0) return
        if (atk.target.kind === 'player') {
          if (isAlive(state, atk.target.player)) events.push({ source: a, to: { kind: 'player', p: atk.target.player }, n })
        } else {
          const pw = state.objects[atk.target.id]
          if (pw && pw.zone === 'battlefield') events.push({ source: a, to: { kind: 'obj', id: pw.id }, n })
        }
      }
      if (remaining > 0) {
        if (declared.length === 0) toDefender(remaining)
        else if (blockers.length === 0) {
          if (trample) toDefender(remaining)
        } else {
          blockers.forEach((b, i) => {
            if (remaining <= 0) return
            const lethal = dt ? 1 : Math.max(0, toughness(state, b) - b.damage)
            const last = i === blockers.length - 1
            const assign = last && !trample ? remaining : Math.min(remaining, lethal)
            if (assign > 0) events.push({ source: a, to: { kind: 'obj', id: b.id }, n: assign })
            remaining -= assign
          })
          if (trample && remaining > 0) toDefender(remaining)
        }
      }
    }
    for (const b of blockers) {
      if (dealsIn(state, b, phase)) {
        const n = power(state, b)
        if (n > 0) events.push({ source: b, to: { kind: 'obj', id: a.id }, n })
      }
    }
  }
  if (state.fogTurn === state.turn) {
    if (events.length) log(state, 'judge', t('Todo o dano de combate é prevenido neste turno.'))
    return
  }
  const hitPlayers = new Set<string>()
  for (const ev of events) {
    if (ev.to.kind === 'player') {
      damagePlayer(state, ev.to.p, ev.n, ev.source, true)
      log(state, 'combat', t('{source} causa {n} de dano de combate a {target}.', { source: objName(state, ev.source.id), n: ev.n, target: pname(state, ev.to.p) }), ev.source.controller)
      if (state.monarch === ev.to.p && ev.source.controller !== ev.to.p) {
        state.monarch = ev.source.controller
        log(state, 'judge', t('{player} se torna o monarca.', { player: pname(state, ev.source.controller) }), ev.source.controller)
      }
      if (!hitPlayers.has(ev.source.id)) {
        hitPlayers.add(ev.source.id)
        for (const tr of ev.source.parsed.triggers) {
          if (tr.event === 'combatDamagePlayer') state.pendingTriggers.push({ controller: ev.source.controller, sourceId: ev.source.id, sourceName: objName(state, ev.source.id), ability: tr, printingId: ev.source.card.printingId })
        }
        fireEvent(state, 'allyCombatDamage', (o) => o.controller === ev.source.controller)
      }
    } else {
      const tgt = state.objects[ev.to.id]
      if (!tgt) continue
      damageObject(state, tgt, ev.n, ev.source)
      log(state, 'combat', t('{source} causa {n} de dano a {target}.', { source: objName(state, ev.source.id), n: ev.n, target: objName(state, tgt.id) }), ev.source.controller)
    }
  }
}

// ============================================================
// Escolhas pendentes
// ============================================================

function finishChoice(state: GameState): void {
  state.choices.shift()
  if (state.choices.length) return
  if (state.step === 'mulligan') {
    startGameAfterMulligans(state)
    return
  }
  if (state.step === 'cleanup' && !state.resolving && state.stack.length === 0) {
    finishCleanup(state)
    return
  }
  settle(state)
}

function applyChoice(state: GameState, p: PlayerId, action: Action): string | null {
  const ch = state.choices[0]
  if (!ch) return t('Não há escolha pendente.')
  if (ch.player !== p) return t('Aguarde a escolha do outro jogador.')
  const pl = state.players[p]
  switch (ch.kind) {
    case 'mulligan': {
      if (action.t === 'keep') {
        pl.kept = true
        const free = state.commanderGame ? 1 : 0
        const bottom = Math.max(0, pl.mulligans - free)
        log(state, 'action', pl.mulligans ? t('{name} mantém a mão após {n} mulligan(s).', { name: pl.name, n: pl.mulligans }) : t('{name} mantém a mão.', { name: pl.name }), p)
        if (bottom > 0 && pl.hand.length > 0) {
          state.choices[0] = { kind: 'bottom', player: p, count: Math.min(bottom, pl.hand.length) }
          return null
        }
        finishChoice(state)
        return null
      }
      if (action.t === 'mulligan') {
        if (pl.mulligans >= 6) return t('Limite de mulligans atingido.')
        pl.mulligans++
        for (const id of [...pl.hand]) moveObject(state, id, 'library')
        shuffleArray(state, pl.library)
        drawCards(state, p, HAND_SIZE, true)
        log(state, 'action', t('{name} faz mulligan ({n}).', { name: pl.name, n: pl.mulligans }), p)
        return null
      }
      return t('Escolha manter ou fazer mulligan.')
    }
    case 'bottom':
    case 'discard':
    case 'sacrifice':
    case 'search':
    case 'scry': {
      if (action.t !== 'chooseCards') return t('Escolha as cartas.')
      const ids = [...new Set(action.ids)]
      if (ch.kind === 'bottom' || ch.kind === 'discard') {
        if (ids.length !== ch.count) return t('Escolha exatamente {n} carta(s).', { n: ch.count })
        if (!ids.every((id) => pl.hand.includes(id))) return t('Escolha cartas da sua mão.')
        for (const id of ids) {
          if (ch.kind === 'bottom') moveObject(state, id, 'library', { bottom: true })
          else {
            log(state, 'action', t('{player} descarta {name}.', { player: pl.name, name: objName(state, id) }), p)
            moveObject(state, id, 'graveyard')
          }
        }
        if (ch.kind === 'bottom') log(state, 'action', t('{name} coloca {n} carta(s) no fundo do grimório.', { name: pl.name, n: ids.length }), p)
      } else if (ch.kind === 'sacrifice') {
        if (ids.length !== ch.count || !ids.every((id) => ch.candidates.includes(id))) return t('Escolha {n} permanente(s) para sacrificar.', { n: ch.count })
        for (const id of ids) {
          log(state, 'action', t('{player} sacrifica {name}.', { player: pl.name, name: objName(state, id) }), p)
          moveObject(state, id, 'graveyard')
        }
      } else if (ch.kind === 'search') {
        if (ids.length > ch.count || !ids.every((id) => ch.candidates.includes(id))) return t('Escolha até {n} carta(s) válidas.', { n: ch.count })
        if (ch.dest === 'top') {
          for (const id of ids) pl.library.splice(pl.library.indexOf(id), 1)
          shuffleArray(state, pl.library)
          for (const id of ids) pl.library.unshift(id)
          log(state, 'action', t('{name} busca uma carta, embaralha e a coloca no topo do grimório.', { name: pl.name }), p)
        } else {
          for (const id of ids) {
            log(state, 'action', ch.dest === 'hand' ? t('{player} busca {name} e coloca na mão.', { player: pl.name, name: objName(state, id) }) : t('{player} busca {name} e coloca no campo de batalha.', { player: pl.name, name: objName(state, id) }), p)
            moveObject(state, id, ch.dest === 'hand' ? 'hand' : 'battlefield', { tapped: ch.tapped, controller: p })
          }
          shuffleArray(state, pl.library)
        }
      } else if (ch.kind === 'scry') {
        // ids = cartas que vão para o fundo (vidência) ou cemitério (vigiar)
        if (!ids.every((id) => ch.cards.includes(id))) return t('Escolha entre as cartas reveladas.')
        for (const id of ids) {
          if (ch.surveil) moveObject(state, id, 'graveyard')
          else moveObject(state, id, 'library', { bottom: true })
        }
        log(state, 'action', t(ch.surveil ? '{name} vigia {n}: {top} no topo, {other} no cemitério.' : '{name} faz vidência {n}: {top} no topo, {other} no fundo.', { name: pl.name, n: ch.cards.length, top: ch.cards.length - ids.length, other: ids.length }), p)
      }
      finishChoice(state)
      return null
    }
    case 'pickDiscard': {
      if (action.t !== 'chooseCards') return t('Escolha uma carta.')
      const id = action.ids[0]
      if (action.ids.length !== 1 || !ch.candidates.includes(id)) return t('Escolha uma carta válida da mão revelada.')
      log(state, 'action', t('{player} descarta {name}.', { player: pname(state, ch.target), name: objName(state, id) }), ch.target)
      moveObject(state, id, 'graveyard')
      finishChoice(state)
      return null
    }
    case 'returnOwn': {
      if (action.t !== 'chooseCards') return t('Escolha a permanente a devolver.')
      const ids = [...new Set(action.ids)]
      if (ids.length !== ch.count || !ids.every((id) => ch.candidates.includes(id))) return t('Escolha {n} permanente(s) válida(s).', { n: ch.count })
      for (const id of ids) {
        log(state, 'action', t('{player} devolve {name} para a mão.', { player: pl.name, name: objName(state, id) }), p)
        moveObject(state, id, 'hand')
      }
      finishChoice(state)
      return null
    }
    case 'handLand': {
      if (action.t !== 'chooseCards') return t('Escolha um terreno (ou nenhum).')
      const ids = [...new Set(action.ids)]
      if (ids.length > 1 || !ids.every((id) => ch.candidates.includes(id))) return t('Escolha no máximo um terreno da sua mão.')
      for (const id of ids) {
        log(state, 'action', t('{player} coloca {name} no campo de batalha.', { player: pl.name, name: objName(state, id) }), p)
        moveObject(state, id, 'battlefield', { controller: p })
      }
      finishChoice(state)
      return null
    }
    case 'dig': {
      if (action.t !== 'chooseCards') return t('Escolha a(s) carta(s).')
      const ids = [...new Set(action.ids)]
      if (ids.length > ch.take || !ids.every((id) => ch.eligible.includes(id))) return t('Escolha até {n} carta(s) válida(s).', { n: ch.take })
      for (const id of ids) {
        log(state, 'action', ch.dest === 'hand' ? t('{player} pega {name} e coloca na mão.', { player: pl.name, name: objName(state, id) }) : t('{player} pega {name} e coloca no campo de batalha.', { player: pl.name, name: objName(state, id) }), p)
        moveObject(state, id, ch.dest === 'hand' ? 'hand' : 'battlefield', { controller: p })
      }
      const rest = ch.cards.filter((id) => !ids.includes(id) && state.objects[id]?.zone === 'library')
      shuffleArray(state, rest)
      for (const id of rest) moveObject(state, id, ch.rest === 'graveyard' ? 'graveyard' : 'library', { bottom: true })
      log(state, 'action', ch.rest === 'graveyard' ? t('{n} carta(s) restante(s) vão para o cemitério.', { n: rest.length }) : t('{n} carta(s) restante(s) vão para o fundo do grimório.', { n: rest.length }), p)
      finishChoice(state)
      return null
    }
    case 'mode': {
      if (action.t !== 'chooseMode') return t('Escolha um modo.')
      const modes = ch.trigger.ability.modes ?? []
      const m = modes[action.index]
      if (!m) return t('Modo inválido.')
      const trig: PendingTrigger = { ...ch.trigger, ability: { ...ch.trigger.ability, ...m, modes: undefined } }
      log(state, 'action', t('{name} escolhe o modo: "{mode}".', { name: pl.name, mode: m.text }), p)
      if (trig.ability.targets.length === 0) {
        pushTriggerToStack(state, trig, [])
        finishChoice(state)
        return null
      }
      const anyLegal = trig.ability.targets.every((s) => s.optional || targetCandidates(state, p, s, trig.sourceId).length > 0)
      if (!anyLegal) return t('Esse modo não tem alvos válidos.')
      state.choices[0] = { kind: 'targets', player: p, trigger: trig }
      return null
    }
    case 'targets': {
      if (action.t !== 'chooseTargets') return t('Escolha os alvos da habilidade.')
      const err = validateTargets(state, p, ch.trigger.ability.targets, action.targets, ch.trigger.sourceId)
      if (err) return err
      pushTriggerToStack(state, ch.trigger, action.targets)
      finishChoice(state)
      return null
    }
  }
}

// ============================================================
// Juiz IA: aplica operações estruturadas
// ============================================================

function applyAIOps(state: GameState, ops: JudgeOp[], explanation: string): void {
  const item = state.pendingAI?.item
  if (!item) return
  const ctrl = item.controller
  // "opponent": os jogadores-alvo do item que são oponentes; sem alvo de jogador, todos os oponentes
  const targetedOpps = item.targets.flatMap((tg) => (tg && tg.kind === 'player' && tg.player !== ctrl && isAlive(state, tg.player) ? [tg.player] : []))
  const oppsOf = targetedOpps.length ? [...new Set(targetedOpps)] : opponents(state, ctrl)
  const playersOf = (op: JudgeOp): PlayerId[] => op.target_players.flatMap((t) => (t === 'controller' ? [ctrl] : oppsOf))
  const objsOf = (op: JudgeOp): GameObject[] => op.target_object_ids.map((id) => state.objects[id]).filter(Boolean)
  const src = item.sourceId ?? item.objectId
  const srcObj = src ? state.objects[src] : undefined
  log(state, 'ai', t('Juiz IA: {text}', { text: explanation }), ctrl)
  for (const op of ops) {
    switch (op.op) {
      case 'damage':
        for (const p of playersOf(op)) damagePlayer(state, p, op.amount, srcObj)
        for (const o of objsOf(op)) if (o.zone === 'battlefield') damageObject(state, o, op.amount, srcObj)
        break
      case 'destroy':
        for (const o of objsOf(op)) destroy(state, o.id)
        break
      case 'exile':
        for (const o of objsOf(op)) moveObject(state, o.id, 'exile')
        break
      case 'bounce':
        for (const o of objsOf(op)) moveObject(state, o.id, 'hand')
        break
      case 'draw':
        for (const p of playersOf(op)) drawCards(state, p, Math.max(0, op.amount))
        break
      case 'discard':
        for (const p of playersOf(op)) {
          const n = Math.min(op.amount, state.players[p].hand.length)
          if (n > 0) state.choices.push({ kind: 'discard', player: p, count: n, reason: item.sourceName })
        }
        break
      case 'gain_life':
        for (const p of playersOf(op)) gainLife(state, p, op.amount)
        break
      case 'lose_life':
        for (const p of playersOf(op)) state.players[p].life -= op.amount
        break
      case 'pump':
        for (const o of objsOf(op)) o.mods.push({ power: op.power, toughness: op.toughness, keywords: op.keywords.map((k) => k.toLowerCase()) })
        break
      case 'add_counters':
        for (const o of objsOf(op)) {
          const key = op.amount >= 0 ? '+1/+1' : '-1/-1'
          o.counters[key] = (o.counters[key] ?? 0) + Math.abs(op.amount)
        }
        break
      case 'create_token': {
        const who = playersOf(op)
        for (const p of who.length ? who : [ctrl]) {
          for (let i = 0; i < Math.max(1, op.amount); i++) {
            createToken(state, p, {
              name: op.token_name || t('Ficha'),
              power: /Creature/i.test(op.token_types) ? op.power : undefined,
              toughness: /Creature/i.test(op.token_types) ? op.toughness : undefined,
              colors: op.colors,
              types: op.token_types.replace(/^Token\s+/i, '') || 'Creature',
              keywords: op.keywords.map((k) => k.toLowerCase()),
              kind: /treasure/i.test(op.token_name) ? 'treasure' : /food/i.test(op.token_name) ? 'food' : /clue/i.test(op.token_name) ? 'clue' : /Creature/i.test(op.token_types) ? 'creature' : 'other'
            })
          }
        }
        break
      }
      case 'tap':
      case 'untap':
        for (const o of objsOf(op)) if (o.zone === 'battlefield') o.tapped = op.op === 'tap'
        break
      case 'mill':
        for (const p of playersOf(op)) {
          for (let i = 0; i < op.amount; i++) {
            const id = state.players[p].library[0]
            if (id) moveObject(state, id, 'graveyard')
          }
        }
        break
      case 'sacrifice':
        for (const o of objsOf(op)) if (o.zone === 'battlefield') moveObject(state, o.id, 'graveyard')
        break
      case 'graveyard_to_hand':
        for (const o of objsOf(op)) if (o.zone === 'graveyard') moveObject(state, o.id, 'hand')
        break
      case 'graveyard_to_battlefield':
        for (const o of objsOf(op)) if (o.zone === 'graveyard') moveObject(state, o.id, 'battlefield', { controller: ctrl })
        break
      case 'add_mana': {
        const pl = state.players[ctrl]
        for (const s of op.mana.match(/\{([WUBRGC])\}/gi) ?? []) pl.pool[s[1].toUpperCase() as keyof ManaPool]++
        break
      }
      case 'none':
        break
    }
  }
}

// ============================================================
// Ajustes manuais
// ============================================================

function applyManual(state: GameState, p: PlayerId, op: ManualOp): string | null {
  switch (op.op) {
    case 'life':
      if (!state.players[op.player]) return t('Jogador inválido.')
      state.players[op.player].life += op.delta
      log(state, 'manual', t('Ajuste manual: vida de {player} {delta} (agora {life}).', { player: pname(state, op.player), delta: `${op.delta > 0 ? '+' : ''}${op.delta}`, life: state.players[op.player].life }), p)
      return null
    case 'draw':
      if (!state.players[op.player]) return t('Jogador inválido.')
      drawCards(state, op.player, 1, true)
      log(state, 'manual', t('Ajuste manual: {player} compra 1 carta.', { player: pname(state, op.player) }), p)
      return null
    case 'tap': {
      const o = state.objects[op.id]
      if (!o || o.zone !== 'battlefield') return t('Objeto inválido.')
      o.tapped = !o.tapped
      log(state, 'manual', t(o.tapped ? 'Ajuste manual: {name} virada.' : 'Ajuste manual: {name} desvirada.', { name: objName(state, op.id) }), p)
      return null
    }
    case 'counter': {
      const o = state.objects[op.id]
      if (!o || o.zone !== 'battlefield') return t('Objeto inválido.')
      const key = hasType(o, 'Planeswalker') && !isCreature(o) ? 'loyalty' : '+1/+1'
      o.counters[key] = Math.max(0, (o.counters[key] ?? 0) + op.delta)
      log(state, 'manual', t(
          key === 'loyalty'
            ? op.delta > 0
              ? 'Ajuste manual: {name} recebe um marcador de lealdade.'
              : 'Ajuste manual: {name} perde um marcador de lealdade.'
            : op.delta > 0
              ? 'Ajuste manual: {name} recebe um marcador +1/+1.'
              : 'Ajuste manual: {name} perde um marcador +1/+1.',
          { name: objName(state, op.id) }
        ), p)
      return null
    }
    case 'damage': {
      const o = state.objects[op.id]
      if (!o || o.zone !== 'battlefield') return t('Objeto inválido.')
      o.damage = Math.max(0, o.damage + op.delta)
      log(state, 'manual', t('Ajuste manual: dano em {name} agora é {n}.', { name: objName(state, op.id), n: o.damage }), p)
      return null
    }
    case 'move': {
      const o = state.objects[op.id]
      if (!o) return t('Objeto inválido.')
      const msg: Record<string, string> = {
        hand: 'Ajuste manual: {name} movida para mão.',
        graveyard: 'Ajuste manual: {name} movida para cemitério.',
        exile: 'Ajuste manual: {name} movida para exílio.',
        battlefield: 'Ajuste manual: {name} movida para campo de batalha.',
        libraryTop: 'Ajuste manual: {name} movida para topo do grimório.',
        libraryBottom: 'Ajuste manual: {name} movida para fundo do grimório.'
      }
      log(state, 'manual', t(msg[op.to], { name: objName(state, op.id) }), p)
      if (op.to === 'libraryTop') moveObject(state, op.id, 'library')
      else if (op.to === 'libraryBottom') moveObject(state, op.id, 'library', { bottom: true })
      else moveObject(state, op.id, op.to, { controller: o.owner })
      return null
    }
  }
}

// ============================================================
// Ponto de entrada: valida e aplica uma ação
// ============================================================

export function performAction(input: GameState, p: PlayerId, action: Action): ActionResult {
  const state = clone(input)
  const err = apply(state, p, action)
  if (err) return { state: input, error: err }
  settle(state)
  return { state }
}

function apply(state: GameState, p: PlayerId, action: Action): string | null {
  if (!Number.isInteger(p) || !state.players[p]) return t('Jogador inválido.')
  if (state.winner !== null && action.t !== 'manual') return t('A partida terminou.')
  if (state.winner === null && state.players[p].lost) return t('Você foi eliminado da partida.')
  switch (action.t) {
    case 'concede':
      // o jogador é eliminado (a partida só termina se restar um jogador): ver checkSBA
      state.players[p].lost = true
      log(state, 'judge', t('{name} concede a partida.', { name: pname(state, p) }), p)
      return null
    case 'manual':
      return applyManual(state, p, action.op)
    case 'keep':
    case 'mulligan':
    case 'chooseCards':
    case 'chooseTargets':
    case 'chooseMode':
      return applyChoice(state, p, action)
    case 'aiResolve':
    case 'aiSkip': {
      if (!state.pendingAI) return t('Nenhum efeito aguardando o Juiz IA.')
      if (action.t === 'aiResolve') applyAIOps(state, action.ops, action.explanation)
      else log(state, 'judge', t('Juiz IA indisponível ({reason}). Parte do efeito de {name} não foi aplicada; use ajustes manuais se necessário.', { reason: action.reason, name: state.pendingAI.item.sourceName }))
      state.pendingAI = null
      if (state.choices.length) return null
      if (state.resolving) {
        continueResolution(state)
      }
      return null
    }
    case 'pass': {
      const pc = priorityCheck(state, p)
      if (pc) return pc
      passPriority(state, p)
      return null
    }
    case 'playLand': {
      const e = checkPlayLand(state, p, action.id, action.face)
      if (e) return e
      const o = state.objects[action.id]
      const face = action.face ?? landFaceOf(o) ?? 0
      state.players[p].landsPlayed++
      moveObject(state, action.id, 'battlefield', { controller: p, face })
      log(state, 'action', t('{player} joga {name}.', { player: pname(state, p), name: objName(state, action.id) }), p)
      state.passes = 0
      return null
    }
    case 'tapMana': {
      const o = state.objects[action.id]
      if (!o || o.zone !== 'battlefield' || o.controller !== p) return t('Você não controla essa permanente.')
      if (state.winner !== null) return t('A partida terminou.')
      if (o.tapped) return t('Essa permanente já está virada.')
      const ab = o.parsed.mana.find((m) => m.cost.tap && !m.cost.mana && !m.cost.discard) ?? o.parsed.mana.find((m) => m.cost.tap && !m.cost.discard)
      if (!ab) return t('Essa permanente não tem habilidade de mana simples.')
      if (isCreature(o) && o.sick && !hasKw(state, o, 'haste')) return t('Criatura com enjoo de invocação não pode virar para gerar mana.')
      if (ab.cost.payLife && state.players[p].life < ab.cost.payLife) return t('Vida insuficiente.')
      if (ab.cost.mana) {
        // terrenos-filtro etc.: paga o custo de mana (vira esta permanente antes, para não usá-la no pagamento)
        o.tapped = true
        const err = payMana(state, p, ab.cost.mana, 0, 0)
        if (err) {
          o.tapped = false
          return err
        }
      }
      o.tapped = true
      const pool = state.players[p].pool
      const produced: string[] = []
      for (const unit of ab.units) {
        const c = action.color && unit.includes(action.color) ? action.color : unit.includes('C') ? 'C' : unit[0]
        pool[c as keyof ManaPool]++
        produced.push(c)
      }
      state.players[p].life -= ab.cost.payLife
      if (ab.cost.sacrificeSelf) moveObject(state, o.id, 'graveyard')
      log(state, 'action', t('{player} vira {name} para {mana}.', { player: pname(state, p), name: objName(state, action.id), mana: `{${produced.join('}{')}}` }), p)
      return null
    }
    case 'cast': {
      const face = action.face ?? 0
      const x = action.x ?? 0
      const modeSel = action.modes ?? action.mode
      const info = castInfo(state, p, action.id, face, modeSel, x)
      if (info.error) return info.error
      if (info.needsX && action.x === undefined) return t('Escolha o valor de X.')
      if (info.modes) {
        if (info.chooseCount > 1) {
          const ms = action.modes ?? []
          if (new Set(ms).size !== info.chooseCount || ms.some((m) => !info.modes![m])) return t('Escolha {n} modos diferentes.', { n: info.chooseCount })
        } else if (action.mode === undefined) return t('Escolha um modo.')
      }
      const terr = validateTargets(state, p, info.block.targets, action.targets, action.id)
      if (terr) return terr
      if (info.extraCost) {
        const ids = [...new Set(action.extra ?? [])]
        if (ids.length !== info.extraCost.count || !ids.every((id) => info.extraCost!.candidates.includes(id))) {
          return info.extraCost.kind === 'sacrifice'
            ? t('Pague o custo adicional: sacrifique {n} permanente(s).', { n: info.extraCost.count })
            : t('Pague o custo adicional: descarte {n} carta(s).', { n: info.extraCost.count })
        }
      }
      const o = state.objects[action.id]
      const fromCommand = o.zone === 'command'
      const payErr = payMana(state, p, info.cost, x, info.tax)
      if (payErr) return payErr
      if (info.extraCost) {
        for (const id of action.extra ?? []) {
          log(state, 'action', t(info.extraCost.kind === 'sacrifice' ? '{player} sacrifica {name} (custo adicional).' : '{player} descarta {name} (custo adicional).', { player: pname(state, p), name: objName(state, id) }), p)
          moveObject(state, id, 'graveyard')
        }
      }
      if (fromCommand) state.players[p].commanderCasts[o.id] = (state.players[p].commanderCasts[o.id] ?? 0) + 1
      removeFromZone(state, o)
      o.zone = 'stack'
      if (face !== o.face) {
        o.face = face
        o.parsed = parseFace(o.card, face)
      }
      const item: StackItem = {
        id: `s${state.nextId++}`,
        kind: 'spell',
        objectId: o.id,
        sourceId: o.id,
        sourceName: objName(state, o.id),
        controller: p,
        block: info.block,
        targets: action.targets,
        x,
        isPermanentSpell: info.isPermanent,
        fromCommand,
        printingId: o.card.printingId,
        modeIndex: action.mode
      }
      state.stack.push(item)
      log(state, 'action', castLogText(pname(state, p), item.sourceName, x, describeTargets(state, action.targets)), p)
      fireCastTriggers(state, p, o)
      state.passes = 0
      state.priority = p
      return null
    }
    case 'activate': {
      const x = action.x ?? 0
      const info = activateInfo(state, p, action.id, action.ability, x)
      if (info.error) return info.error
      if (info.needsX && action.x === undefined) return t('Escolha o valor de X.')
      const o = state.objects[action.id]
      const ab = o.parsed.activated[action.ability]
      const terr = validateTargets(state, p, ab.targets, action.targets, action.id)
      if (terr) return terr
      if (ab.isEquip && action.targets[0]?.kind === 'object' && action.targets[0].id === o.id) return t('Um equipamento não pode equipar a si mesmo.')
      const payErr = payMana(state, p, ab.cost.mana, x, 0)
      if (payErr) return payErr
      if (ab.cost.tap) o.tapped = true
      if (ab.cost.payLife) state.players[p].life -= ab.cost.payLife
      if (ab.isLoyalty) {
        o.counters.loyalty = (o.counters.loyalty ?? 0) + (ab.cost.loyalty ?? 0)
        o.loyaltyUsedTurn = state.turn
      }
      const item: StackItem = {
        id: `s${state.nextId++}`,
        kind: 'ability',
        sourceId: o.id,
        sourceName: objName(state, o.id),
        controller: p,
        block: ab,
        targets: action.targets,
        x,
        isPermanentSpell: false,
        printingId: o.card.printingId,
        equip: ab.isEquip
      }
      if (ab.fromHand === 'cycling') {
        moveObject(state, o.id, 'graveyard')
        log(state, 'action', t('{player} recicla {name}.', { player: pname(state, p), name: item.sourceName }), p)
      }
      if (ab.cost.sacrificeSelf && o.zone === 'battlefield') moveObject(state, o.id, 'graveyard')
      if (ab.cost.exileSelf) moveObject(state, o.id, 'exile')
      state.stack.push(item)
      if (!ab.fromHand) log(state, 'action', activateLogText(pname(state, p), item.sourceName, ab.label, describeTargets(state, action.targets)), p)
      state.passes = 0
      state.priority = p
      return null
    }
    case 'attack': {
      if (!state.awaiting || state.awaiting.kind !== 'attackers') return t('Não é o momento de declarar atacantes.')
      if (state.awaiting.player !== p) return t('Só o jogador ativo declara atacantes.')
      const seen = new Set<string>()
      const defenders: PlayerId[] = []
      for (const a of action.attackers) {
        const o = state.objects[a.id]
        if (!o) return t('Atacante inválido.')
        if (seen.has(a.id)) return t('Uma criatura não pode atacar duas vezes.')
        seen.add(a.id)
        if (!isCreature(o) || o.controller !== p) return t('{name} não é uma criatura sua.', { name: objName(state, a.id) })
        if (o.tapped) return t('{name} está virada e não pode atacar.', { name: objName(state, a.id) })
        if (o.sick && !hasKw(state, o, 'haste')) return t('{name} está com enjoo de invocação (entrou neste turno) e não tem Ímpeto.', { name: objName(state, a.id) })
        if (hasKw(state, o, 'defender')) return t('{name} tem Defensor e não pode atacar.', { name: objName(state, a.id) })
        if (locks(state, o).cantAttack) return t('{name} não pode atacar.', { name: objName(state, a.id) })
        if (!a.target || (a.target.kind !== 'player' && a.target.kind !== 'planeswalker')) return t('Escolha quem {name} ataca.', { name: objName(state, a.id) })
        if (a.target.kind === 'player') {
          if (a.target.player === p || !isAlive(state, a.target.player)) return t('Você só pode atacar um oponente que ainda está na partida.')
          defenders.push(a.target.player)
        } else {
          const pw = state.objects[a.target.id]
          if (!pw || pw.zone !== 'battlefield' || pw.controller === p || !isAlive(state, pw.controller) || !hasType(pw, 'Planeswalker')) return t('Planeswalker inválido como alvo de ataque.')
          defenders.push(pw.controller)
        }
      }
      for (const o of potentialAttackers(state, p)) {
        if (o.parsed.mustAttack && !seen.has(o.id)) return t('{name} ataca a cada combate se puder.', { name: objName(state, o.id) })
      }
      state.awaiting = null
      const c = state.combat ?? { attackers: [], blockers: [], blockersDeclared: false, damageDealt: false, firstStrikeDone: false }
      state.combat = c
      c.attackers = action.attackers.map((a, i) => ({ id: a.id, target: a.target as AttackTarget, defender: defenders[i] }))
      if (c.attackers.length === 0) {
        log(state, 'combat', t('{player} não ataca.', { player: pname(state, p) }), p)
        state.combat = null
        enterStep(state, 'main2')
        return null
      }
      for (const a of c.attackers) {
        const o = state.objects[a.id]
        if (!hasKw(state, o, 'vigilance')) o.tapped = true
        for (const tr of o.parsed.triggers) if (tr.event === 'attacks') state.pendingTriggers.push({ controller: p, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
      }
      log(state, 'combat', t('{player} ataca com {names}.', { player: pname(state, p), names: c.attackers.map((a) => objName(state, a.id)).join(', ') }), p)
      state.priority = p
      state.passes = 0
      return null
    }
    case 'block': {
      if (!state.awaiting || state.awaiting.kind !== 'blockers') return t('Não é o momento de declarar bloqueadores.')
      if (state.awaiting.player !== p) return t('Só o jogador defensor declara bloqueadores.')
      const c = state.combat!
      const used = new Set<string>()
      const mine = attackersAgainst(state, p)
      for (const b of action.blocks) {
        const bl = state.objects[b.blocker]
        const at = state.objects[b.attacker]
        if (!bl || !at) return t('Bloqueio inválido.')
        if (bl.controller !== p) return t('{name} não é sua.', { name: objName(state, b.blocker) })
        if (used.has(b.blocker)) return t('{name} só pode bloquear uma criatura.', { name: objName(state, b.blocker) })
        used.add(b.blocker)
        if (!c.attackers.some((a) => a.id === b.attacker)) return t('{name} não está atacando.', { name: objName(state, b.attacker) })
        if (!mine.includes(b.attacker)) return t('{name} não está atacando você nem um planeswalker seu.', { name: objName(state, b.attacker) })
        const e = canBlock(state, bl, at)
        if (e) return e
      }
      for (const a of c.attackers) {
        const n = action.blocks.filter((b) => b.attacker === a.id).length
        const at = state.objects[a.id]
        if (n === 1 && at && hasKw(state, at, 'menace')) return t('{name} tem Ameaça: precisa ser bloqueada por duas ou mais criaturas.', { name: objName(state, a.id) })
      }
      state.awaiting = null
      const declared = action.blocks.map((b) => ({ ...b }))
      c.blockers.push(...declared)
      if (declared.length === 0) log(state, 'combat', t('{player} não bloqueia.', { player: pname(state, p) }), p)
      for (const b of declared) {
        log(state, 'combat', t('{blocker} bloqueia {attacker}.', { blocker: objName(state, b.blocker), attacker: objName(state, b.attacker) }), p)
        const o = state.objects[b.blocker]
        for (const tr of o.parsed.triggers) if (tr.event === 'blocks') state.pendingTriggers.push({ controller: p, sourceId: o.id, sourceName: objName(state, o.id), ability: tr, printingId: o.card.printingId })
      }
      // próximo defensor (em ordem de turno) declara os seus bloqueadores
      if (c.pendingDefenders?.[0] === p) c.pendingDefenders.shift()
      if (promptNextDefender(state)) return null
      state.priority = state.activePlayer
      state.passes = 0
      return null
    }
  }
}

function describeTargets(state: GameState, targets: (TargetChoice | null)[]): string {
  const names = targets.filter(Boolean).map((t) => {
    const c = t as TargetChoice
    if (c.kind === 'player') return pname(state, c.player)
    if (c.kind === 'stack') return state.stack.find((s) => s.id === c.id)?.sourceName ?? '?'
    return objName(state, c.id)
  })
  return names.join(', ')
}

function castLogText(player: string, name: string, x: number, targets: string): string {
  if (x && targets) return t('{player} conjura {name} (X={x}) (alvo: {targets}).', { player, name, x, targets })
  if (x) return t('{player} conjura {name} (X={x}).', { player, name, x })
  if (targets) return t('{player} conjura {name} (alvo: {targets}).', { player, name, targets })
  return t('{player} conjura {name}.', { player, name })
}

function activateLogText(player: string, name: string, label: string, targets: string): string {
  if (targets) return t('{player} ativa {name}: {label} (alvo: {targets}).', { player, name, label, targets })
  return t('{player} ativa {name}: {label}.', { player, name, label })
}

// ============================================================
// Consultas para a interface e para o bot
// ============================================================

export function currentChoice(state: GameState): PendingChoice | null {
  return state.choices[0] ?? null
}

/** Quem precisa agir agora (prioridade, declaração ou escolha). */
export function actingPlayer(state: GameState): PlayerId | null {
  if (state.winner !== null) return null
  if (state.choices.length) return state.choices[0].player
  if (state.pendingAI) return null
  if (state.awaiting) return state.awaiting.player
  return state.priority
}

export function stepLabel(step: Step): string {
  return t(STEP_LABEL[step])
}

/** O jogador tem alguma jogada de velocidade de instantâneo disponível agora? */
/** Cartas que o jogador pode tentar jogar agora: mão, zona de comando e exiladas com permissão. */
export function playableCardIds(state: GameState, p: PlayerId): string[] {
  const pl = state.players[p]
  return [...pl.hand, ...pl.command, ...pl.exile.filter((id) => canPlayFromExile(state, state.objects[id], p))]
}

export function hasInstantSpeedPlay(state: GameState, p: PlayerId): boolean {
  if (state.priority !== p || busy(state)) return false
  for (const id of playableCardIds(state, p)) {
    const o = state.objects[id]
    if (!o) continue
    const tl = typeLineOf(o)
    if (!/\bInstant\b/.test(tl) && !o.parsed.keywords.includes('flash')) continue
    if (!castInfo(state, p, id).error) return true
  }
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || o.controller !== p) continue
    for (let i = 0; i < o.parsed.activated.length; i++) {
      const ab = o.parsed.activated[i]
      if (ab.sorcerySpeed || ab.isLoyalty) continue
      if (!activateInfo(state, p, id, i).error) return true
    }
  }
  return false
}

export function availableManaCount(state: GameState, p: PlayerId): number {
  const pool = state.players[p].pool
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C + manaSources(state, p).reduce((s, x) => s + x.units.length, 0)
}

export { STEP_ORDER }
