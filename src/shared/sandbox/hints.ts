// Indicadores visuais da mesa livre (só para destacar cartas na tela; nada aqui impede jogadas).
import type { GameCard } from '../engine/types.ts'
import type { PkmCard, PkmType } from '../pokemon/types.ts'
import { canPay } from '../pkm-engine/game.ts'
import { basicEnergyType, parseCardRules } from '../pkm-engine/effects.ts'
import { attachmentsOf, isMtgCard, isPkmCard, poolPayment } from './engine.ts'
import { manaOptionsOf } from './mana.ts'
import type { SObj, SState } from './types.ts'

// ---------------- Magic ----------------

function mtgFace(o: SObj): { typeLine: string; manaCost: string } {
  const c = o.card as GameCard
  const f = c.faces?.[o.face ?? 0]
  return { typeLine: f?.typeLine ?? c.typeLine, manaCost: f?.manaCost ?? c.manaCost }
}

export function isLandCard(o: SObj): boolean {
  return isMtgCard(o.card) && /\bLand\b/.test(mtgFace(o).typeLine)
}

/** Cores de mana que a permanente pode gerar (lidas da habilidade de mana da carta). */
export function manaColorsOf(o: SObj): string[] {
  if (!isMtgCard(o.card)) return []
  return [...new Set(manaOptionsOf(o).flatMap((x) => x.mana))]
}

/** A carta da mão pode ser jogada agora com a mana gerada? (terreno: se ainda não baixou um no turno) */
export function mtgPlayable(state: SState, p: number, id: string): boolean {
  const o = state.objects[id]
  if (!o) return false
  const tl = mtgFace(o).typeLine
  const instant = /\bInstant\b/.test(tl) || (o.card as GameCard).keywords?.some((k) => k.toLowerCase() === 'flash')
  const main = state.step === undefined || state.step === 'main1' || state.step === 'main2'
  // velocidade de feitiço: só no próprio turno, na fase principal; instantâneas: a qualquer momento
  if (!instant && (state.activePlayer !== p || !main)) return false
  if (isLandCard(o)) return state.players[p].landsThisTurn === 0
  return poolPayment(state.players[p].pool, mtgFace(o).manaCost) !== null
}

/** A criatura pode atacar? (minha, desvirada, sem "enjoo" — ou com Ímpeto) */
export function mtgCanAttack(state: SState, p: number, id: string): boolean {
  const o = state.objects[id]
  if (!o || state.activePlayer !== p || o.owner !== p || o.tapped || o.attacking) return false
  // só brilha na hora de declarar atacantes (início do combate / declarar atacantes)
  if (state.step && state.step !== 'beginCombat' && state.step !== 'declareAttackers') return false
  if (!state.players[p].zones.battlefield?.includes(id)) return false
  if (!/\bCreature\b/.test(mtgFace(o).typeLine)) return false
  const haste = (o.card as GameCard).keywords?.some((k) => k.toLowerCase() === 'haste') || /\bhaste\b/i.test((o.card as GameCard).oracleText ?? '')
  return haste || (o.enteredTurn ?? 0) < state.turn
}

// ---------------- Pokémon ----------------

function provides(c: PkmCard): (PkmType | 'any')[] {
  const basic = basicEnergyType(c)
  if (basic) return [basic]
  return parseCardRules(c).energyProvides ?? ['Colorless']
}

/** Energias ligadas a um Pokémon, em unidades de tipo. */
export function pkmEnergyUnits(state: SState, id: string): (PkmType | 'any')[] {
  const out: (PkmType | 'any')[] = []
  for (const a of attachmentsOf(state, id)) {
    const c = state.objects[a].card
    if (isPkmCard(c) && c.category === 'Energy') out.push(...provides(c))
  }
  return out
}

export function pkmInPlay(state: SState, p: number): string[] {
  const z = state.players[p].zones
  return [...(z.active ?? []), ...(z.bench ?? [])]
}

function isBasic(c: PkmCard): boolean {
  return c.category === 'Pokemon' && (c.stage === 'Basic' || (!c.stage && !c.evolveFrom))
}

/** Pokémon em jogo que esta evolução pode evoluir (nome certo, não entrou neste turno). */
export function pkmEvolveTargets(state: SState, p: number, id: string): string[] {
  const c = state.objects[id]?.card
  if (!c || !isPkmCard(c) || !c.evolveFrom) return []
  return pkmInPlay(state, p).filter((x) => {
    const o = state.objects[x]
    return isPkmCard(o.card) && o.card.name === c.evolveFrom && (o.enteredTurn ?? 0) < state.turn && state.turn > 2
  })
}

