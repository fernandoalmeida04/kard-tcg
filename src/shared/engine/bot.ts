// Bot simples (heurístico) para jogar contra o usuário. Sempre propõe ações que o motor valida.
// Pensado para 1 contra 1; com mais jogadores ele foca o oponente com menos vida (`mainEnemy`).

import {
  actingPlayer,
  activateInfo,
  attackersAgainst,
  availableManaCount,
  canAttack,
  canBlock,
  canBlockAny,
  castInfo,
  checkPlayLand,
  currentChoice,
  hasKw,
  isCreature,
  isLand,
  landFaceOf,
  opponents,
  playableCardIds,
  potentialAttackers,
  power,
  targetCandidates,
  toughness,
  typeLineOf
} from './game.ts'
import { parseManaCost } from './mana.ts'
import type { Action, EffectBlock, GameObject, GameState, PendingChoice, PlayerId, TargetChoice, TargetSpec } from './types.ts'

export function creatureValue(state: GameState, o: GameObject): number {
  if (!isCreature(o)) return o.card.cmc * 2 + (isLand(o) ? 1 : 3)
  let v = power(state, o) * 1.5 + toughness(state, o) + o.card.cmc
  for (const k of ['flying', 'deathtouch', 'lifelink', 'first strike', 'double strike', 'trample', 'hexproof', 'indestructible', 'vigilance']) {
    if (hasKw(state, o, k)) v += 1.5
  }
  if (o.isCommander) v += 5
  return v
}

/** Oponente "principal": o oponente vivo com menos vida (empate: ordem de turno). Com 2 jogadores, o único oponente. */
function mainEnemy(state: GameState, p: PlayerId): PlayerId {
  const opps = opponents(state, p)
  if (!opps.length) return p
  return opps.reduce((best, q) => (state.players[q].life < state.players[best].life ? q : best), opps[0])
}

function objs(state: GameState, ids: string[]): GameObject[] {
  return ids.map((id) => state.objects[id]).filter(Boolean)
}

// ---------------- Intenção dos alvos ----------------

type Intent = 'harm' | 'help'

function intentFor(block: EffectBlock, index: number): { intent: Intent; damage?: number } {
  for (const e of block.effects) {
    const refs = (r: unknown) => {
      const x = r as { ref?: string; indices?: number[] }
      return x?.ref === 'target' && x.indices?.includes(index)
    }
    switch (e.k) {
      case 'damage':
        if (refs(e.to)) return { intent: 'harm', damage: typeof e.amount === 'number' ? e.amount : undefined }
        if (e.to.ref === 'player' && e.to.who.k === 'target' && e.to.who.index === index) return { intent: 'harm', damage: typeof e.amount === 'number' ? e.amount : undefined }
        break
      case 'destroy':
      case 'exile':
      case 'bounce':
      case 'tap':
        if (refs(e.what)) return { intent: 'harm' }
        break
      case 'untap':
        if (refs(e.what)) return { intent: 'help' }
        break
      case 'pump':
        if (refs(e.what)) return { intent: e.negative || (typeof e.power === 'number' && e.power < 0) || (typeof e.toughness === 'number' && e.toughness < 0) ? 'harm' : 'help' }
        break
      case 'counters':
        if (refs(e.what)) return { intent: e.counter === '+1/+1' ? 'help' : 'harm' }
        break
      case 'counterSpell':
        if (e.index === index) return { intent: 'harm' }
        break
      case 'gainControl':
        if (refs(e.what)) return { intent: 'harm' }
        break
      case 'copyStack':
        if (e.index === index) return { intent: 'help' }
        break
      case 'regenerate':
      case 'grant':
      case 'flicker':
      case 'copyToken':
        if (refs(e.what)) return { intent: 'help' }
        break
      case 'discardChosen':
        if (e.who.k === 'target' && e.who.index === index) return { intent: 'harm' }
        break
      case 'graveyardReturn':
        if (e.index === index) return { intent: 'help' }
        break
      case 'fight':
        if (refs(e.a)) return { intent: 'help' }
        if (refs(e.b)) return { intent: 'harm' }
        break
      case 'draw':
      case 'gainLife':
        if (e.who.k === 'target' && e.who.index === index) return { intent: 'help' }
        break
      case 'discard':
      case 'loseLife':
      case 'mill':
      case 'sacrifice':
        if (e.who.k === 'target' && e.who.index === index) return { intent: 'harm' }
        break
      default:
        break
    }
  }
  return { intent: 'harm' }
}

