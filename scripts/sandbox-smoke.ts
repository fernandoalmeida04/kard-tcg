// Testa a mesa livre: ações manuais, histórico, reconstrução (Juiz IA) e determinismo.
// Uso: node --experimental-strip-types --no-warnings scripts/sandbox-smoke.ts
import { createSandbox, performSandbox, poolPayment, describeState } from '../src/shared/sandbox/index.ts'
import { judgePrompt, judgeFacts, parseJudge, parseBot, botPrompt } from '../src/shared/sandbox/ai.ts'
import { pkmCanAttack, pkmPlayable, mtgPlayable, mtgCanAttack } from '../src/shared/sandbox/hints.ts'
import type { SAction, SState, SSetup } from '../src/shared/sandbox/index.ts'
import type { PkmCard } from '../src/shared/pokemon/types.ts'
import type { GameCard } from '../src/shared/engine/types.ts'

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) fails++
}

// ---------- Pokémon ----------
const pika: PkmCard = { id: 'pika', name: 'Pikachu ex', category: 'Pokemon', hp: 190, types: ['Lightning'], stage: 'Basic', suffix: 'ex', retreat: 1, weaknesses: [{ type: 'Fighting', value: '×2' }], resistances: [], attacks: [{ name: 'Thunder', cost: ['Lightning', 'Lightning'], damage: '120' }], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [] }
const light: PkmCard = { id: 'L', name: 'Lightning Energy', category: 'Energy', energyType: 'Normal', types: [], weaknesses: [], resistances: [], attacks: [], abilities: [], legal: { standard: true, expanded: true }, regulationMarks: [], defaultPrintingId: '', printingIds: [] }
const deck = [...Array(8).fill(pika), ...Array(52).fill(light)].map((card) => ({ card }))
const setup: SSetup = { game: 'pokemon', format: 'Teste', seed: 42, firstPlayer: 0, players: [{ name: 'A', color: '#e4572e', isBot: false, deck }, { name: 'B', color: '#2f80ed', isBot: true, deck }] }
let s: SState = createSandbox(setup)
const hist: { seat: number; action: SAction }[] = []
const act = (p: number, a: SAction) => {
  const r = performSandbox(s, p, a)
  if (r.error) throw new Error(`${r.error} ${JSON.stringify(a)}`)
  s = r.state
  hist.push({ seat: p, action: a })
}
check(s.players.every((p) => p.zones.hand.length === 7), 'mão inicial de 7 para cada jogador')
// garante um Pikachu e duas energias na mão de A
const pull = (p: number, name: string) => {
  const pl = s.players[p]
  const inHand = pl.zones.hand.find((id) => s.objects[id].card.name === name && !hist.some((h) => 'id' in h.action && (h.action as { id: string }).id === id))
  if (inHand) return inHand
  const id = pl.zones.deck.find((x) => s.objects[x].card.name === name)!
  act(p, { t: 'move', id, to: 'hand' })
  return id
}
const p1 = pull(0, 'Pikachu ex')
act(0, { t: 'move', id: p1, to: 'active' })
act(0, { t: 'setupPrizes' })
check(s.players[0].zones.prizes.length === 6, 'separa 6 prêmios virados')
const e1 = pull(0, 'Lightning Energy')
check(pkmPlayable(s, 0, e1), 'indicador: Energia pode ser ligada (nenhuma ligada no turno)')
act(0, { t: 'attach', id: e1, target: p1 })
const e2 = s.players[0].zones.hand.find((id) => s.objects[id].card.name === 'Lightning Energy' && id !== e1) ?? pull(0, 'Lightning Energy')
check(!pkmPlayable(s, 0, e2), 'indicador: segunda Energia no turno não brilha')
act(0, { t: 'attach', id: e2, target: p1 }) // a mesa livre deixa (o juiz decide)
check(s.log[s.log.length - 1].text.includes('liga'), 'segunda Energia é permitida (sem regra) e registrada')
check(!pkmCanAttack(s, 0, p1), 'indicador: no turno 1 quem começa não pode atacar')
check(!s.firstDrawDone, 'Pokémon: a compra do turno 1 espera o oponente terminar a preparação')
// oponente prepara: Ativo + Prêmios → quem começa compra sozinho
const handA = s.players[0].zones.hand.length
const pB = s.players[1].zones.hand.find((id) => s.objects[id].card.name === 'Pikachu ex') ?? s.players[1].zones.deck.find((id) => s.objects[id].card.name === 'Pikachu ex')!
if (!s.players[1].zones.hand.includes(pB)) act(1, { t: 'move', id: pB, to: 'hand' })
act(1, { t: 'move', id: pB, to: 'active' })
act(1, { t: 'setupPrizes' })
check(s.firstDrawDone === true && s.players[0].zones.hand.length === handA + 1, 'Pokémon: preparação concluída → quem começa compra 1 carta automaticamente')
// condição para a Verificação Pokémon
act(0, { t: 'condition', id: pB, cond: 'poisoned' })
const handB2 = s.players[1].zones.hand.length
act(0, { t: 'passTurn' })
check(s.objects[pB].damage === 10 && s.log.some((l) => l.text.includes('Envenenado: +10')), 'Verificação Pokémon: Envenenado recebe 10 de dano entre os turnos')
check(s.players[1].zones.hand.length === handB2 + 1, 'Pokémon: início do turno compra 1 carta automaticamente')
act(1, { t: 'condition', id: p1, cond: 'paralyzed' })
act(1, { t: 'passTurn' })
check(s.objects[p1].conditions?.includes('paralyzed') === true, 'Paralisado continua durante o próximo turno do dono')
act(0, { t: 'condition', id: p1, cond: 'paralyzed' })
check(pkmCanAttack(s, 0, p1), 'indicador: com 2 Energias no turno 3 o Pikachu pode atacar')
act(0, { t: 'attack', id: p1, index: 0 })
check(s.log.some((l) => l.text.includes('Thunder')), 'ataque é anunciado no histórico')
const logLine = s.log.filter((l) => l.text.includes('liga'))[1]
check(logLine.seq >= 0 && logLine.player === 0, 'linha do histórico guarda a ação e o jogador (cor)')

