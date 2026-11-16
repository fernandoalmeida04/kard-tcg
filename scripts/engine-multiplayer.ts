// Testes do motor com 3 e 4 jogadores (todos contra todos): cenários dirigidos + partidas com uma política simples
// + teste de determinismo (mesma semente + mesma sequência de ações => mesmo estado final).
// Uso: node --experimental-strip-types --no-warnings scripts/engine-multiplayer.ts [partidas por formato]
import {
  createGame,
  performAction,
  botFallback,
  actingPlayer,
  attackersAgainst,
  canAttack,
  canBlock,
  castInfo,
  checkPlayLand,
  isAlive,
  livingPlayers,
  nextPlayer,
  opponents,
  playableCardIds,
  potentialAttackers,
  power,
  targetCandidates,
  isCreature,
  parseCard,
  isFullySupported
} from '../src/shared/engine/index.ts'
import type { Action, GameCard, GameState, PlayerId, TargetChoice } from '../src/shared/engine/index.ts'

// ---------------- Cartas ----------------

function card(name: string, manaCost: string, typeLine: string, oracleText: string, pt?: [number, number], keywords: string[] = [], colors: string[] = []): GameCard {
  const cmc = (manaCost.match(/\{(\d+)\}/g) ?? []).reduce((s, x) => s + parseInt(x.slice(1, -1)), 0) + (manaCost.match(/\{[WUBRG]\}/g) ?? []).length
  return {
    oracleId: name, name, displayName: name, manaCost, cmc, typeLine, displayType: typeLine, oracleText, displayText: oracleText,
    power: pt ? String(pt[0]) : undefined, toughness: pt ? String(pt[1]) : undefined, colors, colorIdentity: colors, keywords, layout: 'normal'
  }
}

const Mountain = card('Mountain', '', 'Basic Land — Mountain', '({T}: Add {R}.)')
const Forest = card('Forest', '', 'Basic Land — Forest', '({T}: Add {G}.)')
const Bears = card('Grizzly Bears', '{1}{G}', 'Creature — Bear', '', [2, 2], [], ['G'])
const HillGiant = card('Hill Giant', '{3}{R}', 'Creature — Giant', '', [3, 3], [], ['R'])
const GoblinGuide = card('Goblin Guide', '{R}', 'Creature — Goblin Scout', 'Haste', [2, 2], ['Haste'], ['R'])
const CrawWurm = card('Craw Wurm', '{4}{G}{G}', 'Creature — Wurm', '', [6, 4], [], ['G'])
const Raider = card('Raider', '{1}{R}', 'Creature — Goblin', 'Whenever Raider attacks, defending player loses 1 life.', [2, 1], [], ['R'])
const Spitter = card('Spitter', '{2}{R}', 'Creature — Goblin', 'Whenever Spitter deals combat damage to a player, that player discards a card.', [2, 2], [], ['R'])
const Bolt = card('Lightning Bolt', '{R}', 'Instant', 'Lightning Bolt deals 3 damage to any target.', undefined, [], ['R'])
const Shock = card('Shock', '{R}', 'Instant', 'Shock deals 2 damage to any target.', undefined, [], ['R'])
const LavaAxe = card('Lava Axe', '{4}{R}', 'Sorcery', 'Lava Axe deals 5 damage to target player.', undefined, [], ['R'])
const Torch = card('Torch Song', '{1}{R}', 'Sorcery', 'Torch Song deals 1 damage to each opponent.', undefined, [], ['R'])
const Drain = card('Life Drain', '{2}{R}', 'Sorcery', 'Each opponent loses 2 life and you gain 2 life.', undefined, [], ['R'])
const Commander = card('Kard Titan', '{2}{R}{G}', 'Legendary Creature — Giant', '', [5, 5], [], ['R', 'G'])

