// Resumo textual do estado da partida (enviado ao Juiz IA).

import { keywordsOf, objName, power, isCreature, toughness, typeLineOf, hasType } from './game.ts'
import { STEP_LABEL, type GameState, type PlayerId, type TargetChoice } from './types.ts'

export function describeObject(state: GameState, id: string): string {
  const o = state.objects[id]
  if (!o) return `[${id}] ?`
  const parts = [`[${id}] ${o.card.name}${o.card.displayName !== o.card.name ? ` (${o.card.displayName})` : ''}`, typeLineOf(o)]
  if (isCreature(o)) parts.push(`${power(state, o)}/${toughness(state, o)}${o.damage ? ` (dano ${o.damage})` : ''}`)
  if (hasType(o, 'Planeswalker')) parts.push(`lealdade ${o.counters.loyalty ?? 0}`)
  if (o.tapped) parts.push('virada')
  const kws = keywordsOf(state, o)
  if (kws.length) parts.push(`palavras-chave: ${kws.join(', ')}`)
  const counters = Object.entries(o.counters).filter(([k, v]) => v && k !== 'loyalty')
  if (counters.length) parts.push(`marcadores: ${counters.map(([k, v]) => `${v}x ${k}`).join(', ')}`)
  if (o.attachedTo) parts.push(`anexada a [${o.attachedTo}]`)
  if (o.isToken) parts.push('ficha')
  return parts.join(' · ')
}

export function stateSummary(state: GameState, perspective: PlayerId): string {
  const lines: string[] = []
  lines.push(`Turno ${state.turn}, jogador ativo: ${state.players[state.activePlayer].name}, etapa: ${STEP_LABEL[state.step]}.`)
  for (const pl of state.players) {
    if (pl.lost) {
      lines.push(`Jogador ${pl.name}: eliminado da partida.`)
      continue
    }
    const who = pl.id === perspective ? 'controller' : 'opponent'
    lines.push(
      `Jogador ${pl.name} (${pl.isBot ? 'bot' : 'humano'}; referência "${who}" se for o controlador da habilidade atual = ${pl.id === perspective ? 'sim' : 'não'}): vida ${pl.life}, mão ${pl.hand.length} cartas, grimório ${pl.library.length}, cemitério ${pl.graveyard.length}.`
    )
    const bf = state.battlefield.filter((id) => state.objects[id]?.controller === pl.id)
    lines.push(`  Campo de batalha de ${pl.name}:`)
    if (!bf.length) lines.push('    (vazio)')
    for (const id of bf) lines.push(`    ${describeObject(state, id)}`)
    const gy = pl.graveyard.slice(-8)
    if (gy.length) lines.push(`  Cemitério (topo): ${gy.map((id) => `[${id}] ${state.objects[id]?.card.name}`).join(', ')}`)
    if (pl.id === perspective && pl.hand.length) {
      lines.push(`  Mão de ${pl.name}: ${pl.hand.map((id) => `[${id}] ${state.objects[id]?.card.name}`).join(', ')}`)
    }
  }
  if (state.stack.length) {
    lines.push('Pilha (topo por último):')
    for (const s of state.stack) lines.push(`  [${s.id}] ${s.sourceName} (controlador: ${state.players[s.controller].name})`)
  }
  return lines.join('\n')
}

export function describeChosenTargets(state: GameState, targets: (TargetChoice | null)[]): string {
  return targets
    .map((t) => {
      if (!t) return null
      if (t.kind === 'player') return `jogador ${state.players[t.player].name} (${state.players[t.player]?.isBot ? 'bot' : 'humano'})`
      if (t.kind === 'stack') return `item da pilha [${t.id}]`
      return `[${t.id}] ${objName(state, t.id)}`
    })
    .filter(Boolean)
    .join('; ')
}

export function recentLog(state: GameState, n = 25): string {
  return state.log
    .slice(-n)
    .map((l) => `T${l.turn}: ${l.text}`)
    .join('\n')
}