// reconstrução para o juiz
const replay = (n: number) => {
  let st = createSandbox(setup)
  for (let i = 0; i < n; i++) st = performSandbox(st, hist[i].seat, hist[i].action).state
  return st
}
const before = replay(logLine.seq)
const after = replay(logLine.seq + 1)
check(JSON.stringify(replay(hist.length)) === JSON.stringify(s), 'determinismo: reproduzir as ações dá o mesmo estado')
const jp = judgePrompt(before, after, logLine, hist[logLine.seq].action, 'A')
check(jp.user.includes('energy attached this turn 1') && jp.user.includes('Pikachu ex'), 'prompt do juiz mostra a mesa antes (1 Energia já ligada no turno)')
const v = parseJudge('```json\n{"valid": false, "title": "Jogada inválida: só 1 Energia por turno.", "explanation": "Regra..."}\n```')
check(!v.valid && v.title.startsWith('Jogada inválida'), 'lê o veredito do juiz')
const bp = botPrompt(s, 1, 'turn')
check(bp.system.includes('takePrize') && bp.user.includes('hand:'), 'prompt do bot tem vocabulário e a mão dele')
const plan = parseBot('{"actions":[{"t":"draw","n":1},{"t":"hack"},{"t":"passTurn"}],"say":"oi"}')
check(plan.actions.length === 1 && plan.say === 'oi', 'bot: ações desconhecidas e passTurn são descartados')