function pickTarget(state: GameState, p: PlayerId, spec: TargetSpec, block: EffectBlock, index: number, sourceId: string | undefined, used: Set<string>): TargetChoice | null {
  const cands = targetCandidates(state, p, spec, sourceId).filter((c) => !used.has(c.kind === 'player' ? `p${c.player}` : c.id))
  if (!cands.length) return null
  const { intent, damage } = intentFor(block, index)
  const enemy = mainEnemy(state, p)
  const score = (c: TargetChoice): number => {
    if (c.kind === 'player') {
      if (intent === 'harm') return c.player !== p ? (damage && state.players[c.player].life <= damage ? 1000 : c.player === enemy ? 5 : 4) : -100
      return c.player === p ? 10 : -100
    }
    if (c.kind === 'stack') {
      const item = state.stack.find((s) => s.id === c.id)
      if (!item) return -100
      if (intent === 'help') return item.controller === p ? 50 : -100
      return item.controller !== p ? 50 : -100
    }
    const o = state.objects[c.id]
    if (!o) return -100
    const v = creatureValue(state, o)
    const mine = o.controller === p || (o.zone === 'graveyard' && o.owner === p)
    if (intent === 'harm') {
      if (mine) return -50 - v
      if (damage !== undefined && isCreature(o)) {
        const remaining = toughness(state, o) - o.damage
        return remaining <= damage ? 20 + v : -10
      }
      return 10 + v
    }
    return mine ? 10 + v : -50
  }
  const sorted = [...cands].sort((a, b) => score(b) - score(a))
  const best = sorted[0]
  if (score(best) < 0 && spec.optional) return null
  return best
}

function chooseTargets(state: GameState, p: PlayerId, block: EffectBlock, sourceId?: string): (TargetChoice | null)[] | null {
  const used = new Set<string>()
  const out: (TargetChoice | null)[] = []
  for (let i = 0; i < block.targets.length; i++) {
    const t = pickTarget(state, p, block.targets[i], block, i, sourceId, used)
    if (!t && !block.targets[i].optional) return null
    if (t) used.add(t.kind === 'player' ? `p${t.player}` : t.id)
    out.push(t)
  }
  return out
}

/** Os alvos escolhidos fazem sentido (não prejudicam o próprio bot)? */
function targetsWorthIt(state: GameState, p: PlayerId, block: EffectBlock, targets: (TargetChoice | null)[]): boolean {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if (!t) continue
    const { intent, damage } = intentFor(block, i)
    if (t.kind === 'player') {
      if (intent === 'harm' && t.player === p) return false
      if (intent === 'help' && t.player !== p) return false
      continue
    }
    if (t.kind === 'stack') continue
    const o = state.objects[t.id]
    if (!o) continue
    const mine = o.controller === p || (o.zone === 'graveyard' && o.owner === p)
    if (intent === 'harm' && mine) return false
    if (intent === 'help' && !mine) return false
    if (intent === 'harm' && damage !== undefined && isCreature(o) && toughness(state, o) - o.damage > damage) return false
  }
  return true
}

// ---------------- Escolhas ----------------