const spells = [Bears, HillGiant, GoblinGuide, CrawWurm, Raider, Spitter, Bolt, Shock, LavaAxe, Torch, Drain]
let partial = 0
for (const c of [...spells, Commander]) {
  const p = parseCard({ name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, keywords: c.keywords })
  if (!isFullySupported(p)) {
    partial++
    console.log(`  [parcial] ${c.name}`)
  }
}

function deck(): GameCard[] {
  const d: GameCard[] = []
  for (let i = 0; i < 12; i++) d.push(Mountain, Forest)
  let i = 0
  while (d.length < 59) d.push(spells[i++ % spells.length])
  return d
}

function setup(n: number, seed: number, firstPlayer?: PlayerId) {
  return {
    format: 'commander',
    startingLife: 20,
    seed,
    aiEnabled: false,
    firstPlayer,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true, deck: deck(), commanders: [Commander] }))
  }
}

// ---------------- Asserções ----------------

let failures = 0
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++
    if (failures <= 40) console.log(`  FALHA: ${msg}`)
  }
}

function act(state: GameState, p: PlayerId, a: Action, ctx: string): GameState {
  const r = performAction(state, p, a)
  if (r.error) throw new Error(`${ctx}: ação recusada (${a.t}) por P${p}: ${r.error}`)
  return r.state
}

function owned(state: GameState, p: PlayerId): number {
  return Object.values(state.objects).filter((o) => o.owner === p).length
}

/** Resolve mulligans (todos mantêm) e avança até a etapa/condição pedida passando a prioridade. */
function keepAll(state: GameState): GameState {
  while (state.step === 'mulligan') state = act(state, actingPlayer(state)!, { t: 'keep' }, 'mulligan')
  return state
}

function passUntil(state: GameState, cond: (s: GameState) => boolean, ctx: string, max = 500): GameState {
  for (let i = 0; i < max && !cond(state); i++) {
    const p = actingPlayer(state)
    if (p === null) throw new Error(`${ctx}: ninguém pode agir`)
    const a: Action = state.choices.length || state.awaiting ? botFallback(state, p) : { t: 'pass' }
    state = act(state, p, a, ctx)
  }
  if (!cond(state)) throw new Error(`${ctx}: condição não alcançada`)
  return state
}

/** Coloca uma cópia de `c` direto no campo de batalha de `p` (sem enjoo). */
function put(state: GameState, p: PlayerId, c: GameCard): string {
  const id = `t${Object.keys(state.objects).length + 1000}`
  state.objects[id] = {
    id, owner: p, controller: p, zone: 'battlefield', card: c, face: 0, parsed: parseCard({ name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, keywords: c.keywords }),
    tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, mods: [], isCommander: false, isToken: false, timestamp: 9999
  }
  state.battlefield.push(id)
  return id
}

// ---------------- Cenários dirigidos ----------------

