// Partidas bot x bot com decks focados nos mecanismos mais recentes do motor (cartas reais do banco).
// Uso: node --experimental-strip-types scripts/engine-mechanics.ts [partidas]
import fs from 'fs'
import { createGame, performAction, botAction, botFallback, actingPlayer, parseCardFaces, isFullySupported } from '../src/shared/engine/index.ts'
import type { GameCard, GameState, PlayerId } from '../src/shared/engine/index.ts'
import type { CardData } from '../src/shared/types.ts'

const data = JSON.parse(fs.readFileSync('database/cards.json', 'utf8')) as { cards: CardData[] }
const byName = new Map(data.cards.map((c) => [c.name, c]))

function toGameCard(c: CardData): GameCard {
  return {
    oracleId: c.oracleId, name: c.name, displayName: c.localName || c.name, manaCost: c.manaCost, cmc: c.cmc,
    typeLine: c.typeLine, displayType: c.localTypeLine || c.typeLine, oracleText: c.oracleText, displayText: c.localText || c.oracleText,
    power: c.power, toughness: c.toughness, loyalty: c.loyalty, colors: c.colors, colorIdentity: c.colorIdentity, keywords: c.keywords,
    producedMana: c.producedMana, layout: c.layout, printingId: c.defaultPrintingId,
    faces: c.faces?.map((f) => ({ name: f.name, displayName: f.localName || f.name, manaCost: f.manaCost, typeLine: f.typeLine, displayType: f.localTypeLine || f.typeLine, oracleText: f.oracleText, displayText: f.localText || f.oracleText, power: f.power, toughness: f.toughness, loyalty: f.loyalty, colors: f.colors ?? c.colors }))
  }
}

const UB = [
  'Thoughtseize', 'Duress', 'Unsummon', 'Preordain', 'Impulse', 'Cryptic Command', 'Reverberate', 'Altar\'s Reap', 'Diabolic Tutor',
  'Drudge Skeletons', 'Dimir Aqueduct', 'Talisman of Dominance', 'Fact or Fiction', 'Archmage of Runes', 'Merfolk Looter', 'Gray Merchant of Asphodel',
  'Chainer\'s Edict', 'Vampiric Tutor', 'Watery Grave', 'Darkslick Shores'
]
const RGW = [
  'Light Up the Stage', 'Fling', 'Momentary Blink', 'Fog', 'Temporal Manipulation', 'Rampant Growth', 'Growth Spiral', 'Selesnya Sanctuary',
  'Talisman of Impulse', 'Ajani\'s Pridemate', 'Conclave Phalanx', 'Beanstalk Giant', 'Keeper of Keys', 'Contagion Clasp', 'Rally the Ranks',
  'Elvish Visionary', 'Ephemerate', 'Fiery Confluence', 'Stomping Ground', 'Copperline Gorge', 'Lightning Helix', 'Llanowar Elves'
]

function build(names: string[], basics: string[]): GameCard[] {
  const deck: GameCard[] = []
  const missing: string[] = []
  for (const n of names) {
    const c = byName.get(n)
    if (!c) {
      missing.push(n)
      continue
    }
    const supported = parseCardFaces(c).every(isFullySupported)
    if (!supported) console.log(`  (parcial) ${n}`)
    for (let k = 0; k < 2; k++) deck.push(toGameCard(c))
  }
  if (missing.length) console.log('  não encontradas:', missing.join(', '))
  let i = 0
  while (deck.length < 60) deck.push(toGameCard(byName.get(basics[i++ % basics.length])!))
  return deck
}

console.log('Deck UB:')
const deckA = build(UB, ['Island', 'Swamp'])
console.log('Deck RGW:')
const deckB = build(RGW, ['Forest', 'Mountain', 'Plains'])
const tracked = [...UB, ...RGW]
const used = new Map<string, number>()
const games = Number(process.argv[2] ?? 20)
let crashes = 0
let refused = 0
const refusedSamples: string[] = []
for (let g = 0; g < games; g++) {
  let state: GameState = createGame({
    format: 'casual', startingLife: 20, seed: g * 7777 + 3, aiEnabled: false,
    players: [
      { name: 'UB', isBot: true, deck: deckA, commanders: [] },
      { name: 'RGW', isBot: true, deck: deckB, commanders: [] }
    ]
  })
  try {
    let steps = 0
    for (; steps < 10000 && state.winner === null && state.turn < 50; steps++) {
      const p = actingPlayer(state) as PlayerId | null
      if (p === null) throw new Error(`travou: ${JSON.stringify({ step: state.step, ai: !!state.pendingAI, choices: state.choices.length })}`)
      const a = botAction(state, p)!
      let r = performAction(state, p, a)
      if (r.error) {
        refused++
        if (refusedSamples.length < 15) refusedSamples.push(`${a.t}: ${r.error}`)
        r = performAction(state, p, botFallback(state, p))
        if (r.error) throw new Error(`fallback recusado: ${r.error} :: ${JSON.stringify(state.choices[0] ?? state.awaiting ?? state.step).slice(0, 300)}`)
      }
      state = r.state
    }
    for (const l of state.log) {
      const m = l.text.match(/(?:conjura|ativa|joga) (.+?)(?: \(|:|\.$)/)
      if (m) {
        const name = tracked.find((t) => m[1].startsWith(state.objects ? t : t))
        void name
      }
    }
    for (const o of Object.values(state.objects)) {
      if (tracked.includes(o.card.name) && (o.zone === 'graveyard' || o.zone === 'battlefield' || o.zone === 'exile')) used.set(o.card.name, (used.get(o.card.name) ?? 0) + 1)
    }
    const w = state.winner === null ? 'nenhum (limite)' : state.winner === 'draw' ? 'empate' : state.winner === 0 ? 'UB' : 'RGW'
    console.log(`Partida ${g + 1}: ${w}, turno ${state.turn}, ${steps} ações`)
  } catch (err) {
    crashes++
    console.log(`Partida ${g + 1}: ERRO -> ${(err as Error).stack?.split('\n').slice(0, 5).join(' | ')}`)
  }
}
console.log(`\nFalhas: ${crashes}/${games}. Ações recusadas: ${refused}`)
for (const s of refusedSamples) console.log('  ' + s)
console.log('\nCartas que passaram por jogo (campo/cemitério/exílio), somando partidas:')
console.log('  ' + tracked.map((t) => `${t}: ${used.get(t) ?? 0}`).join(' · '))