// ---------- Magic ----------
const mountain = { oracleId: 'm', name: 'Mountain', displayName: 'Montanha', manaCost: '', cmc: 0, typeLine: 'Basic Land — Mountain', displayType: '', oracleText: '({T}: Add {R}.)', displayText: '', colors: [], colorIdentity: ['R'], keywords: [], producedMana: ['R'], layout: 'normal' } as GameCard
const bolt = { oracleId: 'b', name: 'Raging Goblin', displayName: 'Goblin', manaCost: '{R}', cmc: 1, typeLine: 'Creature — Goblin', displayType: '', oracleText: 'Haste', displayText: '', colors: ['R'], colorIdentity: ['R'], keywords: ['Haste'], power: '1', toughness: '1', layout: 'normal' } as GameCard
const mdeck = [...Array(20).fill(mountain), ...Array(20).fill(bolt)].map((card) => ({ card }))
s = createSandbox({ game: 'mtg', format: 'Casual', seed: 3, firstPlayer: 0, startingLife: 20, players: [{ name: 'A', color: '#f00', isBot: false, deck: mdeck }, { name: 'B', color: '#00f', isBot: false, deck: mdeck }] })
hist.length = 0
// ---------- mão inicial (mulligan de Londres) ----------
check(s.step === 'mulligan', 'Magic: a partida começa com a decisão das mãos iniciais')
act(1, { t: 'mulligan' })
check(s.players[1].mulligans === 1 && s.players[1].zones.hand.length === 7, 'mulligan: embaralha e compra 7 de novo')
check(Boolean(performSandbox(s, 1, { t: 'keep', bottom: [] }).error), 'mulligan de Londres: manter exige pôr 1 carta no fundo')
const libBefore = s.players[1].zones.library.length
act(1, { t: 'keep', bottom: [s.players[1].zones.hand[0]] })
check(s.players[1].kept === true && s.players[1].zones.hand.length === 6 && s.players[1].zones.library.length === libBefore + 1, 'mantém com 6 cartas e põe 1 no fundo do grimório')
check(s.step === 'mulligan', 'a partida espera todos manterem')
act(0, { t: 'keep', bottom: [] })
const land = s.players[0].zones.library.find((id) => s.objects[id].card.name === 'Mountain')!
act(0, { t: 'move', id: land, to: 'hand' })
check(mtgPlayable(s, 0, land), 'indicador: terreno brilha (nenhum baixado no turno)')
act(0, { t: 'move', id: land, to: 'battlefield' })
const gob = s.players[0].zones.library.find((id) => s.objects[id].card.name === 'Raging Goblin')!
act(0, { t: 'move', id: gob, to: 'hand' })
check(!mtgPlayable(s, 0, gob), 'indicador: sem mana gerada, a criatura não brilha')
act(0, { t: 'tapForMana', id: land, color: 'R' })
check(s.players[0].pool.R === 1 && mtgPlayable(s, 0, gob), 'virar Montanha gera {R} e a criatura passa a brilhar')
act(0, { t: 'move', id: gob, to: 'battlefield' })
check(!s.players[0].pool.R, 'jogar a carta desconta a mana gerada')
check(s.step === 'main1', 'Magic: a partida abre na fase principal 1 (quem começa não compra)')
check(!mtgCanAttack(s, 0, gob), 'indicador: na fase principal o ataque ainda não brilha')
act(0, { t: 'step', to: 'declareAttackers' })
check(s.step === 'declareAttackers' && mtgCanAttack(s, 0, gob), 'indicador: em "declarar atacantes" a criatura com Ímpeto brilha')
check(Boolean(performSandbox(s, 0, { t: 'step', to: 'main1' }).error), 'etapas só avançam (voltar é recusado)')
act(0, { t: 'attack', id: gob })
check(s.objects[gob].attacking === true && s.objects[gob].tapped === true, 'atacante marcado e virado')
act(0, { t: 'life', player: 1, delta: -1 })
check(s.players[1].life === 19, 'vida ajustada manualmente')
check(poolPayment({ R: 1, G: 1 }, '{1}{G}') !== null && poolPayment({ R: 2 }, '{G}') === null, 'cálculo de pagamento com a reserva')
check(describeState(s).includes('Raging Goblin'), 'resumo da mesa para a IA')
// início do turno automático: o próximo jogador desvira e compra
const handB = s.players[1].zones.hand.length
const landB = s.players[1].zones.library.find((id) => s.objects[id].card.name === 'Mountain')!
s.objects[landB].tapped = true
s.players[1].zones.library.splice(s.players[1].zones.library.indexOf(landB), 1)
s.players[1].zones.battlefield.push(landB)
act(0, { t: 'passTurn' })
check(s.activePlayer === 1 && s.step === 'main1', 'passar o turno: o próximo jogador já começa na fase principal 1')
check(s.players[1].zones.hand.length === handB + 1, 'início do turno: compra 1 carta automaticamente')
check(s.objects[landB].tapped === false, 'início do turno: desvira as permanentes automaticamente')
check(!s.objects[gob].attacking, 'marcações de ataque saem ao passar o turno')

