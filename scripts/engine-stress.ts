// Bot contra bot com decks aleatórios de cartas reais do banco local.
// Uso: node --experimental-strip-types scripts/engine-stress.ts [partidas]
import fs from 'fs'
import { createGame, performAction, botAction, botFallback, actingPlayer } from '../src/shared/engine/index.ts'
import type { GameCard, GameState, PlayerId } from '../src/shared/engine/index.ts'
import type { CardData } from '../src/shared/types.ts'

const data = JSON.parse(fs.readFileSync('database/cards.json', 'utf8')) as { cards: CardData[] }
const legal = data.cards.filter((c) => c.legalities.vintage || c.legalities.commander)
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

const BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
function randomDeck(colors: string[], seed: number): GameCard[] {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pool = legal.filter((c) => !/\bLand\b/.test(c.typeLine) && c.colorIdentity.every((x) => colors.includes(x)) && c.cmc <= 6)
  const deck: GameCard[] = []
  while (deck.length < 36) {
    const c = pool[Math.floor(rnd() * pool.length)]
    for (let k = 0; k < 2 && deck.length < 36; k++) deck.push(toGameCard(c))
  }
  for (let i = 0; i < 24; i++) deck.push(toGameCard(byName.get(BASIC[colors[i % colors.length]])!))
  return deck
}

const COLORS = [['R', 'G'], ['W', 'U'], ['B', 'R'], ['G', 'W'], ['U', 'B'], ['W', 'B'], ['U', 'R']]
const games = Number(process.argv[2] ?? 20)
let crashes = 0
let refused = 0
const refusedSamples: string[] = []
for (let g = 0; g < games; g++) {
  const c1 = COLORS[g % COLORS.length]
  const c2 = COLORS[(g + 3) % COLORS.length]
  let state: GameState = createGame({
    format: 'casual', startingLife: 20, seed: g * 31337 + 1, aiEnabled: false,
    players: [
      { name: 'Bot A', isBot: true, deck: randomDeck(c1, g * 7 + 1), commanders: [] },
      { name: 'Bot B', isBot: true, deck: randomDeck(c2, g * 13 + 5), commanders: [] }
    ]
  })
  try {
    let steps = 0
    for (; steps < 8000 && state.winner === null && state.turn < 50; steps++) {
      const p = actingPlayer(state) as PlayerId | null
      if (p === null) throw new Error(`travou: ${JSON.stringify({ step: state.step, ai: !!state.pendingAI, choices: state.choices.length })}`)
      const a = botAction(state, p)!
      let r = performAction(state, p, a)
      if (r.error) {
        refused++
        if (refusedSamples.length < 12) refusedSamples.push(`${a.t}: ${r.error}`)
        r = performAction(state, p, botFallback(state, p))
        if (r.error) throw new Error(`fallback recusado: ${r.error} :: ${JSON.stringify(state.choices[0] ?? state.awaiting ?? state.step)}`)
      }
      state = r.state
    }
    const w = state.winner === null ? 'nenhum (limite)' : state.winner === 'draw' ? 'empate' : `Bot ${state.winner === 0 ? 'A' : 'B'}`
    console.log(`Partida ${g + 1} (${c1.join('')} x ${c2.join('')}): ${w}, turno ${state.turn}, ${steps} ações`)
  } catch (err) {
    crashes++
    console.log(`Partida ${g + 1}: ERRO -> ${(err as Error).stack?.split('\n').slice(0, 4).join(' | ')}`)
  }
}
console.log(`\nFalhas: ${crashes}/${games}. Ações recusadas pelo juiz: ${refused}`)
for (const s of refusedSamples) console.log('  ' + s)
