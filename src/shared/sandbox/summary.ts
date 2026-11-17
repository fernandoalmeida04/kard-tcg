// Resumo da mesa em texto para a IA (Juiz e bot).
import type { GameCard } from '../engine/types.ts'
import type { PkmCard } from '../pokemon/types.ts'
import { attachmentsOf, cardName, isMtgCard, isPkmCard } from './engine.ts'
import { pkmEnergyUnits } from './hints.ts'
import type { SObj, SState } from './types.ts'

/** Texto de regras de uma carta (em inglês, a referência oficial). */
export function cardRulesText(c: GameCard | PkmCard): string {
  if (isPkmCard(c)) {
    const parts: string[] = [`${c.name} — ${c.category}${c.stage ? ` (${c.stage})` : ''}${c.trainerType ? ` (${c.trainerType})` : ''}${c.suffix ? ` ${c.suffix}` : ''}`]
    if (c.hp) parts.push(`HP ${c.hp}; types: ${c.types.join('/') || '-'}${c.evolveFrom ? `; evolves from ${c.evolveFrom}` : ''}; retreat ${c.retreat ?? 0}`)
    if (c.weaknesses.length) parts.push(`Weakness: ${c.weaknesses.map((w) => `${w.type} ${w.value}`).join(', ')}`)
    if (c.resistances.length) parts.push(`Resistance: ${c.resistances.map((w) => `${w.type} ${w.value}`).join(', ')}`)
    for (const a of c.abilities) parts.push(`[${a.type}] ${a.name}: ${a.effect}`)
    for (const a of c.attacks) parts.push(`Attack ${a.name} [${a.cost.join(',')}] ${a.damage ?? ''}${a.effect ? ` — ${a.effect}` : ''}`)
    if (c.effect) parts.push(c.effect)
    return parts.join('\n')
  }
  const faces = c.faces?.length ? c.faces : [{ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, oracleText: c.oracleText, power: c.power, toughness: c.toughness }]
  return faces.map((f) => `${f.name} ${f.manaCost ?? ''} — ${f.typeLine}${f.power ? ` (${f.power}/${f.toughness})` : ''}\n${f.oracleText ?? ''}`).join('\n//\n')
}

function objLine(state: SState, o: SObj): string {
  const flags: string[] = []
  if (o.tapped) flags.push('tapped')
  if (o.faceDown) flags.push('face down')
  if (o.attacking) flags.push(state.game === 'mtg' ? `attacking${typeof o.attackTarget === 'number' ? ` ${state.players[o.attackTarget]?.name}` : typeof o.attackTarget === 'string' ? ` ${state.objects[o.attackTarget]?.card.name ?? ''}` : ''}` : 'attacked this turn')
  if (o.token) flags.push('token')
  if (o.commander) flags.push(`commander (cast from command zone ${o.commanderCasts ?? 0}×, tax ${2 * (o.commanderCasts ?? 0)})`)
  if (o.blocking) flags.push(`blocking ${cardName(state.objects[o.blocking]?.card ?? o.card)}`)
  if (o.damage) flags.push(`${o.damage} damage`)
  if (o.conditions?.length) flags.push(o.conditions.join('+'))
  for (const [k, v] of Object.entries(o.counters)) flags.push(`${v}× ${k} counter`)
  if (o.enteredTurn !== undefined) flags.push(`entered turn ${o.enteredTurn}`)
  if (o.under?.length) flags.push(`evolved from ${o.under.map((u) => cardName(state.objects[u].card)).join(' → ')}`)
  const att = attachmentsOf(state, o.id).map((a) => cardName(state.objects[a].card))
  if (att.length) flags.push(`attached: ${att.join(', ')}`)
  if (state.game === 'pokemon' && isPkmCard(o.card) && o.card.category === 'Pokemon') flags.push(`energy units: ${pkmEnergyUnits(state, o.id).join(',') || 'none'}`)
  return `- [${o.id}] ${o.card.name}${flags.length ? ` (${flags.join('; ')})` : ''}`
}