// ---------- Juiz: fatos calculados (caso do Pariah's Shield: custo 5 com 1 terreno) ----------
const plains = { ...mountain, oracleId: 'p', name: 'Plains', displayName: 'Planície', typeLine: 'Basic Land — Plains', producedMana: ['W'] } as GameCard
const shield = { oracleId: 'ps', name: "Pariah's Shield", displayName: "Pariah's Shield", manaCost: '{5}', cmc: 5, typeLine: 'Artifact — Equipment', displayType: '', oracleText: 'Equip {3}', displayText: '', colors: [], colorIdentity: [], keywords: [], layout: 'normal' } as GameCard
const jdeck = [...Array(30).fill(plains), ...Array(30).fill(shield)].map((card) => ({ card }))
const jsetup: SSetup = { game: 'mtg', format: 'Casual', seed: 9, firstPlayer: 0, startingLife: 20, players: [{ name: 'Você', color: '#00f', isBot: false, deck: jdeck }, { name: 'Bot (IA)', color: '#f00', isBot: true, deck: jdeck }] }
s = createSandbox(jsetup)
hist.length = 0
act(0, { t: 'keep', bottom: [] })
act(1, { t: 'keep', bottom: [] })
const pl0 = s.players[0]
const getFrom = (name: string) => pl0.zones.hand.find((id) => s.objects[id].card.name === name) ?? pl0.zones.library.find((id) => s.objects[id].card.name === name)!
const pid = getFrom('Plains')
if (!pl0.zones.hand.includes(pid)) act(0, { t: 'move', id: pid, to: 'hand' })
act(0, { t: 'move', id: pid, to: 'battlefield' })
const sid = getFrom("Pariah's Shield")
if (!s.players[0].zones.hand.includes(sid)) act(0, { t: 'move', id: sid, to: 'hand' })
const beforeShield = s
act(0, { t: 'move', id: sid, to: 'battlefield' })
const facts = judgeFacts(beforeShield, hist[hist.length - 1].action, 0)
for (const f of facts) console.log('    ' + f)
check(facts.some((f) => f.includes("THIS player's own turn")), "juiz: fatos dizem que era o turno do próprio jogador")
check(facts.some((f) => f.includes('could NOT pay') && f.includes('costs 5') && f.includes('at most 1')), 'juiz: fatos acusam custo 5 com só 1 mana disponível')
// ---------- Mana: Sol Ring gera {C}{C} (caso do Gruul Signet) ----------
const forest = { ...mountain, oracleId: 'f', name: 'Forest', typeLine: 'Basic Land — Forest', oracleText: '({T}: Add {G}.)', producedMana: ['G'] } as GameCard
const solRing = { oracleId: 'sr', name: 'Sol Ring', displayName: 'Sol Ring', manaCost: '{1}', cmc: 1, typeLine: 'Artifact', displayType: '', oracleText: '{T}: Add {C}{C}.', displayText: '', colors: [], colorIdentity: [], keywords: [], producedMana: ['C'], layout: 'normal' } as GameCard
const signet = { oracleId: 'gs', name: 'Gruul Signet', displayName: 'Gruul Signet', manaCost: '{2}', cmc: 2, typeLine: 'Artifact', displayType: '', oracleText: '{1}, {T}: Add {R}{G}.', displayText: '', colors: [], colorIdentity: ['R', 'G'], keywords: [], producedMana: ['G', 'R'], layout: 'normal' } as GameCard
const mdeck2 = [...Array(20).fill(forest), ...Array(20).fill(solRing), ...Array(20).fill(signet)].map((card) => ({ card }))
const msetup: SSetup = { game: 'mtg', format: 'Commander', seed: 5, firstPlayer: 1, startingLife: 40, freeMulligan: true, players: [{ name: 'Você', color: '#00f', isBot: false, deck: mdeck2 }, { name: 'Bot (IA)', color: '#f00', isBot: true, deck: mdeck2 }] }
s = createSandbox(msetup)
hist.length = 0
act(0, { t: 'mulligan' })
check(Boolean(performSandbox(s, 0, { t: 'keep', bottom: [] }).error) === false, 'Commander: o primeiro mulligan é grátis (mantém sem pôr carta no fundo)')
act(0, { t: 'keep', bottom: [] })
act(1, { t: 'keep', bottom: [] })
const bot = s.players[1]
const take = (name: string) => bot.zones.hand.find((id) => s.objects[id].card.name === name && !bot.zones.battlefield.includes(id)) ?? bot.zones.library.find((id) => s.objects[id].card.name === name)!
const fId = take('Forest')
if (!bot.zones.hand.includes(fId)) act(1, { t: 'move', id: fId, to: 'hand' })
act(1, { t: 'move', id: fId, to: 'battlefield' })
act(1, { t: 'tapForMana', id: fId, color: 'G' })
const srId = take('Sol Ring')
if (!s.players[1].zones.hand.includes(srId)) act(1, { t: 'move', id: srId, to: 'hand' })
act(1, { t: 'move', id: srId, to: 'battlefield' })
check(!s.players[1].pool.G, 'Sol Ring ({1}) pago com o {G} da Floresta')
act(1, { t: 'tapForMana', id: srId, color: 'C' }) // como o bot faz: só a cor
check(s.players[1].pool.C === 2, `Sol Ring virado gera {C}{C} (reserva: C×${s.players[1].pool.C ?? 0})`)
const gsId = take('Gruul Signet')
if (!s.players[1].zones.hand.includes(gsId)) act(1, { t: 'move', id: gsId, to: 'hand' })
const beforeSignet = s
act(1, { t: 'move', id: gsId, to: 'battlefield' })
const sigFacts = judgeFacts(beforeSignet, hist[hist.length - 1].action, 1)
check(sigFacts.some((f) => f.includes('COST CHECK: enough mana')), 'juiz: Gruul Signet ({2}) podia ser pago com {C}{C}')
check(!s.players[1].pool.C, 'jogar o Signet desconta {C}{C}')
act(1, { t: 'tapForMana', id: gsId, color: 'R' })
check(s.objects[gsId].tapped === true && s.log[s.log.length - 1].text.includes('{R}{G}'), 'Signet: paga {1} e gera {R}{G}')

// reconstrução com a semente guardada chega à mesma mesa
let rj = createSandbox(msetup)
for (const h of hist) rj = performSandbox(rj, h.seat, h.action).state
check(JSON.stringify(rj.objects) === JSON.stringify(s.objects), 'juiz: reconstrução com a semente do setup chega à mesa atual')

console.log(fails ? `\nFalhas: ${fails}` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