function botChoice(state: GameState, p: PlayerId, ch: PendingChoice): Action {
  const pl = state.players[p]
  const hand = objs(state, pl.hand)
  const myLands = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === p && isLand(o)).length
  switch (ch.kind) {
    case 'mulligan': {
      const lands = hand.filter((o) => landFaceOf(o) !== null).length
      const size = hand.length
      const ok = pl.mulligans >= 2 || (lands >= 2 && lands <= Math.min(5, size - 2))
      return ok ? { t: 'keep' } : { t: 'mulligan' }
    }
    case 'bottom':
    case 'discard': {
      const lands = hand.filter((o) => landFaceOf(o) !== null)
      const spells = hand.filter((o) => landFaceOf(o) === null).sort((a, b) => b.card.cmc - a.card.cmc)
      const totalLands = myLands + lands.length
      const order = totalLands >= 5 ? [...lands, ...spells] : [...spells, ...lands]
      return { t: 'chooseCards', ids: order.slice(0, ch.count).map((o) => o.id) }
    }
    case 'sacrifice': {
      const sorted = objs(state, ch.candidates).sort((a, b) => creatureValue(state, a) - creatureValue(state, b))
      return { t: 'chooseCards', ids: sorted.slice(0, ch.count).map((o) => o.id) }
    }
    case 'search': {
      const need = neededColors(state, p)
      const score = (o: GameObject) => (isLand(o) ? landScore(o, need) : 10 + o.card.cmc + (isCreature(o) ? 2 : 0))
      const sorted = objs(state, ch.candidates).sort((a, b) => score(b) - score(a))
      return { t: 'chooseCards', ids: sorted.slice(0, ch.count).map((o) => o.id) }
    }
    case 'returnOwn': {
      // devolve o objeto menos valioso (terreno virado de preferência)
      const sorted = objs(state, ch.candidates).sort((a, b) => creatureValue(state, a) - (a.tapped ? 1 : 0) - (creatureValue(state, b) - (b.tapped ? 1 : 0)))
      return { t: 'chooseCards', ids: sorted.slice(0, ch.count).map((o) => o.id) }
    }
    case 'handLand': {
      const need = neededColors(state, p)
      const best = objs(state, ch.candidates).sort((a, b) => landScore(b, need) - landScore(a, need))[0]
      return { t: 'chooseCards', ids: best ? [best.id] : [] }
    }
    case 'dig': {
      const handLands = hand.filter((o) => landFaceOf(o) !== null).length
      const wantLand = myLands + handLands < 4
      const score = (o: GameObject) => (isLand(o) ? (wantLand ? 30 : 1) : 10 + o.card.cmc + (isCreature(o) ? 2 : 0))
      const sorted = objs(state, ch.eligible).sort((a, b) => score(b) - score(a))
      return { t: 'chooseCards', ids: sorted.slice(0, ch.take).map((o) => o.id) }
    }
    case 'mode': {
      const modes = ch.trigger.ability.modes ?? []
      let best = -1
      for (let i = 0; i < modes.length; i++) {
        const m = modes[i]
        const t = chooseTargets(state, p, m, ch.trigger.sourceId)
        if (!t) continue
        if (targetsWorthIt(state, p, m, t)) return { t: 'chooseMode', index: i }
        if (best < 0) best = i
      }
      return { t: 'chooseMode', index: Math.max(0, best) }
    }
    case 'scry': {
      const handLands = hand.filter((o) => landFaceOf(o) !== null).length
      const wantLands = myLands + handLands < 4
      const bottom = objs(state, ch.cards).filter((o) => (isLand(o) ? !wantLands : wantLands && o.card.cmc > 4))
      return { t: 'chooseCards', ids: bottom.map((o) => o.id) }
    }
    case 'pickDiscard': {
      const best = objs(state, ch.candidates).sort((a, b) => (isLand(b) ? -1 : b.card.cmc) - (isLand(a) ? -1 : a.card.cmc))[0]
      return { t: 'chooseCards', ids: best ? [best.id] : [] }
    }
    case 'targets': {
      const t = chooseTargets(state, p, ch.trigger.ability, ch.trigger.sourceId)
      if (t) return { t: 'chooseTargets', targets: t }
      // escolhe qualquer alvo válido
      return {
        t: 'chooseTargets',
        targets: ch.trigger.ability.targets.map((s) => (s.optional ? null : (targetCandidates(state, p, s, ch.trigger.sourceId)[0] ?? null)))
      }
    }
  }
}

function neededColors(state: GameState, p: PlayerId): Record<string, number> {
  const need: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const id of [...state.players[p].hand, ...state.players[p].command]) {
    const o = state.objects[id]
    for (const s of o?.card.manaCost.match(/\{[WUBRG]\}/g) ?? []) need[s[1]]++
  }
  return need
}

