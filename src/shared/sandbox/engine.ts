// Mesa livre: aplica ações manuais e escreve o histórico. Nenhuma regra é validada aqui
// (só o que não faz sentido fisicamente, como mover uma carta que não existe).
import { t } from '../i18n/index.ts'
import type { GameCard } from '../engine/types.ts'
import type { PkmCard } from '../pokemon/types.ts'
import { bestOptionFor, manaOptionsOf } from './mana.ts'
import { prizeValue } from '../pkm-engine/effects.ts'
import { STEP_LABEL, STEP_ORDER } from '../engine/types.ts'
import { MTG_ZONES, PKM_ZONES, type SAction, type SCard, type SLog, type SObj, type SPlayer, type SResult, type SSetup, type SState, type SZone } from './types.ts'

// ---------------- utilidades ----------------

function rand(state: SState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let r = state.rng
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296
}

function shuffle(state: SState, arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

export function isPkmCard(c: SCard): c is PkmCard {
  return 'category' in c
}

export function isMtgCard(c: SCard): c is GameCard {
  return 'typeLine' in c && 'oracleText' in c
}

/** Nome para exibir (localizado quando houver). */
export function cardName(c: SCard): string {
  return isPkmCard(c) ? (c.localName ?? c.name) : (c.displayName ?? c.name)
}

export function objName(state: SState, id: string): string {
  const o = state.objects[id]
  return o ? cardName(o.card) : '?'
}

/** Zona principal do baralho de cada jogo. */
export function deckZone(state: SState): SZone {
  return state.game === 'mtg' ? 'library' : 'deck'
}

export function discardZone(state: SState): SZone {
  return state.game === 'mtg' ? 'graveyard' : 'discard'
}

function log(state: SState, text: string, player?: number, kind: SLog['kind'] = 'action'): void {
  const last = state.log.length ? state.log[state.log.length - 1].id : 0
  state.log.push({ id: last + 1, seq: kind === 'system' ? -1 : state.seq, turn: state.turn, player, text, kind })
  if (state.log.length > 800) state.log.splice(0, state.log.length - 800)
}

/** Onde está a carta: zona e dono da zona (ou "attached" se estiver ligada / "under" se embaixo de uma evolução). */
export function locate(state: SState, id: string): { player: number; zone: SZone | 'attached' | 'under' } | null {
  const o = state.objects[id]
  if (!o) return null
  if (o.attachedTo) return { player: o.owner, zone: 'attached' }
  for (const pl of state.players) {
    for (const [z, ids] of Object.entries(pl.zones)) if (ids.includes(id)) return { player: pl.id, zone: z as SZone }
  }
  for (const other of Object.values(state.objects)) if (other.under?.includes(id)) return { player: other.owner, zone: 'under' }
  return null
}

/** Cartas ligadas a uma carta. */
export function attachmentsOf(state: SState, id: string): string[] {
  return Object.values(state.objects)
    .filter((o) => o.attachedTo === id)
    .map((o) => o.id)
}

/** Tira a carta de onde estiver (zona, ligação ou pilha de evolução). */
function detach(state: SState, id: string): void {
  const o = state.objects[id]
  if (o.attachedTo) {
    o.attachedTo = undefined
    return
  }
  for (const pl of state.players) {
    for (const ids of Object.values(pl.zones)) {
      const i = ids.indexOf(id)
      if (i >= 0) {
        ids.splice(i, 1)
        return
      }
    }
  }
  for (const other of Object.values(state.objects)) {
    const i = other.under?.indexOf(id) ?? -1
    if (i >= 0) other.under!.splice(i, 1)
  }
}

const IN_PLAY = new Set<string>(['battlefield', 'active', 'bench', 'stadium'])

/** Zera o estado "de mesa" da carta ao trocar de zona. */
function resetObj(o: SObj): void {
  o.tapped = false
  o.counters = {}
  o.damage = 0
  o.conditions = []
  o.attacking = false
  o.blocking = undefined
  o.face = 0
}

const ZONE_LABEL: Record<string, string> = {
  library: 'grimório',
  hand: 'mão',
  battlefield: 'campo de batalha',
  graveyard: 'cemitério',
  exile: 'exílio',
  command: 'zona de comando',
  deck: 'deck',
  active: 'Ativo',
  bench: 'Banco',
  discard: 'descarte',
  prizes: 'Prêmios',
  lostZone: 'Zona Perdida',
  stadium: 'Estádio'
}

export function zoneLabel(z: string): string {
  return t(ZONE_LABEL[z] ?? z)
}

// ---------------- criação ----------------

export function createSandbox(setup: SSetup): SState {
  const zones = setup.game === 'mtg' ? MTG_ZONES : PKM_ZONES
  const state: SState = {
    game: setup.game,
    format: setup.format,
    turn: 1,
    activePlayer: 0,
    players: setup.players.map((ps, i): SPlayer => ({
      id: i,
      name: ps.name,
      color: ps.color,
      isBot: ps.isBot,
      life: setup.startingLife ?? (setup.game === 'mtg' ? 20 : 0),
      zones: Object.fromEntries(zones.map((z) => [z, [] as string[]])),
      pool: {},
      landsThisTurn: 0,
      energyThisTurn: 0,
      supporterThisTurn: 0
    })),
    objects: {},
    log: [],
    rng: (setup.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    nextId: 1,
    seq: 0,
    winner: null
  }
  const dz = deckZone(state)
  setup.players.forEach((ps, p) => {
    for (const gc of ps.deck) {
      const id = `s${state.nextId++}`
      state.objects[id] = { id, owner: p, card: gc.card, printingId: gc.printingId, counters: {} }
      state.players[p].zones[dz].push(id)
    }
    for (const gc of ps.commanders ?? []) {
      const id = `s${state.nextId++}`
      state.objects[id] = { id, owner: p, card: gc.card, printingId: gc.printingId, counters: {}, commander: true, commanderCasts: 0 }
      state.players[p].zones.command.push(id)
    }
    shuffle(state, state.players[p].zones[dz])
  })
  state.activePlayer = setup.firstPlayer ?? Math.floor(rand(state) * setup.players.length)
  log(state, t('Partida iniciada ({format}). Sorteio: {name} começa. Todas as jogadas são manuais; chame o Juiz IA em qualquer linha do histórico se tiver dúvida.', { format: setup.format, name: state.players[state.activePlayer].name }), undefined, 'system')
  // mão inicial de 7 (o mulligan é manual)
  for (const pl of state.players) {
    for (let i = 0; i < 7 && pl.zones[dz].length; i++) pl.zones.hand.push(pl.zones[dz].shift()!)
  }
  log(state, t('Cada jogador comprou 7 cartas.'), undefined, 'system')
  log(state, t('— Turno {n} · {name} —', { n: 1, name: state.players[state.activePlayer].name }), state.activePlayer, 'turn')
  if (state.game === 'mtg') {
    // mão inicial: todos decidem ao mesmo tempo (manter ou mulligan); a partida começa quando todos mantiverem
    state.step = 'mulligan'
    state.freeMulligan = Boolean(setup.freeMulligan)
    for (const pl of state.players) {
      pl.mulligans = 0
      pl.kept = pl.zones.hand.length === 0
    }
    log(state, t('Mãos iniciais: cada jogador decide se mantém ou faz mulligan.'), undefined, 'system')
    finishMulligans(state)
  }
  return state
}

/** Quantas cartas o jogador põe no fundo ao manter (1 por mulligan; o primeiro é grátis no Commander). */
export function mulliganBottomCount(state: SState, p: number): number {
  const n = state.players[p]?.mulligans ?? 0
  return Math.max(0, n - (state.freeMulligan ? 1 : 0))
}

/** Magic: quando todos mantiveram, a partida começa (quem começa não compra no primeiro turno). */
function finishMulligans(state: SState): void {
  if (state.step !== 'mulligan' || !state.players.every((pl) => pl.kept || pl.conceded)) return
  state.step = 'main1'
  log(state, t('Todos mantiveram a mão. A partida começa.'), undefined, 'system')
  log(state, t('{name} começou a partida e não compra no primeiro turno.', { name: state.players[state.activePlayer].name }), state.activePlayer, 'system')
}

/** Magic: começo do turno automático — desvira as permanentes do jogador ativo e compra 1 carta. */
function beginMtgTurn(state: SState): void {
  const p = state.activePlayer
  const pl = state.players[p]
  state.step = 'untap'
  let untapped = 0
  for (const id of pl.zones.battlefield ?? []) {
    const o = state.objects[id]
    if (o.tapped) {
      o.tapped = false
      untapped++
    }
  }
  log(state, untapped ? t('Desvirar: {name} desvira {n} permanente(s).', { name: pl.name, n: untapped }) : t('Desvirar: nada para desvirar.'), p, 'system')
  state.step = 'upkeep'
  state.step = 'draw'
  if (pl.zones.library.length) {
    pl.zones.hand.push(pl.zones.library.shift()!)
    log(state, t('Compra: {name} compra 1 carta.', { name: pl.name }), p, 'system')
  } else log(state, t('Compra: {name} não tem cartas no grimório para comprar (perde o jogo, pelas regras).', { name: pl.name }), p, 'system')
  state.step = 'main1'
  log(state, t('Fase principal 1.'), p, 'system')
}

/** Passa o turno do jogador `p`: limpa marcações, Verificação Pokémon, próximo jogador e o começo automático do turno dele. */
function passTurnFrom(state: SState, p: number): void {
  const pl = state.players[p]
  pl.pool = {}
  for (const o of Object.values(state.objects)) {
    o.attacking = false
    o.blocking = undefined
    o.attackTapped = false
  }
  const alive = state.players.filter((x) => !x.conceded)
  if (!alive.length) return
  let next = state.activePlayer
  do next = (next + 1) % state.players.length
  while (state.players[next].conceded)
  state.activePlayer = next
  state.turn++
  const np = state.players[next]
  np.landsThisTurn = 0
  np.energyThisTurn = 0
  np.supporterThisTurn = 0
  np.retreatedThisTurn = 0
  np.abilitiesThisTurn = []
  log(state, t('{player} passa o turno.', { player: pl.name }), p)
  if (state.game === 'pokemon') pokemonCheckup(state, p)
  log(state, t('— Turno {n} · {name} —', { n: state.turn, name: np.name }), next, 'turn')
  for (const x of state.players) x.pool = {}
  if (state.game === 'mtg') beginMtgTurn(state)
  else beginPokemonTurn(state)
}

/** Pokémon: compra obrigatória do início do turno (sem cartas no deck, o jogador perde). */
function beginPokemonTurn(state: SState): void {
  const p = state.activePlayer
  const pl = state.players[p]
  if (pl.zones.deck.length) {
    pl.zones.hand.push(pl.zones.deck.shift()!)
    log(state, t('Compra: {name} compra 1 carta.', { name: pl.name }), p, 'system')
  } else if (state.firstDrawDone) {
    log(state, t('{name} não tem cartas no deck para comprar no início do turno e perde a partida.', { name: pl.name }), p, 'system')
    declareWinner(state, state.players.find((x) => x.id !== p && !x.conceded)?.id ?? null)
  }
}

/** Pokémon nocauteado (dano ≥ PS): avisa no histórico quantos Prêmios o oponente pega. */
function koWarning(state: SState, id: string): void {
  const o = state.objects[id]
  if (!o || !isPkmCard(o.card) || !o.card.hp || (o.damage ?? 0) < o.card.hp) return
  const where = locate(state, id)?.zone
  if (where !== 'active' && where !== 'bench') return
  const n = prizeValue(o.card)
  log(state, t('💥 {name} foi Nocauteado! Mova-o para o descarte; o oponente pega {n} Prêmio(s).', { name: cardName(o.card), n }), o.owner, 'system')
}

function declareWinner(state: SState, winner: number | null): void {
  if (winner === null || state.winner !== null) return
  state.winner = winner
  log(state, t('🏆 {name} venceu a partida.', { name: state.players[winner].name }), winner, 'system')
}

/** Pokémon: vitória por pegar o último Prêmio ou pelo oponente ficar sem Pokémon em jogo (depois da preparação). */
function checkPokemonWin(state: SState): void {
  if (state.winner !== null || !state.firstDrawDone) return
  for (const pl of state.players) {
    if (pl.conceded) continue
    if (pl.zones.prizes.length === 0) {
      log(state, t('{name} pegou todas as cartas de Prêmio!', { name: pl.name }), pl.id, 'system')
      declareWinner(state, pl.id)
      return
    }
  }
  for (const pl of state.players) {
    if (pl.conceded) continue
    if (!pl.zones.active.length && !pl.zones.bench.length) {
      log(state, t('{name} não tem mais Pokémon em jogo.', { name: pl.name }), pl.id, 'system')
      declareWinner(state, state.players.find((x) => x.id !== pl.id && !x.conceded)?.id ?? null)
      return
    }
  }
}

/** Pokémon: no turno 1, quem começa compra assim que todos terminam a preparação (Ativo e Prêmios). */
function maybeFirstPokemonDraw(state: SState): void {
  if (state.firstDrawDone || state.turn !== 1) return
  const playing = state.players.filter((pl) => pl.zones.deck.length + pl.zones.hand.length + pl.zones.active.length > 0)
  if (!playing.length || !playing.every((pl) => pl.zones.active.length > 0 && pl.zones.prizes.length > 0)) return
  state.firstDrawDone = true
  log(state, t('Preparação concluída.'), undefined, 'system')
  beginPokemonTurn(state)
}

/**
 * Verificação Pokémon (entre os turnos), obrigatória: Envenenado +10, Queimado +20 e moeda (cara cura),
 * Adormecido joga moeda (cara acorda), Paralisado sai depois do turno do dono. Nocautes ficam com os jogadores.
 */
function pokemonCheckup(state: SState, endedTurnOf: number): void {
  const lines: [string, number][] = []
  for (const pl of state.players) {
    const id = pl.zones.active?.[0]
    if (!id) continue
    const o = state.objects[id]
    const name = cardName(o.card)
    const conds = o.conditions ?? []
    if (conds.includes('poisoned')) {
      o.damage = (o.damage ?? 0) + 10
      lines.push([t('{name} está Envenenado: +10 de dano (total {total}).', { name, total: o.damage }), pl.id])
    }
    if (conds.includes('burned')) {
      o.damage = (o.damage ?? 0) + 20
      const heads = rand(state) < 0.5
      lines.push([t('{name} está Queimado: +20 de dano (total {total}). Moeda: {r}{cure}.', { name, total: o.damage, r: heads ? t('cara') : t('coroa'), cure: heads ? t(' — não está mais Queimado') : '' }), pl.id])
      if (heads) o.conditions = (o.conditions ?? []).filter((c) => c !== 'burned')
    }
    if (conds.includes('asleep')) {
      const heads = rand(state) < 0.5
      lines.push([t('{name} está Adormecido. Moeda: {r}{wake}.', { name, r: heads ? t('cara') : t('coroa'), wake: heads ? t(' — acordou') : '' }), pl.id])
      if (heads) o.conditions = (o.conditions ?? []).filter((c) => c !== 'asleep')
    }
    if (conds.includes('paralyzed') && pl.id === endedTurnOf && (o.paralyzedOn ?? 0) < state.turn - 1) {
      o.conditions = (o.conditions ?? []).filter((c) => c !== 'paralyzed')
      lines.push([t('{name} não está mais Paralisado.', { name }), pl.id])
    }
    const hp = 'hp' in o.card ? (o.card.hp ?? 0) : 0
    if (hp && (o.damage ?? 0) >= hp && lines.some(([, who]) => who === pl.id)) lines.push([t('{name} tem dano igual ou maior que os PS: Nocauteado (mova para o descarte e pegue os Prêmios).', { name }), pl.id])
  }
  if (lines.length) {
    log(state, t('Verificação Pokémon:'), undefined, 'system')
    for (const [text, who] of lines) log(state, text, who, 'system')
  }
}

const STEP_INDEX = Object.fromEntries(STEP_ORDER.map((s, i) => [s, i])) as Record<string, number>


// ---------------- ações ----------------

export function performSandbox(input: SState, p: number, action: SAction): SResult {
  const state = structuredClone(input)
  try {
    const err = apply(state, p, action)
    if (err) return { state: input, error: err }
    if (state.game === 'pokemon') {
      maybeFirstPokemonDraw(state)
      checkPokemonWin(state)
    }
    state.seq++
  } catch (e) {
    return { state: input, error: (e as Error).message }
  }
  return { state }
}

function apply(state: SState, p: number, a: SAction): string | null {
  const pl = state.players[p]
  if (!pl) return t('Jogador inválido.')
  const me = pl.name
  const obj = 'id' in a ? state.objects[a.id] : undefined
  if ('id' in a && !obj) return t('Carta inválida.')
  const name = obj ? cardName(obj.card) : ''

  switch (a.t) {
    case 'move': {
      const from = locate(state, a.id)
      if (!from) return t('Carta inválida.')
      const o = obj!
      const fromZone = from.zone
      const wasInPlay = IN_PLAY.has(fromZone) || fromZone === 'attached'
      const goingInPlay = IN_PLAY.has(a.to)
      // Pokémon: o Ativo tem lugar para um Pokémon só (para trocar, use Recuar / Promover)
      if (state.game === 'pokemon' && a.to === 'active' && fromZone !== 'active' && (state.players[o.owner].zones.active?.length ?? 0) > 0)
        return t('O Ativo já tem um Pokémon. Para trocar, use "Recuar / trocar com" ou "Promover ao Ativo".')
      // Pokémon: só um Estádio em jogo — o anterior vai para o descarte do dono
      if (state.game === 'pokemon' && a.to === 'stadium' && fromZone !== 'stadium') {
        for (const other of state.players) {
          for (const sid of [...(other.zones.stadium ?? [])]) {
            other.zones.stadium.splice(other.zones.stadium.indexOf(sid), 1)
            state.players[state.objects[sid].owner].zones.discard.push(sid)
            log(state, t('{name} sai de jogo (só pode haver um Estádio) e vai para o descarte.', { name: objName(state, sid) }), p)
          }
        }
      }
      // ao sair de jogo, as cartas ligadas e as de evolução embaixo vão junto para o descarte
      if (wasInPlay && !goingInPlay) {
        for (const att of attachmentsOf(state, a.id)) {
          const ao = state.objects[att]
          ao.attachedTo = undefined
          resetObj(ao)
          state.players[ao.owner].zones[discardZone(state)].push(att)
        }
        for (const u of o.under ?? []) state.players[state.objects[u].owner].zones[a.to === 'hand' ? 'hand' : discardZone(state)].push(u)
        o.under = undefined
      }
      // ficha que sai do campo de batalha deixa de existir
      if (o.token && wasInPlay && !goingInPlay) {
        detach(state, a.id)
        delete state.objects[a.id]
        log(state, t('{player}: a ficha {name} sai do campo e deixa de existir.', { player: me, name }), p)
        return null
      }
      // comandante saindo da zona de comando: paga o imposto (2 a mais por vez que já saiu)
      let tax = 0
      if (o.commander && fromZone === 'command' && (goingInPlay || a.cast)) {
        tax = 2 * (o.commanderCasts ?? 0)
        o.commanderCasts = (o.commanderCasts ?? 0) + 1
        if (state.game === 'mtg' && 'manaCost' in o.card) payFromPool(pl, `${o.card.manaCost}${tax ? `{${tax}}` : ''}`)
      }
      detach(state, a.id)
      if (!goingInPlay || !wasInPlay) resetObj(o)
      o.faceDown = a.faceDown ?? (a.to === 'prizes' ? true : false)
      if (goingInPlay && !wasInPlay) o.enteredTurn = state.turn
      const owner = state.players[o.owner]
      const list = owner.zones[a.to] ?? (owner.zones[a.to] = [])
      if (a.pos === 'top' || (a.pos === undefined && (a.to === 'library' || a.to === 'deck'))) list.unshift(a.id)
      else list.push(a.id)
      // indicadores do turno
      if (state.game === 'mtg' && a.to === 'battlefield' && fromZone === 'hand' && 'typeLine' in o.card && /\bLand\b/.test(o.card.typeLine)) pl.landsThisTurn++
      if (state.game === 'pokemon' && fromZone === 'hand' && 'category' in o.card && o.card.trainerType === 'Supporter') pl.supporterThisTurn++
      if (state.game === 'mtg' && fromZone === 'hand' && (goingInPlay || a.cast) && 'manaCost' in o.card) payFromPool(pl, o.card.manaCost)
      // nome visível só quando a carta passa por uma zona pública (mão, deck e Prêmios são escondidos)
      const HIDDEN = new Set(['hand', 'library', 'deck', 'prizes'])
      const visible = !o.faceDown && (!HIDDEN.has(fromZone) || !HIDDEN.has(a.to))
      const label = visible ? name : t('uma carta')
      const text =
        o.commander && fromZone === 'command' && (goingInPlay || a.cast)
          ? t('{player} conjura o comandante {name} da zona de comando (imposto: +{tax}).', { player: me, name, tax })
          : fromZone === 'hand' && a.cast
          ? t('{player} conjura {name}.', { player: me, name })
          : fromZone === 'hand' && goingInPlay
          ? t('{player} joga {name} ({zone}).', { player: me, name, zone: zoneLabel(a.to) })
          : t('{player} move {name}: {from} → {to}.', { player: me, name: label, from: zoneLabel(fromZone), to: zoneLabel(a.to) })
      log(state, text, p)
      return null
    }
    case 'attach': {
      const target = state.objects[a.target]
      if (!target || a.target === a.id) return t('Carta inválida.')
      const fromZone = locate(state, a.id)?.zone
      detach(state, a.id)
      obj!.attachedTo = a.target
      obj!.faceDown = false
      if (fromZone === 'hand' && 'category' in obj!.card && obj!.card.category === 'Energy') pl.energyThisTurn++
      if (fromZone === 'hand' && state.game === 'mtg' && 'manaCost' in obj!.card) payFromPool(pl, obj!.card.manaCost)
      log(state, t('{player} liga {name} em {target}.', { player: me, name, target: cardName(target.card) }), p)
      return null
    }
    case 'evolve': {
      const target = state.objects[a.target]
      const where = locate(state, a.target)
      if (!target || !where || (where.zone !== 'active' && where.zone !== 'bench')) return t('Escolha um Pokémon em jogo.')
      detach(state, a.id)
      // a evolução assume o lugar do Pokémon; dano, Energias e Ferramenta continuam
      const zone = state.players[where.player].zones[where.zone]
      zone[zone.indexOf(a.target)] = a.id
      const o = obj!
      o.under = [...(target.under ?? []), a.target]
      target.under = undefined
      o.damage = target.damage ?? 0
      o.counters = { ...target.counters }
      o.conditions = []
      o.enteredTurn = state.turn
      o.faceDown = false
      for (const att of attachmentsOf(state, a.target)) state.objects[att].attachedTo = a.id
      resetObj(target)
      log(state, t('{player} evolui {from} para {name}.', { player: me, from: cardName(target.card), name }), p)
      return null
    }
    case 'tap': {
      obj!.tapped = !obj!.tapped
      log(state, obj!.tapped ? t('{player} vira {name}.', { player: me, name }) : t('{player} desvira {name}.', { player: me, name }), p)
      return null
    }
    case 'tapForMana': {
      if (obj!.tapped) return t('{name} já está virada.', { name })
      obj!.tapped = true
      // quanto a carta gera: o informado, ou o da habilidade de mana dela (Sol Ring = {C}{C})
      let mana: string[]
      let cost = 0
      if (Array.isArray(a.mana) && a.mana.length) mana = a.mana.filter((c) => /^[WUBRGC]$/.test(c)).slice(0, 10)
      else if (a.n) mana = Array(Math.max(1, Math.min(10, a.n))).fill(a.color)
      else {
        const opt = bestOptionFor(obj!, a.color)
        mana = opt ? opt.mana : [a.color]
        cost = opt?.cost ?? 0
      }
      if (Array.isArray(a.mana)) cost = manaOptionsOf(obj!).find((x) => x.mana.join('') === mana.join(''))?.cost ?? 0
      // custo de ativação (Signets: {1}) sai da mana gerada antes, se houver
      if (cost) payFromPool(pl, `{${cost}}`)
      for (const c of mana) pl.pool[c] = (pl.pool[c] ?? 0) + 1
      const text = mana.map((c) => `{${c}}`).join('')
      log(state, cost ? t('{player} paga {cost} e vira {name} para gerar {mana}.', { player: me, cost: `{${cost}}`, name, mana: text }) : t('{player} vira {name} para gerar {mana}.', { player: me, name, mana: text }), p)
      return null
    }
    case 'untapAll': {
      for (const id of pl.zones.battlefield ?? []) state.objects[id].tapped = false
      log(state, t('{player} desvira suas permanentes.', { player: me }), p)
      return null
    }
    case 'mana': {
      pl.pool[a.color] = Math.max(0, (pl.pool[a.color] ?? 0) + a.delta)
      log(state, a.delta > 0 ? t('{player} adiciona {mana} à reserva de mana.', { player: me, mana: `{${a.color}}`.repeat(Math.min(10, a.delta)) }) : t('{player} remove {mana} da reserva de mana.', { player: me, mana: `{${a.color}}`.repeat(Math.min(10, -a.delta)) }), p)
      return null
    }
    case 'manaClear':
      pl.pool = {}
      log(state, t('{player} esvazia a reserva de mana.', { player: me }), p)
      return null
    case 'counter': {
      const v = Math.max(0, (obj!.counters[a.key] ?? 0) + a.delta)
      if (v) obj!.counters[a.key] = v
      else delete obj!.counters[a.key]
      log(state, t('{player}: marcadores {key} em {name} agora {n}.', { player: me, key: a.key, name, n: v }), p)
      return null
    }
    case 'damage': {
      obj!.damage = Math.max(0, (obj!.damage ?? 0) + a.delta)
      log(state, a.delta > 0 ? t('{player} coloca {n} de dano em {name} (total {total}).', { player: me, n: a.delta, name, total: obj!.damage }) : t('{player} remove {n} de dano de {name} (total {total}).', { player: me, n: -a.delta, name, total: obj!.damage }), p)
      if (a.delta > 0) koWarning(state, a.id)
      return null
    }
    case 'condition': {
      const list = (obj!.conditions ??= [])
      const i = list.indexOf(a.cond)
      if (a.cond === 'clear') obj!.conditions = []
      else if (i >= 0) list.splice(i, 1)
      else {
        // Adormecido, Confuso e Paralisado se substituem
        if (['asleep', 'confused', 'paralyzed'].includes(a.cond)) obj!.conditions = list.filter((c) => !['asleep', 'confused', 'paralyzed'].includes(c))
        obj!.conditions.push(a.cond)
        if (a.cond === 'paralyzed') obj!.paralyzedOn = state.turn
      }
      const labels: Record<string, string> = { asleep: t('Adormecido'), confused: t('Confuso'), paralyzed: t('Paralisado'), poisoned: t('Envenenado'), burned: t('Queimado') }
      log(state, a.cond === 'clear' ? t('{player} remove as condições de {name}.', { player: me, name }) : i >= 0 ? t('{player}: {name} não está mais {cond}.', { player: me, name, cond: labels[a.cond] ?? a.cond }) : t('{player}: {name} agora está {cond}.', { player: me, name, cond: labels[a.cond] ?? a.cond }), p)
      return null
    }
    case 'poison': {
      const target = state.players[a.player]
      if (!target) return t('Jogador inválido.')
      target.poison = Math.max(0, (target.poison ?? 0) + a.delta)
      log(state, t('{player}: veneno de {target} agora {n}.', { player: me, target: target.name, n: target.poison }), p)
      if (target.poison >= 10) log(state, t('☠ {name} tem 10 ou mais marcadores de veneno e perde o jogo (pelas regras).', { name: target.name }), a.player, 'system')
      return null
    }
    case 'commanderDamage': {
      const target = state.players[a.player]
      const src = state.objects[a.source]
      if (!target || !src) return t('Jogador inválido.')
      const map = (target.commanderDamage ??= {})
      map[a.source] = Math.max(0, (map[a.source] ?? 0) + a.delta)
      // dano de comandante também é perda de vida normal
      target.life -= a.delta
      log(state, t('{player}: {source} causa {n} de dano de comandante em {target} (total {total}; vida {life}).', { player: me, source: cardName(src.card), n: a.delta, target: target.name, total: map[a.source], life: target.life }), p)
      if (map[a.source] >= 21) log(state, t('⚔ {name} recebeu 21 ou mais de dano do mesmo comandante e perde o jogo (pelas regras).', { name: target.name }), a.player, 'system')
      return null
    }
    case 'token': {
      if (state.game !== 'mtg') return t('Só no Magic.')
      const n = Math.max(1, Math.min(20, Math.floor(a.count ?? 1)))
      const base = a.copyOf ? state.objects[a.copyOf] : undefined
      let card: GameCard
      if (base && isMtgCard(base.card)) card = { ...base.card, token: true }
      else {
        const nm = String(a.name ?? '').trim().slice(0, 60) || t('Ficha')
        const types = String(a.types ?? '').trim().slice(0, 60) || 'Creature'
        card = {
          oracleId: `token:${nm}`,
          name: nm,
          displayName: nm,
          manaCost: '',
          cmc: 0,
          typeLine: `Token ${types}`,
          displayType: `${t('Ficha')} ${types}`,
          oracleText: String(a.text ?? '').slice(0, 300),
          displayText: String(a.text ?? '').slice(0, 300),
          power: a.power,
          toughness: a.toughness,
          colors: (a.colors ?? []).filter((c) => /^[WUBRG]$/.test(c)),
          colorIdentity: [],
          keywords: [],
          layout: 'token',
          token: true
        }
      }
      for (let i = 0; i < n; i++) {
        const id = `s${state.nextId++}`
        state.objects[id] = { id, owner: p, card, printingId: base?.printingId, counters: {}, token: true, enteredTurn: state.turn }
        pl.zones.battlefield.push(id)
      }
      const desc = base ? t('cópia de {name}', { name: cardName(base.card) }) : `${card.name}${card.power ? ` ${card.power}/${card.toughness}` : ''}`
      log(state, n === 1 ? t('{player} cria uma ficha: {desc}.', { player: me, desc }) : t('{player} cria {n} fichas: {desc}.', { player: me, n, desc }), p)
      return null
    }
    case 'lookTop': {
      const n = Math.max(1, Math.min(20, Math.floor(a.n)))
      log(state, t('{player} olha as {n} cartas do topo do grimório.', { player: me, n: Math.min(n, (pl.zones.library ?? pl.zones.deck ?? []).length) }), p)
      return null
    }
    case 'life': {
      const target = state.players[a.player]
      if (!target) return t('Jogador inválido.')
      target.life += a.delta
      log(state, t('{player}: vida de {target} {delta} (agora {life}).', { player: me, target: target.name, delta: `${a.delta > 0 ? '+' : ''}${a.delta}`, life: target.life }), p)
      return null
    }
    case 'draw': {
      const dz = deckZone(state)
      let n = 0
      for (let i = 0; i < Math.max(1, Math.min(20, a.n)) && pl.zones[dz].length; i++) {
        pl.zones.hand.push(pl.zones[dz].shift()!)
        n++
      }
      log(state, n === 1 ? t('{player} compra 1 carta.', { player: me }) : t('{player} compra {n} cartas.', { player: me, n }), p)
      if (!n) log(state, t('{player} tentou comprar, mas o deck está vazio.', { player: me }), p)
      return null
    }
    case 'shuffle': {
      const list = pl.zones[a.zone]
      if (!list) return t('Zona inválida.')
      shuffle(state, list)
      log(state, t('{player} embaralha: {zone}.', { player: me, zone: zoneLabel(a.zone) }), p)
      return null
    }
    case 'mulligan': {
      const dz = deckZone(state)
      pl.zones[dz].push(...pl.zones.hand)
      pl.zones.hand = []
      shuffle(state, pl.zones[dz])
      for (let i = 0; i < 7 && pl.zones[dz].length; i++) pl.zones.hand.push(pl.zones[dz].shift()!)
      if (state.game === 'mtg' && state.step === 'mulligan') {
        pl.mulligans = (pl.mulligans ?? 0) + 1
        pl.kept = false
        log(state, t('{player} faz mulligan ({n}): embaralha a mão no grimório e compra 7.', { player: me, n: pl.mulligans }), p)
      } else log(state, t('{player} faz mulligan: embaralha a mão no deck e compra 7.', { player: me }), p)
      return null
    }
    case 'keep': {
      if (state.game !== 'mtg' || state.step !== 'mulligan') return t('Não é hora de manter a mão.')
      if (pl.kept) return t('Você já manteve a mão.')
      const need = mulliganBottomCount(state, p)
      const ids = [...new Set(a.bottom ?? [])]
      if (ids.length !== Math.min(need, pl.zones.hand.length) || !ids.every((id) => pl.zones.hand.includes(id))) return t('Escolha exatamente {n} carta(s) da mão para o fundo do grimório.', { n: need })
      for (const id of ids) {
        pl.zones.hand.splice(pl.zones.hand.indexOf(id), 1)
        pl.zones.library.push(id)
      }
      pl.kept = true
      log(state, (pl.mulligans ?? 0) ? t('{player} mantém a mão após {n} mulligan(s) e põe {b} carta(s) no fundo do grimório.', { player: me, n: pl.mulligans ?? 0, b: ids.length }) : t('{player} mantém a mão.', { player: me }), p)
      finishMulligans(state)
      return null
    }
    case 'setupPrizes': {
      if (state.game !== 'pokemon') return t('Só no Pokémon.')
      const cards = pl.zones.deck.splice(0, 6)
      for (const id of cards) state.objects[id].faceDown = true
      pl.zones.prizes.push(...cards)
      log(state, t('{player} separa {n} cartas de Prêmio.', { player: me, n: cards.length }), p)
      return null
    }
    case 'takePrize': {
      const i = pl.zones.prizes?.indexOf(a.id) ?? -1
      if (i < 0) return t('Escolha uma das suas cartas de Prêmio.')
      pl.zones.prizes.splice(i, 1)
      obj!.faceDown = false
      pl.zones.hand.push(a.id)
      log(state, t('{player} pega uma carta de Prêmio ({left} restantes).', { player: me, left: pl.zones.prizes.length }), p)
      return null
    }
    case 'flip': {
      if (isMtgCard(obj!.card) && obj!.card.faces && obj!.card.faces.length > 1 && !obj!.faceDown) {
        obj!.face = obj!.face ? 0 : 1
        log(state, t('{player} transforma {name}.', { player: me, name: cardName(obj!.card) }), p)
      } else {
        obj!.faceDown = !obj!.faceDown
        log(state, obj!.faceDown ? t('{player} vira {name} para baixo.', { player: me, name }) : t('{player} revela {name}.', { player: me, name }), p)
      }
      return null
    }
    case 'attack': {
      const o = obj!
      if (state.game === 'mtg') {
        o.attacking = !o.attacking
        o.attackTarget = o.attacking ? a.attackTarget : undefined
        const vigilance = isMtgCard(o.card) && o.card.keywords?.some((k) => k.toLowerCase() === 'vigilance')
        if (o.attacking) {
          // atacar vira a criatura (menos com Vigilância); guarda isso para desfazer se ela sair do ataque
          o.attackTapped = !o.tapped && !vigilance
          if (!vigilance) o.tapped = true
        } else if (o.attackTapped) {
          o.tapped = false
          o.attackTapped = false
        }
        const tgt = typeof a.attackTarget === 'number' ? state.players[a.attackTarget]?.name : typeof a.attackTarget === 'string' ? objName(state, a.attackTarget) : null
        log(state, o.attacking ? (tgt ? t('{player} ataca {target} com {name}.', { player: me, target: tgt, name }) : t('{player} declara {name} como atacante.', { player: me, name })) : t('{player} retira {name} do ataque.', { player: me, name }), p)
      } else {
        const atk = isPkmCard(o.card) ? o.card.attacks[a.index ?? 0] : undefined
        if (!atk) return t('Ataque inválido.')
        o.attacking = true
        log(state, t('{player}: {name} usa {attack}{dmg}.', { player: me, name, attack: atk.localName ?? atk.name, dmg: atk.damage ? ` (${atk.damage})` : '' }), p)
        const target = a.target ? state.objects[a.target] : undefined
        if (target && typeof a.damage === 'number' && a.damage > 0) {
          target.damage = (target.damage ?? 0) + Math.floor(a.damage)
          log(state, t('{name} causa {n} de dano em {target} (total {total}).', { name, n: Math.floor(a.damage), target: cardName(target.card), total: target.damage }), p)
          koWarning(state, target.id)
        }
        // atacar encerra o turno (depois de aplicar o dano)
        if (a.endTurn) {
          checkPokemonWin(state)
          if (state.winner === null) passTurnFrom(state, p)
        }
      }
      return null
    }
    case 'ability': {
      const ab = isPkmCard(obj!.card) ? obj!.card.abilities[a.index] : undefined
      if (!ab) return t('Habilidade inválida.')
      const key = `${a.id}:${a.index}`
      const used = (pl.abilitiesThisTurn ??= [])
      const times = used.filter((k) => k === key).length
      used.push(key)
      log(state, t('{player} usa a Habilidade {ability} de {name}{again}: "{text}" (faça o efeito à mão).', { player: me, ability: ab.localName ?? ab.name, name, again: times ? t(' (de novo neste turno)') : '', text: ab.localEffect ?? ab.effect }), p)
      return null
    }
    case 'block': {
      obj!.blocking = a.attacker ?? undefined
      log(state, a.attacker ? t('{player} bloqueia {attacker} com {name}.', { player: me, attacker: objName(state, a.attacker), name }) : t('{player} retira o bloqueio de {name}.', { player: me, name }), p)
      return null
    }
    case 'switchActive': {
      const bench = pl.zones.bench
      const i = bench?.indexOf(a.id) ?? -1
      if (i < 0) return t('Escolha um Pokémon do seu Banco.')
      const old = pl.zones.active[0]
      if (a.retreat && old) {
        // recuar: descarta as Energias do custo e marca o recuo do turno
        for (const e of a.discard ?? []) {
          if (state.objects[e]?.attachedTo !== old) continue
          state.objects[e].attachedTo = undefined
          state.players[state.objects[e].owner].zones.discard.push(e)
        }
        pl.retreatedThisTurn = (pl.retreatedThisTurn ?? 0) + 1
        log(state, t('{player} recua {old} descartando {n} Energia(s).', { player: me, old: objName(state, old), n: (a.discard ?? []).length }), p)
      }
      bench.splice(i, 1)
      pl.zones.active = [a.id]
      if (old) {
        // Pokémon que vai para o Banco perde as condições especiais
        state.objects[old].conditions = []
        bench.push(old)
      }
      log(state, old ? t('{player} troca {old} por {name} no Ativo.', { player: me, old: objName(state, old), name }) : t('{player} coloca {name} no Ativo.', { player: me, name }), p)
      return null
    }
    case 'coin': {
      const heads = rand(state) < 0.5
      log(state, t('🪙 {player} joga uma moeda: {r}.', { player: me, r: heads ? t('cara') : t('coroa') }), p, 'coin')
      return null
    }
    case 'dice': {
      const sides = Math.max(2, Math.min(100, Math.floor(a.sides)))
      const r = 1 + Math.floor(rand(state) * sides)
      log(state, t('🎲 {player} rola um d{sides}: {r}.', { player: me, sides, r }), p, 'coin')
      return null
    }
    case 'passTurn': {
      passTurnFrom(state, p)
      return null
    }
    case 'step': {
      if (state.game !== 'mtg') return t('Só no Magic.')
      if (!(a.to in STEP_INDEX)) return t('Etapa inválida.')
      const from = state.step ?? 'main1'
      if (STEP_INDEX[a.to] <= STEP_INDEX[from]) return t('Só dá para avançar para uma etapa seguinte (ou passe o turno).')
      // a mana não usada some ao fim de cada etapa e fase
      for (const x of state.players) x.pool = {}
      // o combate acabou: as marcações de ataque e bloqueio saem
      if (STEP_INDEX[a.to] > STEP_INDEX.endCombat) {
        for (const o of Object.values(state.objects)) {
          o.attacking = false
          o.blocking = undefined
        }
      }
      state.step = a.to
      log(state, t('{player} vai para: {step}.', { player: me, step: t(STEP_LABEL[a.to]) }), p)
      return null
    }
    case 'note': {
      const text = String(a.text ?? '').trim().slice(0, 300)
      if (!text) return t('Mensagem vazia.')
      log(state, `${me}: ${text}`, p, 'chat')
      return null
    }
    case 'concede': {
      pl.conceded = true
      log(state, t('{player} concede a partida.', { player: me }), p)
      const alive = state.players.filter((x) => !x.conceded)
      if (alive.length === 1) {
        state.winner = alive[0].id
        log(state, t('🏆 {name} venceu a partida.', { name: alive[0].name }), alive[0].id, 'system')
      } else if (alive.length > 1) {
        // multijogador: quem sai leva as próprias cartas da mesa (regra 800.4a) e, se era a vez dele, o turno passa
        if (state.game === 'mtg') removeFromTable(state, p)
        if (state.activePlayer === p) passTurnFrom(state, p)
      }
      return null
    }
  }
  return t('Ação desconhecida.')
}

/** Magic multijogador: as permanentes de quem saiu do jogo deixam a mesa (vão para o exílio dele; fichas somem). */
function removeFromTable(state: SState, p: number): void {
  const pl = state.players[p]
  const gone = new Set(pl.zones.battlefield)
  for (const o of Object.values(state.objects)) if (o.owner === p && o.attachedTo) gone.add(o.id)
  for (const id of gone) {
    const o = state.objects[id]
    for (const att of attachmentsOf(state, id)) {
      const ao = state.objects[att]
      if (ao.owner === p) continue
      ao.attachedTo = undefined
      resetObj(ao)
      state.players[ao.owner].zones.graveyard.push(att)
    }
    detach(state, id)
    resetObj(o)
    if (o.token) delete state.objects[id]
    else pl.zones.exile.push(id)
  }
  for (const o of Object.values(state.objects)) if (o.attackTarget === p) o.attackTarget = undefined
  for (const ob of Object.values(state.objects)) if (typeof ob.attackTarget === 'string' && !state.objects[ob.attackTarget]) ob.attackTarget = undefined
  pl.pool = {}
  if (gone.size) log(state, t('{player} saiu do jogo: {n} permanente(s) deixaram a mesa.', { player: pl.name, n: gone.size }), p, 'system')
}

/** Desconta o custo da reserva de mana (só se der para pagar; é um indicador, não uma regra). */
function payFromPool(pl: SPlayer, cost: string): void {
  const plan = poolPayment(pl.pool, cost)
  if (plan) pl.pool = plan
}

/** Reserva que sobra depois de pagar `cost` com a mana gerada (null se não der). */
export function poolPayment(pool: Record<string, number>, cost: string): Record<string, number> | null {
  const left = { ...pool }
  const syms = cost.match(/\{[^}]+\}/g) ?? []
  let generic = 0
  const take = (opts: string[]): boolean => {
    for (const c of opts) {
      if ((left[c] ?? 0) > 0) {
        left[c]--
        return true
      }
    }
    return false
  }
  for (const raw of syms) {
    const s = raw.slice(1, -1).toUpperCase()
    if (/^\d+$/.test(s)) generic += parseInt(s, 10)
    else if (s === 'X') continue
    else if (/^[WUBRGC]$/.test(s)) {
      if (!take([s])) return null
    } else if (/^[WUBRG]\/[WUBRG]$/.test(s)) {
      if (!take([s[0], s[2]])) return null
    } else if (/^[WUBRG]\/P$/.test(s)) {
      if (!take([s[0]])) generic += 0 // pode pagar com vida
    } else if (/^2\/[WUBRG]$/.test(s)) {
      if (!take([s[2]])) generic += 2
    }
  }
  let total = Object.values(left).reduce((a, b) => a + b, 0)
  if (total < generic) return null
  for (const c of ['C', 'W', 'U', 'B', 'R', 'G']) {
    while (generic > 0 && (left[c] ?? 0) > 0) {
      left[c]--
      generic--
      total--
    }
  }
  for (const k of Object.keys(left)) if (!left[k]) delete left[k]
  return left
}
