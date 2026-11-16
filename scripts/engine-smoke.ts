// Teste de fumaça do motor: bot contra bot com cartas sintéticas.
// Rode com: npm run test:engine
import { createGame, performAction, botAction, botFallback, actingPlayer, parseCard, isFullySupported } from '../src/shared/engine/index.ts'
import type { GameCard, GameState, PlayerId } from '../src/shared/engine/index.ts'

function card(name: string, manaCost: string, typeLine: string, oracleText: string, pt?: [number, number], keywords: string[] = [], colors: string[] = []): GameCard {
  const cmc = (manaCost.match(/\{(\d+)\}/g) ?? []).reduce((s, x) => s + parseInt(x.slice(1, -1)), 0) + (manaCost.match(/\{[WUBRG]\}/g) ?? []).length
  return {
    oracleId: name,
    name,
    displayName: name,
    manaCost,
    cmc,
    typeLine,
    displayType: typeLine,
    oracleText,
    displayText: oracleText,
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
    colors,
    colorIdentity: colors,
    keywords,
    layout: 'normal'
  }
}

const Mountain = card('Mountain', '', 'Basic Land — Mountain', '({T}: Add {R}.)')
const Forest = card('Forest', '', 'Basic Land — Forest', '({T}: Add {G}.)')
const Island = card('Island', '', 'Basic Land — Island', '({T}: Add {U}.)')
const Plains = card('Plains', '', 'Basic Land — Plains', '({T}: Add {W}.)')

