// Bot simples de Pokémon: prepara o campo, coloca Básicos no Banco, evolui, liga Energia em quem
// precisa, joga Treinadores automatizados e ataca com o ataque de maior dano que conseguir pagar.
import type { PkmType } from '../pokemon/types.ts'
import { attackError, canAct, canPay, checkAttach, checkEvolve, checkPlayBasic, checkRetreat, checkTrainer, currentChoice, energyUnits, inPlayOf, isBasicPokemon, maxHp, opp, remainingHp, rulesOf, topCard } from './game.ts'
import type { InPlay, PAction, PChoice, PGameState, PSeat } from './types.ts'

function dmgOf(s: string | undefined): number {
  const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

/** Quanto falta de energia para o melhor ataque deste Pokémon (0 = já pode). */
function energyNeed(state: PGameState, ip: InPlay): { need: number; type?: PkmType } {
  const c = topCard(state, ip)
  if (!c.attacks.length) return { need: 99 }
  const units = energyUnits(state, ip)
  let best = { need: 99, type: undefined as PkmType | undefined, dmg: -1 }
  for (const a of c.attacks) {
    const missing = Math.max(0, a.cost.length - units.length)
    const ok = canPay(units, a.cost)
    const need = ok ? 0 : Math.max(1, missing)
    const type = a.cost.find((x) => x !== 'Colorless' && !units.includes(x))
    const dmg = dmgOf(a.damage)
    if (need < best.need || (need === best.need && dmg > best.dmg)) best = { need, type, dmg }
  }
  return best
}

function botChoice(state: PGameState, p: PSeat, ch: PChoice): PAction {
  const pl = state.players[p]
  switch (ch.kind) {
    case 'setup': {
      const basics = pl.hand.filter((id) => isBasicPokemon(state.objects[id].card)).sort((a, b) => (state.objects[b].card.hp ?? 0) - (state.objects[a].card.hp ?? 0))
      return { t: 'setup', active: basics[0], bench: basics.slice(1, 6) }
    }
    case 'extraDraw':
      return { t: 'extraDraw', n: ch.max }
    case 'promote': {
      const best = [...pl.bench].sort((a, b) => energyNeed(state, a).need - energyNeed(state, b).need || remainingHp(state, b) - remainingHp(state, a))[0]
      return { t: 'chooseInPlay', id: best.id }
    }
    case 'inPlay': {
      // alvos do oponente: o com menos PS restantes; meus: o mais machucado (cura) ou o mais pronto (troca)
      const theirs = ch.candidates.filter((id) => state.objects[id].owner !== p)
      if (theirs.length) {
        const best = theirs.map((id) => inPlayOf(state, opp(p)).find((x) => x.id === id)!).sort((a, b) => remainingHp(state, a) - remainingHp(state, b))[0]
        return { t: 'chooseInPlay', id: best?.id ?? theirs[0] }
      }
      const mine = ch.candidates.map((id) => inPlayOf(state, p).find((x) => x.id === id)!).filter(Boolean)
      const healing = /cur/i.test(ch.prompt)
      const best = [...mine].sort((a, b) => (healing ? b.damage - a.damage : energyNeed(state, a).need - energyNeed(state, b).need))[0]
      return { t: 'chooseInPlay', id: best?.id ?? ch.candidates[0] ?? null }
    }
    case 'cards': {
      if (ch.zone === 'hand' && ch.min > 0) {
        // descartar: Energias e Treinadores primeiro
        const order = [...ch.candidates].sort((a, b) => rank(state, a) - rank(state, b))
        return { t: 'chooseCards', ids: order.slice(0, ch.min) }
      }
      const order = [...ch.candidates].sort((a, b) => rank(state, b) - rank(state, a))
      return { t: 'chooseCards', ids: order.slice(0, ch.max) }
    }
    case 'energy':
      return { t: 'chooseCards', ids: ch.candidates.slice(0, ch.count) }
    case 'yesNo':
      return { t: 'chooseYesNo', yes: true }
  }
}

/** Valor de uma carta para o bot (maior = mais útil). */
function rank(state: PGameState, id: string): number {
  const c = state.objects[id].card
  if (c.category === 'Pokemon') return 3 + (c.hp ?? 0) / 1000
  if (c.category === 'Trainer') return 2
  return 1
}

/** Próxima ação do bot (ou null se não for a vez dele). */
export function pkmBotAction(state: PGameState, p: PSeat): PAction | null {
  if (!canAct(state, p)) return null
  const ch = currentChoice(state, p)
  if (ch) return botChoice(state, p, ch)
  const pl = state.players[p]
  const mine = inPlayOf(state, p)

  // 1. Básicos no Banco (deixa 1 vaga se tiver muitos)
  for (const id of pl.hand) if (!checkPlayBasic(state, p, id) && pl.bench.length < 4) return { t: 'playBasic', id }
  // 2. evoluir
  for (const id of pl.hand) for (const ip of mine) if (!checkEvolve(state, p, id, ip.id)) return { t: 'evolve', id, target: ip.id }
  // 3. Treinadores totalmente automatizados que não sejam arriscados
  for (const id of pl.hand) {
    const c = state.objects[id].card
    if (c.category !== 'Trainer' || c.trainerType === 'Stadium' || c.trainerType === 'Tool') continue
    const tr = rulesOf(c).trainer
    if (!tr || tr.unsupported.length || !tr.effects.length) continue
    if (tr.effects.some((e) => e.k === 'discardHandDraw') && pl.hand.length > 4) continue
    if (tr.effects.some((e) => e.k === 'heal') && !mine.some((ip) => ip.damage > 0)) continue
    if (tr.effects.some((e) => e.k === 'switchOwnActive')) continue
    if (!checkTrainer(state, p, id)) return { t: 'playTrainer', id }
  }
  // 4. Energia: no Ativo se ele ainda precisa; senão no Banco que estiver mais perto de atacar
  if (!pl.energyAttached) {
    const energies = pl.hand.filter((id) => state.objects[id].card.category === 'Energy')
    if (energies.length) {
      const targets = [...mine].filter((ip) => energyNeed(state, ip).need > 0).sort((a, b) => Number(b === pl.active) - Number(a === pl.active) || energyNeed(state, a).need - energyNeed(state, b).need)
      for (const ip of targets) {
        const want = energyNeed(state, ip).type
        const pick = energies.find((id) => rulesOf(state.objects[id].card).energyProvides?.includes(want ?? 'Colorless')) ?? energies[0]
        if (!checkAttach(state, p, pick, ip.id)) return { t: 'attachEnergy', id: pick, target: ip.id }
      }
    }
  }
  // 5. recuar se o Ativo não ataca e alguém do Banco já pode
  if (pl.active && energyNeed(state, pl.active).need > 0) {
    const ready = pl.bench.find((b) => energyNeed(state, b).need === 0)
    if (ready && !checkRetreat(state, p, ready.id) && remainingHp(state, pl.active) < maxHp(state, pl.active)) return { t: 'retreat', to: ready.id }
  }
  // 6. atacar com o maior dano possível
  if (pl.active) {
    const c = topCard(state, pl.active)
    const options = c.attacks.map((a, i) => ({ i, dmg: dmgOf(a.damage) + (a.effect ? 5 : 0) })).filter((o) => !attackError(state, p, o.i))
    if (options.length) return { t: 'attack', index: options.sort((a, b) => b.dmg - a.dmg)[0].i }
  }
  return { t: 'endTurn' }
}

/** Ação segura se o motor recusar a do bot (ou no modo "oponente parado"). */
export function pkmBotFallback(state: PGameState, p: PSeat): PAction {
  const ch = currentChoice(state, p)
  if (ch) {
    if (ch.kind === 'inPlay' && ch.optional) return { t: 'chooseInPlay', id: null }
    if (ch.kind === 'cards' && ch.min === 0) return { t: 'chooseCards', ids: [] }
    return botChoice(state, p, ch)
  }
  return { t: 'endTurn' }
}