/** A carta da mão pode ser jogada agora? (indicador) */
export function pkmPlayable(state: SState, p: number, id: string): boolean {
  const o = state.objects[id]
  if (!o || state.activePlayer !== p || !isPkmCard(o.card)) return false
  const c = o.card
  const pl = state.players[p]
  if (c.category === 'Pokemon') {
    if (isBasic(c)) return (pl.zones.bench?.length ?? 0) < 5 || !(pl.zones.active?.length ?? 0)
    return pkmEvolveTargets(state, p, id).length > 0
  }
  if (c.category === 'Energy') return pl.energyThisTurn === 0 && pkmInPlay(state, p).length > 0
  if (c.trainerType === 'Supporter') return pl.supporterThisTurn === 0 && state.turn > 1
  if (c.trainerType === 'Tool') return pkmInPlay(state, p).some((x) => !attachmentsOf(state, x).some((a) => isPkmCard(state.objects[a].card) && (state.objects[a].card as PkmCard).trainerType === 'Tool'))
  return true
}

/** O ataque pode ser pago com as Energias ligadas? */
export function pkmAttackAffordable(state: SState, id: string, index: number): boolean {
  const o = state.objects[id]
  if (!o || !isPkmCard(o.card)) return false
  const a = o.card.attacks[index]
  return Boolean(a) && canPay(pkmEnergyUnits(state, id), a.cost)
}

/** O Pokémon Ativo pode atacar agora? (meu turno, não é o 1º turno da partida, sem Adormecido/Paralisado, com Energia) */
export function pkmCanAttack(state: SState, p: number, id: string): boolean {
  const o = state.objects[id]
  if (!o || state.activePlayer !== p || o.attacking || state.turn === 1) return false
  if (state.players[p].zones.active?.[0] !== id) return false
  if (o.conditions?.some((c) => c === 'asleep' || c === 'paralyzed')) return false
  return isPkmCard(o.card) && o.card.attacks.some((_, i) => pkmAttackAffordable(state, id, i))
}

// ---------------- Pokémon: ataque e recuo (cálculos para as janelas; o jogador confirma) ----------------

export interface PkmDamageCalc {
  base: number
  total: number
  /** Explicação: "Fraqueza ×2", "Resistência −30"... */
  parts: string[]
  /** O dano tem modificador no texto ("30+", "20×"): o jogador completa. */
  variable: boolean
}

/** Dano do ataque no alvo, com Fraqueza e Resistência (só no Ativo do oponente). */
export function pkmAttackDamage(state: SState, attackerId: string, index: number, targetId: string): PkmDamageCalc {
  const a = state.objects[attackerId]
  const d = state.objects[targetId]
  const atk = a && isPkmCard(a.card) ? a.card.attacks[index] : undefined
  const raw = String(atk?.damage ?? '')
  const base = parseInt(raw.replace(/[^\d]/g, ''), 10) || 0
  const out: PkmDamageCalc = { base, total: base, parts: [], variable: /[+×x−-]/.test(raw) }
  if (!a || !d || !isPkmCard(a.card) || !isPkmCard(d.card) || !base) return out
  const isActive = state.players[d.owner].zones.active?.[0] === targetId
  if (!isActive) {
    out.parts.push('bench')
    return out
  }
  let total = base
  for (const w of d.card.weaknesses) {
    if (!a.card.types.includes(w.type)) continue
    const v = w.value.replace('−', '-')
    if (/^[x×]\s*2$/i.test(v)) {
      total *= 2
      out.parts.push(`weak×2:${w.type}`)
    } else {
      const n = parseInt(v.replace(/[^\d]/g, ''), 10) || 0
      total += n
      out.parts.push(`weak+${n}:${w.type}`)
    }
  }
  for (const r of d.card.resistances) {
    if (!a.card.types.includes(r.type)) continue
    const n = parseInt(r.value.replace(/[^\d]/g, ''), 10) || 0
    total -= n
    out.parts.push(`res-${n}:${r.type}`)
  }
  out.total = Math.max(0, total)
  return out
}

/** Custo de recuo e as Energias sugeridas para descartar (as que fornecem menos unidades primeiro). */
export function pkmRetreatPlan(state: SState, activeId: string): { cost: number; energies: string[]; suggested: string[]; enough: boolean } {
  const o = state.objects[activeId]
  const cost = o && isPkmCard(o.card) ? (o.card.retreat ?? 0) : 0
  const energies = attachmentsOf(state, activeId).filter((e) => isPkmCard(state.objects[e].card) && (state.objects[e].card as PkmCard).category === 'Energy')
  const units = (id: string) => provides(state.objects[id].card as PkmCard).length
  const sorted = [...energies].sort((x, y) => units(x) - units(y))
  const suggested: string[] = []
  let total = 0
  for (const e of sorted) {
    if (total >= cost) break
    suggested.push(e)
    total += units(e)
  }
  return { cost, energies, suggested, enough: total >= cost }
}

/** Unidades de energia fornecidas por uma carta de Energia. */
export function pkmEnergyValue(state: SState, id: string): number {
  const c = state.objects[id]?.card
  return c && isPkmCard(c) && c.category === 'Energy' ? provides(c).length : 0
}
