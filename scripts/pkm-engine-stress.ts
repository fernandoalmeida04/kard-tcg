// Teste de estresse do motor de Pokémon: bot contra bot com decks montados do banco local.
// Uso: node --experimental-strip-types --no-warnings scripts/pkm-engine-stress.ts [partidas]
import fs from 'fs'
import { createGame, performAction, pkmBotAction, pkmBotFallback, canAct, isCardAutomated } from '../src/shared/pkm-engine/index.ts'
import type { PAction, PGameCard, PGameState } from '../src/shared/pkm-engine/index.ts'
import type { PkmCard, PkmType } from '../src/shared/pokemon/types.ts'

const GAMES = Number(process.argv[2]) || 30
const db = JSON.parse(fs.readFileSync('database/pokemon.json', 'utf8'))
const all: PkmCard[] = Array.isArray(db.cards) ? db.cards : Object.values(db.cards)
const legal = all.filter((c) => c.legal?.standard || c.legal?.expanded)
const byName = (n: string) => legal.find((c) => c.name === n) ?? all.find((c) => c.name === n)

let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

function deckFor(type: PkmType): PGameCard[] {
  const basics = legal.filter((c) => c.category === 'Pokemon' && c.stage === 'Basic' && c.types.includes(type) && (c.hp ?? 0) >= 60 && c.attacks.length && c.attacks.every((a) => a.cost.every((x) => x === type || x === 'Colorless')))
  const pool = basics.filter((c) => isCardAutomated(c))
  const picked: PkmCard[] = []
  for (let i = 0; i < 5 && pool.length; i++) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
  // uma linha de evolução, se houver
  const stage1 = legal.find((c) => c.stage === 'Stage1' && c.types.includes(type) && picked.some((b) => b.name === c.evolveFrom))
  const cards: PkmCard[] = []
  for (const c of picked) for (let i = 0; i < 4; i++) cards.push(c)
  if (stage1) for (let i = 0; i < 3; i++) cards.push(stage1)
  for (const n of ['Potion', 'Switch', 'Nest Ball', "Professor's Research", 'Ultra Ball', "Boss's Orders", 'Energy Retrieval', 'Rare Candy']) {
    const c = byName(n)
    if (c) for (let i = 0; i < 2; i++) cards.push(c)
  }
  const energy = byName(`${type} Energy`) ?? byName(`Basic ${type} Energy`)
  while (cards.length < 60 && energy) cards.push(energy)
  return cards.slice(0, 60).map((card) => ({ card, printingId: card.defaultPrintingId }))
}

const TYPES: PkmType[] = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal']
let failures = 0
let rejected = 0
let crashes = 0
const winners: Record<string, number> = {}

function play(setupSeed: number, decks: [PGameCard[], PGameCard[]]): { state: PGameState; actions: { p: number; a: PAction }[] } {
  let state = createGame({ format: 'Teste', seed: setupSeed, players: [{ name: 'Bot A', isBot: true, deck: decks[0] }, { name: 'Bot B', isBot: true, deck: decks[1] }], evolutions: {} })
  const actions: { p: number; a: PAction }[] = []
  for (let step = 0; step < 4000 && state.winner === null; step++) {
    const p = [0, 1].find((x) => canAct(state, x))
    if (p === undefined) throw new Error(`ninguém pode agir (passo ${step}, etapa ${state.step}, escolhas ${state.choices.length}, resolvendo ${Boolean(state.resolving)})`)
    let a = pkmBotAction(state, p)!
    let r = performAction(state, p, a)
    if (r.crash) {
      crashes++
      console.log('ERRO INTERNO:', r.crash.split('\n').slice(0, 4).join(' | '), JSON.stringify(a))
    }
    if (r.error) {
      rejected++
      if (rejected < 15) console.log('  recusada:', r.error, JSON.stringify(a))
      a = pkmBotFallback(state, p)
      r = performAction(state, p, a)
      if (r.error) throw new Error(`fallback recusado: ${r.error} ${JSON.stringify(a)}`)
    }
    actions.push({ p, a })
    state = r.state
  }
  return { state, actions }
}

for (let g = 0; g < GAMES; g++) {
  const t1 = TYPES[g % TYPES.length]
  const t2 = TYPES[(g * 3 + 1) % TYPES.length]
  const decks: [PGameCard[], PGameCard[]] = [deckFor(t1), deckFor(t2)]
  try {
    const { state, actions } = play(1000 + g, decks)
    const w = state.winner === null ? 'sem fim' : state.winner === 'draw' ? 'empate' : state.players[state.winner].name
    winners[w] = (winners[w] ?? 0) + 1
    // determinismo: reproduzir as mesmas ações dá o mesmo estado
    let replay = createGame({ format: 'Teste', seed: 1000 + g, players: [{ name: 'Bot A', isBot: true, deck: decks[0] }, { name: 'Bot B', isBot: true, deck: decks[1] }], evolutions: {} })
    for (const x of actions) replay = performAction(replay, x.p, x.a).state
    const same = JSON.stringify(replay) === JSON.stringify(state)
    if (!same) failures++
    console.log(`Partida ${g + 1} (${t1} x ${t2}): ${w}, turno ${state.turn}, ${actions.length} ações, prêmios ${state.players.map((p) => p.prizes.length).join('/')}${same ? '' : ' · NÃO DETERMINÍSTICA'}`)
    if (w === 'sem fim') failures++
  } catch (err) {
    failures++
    console.log(`Partida ${g + 1}: FALHA — ${(err as Error).message}`)
  }
}
console.log(`\nVencedores: ${JSON.stringify(winners)}`)
console.log(`Falhas: ${failures}/${GAMES} · ações recusadas: ${rejected} · erros internos: ${crashes}`)
process.exit(failures || crashes ? 1 : 0)