function landScore(o: GameObject, need: Record<string, number>): number {
  let s = 0
  for (const ab of o.parsed.mana) for (const u of ab.units) for (const c of u) s += need[c] ?? 0
  if (o.parsed.entersTapped) s -= 1
  return s
}

// ---------------- Combate ----------------

function botAttack(state: GameState, p: PlayerId): Action {
  const enemy = mainEnemy(state, p)
  const attackers = potentialAttackers(state, p)
  const blockers = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === enemy && canBlockAny(state, o))
  const enemyLife = state.players[enemy].life
  const myLife = state.players[p].life
  const enemyPower = state.battlefield
    .map((id) => state.objects[id])
    .filter((o) => o && o.controller === enemy && isCreature(o))
    .reduce((s, o) => s + Math.max(0, power(state, o)), 0)

  const evasive = (a: GameObject) => blockers.every((b) => canBlock(state, b, a) !== null)
  const safe = (a: GameObject) =>
    blockers.every((b) => {
      if (canBlock(state, b, a)) return true
      const bKills = power(state, b) >= toughness(state, a) || hasKw(state, b, 'deathtouch')
      const aKills = power(state, a) >= toughness(state, b) || hasKw(state, a, 'deathtouch')
      if (hasKw(state, a, 'first strike') && aKills) return true
      return !bKills || aKills
    })

  const totalPower = attackers.reduce((s, a) => s + Math.max(0, power(state, a)), 0)
  const allIn = totalPower - blockers.length * 2 >= enemyLife || (blockers.length === 0 && totalPower >= enemyLife)

  let chosen = attackers.filter((a) => a.parsed.mustAttack || (power(state, a) > 0 && (allIn || evasive(a) || safe(a) || blockers.length === 0)))
  // guarda bloqueadores se o contra-ataque do oponente puder ser letal
  if (!allIn && enemyPower >= myLife) {
    const keep = [...chosen].sort((a, b) => toughness(state, b) - toughness(state, a))
    while (keep.length && chosen.length && enemyPower - keep.filter((k) => !chosen.includes(k)).length * 2 >= myLife) {
      const k = keep.shift()!
      if (hasKw(state, k, 'vigilance') || k.parsed.mustAttack) continue
      chosen = chosen.filter((c) => c !== k)
    }
  }
  return { t: 'attack', attackers: chosen.filter((a) => canAttack(state, a)).map((a) => ({ id: a.id, target: { kind: 'player', player: enemy } })) }
}

function botBlock(state: GameState, p: PlayerId): Action {
  const c = state.combat
  if (!c) return { t: 'block', blocks: [] }
  const myLife = state.players[p].life
  const attackers = attackersAgainst(state, p).map((id) => state.objects[id]).filter(Boolean).sort((a, b) => power(state, b) - power(state, a))
  const available = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === p && canBlockAny(state, o))
  const blocks: { blocker: string; attacker: string }[] = []
  const usedB = new Set<string>()
  let incoming = attackers.reduce((s, a) => s + Math.max(0, power(state, a)), 0)

  for (const a of attackers) {
    if (hasKw(state, a, 'menace')) continue
    const options = available.filter((b) => !usedB.has(b.id) && !canBlock(state, b, a))
    if (!options.length) continue
    const ap = power(state, a)
    const at = toughness(state, a)
    const kills = (b: GameObject) => power(state, b) >= at || hasKw(state, b, 'deathtouch')
    const survives = (b: GameObject) => toughness(state, b) > ap && !hasKw(state, a, 'deathtouch')
    const good = options.filter((b) => kills(b) && survives(b)).sort((x, y) => creatureValue(state, x) - creatureValue(state, y))[0]
    const wall = options.filter((b) => survives(b)).sort((x, y) => creatureValue(state, x) - creatureValue(state, y))[0]
    const trade = options.filter((b) => kills(b) && creatureValue(state, b) <= creatureValue(state, a)).sort((x, y) => creatureValue(state, x) - creatureValue(state, y))[0]
    let pick = good ?? wall ?? trade
    if (!pick && incoming >= myLife) pick = options.sort((x, y) => creatureValue(state, x) - creatureValue(state, y))[0]
    if (pick) {
      blocks.push({ blocker: pick.id, attacker: a.id })
      usedB.add(pick.id)
      if (!hasKw(state, a, 'trample')) incoming -= ap
    }
  }
  // Ameaça: só bloqueia se for necessário para sobreviver
  for (const a of attackers.filter((x) => hasKw(state, x, 'menace'))) {
    if (incoming < myLife) break
    const options = available.filter((b) => !usedB.has(b.id) && !canBlock(state, b, a))
    if (options.length >= 2) {
      for (const b of options.slice(0, 2)) {
        blocks.push({ blocker: b.id, attacker: a.id })
        usedB.add(b.id)
      }
      incoming -= power(state, a)
    }
  }
  return { t: 'block', blocks }
}

