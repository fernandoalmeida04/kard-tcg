// Testa o registro de problemas do motor e as proteções contra erros silenciosos.
// Uso: node --experimental-strip-types --no-warnings scripts/engine-issues.ts
import { createGame, performAction, toughness, hasUnknownPT } from '../src/shared/engine/index.ts'
import type { GameCard, GameState } from '../src/shared/engine/index.ts'
import { mergeIssues, issuesToMarkdown } from '../src/shared/engineIssues.ts'

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) fails++
}
const mk = (name: string, manaCost: string, typeLine: string, oracleText: string, pt?: [string, string]): GameCard =>
  ({ oracleId: name, name, displayName: name, manaCost, cmc: 2, typeLine, displayType: typeLine, oracleText, displayText: oracleText, colors: ['W'], colorIdentity: ['W'], keywords: [], layout: 'normal', power: pt?.[0], toughness: pt?.[1] }) as GameCard
const plains = mk('Plains', '', 'Basic Land — Plains', '({T}: Add {W}.)')
const weird = mk('Weird Star', '{1}{W}', 'Creature — Spirit', "Weird Star's power and toughness are each equal to the number of times you sneezed.", ['*', '*'])
const devoted = mk('Devoted One', '{W}{W}', 'Creature — Human', "Devoted One's power and toughness are each equal to your devotion to white.", ['*', '*'])

function game(): GameState {
  return createGame({ format: 'Casual', startingLife: 20, aiEnabled: false, seed: 3, firstPlayer: 0, players: [0, 1].map((i) => ({ name: 'P' + i, isBot: false, deck: [weird, devoted, ...Array(40).fill(plains)], commanders: [] })) })
}
let s = game()
const put = (name: string) => {
  const o = Object.values(s.objects).find((x) => x.card.name === name && x.owner === 0)!
  const r = performAction(s, 0, { t: 'manual', op: { op: 'move', id: o.id, to: 'battlefield' } })
  if (r.error) throw new Error(r.error)
  s = r.state
  return o.id
}
const w = put('Weird Star')
check(s.battlefield.includes(w), 'criatura */* com regra desconhecida NÃO morre por resistência 0')
check(hasUnknownPT(s.objects[w]), 'hasUnknownPT detecta o "*" não entendido')
check((s.issues ?? []).some((i) => i.kind === 'unknownPT' && i.card === 'Weird Star'), 'problema unknownPT registrado')
check((s.issues ?? []).some((i) => i.kind === 'manual'), 'ajuste manual registrado')
let r = performAction(s, 0, { t: 'manual', op: { op: 'setPT', id: w, power: 3, toughness: 4 } })
check(!r.error, 'setPT aceito')
s = r.state
check(toughness(s, s.objects[w]) === 4 && !hasUnknownPT(s.objects[w]), 'setPT define resistência 4')
const d = put('Devoted One')
// {W}{W} da própria carta + {W} da Weird Star = devoção 3
check(s.battlefield.includes(d) && toughness(s, s.objects[d]) === 3, 'devoção a branco 3 → Devoted One tem resistência 3')
check(!(s.issues ?? []).some((i) => i.kind === 'unknownPT' && i.card === 'Devoted One'), 'devoção entendida: sem unknownPT')

// exceção interna: a jogada é desfeita e a partida continua
const broken = structuredClone(s)
const handCard = broken.players[0].hand[0]
;(broken.objects[handCard] as unknown as { card: unknown }).card = null
r = performAction(broken, 0, { t: 'cast', id: handCard, targets: [] })
check(Boolean(r.error && r.crash), 'exceção interna vira erro + crash, sem derrubar a partida')
check(r.state === broken, 'estado anterior preservado após exceção')

// agregação e relatório
const evs = (s.issues ?? []).map((i) => ({ ...i, format: 'Casual' }))
let list = mergeIssues([], evs, '0.0.0')
list = mergeIssues(list, evs, '0.0.0')
check(list.every((i) => i.count >= 2), 'mesmos problemas são agregados com contador')
const md = issuesToMarkdown(list, { appVersion: '0.0.0' })
check(md.includes('Weird Star') && md.includes('## '), 'relatório Markdown gerado')
console.log(fails ? `\nFalhas: ${fails}` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
