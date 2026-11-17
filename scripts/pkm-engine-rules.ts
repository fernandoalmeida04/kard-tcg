// Testes dirigidos das regras do motor de Pokémon (cartas sintéticas).
// Uso: node --experimental-strip-types --no-warnings scripts/pkm-engine-rules.ts
import { createGame, performAction, findInPlay, canPay, parseEffectText } from '../src/shared/pkm-engine/index.ts'
import type { PAction, PGameState } from '../src/shared/pkm-engine/index.ts'
import type { PkmCard, PkmType } from '../src/shared/pokemon/types.ts'

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) fails++
}
let nid = 0
function poke(name: string, hp: number, type: PkmType, attacks: PkmCard['attacks'], o: Partial<PkmCard> = {}): PkmCard {
  return { id: `c${nid++}`, name, category: 'Pokemon', hp, types: [type], stage: 'Basic', retreat: 1, weaknesses: [], resistances: [], attacks, abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [], ...o }
}
const energy = (type: PkmType): PkmCard => ({ id: `e-${type}`, name: `${type} Energy`, category: 'Energy', energyType: 'Normal', types: [], weaknesses: [], resistances: [], attacks: [], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [] })
const trainer = (name: string, trainerType: string, effect: string): PkmCard => ({ id: `t-${name}`, name, category: 'Trainer', trainerType, effect, types: [], weaknesses: [], resistances: [], attacks: [], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [] })

const fire = poke('Flamy', 100, 'Fire', [{ name: 'Ember', cost: ['Fire'], damage: '30' }, { name: 'Poison Fang', cost: ['Fire', 'Colorless'], damage: '10', effect: "Your opponent's Active Pokémon is now Poisoned." }])
const grass = poke('Leafy', 70, 'Grass', [{ name: 'Tackle', cost: ['Colorless'], damage: '10' }], { weaknesses: [{ type: 'Fire', value: '×2' }] })
const water = poke('Splashy', 120, 'Water', [{ name: 'Bubble', cost: ['Water'], damage: '20' }], { resistances: [{ type: 'Fire', value: '-30' }] })
const grassEx = poke('Leafy ex', 60, 'Grass', [{ name: 'Tackle', cost: ['Colorless'], damage: '10' }], { suffix: 'ex', weaknesses: [{ type: 'Fire', value: '×2' }] })
const stage1 = poke('Flamier', 130, 'Fire', [{ name: 'Big Burn', cost: ['Fire'], damage: '70' }], { stage: 'Stage1', evolveFrom: 'Flamy' })
const stage2 = poke('Flamiest', 200, 'Fire', [{ name: 'Inferno', cost: ['Fire'], damage: '150' }], { stage: 'Stage2', evolveFrom: 'Flamier' })
const candy = trainer('Rare Candy', 'Item', 'Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card on the Basic Pokémon. (This counts as evolving that Pokémon.)')
const research = trainer("Professor's Research", 'Supporter', 'Discard your hand and draw 7 cards.')

function game(d0: PkmCard[], d1: PkmCard[], firstPlayer = 0): PGameState {
  const fill = (d: PkmCard[], e: PkmType) => [...d, ...Array(60 - d.length).fill(energy(e))].map((card) => ({ card }))
  return createGame({ format: 'Teste', seed: 7, firstPlayer, players: [{ name: 'A', isBot: false, deck: fill(d0, 'Fire') }, { name: 'B', isBot: false, deck: fill(d1, 'Water') }], evolutions: { Flamier: 'Flamy' } })
}
let s: PGameState
const act = (p: number, a: PAction, expectOk = true) => {
  const r = performAction(s, p, a)
  if (expectOk && r.error) throw new Error(`recusada: ${r.error} ${JSON.stringify(a)}`)
  if (!r.error) s = r.state
  return r
}
/** Coloca uma carta específica na mão (tirando do deck), para testes. */
const toHand = (p: number, name: string) => {
  const pl = s.players[p]
  const id = [...pl.deck, ...pl.prizes].find((x) => s.objects[x].card.name === name)!
  for (const z of [pl.deck, pl.prizes]) if (z.includes(id)) z.splice(z.indexOf(id), 1)
  pl.hand.push(id)
  return id
}
const handId = (p: number, name: string) => s.players[p].hand.find((x) => s.objects[x].card.name === name) ?? toHand(p, name)
const setupBoth = (a: string, b: string) => {
  act(0, { t: 'setup', active: handId(0, a), bench: [] })
  act(1, { t: 'setup', active: handId(1, b), bench: [] })
  while (s.choices.length) act(s.choices[0].player, { t: 'extraDraw', n: 0 })
}

// --- custo de energia
check(canPay(['Fire'], ['Fire']) && !canPay(['Water'], ['Fire']) && canPay(['Water', 'Fire'], ['Fire', 'Colorless']) && !canPay(['Fire'], ['Fire', 'Colorless']) && canPay(['any'], ['Grass']), 'pagamento de custo (tipos e Incolor)')