// ---------------- Prioridade ----------------

function maxX(state: GameState, p: PlayerId, cost: string): number {
  const pc = parseManaCost(cost)
  const fixed = pc.generic + pc.reqs.length
  return Math.max(0, Math.floor((availableManaCount(state, p) - fixed) / Math.max(1, pc.x)))
}

interface Candidate {
  action: Action
  score: number
}

function spellCandidates(state: GameState, p: PlayerId, instantOnly: boolean): Candidate[] {
  const out: Candidate[] = []
  for (const id of playableCardIds(state, p)) {
    const o = state.objects[id]
    if (!o) continue
    const faces = o.card.layout === 'modal_dfc' || o.card.layout === 'split' ? [0, 1] : [0]
    for (const face of faces) {
      const pre = castInfo(state, p, id, face, 0, 0)
      if (pre.error && !pre.needsX) continue
      const tl = o.card.faces?.[face]?.typeLine ?? typeLineOf(o)
      if (/\bLand\b/.test(tl) && !/Creature/.test(tl)) continue
      if (instantOnly && !/\bInstant\b/.test(tl) && !o.parsed.keywords.includes('flash')) continue
      // modos: "escolha um" testa cada modo; "escolha dois" testa os pares
      const modeOpts: (number | number[] | undefined)[] = []
      if (pre.modes) {
        if (pre.chooseCount > 1) {
          for (let a = 0; a < pre.modes.length; a++) for (let b = a + 1; b < pre.modes.length; b++) modeOpts.push([a, b])
        } else pre.modes.forEach((_, i) => modeOpts.push(i))
      } else modeOpts.push(undefined)
      for (const mode of modeOpts) {
        const x = pre.needsX ? maxX(state, p, pre.cost) : 0
        if (pre.needsX && x < 1) continue
        const info = castInfo(state, p, id, face, mode, x)
        if (info.error) continue
        const targets = chooseTargets(state, p, info.block, id)
        if (!targets) continue
        if (!targetsWorthIt(state, p, info.block, targets)) continue
        // custo adicional: sacrifica o objeto menos valioso / descarta a pior carta
        let extra: string[] | undefined
        if (info.extraCost) {
          const cands = objs(state, info.extraCost.candidates).sort((a, b) => creatureValue(state, a) - creatureValue(state, b))
          if (cands.length < info.extraCost.count) continue
          if (info.extraCost.kind === 'sacrifice' && creatureValue(state, cands[0]) > 8) continue
          extra = cands.slice(0, info.extraCost.count).map((c) => c.id)
        }
        let score = 0
        const effects = info.block.effects
        if (info.isPermanent) {
          score = 10 + o.card.cmc * 3 + (isCreature(o) ? 2 : 0)
          if (o.parsed.aura) {
            const helpful = o.parsed.statics.some((s) => s.k === 'attachedBuff')
            const t = targets[0]
            if (t?.kind === 'object') {
              const mine = state.objects[t.id]?.controller === p
              if (helpful !== mine) continue
            }
          }
        } else {
          const kinds = effects.map((e) => e.k)
          if (kinds.includes('counterSpell')) {
            if (!state.stack.length || state.stack[state.stack.length - 1].controller === p) continue
            score = 40
          } else if (kinds.some((k) => k === 'destroy' || k === 'exile' || k === 'bounce' || k === 'damage' || k === 'fight')) {
            const t = targets.find((x) => x && x.kind === 'object') as { id: string } | undefined
            const tp = targets.find((x) => x && x.kind === 'player') as { player: PlayerId } | undefined
            if (t) score = 15 + creatureValue(state, state.objects[t.id])
            else if (tp && tp.player !== p) {
              const dmg = effects.find((e) => e.k === 'damage')
              const n = dmg && dmg.k === 'damage' ? (dmg.amount === 'X' ? x : typeof dmg.amount === 'number' ? dmg.amount : 0) : 0
              score = state.players[tp.player].life <= n ? 500 : 3
            } else score = 8
          } else if (kinds.includes('pump') && !kinds.includes('token')) {
            // truques de combate: só no combate, em criatura atacante/bloqueada
            if (!state.combat) continue
            score = 12
          } else if (kinds.includes('fog')) {
            // neblina: só quando está sendo atacado
            if (!state.combat?.attackers.length || state.activePlayer === p) continue
            score = 20
          } else if (kinds.includes('copyStack')) {
            if (!state.stack.length) continue
            score = 25
          } else if (kinds.some((k) => ['draw', 'search', 'token', 'scry', 'dig', 'impulse', 'extraTurn', 'monarch', 'proliferate', 'putLandFromHand'].includes(k))) {
            score = 9 + o.card.cmc
          } else if (effects.length === 0) {
            continue
          } else {
            score = 6
          }
        }
        out.push({
          action: { t: 'cast', id, targets, x: pre.needsX ? x : undefined, face, mode: typeof mode === 'number' ? mode : undefined, modes: Array.isArray(mode) ? mode : undefined, extra },
          score
        })
      }
    }
  }
  return out
}