const pool: GameCard[] = [
  card('Lightning Bolt', '{R}', 'Instant', 'Lightning Bolt deals 3 damage to any target.', undefined, [], ['R']),
  card('Grizzly Bears', '{1}{G}', 'Creature — Bear', '', [2, 2], [], ['G']),
  card('Llanowar Elves', '{G}', 'Creature — Elf Druid', '{T}: Add {G}.', [1, 1], [], ['G']),
  card('Giant Growth', '{G}', 'Instant', 'Target creature gets +3/+3 until end of turn.', undefined, [], ['G']),
  card('Goblin Guide', '{R}', 'Creature — Goblin Scout', 'Haste', [2, 2], ['Haste'], ['R']),
  card('Craw Wurm', '{4}{G}{G}', 'Creature — Wurm', '', [6, 4], [], ['G']),
  card('Rampant Growth', '{1}{G}', 'Sorcery', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', undefined, [], ['G']),
  card('Shock', '{R}', 'Instant', 'Shock deals 2 damage to any target.', undefined, [], ['R']),
  card('Hill Giant', '{3}{R}', 'Creature — Giant', '', [3, 3], [], ['R']),
  card('Prodigal Pyromancer', '{2}{R}', 'Creature — Human Wizard', '{T}: Prodigal Pyromancer deals 1 damage to any target.', [1, 1], [], ['R']),
  card('Flametongue Kavu', '{3}{R}', 'Creature — Kavu', 'When Flametongue Kavu enters, it deals 4 damage to target creature.', [4, 2], [], ['R']),
  card('Rancor', '{G}', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.', undefined, [], ['G']),
  card('Garruk\'s Companion', '{G}{G}', 'Creature — Beast', 'Trample', [3, 2], ['Trample'], ['G']),
  card('Ancestral Recall', '{U}', 'Instant', 'Target player draws three cards.', undefined, [], ['U']),
  card('Counterspell', '{U}{U}', 'Instant', 'Counter target spell.', undefined, [], ['U']),
  card('Serra Angel', '{3}{W}{W}', 'Creature — Angel', 'Flying, vigilance', [4, 4], ['Flying', 'Vigilance'], ['W']),
  card('Pacifism', '{1}{W}', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t attack or block.', undefined, [], ['W']),
  card('Raise the Alarm', '{1}{W}', 'Instant', 'Create two 1/1 white Soldier creature tokens.', undefined, [], ['W']),
  card('Divination', '{2}{U}', 'Sorcery', 'Draw two cards.', undefined, [], ['U']),
  card('Opt', '{U}', 'Instant', 'Scry 1.\nDraw a card.', undefined, [], ['U']),
  card('Wrath of God', '{2}{W}{W}', 'Sorcery', 'Destroy all creatures. They can\'t be regenerated.', undefined, [], ['W']),
  card('Glorious Anthem', '{1}{W}{W}', 'Enchantment', 'Creatures you control get +1/+1.', undefined, [], ['W']),
  card('Bonesplitter', '{1}', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}', undefined, [], []),
  card('Swords to Plowshares', '{W}', 'Instant', 'Exile target creature. Its controller gains life equal to its power.', undefined, [], ['W']),
  card('Lightning Helix', '{R}{W}', 'Instant', 'Lightning Helix deals 3 damage to any target and you gain 3 life.', undefined, [], ['R', 'W']),
  card('Treasure Map Guy', '{2}{R}', 'Creature — Pirate', 'When Treasure Map Guy enters, create a Treasure token.', [2, 2], [], ['R'])
]

const deckRG: GameCard[] = []
const deckWU: GameCard[] = []
for (let i = 0; i < 9; i++) deckRG.push(Mountain, Forest)
for (let i = 0; i < 9; i++) deckWU.push(Plains, Island)
const rg = pool.filter((c) => c.colors.every((x) => x === 'R' || x === 'G'))
const wu = pool.filter((c) => c.colors.every((x) => x === 'W' || x === 'U'))
while (deckRG.length < 40) deckRG.push(rg[deckRG.length % rg.length])
while (deckWU.length < 40) deckWU.push(wu[deckWU.length % wu.length])

// Cobertura do parser nas cartas sintéticas
let unsupported = 0
for (const c of pool) {
  const p = parseCard({ name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, keywords: c.keywords })
  if (!isFullySupported(p)) {
    unsupported++
    console.log(`  [parcial] ${c.name}: ${JSON.stringify([...p.unsupported, ...(p.spell?.unsupported ?? []), ...p.triggers.flatMap((t) => t.unsupported)])}`)
  }
}
console.log(`Parser: ${pool.length - unsupported}/${pool.length} cartas totalmente suportadas.`)

function playGame(seed: number): { winner: GameState['winner']; turns: number; errors: number } {
  let state = createGame({
    format: 'casual',
    startingLife: 20,
    seed,
    aiEnabled: false,
    players: [
      { name: 'Bot A', isBot: true, deck: deckRG, commanders: [] },
      { name: 'Bot B', isBot: true, deck: deckWU, commanders: [] }
    ]
  })
  let errors = 0
  for (let i = 0; i < 5000 && state.winner === null && state.turn < 60; i++) {
    if (state.pendingAI) {
      const r = performAction(state, state.pendingAI.item.controller, { t: 'aiSkip', reason: 'teste' })
      state = r.state
      continue
    }
    const p = actingPlayer(state) as PlayerId | null
    if (p === null) throw new Error('Ninguém pode agir: ' + JSON.stringify({ step: state.step, choices: state.choices, awaiting: state.awaiting }))
    const a = botAction(state, p)!
    let r = performAction(state, p, a)
    if (r.error) {
      errors++
      if (errors < 15) console.log(`  erro do bot (${a.t}): ${r.error}`)
      r = performAction(state, p, botFallback(state, p))
      if (r.error) throw new Error(`Fallback falhou: ${r.error} ${JSON.stringify(state.choices[0] ?? state.awaiting)}`)
    }
    state = r.state
  }
  return { winner: state.winner, turns: state.turn, errors }
}

let total = 0
for (let s = 1; s <= 30; s++) {
  const r = playGame(s * 7919)
  total += r.errors
  console.log(`Partida ${s}: vencedor=${r.winner === null ? 'nenhum' : r.winner === 'draw' ? 'empate' : r.winner === 0 ? 'Bot A' : 'Bot B'} em ${r.turns} turnos (${r.errors} ações recusadas)`)
}
console.log(`Total de ações recusadas pelo juiz: ${total}`)