// --- primeiro turno, fraqueza, prêmios
s = game([fire, fire, fire, fire, stage1, stage2, candy, research], [grass, grass, grassEx, water, water])
setupBoth('Flamy', 'Leafy')
check(s.step === 'main' && s.turn === 1 && s.activePlayer === 0, 'turno 1 começa com o primeiro jogador')
act(0, { t: 'attachEnergy', id: handId(0, 'Fire Energy'), target: s.players[0].active!.id })
check(Boolean(act(0, { t: 'attack', index: 0 }, false).error), 'quem começa não ataca no turno 1')
check(Boolean(act(0, { t: 'playTrainer', id: handId(0, "Professor's Research") }, false).error), 'quem começa não joga Apoiador no turno 1')
check(Boolean(act(0, { t: 'attachEnergy', id: handId(0, 'Fire Energy'), target: s.players[0].active!.id }, false).error), 'só uma Energia por turno')
check(Boolean(act(0, { t: 'evolve', id: handId(0, 'Flamier'), target: s.players[0].active!.id }, false).error), 'não evolui no primeiro turno')
act(0, { t: 'endTurn' })
check(s.activePlayer === 1 && s.turn === 2, 'turno passa para o oponente')
act(1, { t: 'endTurn' })
act(0, { t: 'attack', index: 0 })
// Ember 30 ×2 (fraqueza) = 60 em Leafy (70 PS)
const leafy = s.players[1].active!
check(leafy.damage === 60, `fraqueza ×2: 30 → 60 (dano ${leafy.damage})`)
check(s.activePlayer === 1, 'atacar encerra o turno')

// --- nocaute, prêmio e novo Ativo
s.players[1].bench.push({ id: toHand(1, 'Splashy'), stack: [], energy: [], damage: 0, playedTurn: 0 })
s.players[1].hand.splice(s.players[1].hand.indexOf(s.players[1].bench[0].id), 1)
s.players[1].bench[0].stack = [s.players[1].bench[0].id]
act(1, { t: 'endTurn' })
const handBefore = s.players[0].hand.length
act(0, { t: 'attack', index: 0 })
check(s.players[1].active === null && s.players[0].prizes.length === 5, 'nocaute: Pokémon sai e o atacante pega 1 prêmio')
check(s.players[0].hand.length === handBefore + 1, 'o prêmio vai para a mão')
check(s.choices[0]?.kind === 'promote' && s.choices[0].player === 1, 'oponente escolhe novo Ativo')
act(1, { t: 'chooseInPlay', id: s.players[1].bench[0].id })
check(s.players[1].active !== null && s.activePlayer === 1, 'novo Ativo e o turno do oponente começa')

// --- resistência
act(1, { t: 'endTurn' })
act(0, { t: 'attack', index: 0 })
check(s.players[1].active!.damage === 0, 'resistência -30: 30 → 0')

// --- veneno (Verificação Pokémon) e evolução
act(1, { t: 'endTurn' })
const myActive = s.players[0].active!.id
act(0, { t: 'evolve', id: handId(0, 'Flamier'), target: myActive })
check(findInPlay(s, s.players[0].active!.id) !== null && s.objects[s.players[0].active!.id].card.name === 'Flamier', 'evolui no turno seguinte')
check(Boolean(act(0, { t: 'evolve', id: handId(0, 'Flamiest'), target: s.players[0].active!.id }, false).error), 'não evolui duas vezes no mesmo turno')
act(0, { t: 'endTurn' })
act(1, { t: 'endTurn' })
// Doce Raro não serve (Flamy já evoluiu); testa o recuo
check(Boolean(act(0, { t: 'retreat', to: 'x' }, false).error), 'recuo sem Banco é recusado')

// --- 2 prêmios por Pokémon ex e condição de envenenado
s = game([fire, fire], [grassEx, grass])
setupBoth('Flamy', 'Leafy ex')
const fireId = s.players[0].active!.id
act(0, { t: 'attachEnergy', id: handId(0, 'Fire Energy'), target: fireId })
act(0, { t: 'endTurn' })
act(1, { t: 'playBasic', id: handId(1, 'Leafy') })
act(1, { t: 'endTurn' })
act(0, { t: 'attack', index: 0 })
check(s.players[0].prizes.length === 4, `Pokémon ex vale 2 prêmios (restam ${s.players[0].prizes.length})`)
act(1, { t: 'chooseInPlay', id: s.players[1].bench[0].id })
act(1, { t: 'endTurn' })
act(0, { t: 'attachEnergy', id: handId(0, 'Fire Energy'), target: fireId })
act(0, { t: 'attack', index: 1 })
const victim = s.players[1].active!
check(victim.poisoned === true && victim.damage === 10 * 2 + 10, `envenenado: 10 do ataque ×2 + 10 da verificação (dano ${victim.damage})`)

// --- Doce Raro
s = game([fire, stage2, candy], [water])
setupBoth('Flamy', 'Splashy')
act(0, { t: 'endTurn' })
act(1, { t: 'endTurn' })
handId(0, 'Flamiest')
act(0, { t: 'playTrainer', id: handId(0, 'Rare Candy') })
act(0, { t: 'chooseCards', ids: [handId(0, 'Flamiest')] })
act(0, { t: 'chooseInPlay', id: s.players[0].active!.id })
check(s.objects[s.players[0].active!.id].card.name === 'Flamiest', 'Doce Raro: Básico → Estágio 2')

// --- interpretação de textos
const p = parseEffectText('Flip a coin. If heads, your opponent’s Active Pokémon is now Paralyzed.')
check(p.effects.length === 2 && p.effects[0].k === 'flip' && p.effects[1].k === 'condition' && !p.unsupported.length, 'texto: moeda + Paralisado')
const q = parseEffectText('Discard 2 cards from your hand. If you do, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.')
check(q.effects[0].k === 'discardFromHand' && q.effects[1].k === 'search' && !q.unsupported.length, 'texto: Ultra Ball (custo + busca)')

console.log(fails ? `\nFalhas: ${fails}` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