function abilityCandidates(state: GameState, p: PlayerId): Candidate[] {
  const out: Candidate[] = []
  for (const id of state.battlefield) {
    const o = state.objects[id]
    if (!o || o.controller !== p) continue
    o.parsed.activated.forEach((ab, i) => {
      if (ab.fromHand) return
      const info = activateInfo(state, p, id, i, 0)
      if (info.error) return
      if (info.needsX) return
      if (ab.isEquip) {
        if (o.attachedTo) return
        const own = state.battlefield.map((x) => state.objects[x]).filter((c) => c && c.controller === p && isCreature(c) && c.id !== id)
        if (!own.length) return
        const best = own.sort((a, b) => creatureValue(state, b) - creatureValue(state, a))[0]
        out.push({ action: { t: 'activate', id, ability: i, targets: [{ kind: 'object', id: best.id }] }, score: 7 })
        return
      }
      if (ab.effects.length === 0) return
      const targets = chooseTargets(state, p, ab, id)
      if (!targets || !targetsWorthIt(state, p, ab, targets)) return
      if (ab.isLoyalty) {
        const loy = ab.cost.loyalty ?? 0
        const harmful = ab.effects.some((e) => ['destroy', 'exile', 'damage', 'bounce'].includes(e.k))
        if (loy < 0 && !harmful) return
        out.push({ action: { t: 'activate', id, ability: i, targets }, score: loy >= 0 ? 6 + loy : 14 })
        return
      }
      if (ab.cost.sacrificeSelf) return
      // habilidades com {T} de criaturas: evita usar no próprio turno antes do combate
      if (ab.cost.tap && isCreature(o) && state.activePlayer === p && state.step === 'main1') return
      const useful = ab.effects.some((e) => ['damage', 'destroy', 'draw', 'token', 'counters', 'gainLife', 'scry'].includes(e.k))
      if (!useful) return
      out.push({ action: { t: 'activate', id, ability: i, targets }, score: 5 })
    })
  }
  return out
}

function botLand(state: GameState, p: PlayerId): Action | null {
  const need = neededColors(state, p)
  const lands = playableCardIds(state, p)
    .map((id) => state.objects[id])
    .filter((o) => o && landFaceOf(o) !== null && !checkPlayLand(state, p, o.id))
    .sort((a, b) => {
      const aMdfc = a.card.layout === 'modal_dfc' ? 1 : 0
      const bMdfc = b.card.layout === 'modal_dfc' ? 1 : 0
      return aMdfc - bMdfc || landScore(b, need) - landScore(a, need)
    })
  if (!lands.length) return null
  return { t: 'playLand', id: lands[0].id }
}