/**
 * Mesa em texto. `viewer`: jogador cuja mão é mostrada (o bot); `all`: mostra todas as mãos e o
 * topo dos decks (o Juiz, que é neutro).
 */
export function describeState(state: SState, o: { viewer?: number; all?: boolean } = {}): string {
  const lines: string[] = [`Game: ${state.game === 'mtg' ? 'Magic: The Gathering' : 'Pokémon TCG'} · format ${state.format} · turn ${state.turn} · active player: ${state.players[state.activePlayer].name} (seat ${state.activePlayer})${state.step ? ` · current step: ${state.step}` : ''}`]
  const seen = new Map<string, GameCard | PkmCard>()
  for (const pl of state.players) {
    lines.push('', `## Seat ${pl.id}: ${pl.name}${pl.isBot ? ' (bot)' : ''}${pl.conceded ? ' (conceded)' : ''}`)
    if (state.game === 'mtg') {
      lines.push(`Life ${pl.life} · poison ${pl.poison ?? 0} · library ${pl.zones.library.length} · hand ${pl.zones.hand.length} · lands played this turn ${pl.landsThisTurn}`)
      const cmd = Object.entries(pl.commanderDamage ?? {}).filter(([, n]) => n > 0)
      if (cmd.length) lines.push(`Commander damage taken: ${cmd.map(([id, n]) => `${state.objects[id]?.card.name ?? id} ${n}`).join(', ')}`)
      const pool = Object.entries(pl.pool).map(([c, n]) => `{${c}}×${n}`).join(' ')
      if (pool) lines.push(`Mana pool: ${pool}`)
    } else {
      lines.push(`Prizes left ${pl.zones.prizes.length} · deck ${pl.zones.deck.length} · hand ${pl.zones.hand.length} · energy attached this turn ${pl.energyThisTurn} · supporters played this turn ${pl.supporterThisTurn}`)
    }
    const zones = state.game === 'mtg' ? ['battlefield', 'command', 'graveyard', 'exile'] : ['active', 'bench', 'stadium', 'discard', 'lostZone']
    const PILES = new Set(['graveyard', 'exile', 'discard', 'lostZone'])
    for (const z of zones) {
      const ids = pl.zones[z] ?? []
      if (!ids.length) continue
      if (PILES.has(z)) {
        // pilhas: só os nomes (mais recentes primeiro), para o pedido à IA não crescer demais
        const recent = [...ids].reverse().slice(0, 12).map((id) => `[${id}] ${state.objects[id].card.name}`)
        lines.push(`${z} (${ids.length}, most recent first): ${recent.join('; ')}${ids.length > 12 ? '; …' : ''}`)
        continue
      }
      lines.push(`${z}:`)
      for (const id of ids) {
        const ob = state.objects[id]
        lines.push(objLine(state, ob))
        if (!ob.faceDown) seen.set(ob.card.name, ob.card)
        for (const a of attachmentsOf(state, id)) seen.set(state.objects[a].card.name, state.objects[a].card)
      }
    }
    if (o.all || o.viewer === pl.id) {
      lines.push(`hand:`)
      for (const id of pl.zones.hand) {
        lines.push(objLine(state, state.objects[id]))
        seen.set(state.objects[id].card.name, state.objects[id].card)
      }
    }
  }
  lines.push('', '## Card texts')
  for (const c of seen.values()) lines.push(cardRulesText(c), '')
  return lines.join('\n')
}

/** Histórico recente (até a linha `uptoId`, inclusive). */
export function recentLog(state: SState, uptoId?: number, n = 40): string {
  const list = uptoId === undefined ? state.log : state.log.filter((e) => e.id <= uptoId)
  return list
    .slice(-n)
    .map((e) => `#${e.id} [turn ${e.turn}] ${e.player !== undefined ? `(${state.players[e.player]?.name}) ` : ''}${e.text}`)
    .join('\n')
}

export function isMtg(state: SState): boolean {
  return state.game === 'mtg'
}

export { isMtgCard }
