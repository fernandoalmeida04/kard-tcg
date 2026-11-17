// Regressão dos problemas do diagnóstico da mesa livre (Magic e Pokémon).
// Uso: node --experimental-strip-types --no-warnings scripts/sandbox-rules.ts
import { createSandbox, performSandbox } from '../src/shared/sandbox/index.ts'
import { judgeFacts } from '../src/shared/sandbox/ai.ts'
import type { SAction, SState } from '../src/shared/sandbox/index.ts'
import type { GameCard } from '../src/shared/engine/types.ts'
import type { PkmCard } from '../src/shared/pokemon/types.ts'

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) fails++
}
let s: SState
const act = (p: number, a: SAction): string | null => {
  const r = performSandbox(s, p, a)
  if (r.error) return r.error
  s = r.state
  return null
}

// ---------------- cartas ----------------
const mtg = (o: Partial<GameCard>): GameCard => ({ oracleId: o.name!, displayName: o.name!, manaCost: '', cmc: 0, typeLine: '', displayType: '', oracleText: '', displayText: '', colors: [], colorIdentity: [], keywords: [], layout: 'normal', ...o }) as GameCard
const mountain = mtg({ name: 'Mountain', typeLine: 'Basic Land — Mountain', oracleText: '({T}: Add {R}.)', producedMana: ['R'] })
const bear = mtg({ name: 'Grizzly Bears', manaCost: '{1}{G}', cmc: 2, typeLine: 'Creature — Bear', power: '2', toughness: '2' })
const bolt = mtg({ name: 'Lightning Bolt', manaCost: '{R}', cmc: 1, typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.' })
const big = mtg({ name: 'Big Spell', manaCost: '{5}{R}', cmc: 6, typeLine: 'Sorcery' })
const pk = (name: string, o: Partial<PkmCard> = {}): PkmCard => ({ id: name, name, category: 'Pokemon', hp: 60, types: ['Fire'], stage: 'Basic', retreat: 1, weaknesses: [], resistances: [], attacks: [{ name: 'Hit', cost: [], damage: '30' }], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [], ...o })
const stadium = (name: string): PkmCard => ({ ...pk(name), category: 'Trainer', trainerType: 'Stadium', hp: undefined, attacks: [] })

function mtgGame(deck: GameCard[]): void {
  s = createSandbox({ game: 'mtg', format: 'Casual', seed: 1, firstPlayer: 0, startingLife: 20, players: [0, 1].map((i) => ({ name: 'P' + i, color: '#fff', isBot: false, deck: deck.map((card) => ({ card })) })) })
  act(0, { t: 'keep', bottom: [] })
  act(1, { t: 'keep', bottom: [] })
}
function pull(p: number, name: string): string {
  const z = s.players[p].zones
  const lib = s.game === 'mtg' ? z.library : z.deck
  const id = [...z.hand, ...lib].find((x) => s.objects[x].card.name === name)!
  if (!z.hand.includes(id)) act(p, { t: 'move', id, to: 'hand' })
  return id
}

// ================= Item 1: erros confirmados =================
console.log('— Item 1: erros confirmados')
mtgGame([...Array(20).fill(mountain), ...Array(15).fill(bear), ...Array(15).fill(bolt), ...Array(10).fill(big)])
const land = pull(0, 'Mountain')
act(0, { t: 'move', id: land, to: 'battlefield' })
act(0, { t: 'tapForMana', id: land, color: 'R' })
check(act(0, { t: 'tapForMana', id: land, color: 'R' }) !== null && s.players[0].pool.R === 1, '1. virar para mana uma terra já virada é recusado')
const b1 = pull(0, 'Lightning Bolt')
act(0, { t: 'move', id: b1, to: 'graveyard', cast: true })
check(!s.players[0].pool.R && s.log[s.log.length - 1].text.includes('conjura'), '2. conjurar instantâneo gasta a mana gerada e aparece como conjuração')
const g = pull(0, 'Big Spell')
const before = s
act(0, { t: 'move', id: g, to: 'graveyard' })
const f = judgeFacts(before, { t: 'move', id: g, to: 'graveyard' }, 0)
check(!f.some((x) => x.includes('COST CHECK')) && f.some((x) => x.includes('WITHOUT being cast')), '3. descarte não é julgado como conjuração sem mana')
const bearId = pull(0, 'Grizzly Bears')
act(0, { t: 'move', id: bearId, to: 'battlefield' })
act(0, { t: 'step', to: 'declareAttackers' })
act(0, { t: 'attack', id: bearId })
check(s.objects[bearId].tapped === true, '4a. atacar vira a criatura')
act(0, { t: 'attack', id: bearId })
check(s.objects[bearId].tapped === false && !s.objects[bearId].attacking, '4b. retirar do ataque desvira a criatura')

s = createSandbox({ game: 'pokemon', format: 'Teste', seed: 2, firstPlayer: 0, players: [0, 1].map((i) => ({ name: 'P' + i, color: '#fff', isBot: false, deck: [...Array(20).fill(pk('Mon')), stadium('Artazon'), stadium('Mesagoza'), ...Array(38).fill(pk('Mon'))].map((card) => ({ card })) })) })
const m1 = pull(0, 'Mon')
act(0, { t: 'move', id: m1, to: 'active' })
const m2 = s.players[0].zones.hand.find((x) => s.objects[x].card.name === 'Mon' && x !== m1) ?? pull(0, 'Mon')
check(act(0, { t: 'move', id: m2, to: 'active' }) !== null && s.players[0].zones.active.length === 1, '5. o Ativo não aceita um segundo Pokémon')
act(0, { t: 'move', id: pull(0, 'Artazon'), to: 'stadium' })
act(1, { t: 'move', id: pull(1, 'Mesagoza'), to: 'stadium' })
const inPlay = s.players.flatMap((p) => p.zones.stadium)
check(inPlay.length === 1 && s.objects[inPlay[0]].card.name === 'Mesagoza' && s.players[0].zones.discard.some((x) => s.objects[x].card.name === 'Artazon'), '6. só um Estádio: o anterior vai para o descarte do dono')

// ================= Item 2: Pokémon — etapas obrigatórias =================
console.log('— Item 2: Pokémon — ataque, nocaute, vitória, recuo e Habilidade')
const fireMon = pk('Charmander', { types: ['Fire'], hp: 70, retreat: 2, attacks: [{ name: 'Ember', cost: [], damage: '40' }], abilities: [{ type: 'Ability', name: 'Warm Up', effect: 'Once during your turn, you may draw a card.' }] })
const grassMon = pk('Bulbasaur', { types: ['Grass'], hp: 70, weaknesses: [{ type: 'Fire', value: '×2' }] })
const waterMon = pk('Squirtle', { types: ['Water'], hp: 70, resistances: [{ type: 'Fire', value: '-30' }] })
const fireE: PkmCard = { id: 'fe', name: 'Fire Energy', category: 'Energy', energyType: 'Normal', types: [], weaknesses: [], resistances: [], attacks: [], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [] }
const deckA = [...Array(10).fill(fireMon), ...Array(20).fill(fireE), ...Array(30).fill(fireMon)].map((card) => ({ card }))
const deckB = [...Array(4).fill(grassMon), ...Array(4).fill(waterMon), ...Array(52).fill(fireE)].map((card) => ({ card }))
s = createSandbox({ game: 'pokemon', format: 'Teste', seed: 4, firstPlayer: 0, players: [{ name: 'A', color: '#f00', isBot: false, deck: deckA }, { name: 'B', color: '#00f', isBot: false, deck: deckB }] })
const aAct = pull(0, 'Charmander')
act(0, { t: 'move', id: aAct, to: 'active' })
const aBench = s.players[0].zones.hand.find((x) => s.objects[x].card.name === 'Charmander' && x !== aAct) ?? pull(0, 'Charmander')
act(0, { t: 'move', id: aBench, to: 'bench' })
act(0, { t: 'setupPrizes' })
const bAct = pull(1, 'Bulbasaur')
act(1, { t: 'move', id: bAct, to: 'active' })
const bBench = pull(1, 'Squirtle')
act(1, { t: 'move', id: bBench, to: 'bench' })
act(1, { t: 'setupPrizes' })
act(0, { t: 'passTurn' })
act(1, { t: 'passTurn' })
// dano com Fraqueza calculado (o jogador confirma na janela)
const { pkmAttackDamage, pkmRetreatPlan } = await import('../src/shared/sandbox/hints.ts')
const calcW = pkmAttackDamage(s, aAct, 0, bAct)
check(calcW.base === 40 && calcW.total === 80, `dano com Fraqueza ×2: 40 → ${calcW.total}`)
const calcBench = pkmAttackDamage(s, aAct, 0, bBench)
check(calcBench.total === 40 && calcBench.parts.includes('bench'), 'no Banco não há Fraqueza/Resistência')
const turnBefore = s.turn
act(0, { t: 'attack', id: aAct, index: 0, target: bAct, damage: calcW.total, endTurn: true })
check(s.objects[bAct].damage === 80, 'o ataque aplica o dano confirmado')
check(s.log.some((l) => l.text.includes('Nocauteado')), 'nocaute avisado na hora, com os Prêmios a pegar')
check(s.turn === turnBefore + 1 && s.activePlayer === 1, 'atacar encerra o turno')
// recuo com custo
act(1, { t: 'move', id: bAct, to: 'discard' })
act(1, { t: 'switchActive', id: bBench })
const calcR = pkmAttackDamage(s, aAct, 0, bBench)
check(calcR.total === 10, `Resistência −30: 40 → ${calcR.total}`)
act(1, { t: 'passTurn' })
const e1 = pull(0, 'Fire Energy')
act(0, { t: 'attach', id: e1, target: aAct })
const e2 = s.players[0].zones.hand.find((x) => s.objects[x].card.name === 'Fire Energy' && x !== e1) ?? pull(0, 'Fire Energy')
act(0, { t: 'attach', id: e2, target: aAct })
const plan = pkmRetreatPlan(s, aAct)
check(plan.cost === 2 && plan.suggested.length === 2 && plan.enough, 'recuo: custo 2 e 2 Energias sugeridas')
act(0, { t: 'switchActive', id: aBench, retreat: true, discard: plan.suggested })
check(s.players[0].zones.active[0] === aBench && s.players[0].zones.discard.filter((x) => s.objects[x].card.name === 'Fire Energy').length === 2 && s.players[0].retreatedThisTurn === 1, 'recuar descarta as Energias e marca o recuo do turno')
const rf = judgeFacts(s, { t: 'switchActive', id: aAct, retreat: true, discard: [] }, 0)
check(rf.some((x) => x.includes('Retreats already done this turn before: 1')), 'juiz: fatos do recuo mostram que já recuou no turno')
// Habilidade
act(0, { t: 'ability', id: aBench, index: 0 })
check(s.log[s.log.length - 1].text.includes('Warm Up') && s.players[0].abilitiesThisTurn?.length === 1, 'usar Habilidade fica registrado no histórico')
// vitória: pegar o último Prêmio
for (const id of [...s.players[0].zones.prizes]) act(0, { t: 'takePrize', id })
check(s.winner === 0, 'pegar o último Prêmio dá a vitória')

// ================= Item 3: ferramentas do Magic =================
console.log('— Item 3: Magic — fichas, veneno, marcadores, topo, Commander e alvo do ataque')
const cmdr = mtg({ name: 'Krenko, Mob Boss', manaCost: '{2}{R}{R}', cmc: 4, typeLine: 'Legendary Creature — Goblin Warrior', power: '3', toughness: '3' })
const walker = mtg({ name: 'Chandra', manaCost: '{2}{R}', cmc: 3, typeLine: 'Legendary Planeswalker — Chandra' })
s = createSandbox({
  game: 'mtg',
  format: 'Commander',
  seed: 7,
  firstPlayer: 0,
  startingLife: 40,
  freeMulligan: true,
  players: [0, 1, 2].map((i) => ({ name: 'P' + i, color: '#fff', isBot: false, deck: [...Array(40).fill(mountain), ...Array(20).fill(bear), ...Array(5).fill(walker)].map((card) => ({ card })), commanders: [{ card: cmdr }] }))
})
for (const p of [0, 1, 2]) act(p, { t: 'keep', bottom: [] })
// fichas
act(0, { t: 'token', name: 'Goblin', types: 'Creature — Goblin', power: '1', toughness: '1', count: 3 })
const goblins = s.players[0].zones.battlefield.filter((x) => s.objects[x].token)
check(goblins.length === 3 && s.objects[goblins[0]].card.typeLine.includes('Token'), 'criar 3 fichas Goblin 1/1')
act(0, { t: 'move', id: goblins[0], to: 'graveyard' })
check(!s.objects[goblins[0]] && !s.players[0].zones.graveyard.includes(goblins[0]), 'ficha que sai do campo deixa de existir')
const bearP = pull(0, 'Grizzly Bears')
act(0, { t: 'move', id: bearP, to: 'battlefield' })
act(0, { t: 'token', copyOf: bearP })
check(s.players[0].zones.battlefield.some((x) => s.objects[x].token && s.objects[x].card.name === 'Grizzly Bears'), 'criar cópia de uma permanente como ficha')
// veneno e marcadores
act(1, { t: 'poison', player: 2, delta: 10 })
check(s.players[2].poison === 10 && s.log.some((l) => l.text.includes('veneno') && l.text.includes('perde')), 'veneno: 10 marcadores avisam a derrota')
act(0, { t: 'counter', id: bearP, key: '-1/-1', delta: 1 })
act(0, { t: 'counter', id: bearP, key: 'escudo', delta: 2 })
check(s.objects[bearP].counters['-1/-1'] === 1 && s.objects[bearP].counters.escudo === 2, 'marcadores −1/−1 e com nome livre')
// olhar o topo
act(0, { t: 'lookTop', n: 3 })
check(s.log[s.log.length - 1].text.includes('olha as 3 cartas'), 'olhar as 3 do topo fica registrado')
// imposto e dano de comandante
const cmdId = s.players[0].zones.command[0]
act(0, { t: 'move', id: cmdId, to: 'battlefield' })
check(s.log[s.log.length - 1].text.includes('imposto: +0'), 'comandante: 1ª vez sem imposto')
act(0, { t: 'move', id: cmdId, to: 'command' })
act(0, { t: 'move', id: cmdId, to: 'battlefield' })
check(s.log[s.log.length - 1].text.includes('imposto: +2') && s.objects[cmdId].commanderCasts === 2, 'comandante: 2ª vez com imposto +2')
const lifeBefore = s.players[1].life
act(0, { t: 'commanderDamage', player: 1, source: cmdId, delta: 21 })
check(s.players[1].commanderDamage?.[cmdId] === 21 && s.players[1].life === lifeBefore - 21 && s.log.some((l) => l.text.includes('21 ou mais')), 'dano de comandante: tira vida e avisa aos 21')
// alvo do ataque (3 jogadores)
act(0, { t: 'step', to: 'declareAttackers' })
act(0, { t: 'attack', id: bearP, attackTarget: 2 })
check(s.objects[bearP].attackTarget === 2 && s.log[s.log.length - 1].text.includes('ataca P2'), 'multiplayer: ataque com alvo escolhido (P2)')

// ================= Commander contra 3 bots: quem perde sai da mesa =================
console.log('— Commander 4 jogadores')
s = createSandbox({ game: 'mtg', format: 'Commander', seed: 3, firstPlayer: 1, startingLife: 40, freeMulligan: true, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i, color: '#fff', isBot: i > 0, deck: [...Array(30).fill(mountain), ...Array(30).fill(bear)].map((card) => ({ card })) })) })
for (const p of [0, 1, 2, 3]) act(p, { t: 'keep', bottom: [] })
check(s.activePlayer === 1 && s.players.length === 4, '4 jogadores: partida começa com o bot 1')
const mt4 = pull(1, 'Mountain')
act(1, { t: 'move', id: mt4, to: 'battlefield' })
act(1, { t: 'token', name: 'Goblin', types: 'Creature — Goblin', power: '1', toughness: '1', count: 1 })
const tok = Object.values(s.objects).find((o) => o.token && o.owner === 1)!.id
const atk0 = pull(0, 'Grizzly Bears')
act(0, { t: 'move', id: atk0, to: 'battlefield' })
s.objects[atk0].attackTarget = 1
act(1, { t: 'life', player: 1, delta: -40 })
act(1, { t: 'concede' })
check(s.players[1].conceded && s.winner === null, 'bot 1 sai, a partida continua com 3')
check(!s.players[1].zones.battlefield.length && s.players[1].zones.exile.includes(mt4) && !s.objects[tok], 'as permanentes dele deixam a mesa (ficha some)')
check(s.objects[atk0].attackTarget === undefined, 'ataques contra quem saiu perdem o alvo')
check(s.activePlayer === 2, 'era a vez dele: o turno passa para o próximo vivo')
act(2, { t: 'concede' })
act(3, { t: 'concede' })
check(s.winner === 0, 'último jogador em pé vence')

console.log(fails ? `\nFalhas: ${fails}` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