function scenarios(): void {
  // 1) ordem de mulligans, ordem de turno e quem compra no turno 1
  {
    let s = createGame(setup(4, 11, 2))
    check(s.choices.map((c) => c.player).join() === '2,3,0,1', `mulligans em ordem de turno a partir do primeiro jogador (${s.choices.map((c) => c.player)})`)
    s = keepAll(s)
    check(s.turn === 1 && s.activePlayer === 2, 'turno 1 é do primeiro jogador')
    check(s.players[2].hand.length === 7, 'primeiro jogador não compra no turno 1')
    const order: number[] = [s.activePlayer]
    for (let k = 0; k < 4; k++) {
      const t = s.turn
      s = passUntil(s, (x) => x.turn > t, 'ordem de turno')
      order.push(s.activePlayer)
    }
    check(order.join() === '2,3,0,1,2', `ordem de turno 2,3,0,1,2 (obtido ${order.join()})`)
    check(s.players[3].hand.length >= 7, 'demais jogadores compram')
  }

  // 2) prioridade: só resolve depois que TODOS os jogadores vivos passam em sequência
  {
    let s = keepAll(createGame(setup(3, 21, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    const bolt = s.players[0].hand.find((id) => s.objects[id].card.name === 'Lightning Bolt') ?? (() => {
      const id = s.players[0].hand[0]
      s.objects[id].card = Bolt
      s.objects[id].parsed = parseCard({ name: Bolt.name, typeLine: Bolt.typeLine, oracleText: Bolt.oracleText, keywords: [] })
      return id
    })()
    put(s, 0, Mountain)
    s = act(s, 0, { t: 'cast', id: bolt, targets: [{ kind: 'player', player: 2 }] }, 'bolt')
    check(s.stack.length === 1 && s.priority === 0, 'mágica na pilha, prioridade com quem conjurou')
    s = act(s, 0, { t: 'pass' }, 'pass0')
    check(s.priority === 1 && s.stack.length === 1, 'prioridade vai para o próximo jogador (P1)')
    s = act(s, 1, { t: 'pass' }, 'pass1')
    check(s.priority === 2 && s.stack.length === 1, 'prioridade vai para P2; ainda não resolveu')
    s = act(s, 2, { t: 'pass' }, 'pass2')
    check(s.stack.length === 0 && s.players[2].life === 17, `resolve após 3 passes: P2 com 17 de vida (${s.players[2].life})`)
    check(s.priority === 0 && s.step === 'main1', 'prioridade volta ao jogador ativo, mesma etapa')
  }

  // 3) combate: cada atacante escolhe o defensor; cada defensor declara bloqueadores na sua vez; dano no jogador certo
  {
    let s = keepAll(createGame(setup(3, 31, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    const a = put(s, 0, HillGiant)
    const b = put(s, 0, Raider)
    const blk1 = put(s, 1, Bears)
    const blk2 = put(s, 2, Bears)
    s = passUntil(s, (x) => x.awaiting?.kind === 'attackers', 'atacantes')
    check(s.awaiting?.player === 0, 'jogador ativo declara atacantes')
    const bad = performAction(s, 0, { t: 'attack', attackers: [{ id: a, target: { kind: 'player', player: 0 } }] })
    check(Boolean(bad.error), 'não pode atacar a si mesmo')
    s = act(s, 0, { t: 'attack', attackers: [{ id: a, target: { kind: 'player', player: 1 } }, { id: b, target: { kind: 'player', player: 2 } }] }, 'attack')
    // gatilho do Raider: "defending player loses 1 life" => P2 (quem ele ataca), não P1
    s = passUntil(s, (x) => x.step === 'declareBlockers' || x.awaiting?.kind === 'blockers', 'até bloqueios')
    check(s.players[2].life === 19 && s.players[1].life === 20, `"defending player" é quem o Raider ataca (P1=${s.players[1].life}, P2=${s.players[2].life})`)
    check(s.awaiting?.kind === 'blockers' && s.awaiting.player === 1, 'P1 (primeiro em ordem de turno) declara bloqueadores primeiro')
    const wrong = performAction(s, 1, { t: 'block', blocks: [{ blocker: blk1, attacker: b }] })
    check(Boolean(wrong.error), 'P1 não pode bloquear um atacante que ataca P2')
    const notTurn = performAction(s, 2, { t: 'block', blocks: [] })
    check(Boolean(notTurn.error), 'P2 espera a vez de declarar')
    s = act(s, 1, { t: 'block', blocks: [] }, 'block P1')
    check(s.awaiting?.kind === 'blockers' && s.awaiting.player === 2, 'depois P2 declara bloqueadores')
    const wrong2 = performAction(s, 2, { t: 'block', blocks: [{ blocker: blk2, attacker: a }] })
    check(Boolean(wrong2.error), 'P2 não pode bloquear um atacante que ataca P1')
    s = act(s, 2, { t: 'block', blocks: [{ blocker: blk2, attacker: b }] }, 'block P2')
    check(s.awaiting === null && s.combat?.blockersDeclared === true, 'bloqueios concluídos')
    s = passUntil(s, (x) => x.step === 'combatDamage', 'dano')
    check(s.players[1].life === 17, `Hill Giant causa 3 a P1 (${s.players[1].life})`)
    check(s.players[2].life === 19, `Raider bloqueado: P2 continua com 19 (${s.players[2].life})`)
  }

  // 4) eliminação: objetos saem do jogo, controle volta ao dono, ordem de turno pula o eliminado
  {
    let s = keepAll(createGame(setup(3, 41, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    const stolen = put(s, 2, CrawWurm)
    s.objects[stolen].controller = 1 // P1 controla uma criatura de P2
    put(s, 1, Bears)
    s.players[1].life = 3
    const bolt = s.players[0].hand[0]
    s.objects[bolt].card = Bolt
    s.objects[bolt].parsed = parseCard({ name: Bolt.name, typeLine: Bolt.typeLine, oracleText: Bolt.oracleText, keywords: [] })
    put(s, 0, Mountain)
    s = act(s, 0, { t: 'cast', id: bolt, targets: [{ kind: 'player', player: 1 }] }, 'bolt')
    s = act(s, 0, { t: 'pass' }, 'p0')
    s = act(s, 1, { t: 'pass' }, 'p1')
    s = act(s, 2, { t: 'pass' }, 'p2')
    check(s.players[1].lost && s.winner === null, 'P1 eliminado, partida continua')
    check(owned(s, 1) === 0, `P1 não possui mais objetos (${owned(s, 1)})`)
    check(s.players[1].hand.length + s.players[1].library.length + s.players[1].graveyard.length + s.players[1].command.length === 0, 'zonas de P1 vazias')
    check(s.objects[stolen]?.controller === 2, 'controle da criatura roubada volta para P2')
    check(livingPlayers(s).join() === '0,2' && opponents(s, 0).join() === '2', 'jogadores vivos: P0 e P2')
    const t = s.turn
    s = passUntil(s, (x) => x.turn > t, 'próximo turno')
    check(s.activePlayer === 2, `turno passa de P0 para P2, pulando P1 (${s.activePlayer})`)
    const r = performAction(s, 1, { t: 'pass' })
    check(Boolean(r.error), 'jogador eliminado não pode agir')
    // passes: agora só 2 jogadores vivos
    check(nextPlayer(s, 2) === 0 && nextPlayer(s, 0) === 2, 'nextPlayer pula o eliminado')
  }

  // 5) concessão de um jogador que não está agindo; concessão do jogador ativo; última concessão encerra
  {
    let s = keepAll(createGame(setup(4, 51, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    s = act(s, 3, { t: 'concede' }, 'concede P3')
    check(s.players[3].lost && s.winner === null && owned(s, 3) === 0, 'P3 concede e é eliminado; partida segue')
    check(s.priority === 0 && s.step === 'main1' && s.activePlayer === 0, 'turno de P0 continua')
    s = act(s, 0, { t: 'concede' }, 'concede P0 (ativo)')
    check(s.players[0].lost && s.winner === null && s.activePlayer === 1 && s.turn === 2, `turno do jogador ativo que concedeu termina; P1 joga (ativo=${s.activePlayer}, turno=${s.turn})`)
    check(owned(s, 0) === 0, 'P0 sem objetos')
    s = act(s, 2, { t: 'concede' }, 'concede P2')
    check(s.winner === 1, `último jogador vivo vence (${s.winner})`)
  }

  // 6) concessão durante os mulligans
  {
    let s = createGame(setup(3, 61, 0))
    s = act(s, 2, { t: 'concede' }, 'concede no mulligan')
    check(s.step === 'mulligan' && s.choices.length === 2, 'mulligan de P2 removido')
    s = keepAll(s)
    check(s.turn === 1 && s.activePlayer === 0, 'partida começa normalmente')
  }

  // 7) dano de comandante: 21 de um mesmo comandante elimina (mesmo com vida sobrando)
  {
    let s = keepAll(createGame(setup(3, 71, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    const cmd = s.players[0].command[0]
    const o = s.objects[cmd]
    s.players[0].command = []
    o.zone = 'battlefield'
    o.sick = false
    s.battlefield.push(cmd)
    s.players[2].commanderDamage[cmd] = 18
    s.players[2].life = 40
    s = passUntil(s, (x) => x.awaiting?.kind === 'attackers', 'atacantes')
    s = act(s, 0, { t: 'attack', attackers: [{ id: cmd, target: { kind: 'player', player: 2 } }] }, 'attack cmd')
    s = passUntil(s, (x) => x.step === 'combatDamage' || x.players[2].lost, 'dano cmd')
    check(s.players[2].lost && s.winner === null, `21+ de dano de comandante elimina P2 (dano=${s.players[2].commanderDamage[cmd] ?? '-'}, vida=${s.players[2].life})`)
  }

  // 8) "each opponent" atinge todos os oponentes vivos
  {
    let s = keepAll(createGame(setup(4, 81, 0)))
    s = passUntil(s, (x) => x.step === 'main1', 'main1')
    s = act(s, 2, { t: 'concede' }, 'concede P2')
    const id = s.players[0].hand[0]
    s.objects[id].card = Torch
    s.objects[id].parsed = parseCard({ name: Torch.name, typeLine: Torch.typeLine, oracleText: Torch.oracleText, keywords: [] })
    put(s, 0, Mountain)
    put(s, 0, Mountain)
    s = act(s, 0, { t: 'cast', id, targets: [] }, 'torch')
    s = passUntil(s, (x) => x.stack.length === 0, 'resolve torch')
    check(s.players[0].life === 20 && s.players[1].life === 19 && s.players[3].life === 19, `cada oponente vivo leva 1 (${s.players.map((p) => p.life)})`)
  }
}

// ---------------- Política simples para partidas completas ----------------

function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296)
}

function chooseTargets(state: GameState, p: PlayerId, specs: ReturnType<typeof castInfo>['block']['targets'], sourceId: string): (TargetChoice | null)[] | null {
  const out: (TargetChoice | null)[] = []
  for (const spec of specs) {
    const cands = targetCandidates(state, p, spec, sourceId)
    const players = cands.filter((c) => c.kind === 'player' && c.player !== p) as { kind: 'player'; player: PlayerId }[]
    const foes = cands.filter((c) => c.kind === 'object' && state.objects[c.id]?.controller !== p)
    let pick: TargetChoice | null = null
    if (players.length) pick = players.sort((a, b) => state.players[a.player].life - state.players[b.player].life)[0]
    else if (foes.length) pick = foes[0]
    if (!pick && !spec.optional) return null
    out.push(pick)
  }
  return out
}

function policy(state: GameState, p: PlayerId, rnd: () => number): Action {
  if (state.choices.length) return botFallback(state, p)
  if (state.awaiting?.kind === 'attackers') {
    const opps = opponents(state, p)
    const atk = potentialAttackers(state, p).filter((o) => canAttack(state, o) && rnd() < 0.75)
    return { t: 'attack', attackers: atk.map((o, i) => ({ id: o.id, target: { kind: 'player' as const, player: opps[(i + state.turn) % opps.length] } })) }
  }
  if (state.awaiting?.kind === 'blockers') {
    const used = new Set<string>()
    const blocks: { blocker: string; attacker: string }[] = []
    const mine = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === p && isCreature(o))
    for (const aid of attackersAgainst(state, p)) {
      const a = state.objects[aid]
      if (!a || rnd() < 0.5) continue
      const b = mine.find((x) => !used.has(x.id) && canBlock(state, x, a) === null)
      if (b) {
        used.add(b.id)
        blocks.push({ blocker: b.id, attacker: aid })
      }
    }
    return { t: 'block', blocks }
  }
  const main = state.activePlayer === p && (state.step === 'main1' || state.step === 'main2') && state.stack.length === 0
  if (main) {
    for (const id of playableCardIds(state, p)) if (!checkPlayLand(state, p, id)) return { t: 'playLand', id }
    for (const id of playableCardIds(state, p)) {
      const info = castInfo(state, p, id)
      if (info.error || info.needsX || info.modes) continue
      const targets = chooseTargets(state, p, info.block.targets, id)
      if (!targets) continue
      return { t: 'cast', id, targets }
    }
  }
  return { t: 'pass' }
}

interface GameResult {
  winner: GameState['winner']
  turns: number
  actions: [PlayerId, Action][]
  final: GameState
  multiTargetCombats: number
}

function playGame(n: number, seed: number, turnCap: number, concedeAt?: number): GameResult {
  let state = createGame(setup(n, seed))
  const rnd = lcg(seed ^ 0x5bd1e995)
  const actions: [PlayerId, Action][] = []
  const gone = new Set<PlayerId>()
  let multiTargetCombats = 0
  let conceded = false
  for (let i = 0; i < 40000 && state.winner === null && state.turn <= turnCap; i++) {
    let p: PlayerId
    let a: Action
    if (state.pendingAI) {
      p = state.pendingAI.item.controller
      a = { t: 'aiSkip', reason: 'teste' }
    } else if (concedeAt !== undefined && !conceded && state.turn === concedeAt) {
      // um jogador que não é o ativo concede no meio do turno
      conceded = true
      p = opponents(state, state.activePlayer)[1] ?? opponents(state, state.activePlayer)[0]
      a = { t: 'concede' }
    } else {
      const q = actingPlayer(state)
      if (q === null) throw new Error(`seed ${seed}: ninguém pode agir (${state.step})`)
      p = q
      a = policy(state, p, rnd)
    }
    const r = performAction(state, p, a)
    if (r.error) throw new Error(`seed ${seed}: ação da política recusada (${a.t}) por P${p} na etapa ${state.step}: ${r.error}`)
    actions.push([p, a])
    const prev = state
    state = r.state

    // eliminados não possuem mais objetos
    for (const pl of state.players) if (pl.lost && (state.winner === null || gone.has(pl.id))) gone.add(pl.id)
    for (const q of gone) check(owned(state, q) === 0, `seed ${seed}: P${q} eliminado ainda possui objetos`)
    // ordem de turno pula eliminados
    if (state.turn > prev.turn && prev.turn > 0 && state.winner === null) {
      check(isAlive(state, state.activePlayer), `seed ${seed}: jogador ativo morto no turno ${state.turn}`)
      check(state.activePlayer === nextPlayer(state, prev.activePlayer), `seed ${seed}: ordem de turno errada (${prev.activePlayer} -> ${state.activePlayer})`)
    }
    // quem declara bloqueadores está vivo e está sendo atacado
    if (state.awaiting?.kind === 'blockers') check(isAlive(state, state.awaiting.player) && attackersAgainst(state, state.awaiting.player).length > 0, `seed ${seed}: defensor inválido`)
    // bloqueios só contra atacantes que atacam o defensor
    if (a.t === 'block' && state.combat) {
      for (const b of a.blocks) {
        const atk = state.combat.attackers.find((x) => x.id === b.attacker)
        check(!atk || atk.defender === p, `seed ${seed}: P${p} bloqueou atacante que ataca P${atk?.defender}`)
      }
    }
    // dano de combate vai para o jogador certo
    if (prev.step === 'declareBlockers' && state.step === 'combatDamage' && state.turn === prev.turn && prev.combat && state.fogTurn !== state.turn) {
      const expected = new Map<PlayerId, number>()
      for (const atk of prev.combat.attackers) {
        const o = prev.objects[atk.id]
        if (!o || o.zone !== 'battlefield' || atk.target.kind !== 'player') continue
        if (prev.combat.blockers.some((b) => b.attacker === atk.id)) continue
        expected.set(atk.target.player, (expected.get(atk.target.player) ?? 0) + Math.max(0, power(prev, o)))
      }
      if ([...expected.values()].filter((v) => v > 0).length >= 2) multiTargetCombats++
      for (let q = 0; q < n; q++) {
        const lostLife = prev.players[q].life - state.players[q].life
        check(lostLife === (expected.get(q) ?? 0), `seed ${seed}: P${q} perdeu ${lostLife} no dano de combate, esperado ${expected.get(q) ?? 0}`)
      }
    }
  }
  return { winner: state.winner, turns: state.turn, actions, final: state, multiTargetCombats }
}

function replay(n: number, seed: number, actions: [PlayerId, Action][]): GameState {
  let state = createGame(setup(n, seed))
  for (const [p, a] of actions) state = act(state, p, a, `replay seed ${seed}`)
  return state
}

/** JSON do estado sem os textos do log (que dependem do idioma). */
function fingerprint(state: GameState): string {
  return JSON.stringify({ ...state, log: state.log.map((l) => ({ ...l, text: '' })) })
}

// ---------------- Execução ----------------

console.log(`Cartas de teste: ${spells.length + 1 - partial}/${spells.length + 1} totalmente suportadas.`)
console.log('Cenários dirigidos...')
try {
  scenarios()
} catch (err) {
  failures++
  console.log(`  ERRO: ${(err as Error).stack?.split('\n').slice(0, 4).join(' | ')}`)
}
console.log(`  falhas até aqui: ${failures}`)

const perFormat = Number(process.argv[2] ?? 15)
let crashes = 0
let unfinished = 0
let multiTotal = 0
const results: GameResult[] = []
for (const n of [3, 4]) {
  for (let g = 0; g < perFormat; g++) {
    const seed = n * 100003 + g * 7919
    try {
      const r = playGame(n, seed, 250, g % 3 === 0 ? 5 : undefined)
      results.push(r)
      multiTotal += r.multiTargetCombats
      if (r.winner === null) unfinished++
      const elim = r.final.players.filter((p) => p.lost).map((p) => `P${p.id}@T${p.eliminatedTurn}`).join(' ')
      console.log(`${n}J partida ${g + 1}: vencedor=${r.winner === null ? 'nenhum (limite)' : r.winner === 'draw' ? 'empate' : `P${r.winner}`}, turno ${r.turns}, ${r.actions.length} ações, eliminados: ${elim}`)
    } catch (err) {
      crashes++
      console.log(`${n}J partida ${g + 1}: ERRO -> ${(err as Error).stack?.split('\n').slice(0, 4).join(' | ')}`)
    }
  }
}
check(unfinished === 0, `${unfinished} partida(s) não terminaram dentro do limite de turnos`)
check(multiTotal > 0, 'nenhum combate causou dano a dois oponentes diferentes')

// Determinismo: mesma semente + mesmas ações => estado idêntico (duas reproduções independentes)
let detFail = 0
for (const r of results.slice(0, 6)) {
  const n = r.final.players.length
  const seed = n * 100003 + (results.indexOf(r) % perFormat) * 7919
  const a = replay(n, seed, r.actions)
  const b = replay(n, seed, r.actions)
  if (fingerprint(a) !== fingerprint(b) || fingerprint(a) !== fingerprint(r.final)) detFail++
}
check(detFail === 0, `${detFail} reprodução(ões) divergiram`)
console.log(`Determinismo: ${Math.min(6, results.length) - detFail}/${Math.min(6, results.length)} reproduções idênticas.`)
console.log(`Combates com dano a 2+ oponentes: ${multiTotal}`)
console.log(`\nFalhas de asserção: ${failures}. Partidas com erro: ${crashes}.`)
if (failures || crashes) process.exitCode = 1