function botPriority(state: GameState, p: PlayerId): Action {
  const myTurn = state.activePlayer === p
  const stackTop = state.stack[state.stack.length - 1]
  if (stackTop) {
    if (stackTop.controller !== p) {
      const responses = spellCandidates(state, p, true).filter((c) => c.score >= 30)
      if (responses.length) return responses.sort((a, b) => b.score - a.score)[0].action
    }
    return { t: 'pass' }
  }
  if (myTurn && (state.step === 'main1' || state.step === 'main2')) {
    const land = botLand(state, p)
    if (land) return land
    const cands = [...spellCandidates(state, p, false), ...abilityCandidates(state, p)].filter((c) => {
      // em main1 prioriza criaturas com ímpeto e remoções; o resto pode esperar a main2
      if (state.step === 'main1' && c.action.t === 'cast') {
        const o = state.objects[c.action.id]
        if (o && isCreature(o) && !hasKw(state, o, 'haste') && potentialAttackers(state, p).length > 0) return false
      }
      return true
    })
    if (cands.length) return cands.sort((a, b) => b.score - a.score)[0].action
    return { t: 'pass' }
  }
  // Durante combate (próprio ou do oponente): truques e remoções instantâneas
  if (state.combat && (state.step === 'declareBlockers' || state.step === 'declareAttackers')) {
    const tricks = spellCandidates(state, p, true).filter((c) => c.score >= 12)
    if (tricks.length && Math.random() < 0.8) return tricks.sort((a, b) => b.score - a.score)[0].action
  }
  // Fim do turno do oponente: compra/fichas instantâneas
  if (!myTurn && state.step === 'end') {
    const eot = spellCandidates(state, p, true).filter((c) => c.score >= 9)
    if (eot.length) return eot.sort((a, b) => b.score - a.score)[0].action
  }
  return { t: 'pass' }
}

/** Decide a próxima ação do bot (ou null se não for a vez dele). */
export function botAction(state: GameState, p: PlayerId): Action | null {
  if (actingPlayer(state) !== p) return null
  const ch = currentChoice(state)
  if (ch) return botChoice(state, p, ch)
  if (state.awaiting?.kind === 'attackers') return botAttack(state, p)
  if (state.awaiting?.kind === 'blockers') return botBlock(state, p)
  return botPriority(state, p)
}

/** Ação de fallback se o motor recusar a ação proposta pelo bot. */
export function botFallback(state: GameState, p: PlayerId): Action {
  const ch = currentChoice(state)
  if (ch) {
    if (ch.kind === 'mulligan') return { t: 'keep' }
    if (ch.kind === 'targets') return { t: 'chooseTargets', targets: ch.trigger.ability.targets.map(() => null) }
    if (ch.kind === 'scry') return { t: 'chooseCards', ids: [] }
    if (ch.kind === 'search') return { t: 'chooseCards', ids: [] }
    if (ch.kind === 'sacrifice') return { t: 'chooseCards', ids: ch.candidates.slice(0, ch.count) }
    if (ch.kind === 'pickDiscard') return { t: 'chooseCards', ids: ch.candidates.slice(0, 1) }
    if (ch.kind === 'returnOwn') return { t: 'chooseCards', ids: ch.candidates.slice(0, ch.count) }
    if (ch.kind === 'handLand' || ch.kind === 'dig') return { t: 'chooseCards', ids: [] }
    if (ch.kind === 'mode') {
      const modes = ch.trigger.ability.modes ?? []
      const i = modes.findIndex((m) => m.targets.every((s) => s.optional || targetCandidates(state, p, s, ch.trigger.sourceId).length > 0))
      return { t: 'chooseMode', index: Math.max(0, i) }
    }
    return { t: 'chooseCards', ids: state.players[p].hand.slice(0, ch.count) }
  }
  if (state.awaiting?.kind === 'attackers') return { t: 'attack', attackers: [] }
  if (state.awaiting?.kind === 'blockers') return { t: 'block', blocks: [] }
  return { t: 'pass' }
}
