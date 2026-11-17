// Instruções (prompts) do Juiz IA e do bot, e leitura das respostas em JSON.
import type { GameCard } from '../engine/types.ts'
import type { PkmCard } from '../pokemon/types.ts'
import { canPay } from '../pkm-engine/game.ts'
import { isPkmCard, locate } from './engine.ts'
import { pkmEnergyUnits, pkmEnergyValue } from './hints.ts'
import { manaOptionsOf, maxManaOf } from './mana.ts'
import { cardRulesText, describeState, recentLog } from './summary.ts'
import type { SAction, SLog, SObj, SState } from './types.ts'

const LANG_NOTE = 'Write all human-readable text in Brazilian Portuguese (pt-BR).'

// ---------------- Juiz ----------------

export interface JudgeVerdict {
  valid: boolean
  /** Uma linha: "Jogada válida" / "Jogada inválida" + o motivo curto. */
  title: string
  explanation: string
}

/** Custo de mana da face atual (Magic). */
function mtgCost(o: SObj): { cost: string; typeLine: string; cmc: number } {
  const c = o.card as GameCard
  const f = c.faces?.[o.face ?? 0]
  const cost = f?.manaCost ?? c.manaCost ?? ''
  let cmc = 0
  for (const raw of cost.match(/\{[^}]+\}/g) ?? []) {
    const sym = raw.slice(1, -1).toUpperCase()
    if (/^\d+$/.test(sym)) cmc += parseInt(sym, 10)
    else if (sym !== 'X') cmc += /^2\//.test(sym) ? 2 : 1
  }
  return { cost, typeLine: f?.typeLine ?? c.typeLine, cmc }
}

/**
 * Fatos calculados pelo simulador sobre a jogada (confiáveis), para o juiz não precisar deduzir
 * custos e contagens de "uma vez por turno" a partir do texto.
 */
export function judgeFacts(before: SState, action: SAction | null, seat: number): string[] {
  const facts: string[] = []
  const pl = before.players[seat]
  if (!pl) return facts
  facts.push(`It was ${before.activePlayer === seat ? 'THIS player\'s own turn' : `NOT this player's turn (active player: ${before.players[before.activePlayer]?.name})`} (turn ${before.turn}${before.step ? `, step: ${before.step}` : ''}). The player who went first this game: ${before.log.find((l) => l.kind === 'turn')?.text ?? '?'}.`)
  if (!action || !('id' in action)) return facts
  const o = before.objects[action.id]
  if (!o) return facts
  const from = locate(before, action.id)?.zone
  facts.push(`Card: ${o.card.name} (moved from zone: ${from ?? '?'}).`)

  if (before.game === 'mtg') {
    const { cost, typeLine, cmc } = mtgCost(o)
    // conjurar = da mão para o campo, ligar da mão (Aura/Equipamento) ou instantâneo/feitiço marcado como conjurado
    const castFromHand = from === 'hand' && (action.t === 'attach' || (action.t === 'move' && (action.to === 'battlefield' || action.cast === true)))
    if (from === 'hand' && action.t === 'move' && !castFromHand) facts.push(`The card was moved from hand to ${action.to} WITHOUT being cast (e.g. a discard or an effect) — do not judge it as casting a spell and do not check its mana cost.`)
    if (castFromHand) {
      const isLand = /\bLand\b/.test(typeLine)
      if (isLand) {
        facts.push(`It is a land. Lands this player had already played this turn before this action: ${pl.landsThisTurn}.`)
      } else {
        const pool = Object.entries(pl.pool).filter(([, n]) => n > 0)
        const poolTotal = pool.reduce((sum, [, n]) => sum + n, 0)
        const sources = (pl.zones.battlefield ?? []).map((id) => before.objects[id]).filter((x) => x && !x.tapped && manaOptionsOf(x).length)
        const potential = poolTotal + sources.reduce((sum, x) => sum + maxManaOf(x), 0)
        const describe = (x: SObj) => `${x.card.name} (${manaOptionsOf(x).map((op) => `${op.cost ? `pay {${op.cost}} → ` : ''}${op.mana.map((c) => `{${c}}`).join('')}`).join(' or ')})`
        facts.push(`Mana cost: ${cost || '(none)'} = ${cmc} mana total. Type: ${typeLine}.`)
        facts.push(`Mana available to this player right before: floating pool ${pool.map(([c, n]) => `{${c}}×${n}`).join(' ') || 'empty'}; untapped mana sources on the battlefield: ${sources.map(describe).join(', ') || 'none'}. Maximum mana they could have produced: ${potential}.`)
        const colored: Record<string, number> = {}
        for (const raw of cost.match(/\{[^}]+\}/g) ?? []) {
          const sym = raw.slice(1, -1).toUpperCase()
          if (/^[WUBRG]$/.test(sym)) colored[sym] = (colored[sym] ?? 0) + 1
        }
        const colorProblems = Object.entries(colored)
          .filter(([c, n]) => (pl.pool[c] ?? 0) + sources.reduce((sum, x) => sum + Math.max(0, ...manaOptionsOf(x).map((op) => op.mana.filter((m) => m === c).length)), 0) < n)
          .map(([c, n]) => `{${c}}×${n}`)
        if (cmc > potential) facts.push(`COST CHECK: the player could NOT pay this card — it costs ${cmc} but at most ${potential} mana was available (ignoring cost reducers or alternative costs written on the cards in play).`)
        else if (colorProblems.length) facts.push(`COST CHECK: not enough sources of the required colors: ${colorProblems.join(', ')}.`)
        else facts.push(`COST CHECK: enough mana was available (${potential} ≥ ${cmc}).`)
        const flash = /\bInstant\b/.test(typeLine) || (o.card as GameCard).keywords?.some((k) => k.toLowerCase() === 'flash')
        facts.push(`Timing: ${flash ? 'instant speed (Instant or Flash)' : 'sorcery speed — only in its controller\'s own main phase with an empty stack'}.`)
      }
    }
  } else {
    const c = o.card as PkmCard
    if (action.t === 'attach' && from === 'hand' && c.category === 'Energy') facts.push(`Energy cards this player had already attached from hand this turn before this action: ${pl.energyThisTurn} (limit: 1 per turn).`)
    if (action.t === 'move' && from === 'hand' && c.trainerType === 'Supporter') facts.push(`Supporters this player had already played this turn before this action: ${pl.supporterThisTurn} (limit 1 per turn; the player who goes first cannot play one on turn 1).`)
    if (action.t === 'evolve') {
      const target = before.objects[action.target]
      facts.push(`Evolution: ${c.name} evolves from "${c.evolveFrom ?? '?'}"; target is ${target?.card.name ?? '?'}, which entered play / last evolved on turn ${target?.enteredTurn ?? '?'} (current turn ${before.turn}; no evolving on a player's first turn or on a Pokémon that came into play this turn).`)
    }
    if (action.t === 'attack' && c.category === 'Pokemon') {
      const atk = c.attacks[action.index ?? 0]
      const units = pkmEnergyUnits(before, action.id)
      facts.push(`Attack ${atk?.name ?? '?'} costs [${atk?.cost.join(', ') ?? '?'}]; Energy attached: [${units.join(', ') || 'none'}] → ${atk && canPay(units, atk.cost) ? 'cost CAN be paid' : 'cost CANNOT be paid'}. Special conditions: ${o.conditions?.join(', ') || 'none'}.`)
    }
    if (action.t === 'switchActive') {
      const activeId = pl.zones.active?.[0]
      const act = activeId ? before.objects[activeId] : undefined
      if (action.retreat && act && isPkmCard(act.card)) {
        const paid = (action.discard ?? []).reduce((sum, id) => sum + pkmEnergyValue(before, id), 0)
        facts.push(`RETREAT of ${act.card.name}: retreat cost ${act.card.retreat ?? 0}; Energy discarded worth ${paid} unit(s) → ${paid >= (act.card.retreat ?? 0) ? 'cost paid' : 'cost NOT fully paid'}. Retreats already done this turn before: ${pl.retreatedThisTurn ?? 0} (limit 1). Special conditions of the Active: ${act.conditions?.join(', ') || 'none'} (Asleep or Paralyzed Pokémon cannot retreat).`)
      } else if (!action.retreat) facts.push('This was a switch WITHOUT paying a retreat cost (it must come from a card effect, e.g. Switch / Boss\'s Orders, or from promoting a new Active after a Knock Out).')
    }
    if (action.t === 'ability' && c.category === 'Pokemon') {
      const ab = c.abilities[action.index]
      const times = (pl.abilitiesThisTurn ?? []).filter((k) => k === `${action.id}:${action.index}`).length
      facts.push(`Ability "${ab?.name ?? '?'}" text: ${ab?.effect ?? '?'} — times this player had already used this ability of this Pokémon this turn: ${times}.`)
    }
    if (action.t === 'move' && from === 'hand' && (action.to === 'bench' || action.to === 'active')) facts.push(`Card stage: ${c.stage ?? '?'} (only Basic Pokémon go directly into play). Bench size before: ${pl.zones.bench?.length ?? 0}/5.`)
  }
  return facts
}

export function judgePrompt(before: SState, after: SState, entry: SLog, action: SAction | null, actorName: string, seat = entry.player ?? 0): { system: string; user: string } {
  const game = before.game === 'mtg' ? 'Magic: The Gathering (current Comprehensive Rules)' : 'Pokémon TCG (current official rules, Scarlet & Violet era)'
  const system = [
    `You are a certified, neutral tournament judge for ${game}.`,
    'This is a manual tabletop simulator: players perform every action by hand, so actions can break the rules. A player is asking you to review ONE action from the game log.',
    'Decide if that action was legal given the game state right before it, the card texts and the rules. Check, in this order: (1) whether the player could pay the cost (mana / Energy) with what was available, (2) once-per-turn limits (one land per turn, one Energy attachment per turn, one Supporter per turn, retreat once), (3) timing (whose turn it is, sorcery vs instant speed, first-turn restrictions, evolution restrictions), (4) targets and card text.',
    'The "Pre-computed facts" section is calculated by the simulator and is reliable — trust it over your own reading of the board, especially for whose turn it is, costs and counts.',
    'If several problems exist, lead with the most fundamental one (usually the unpaid cost) in the title and mention the others in the explanation.',
    'Note: in this simulator, casting a spell from hand is logged as moving it to the battlefield (permanents) or to the graveyard (instants/sorceries); tapping lands for mana is logged separately and is optional bookkeeping, so judge the cost by the mana the player COULD have produced (floating mana + untapped sources).',
    'If the log does not give enough information to be sure (e.g. hidden information), say what is missing; do not invent facts.',
    'Never reveal cards from a hand, deck or face-down Prize card unless that is required to explain the ruling.',
    'Answer ONLY with JSON: {"valid": boolean, "title": string, "explanation": string}. "title" is one short sentence starting with "Jogada válida:" or "Jogada inválida:". "explanation" is 2-5 sentences citing the rule or card text.',
    LANG_NOTE
  ].join('\n')
  const facts = judgeFacts(before, action, seat)
  // carta da jogada (pode estar numa pilha, sem texto no resumo)
  const involved = action && 'id' in action ? (before.objects[action.id] ?? after.objects[action.id]) : undefined
  const user = [
    `# Action under review (log line #${entry.id}, turn ${entry.turn}, done by ${actorName})`,
    entry.text,
    action ? `Structured action: ${JSON.stringify(action)}` : '',
    '',
    '# Pre-computed facts (reliable)',
    ...facts.map((f) => `- ${f}`),
    '',
    '# Game log up to that line',
    recentLog(after, entry.id, 35),
    '',
    '# Board state RIGHT BEFORE the action',
    describeState(before, { all: true }),
    ...(involved ? ['', '# Text of the card involved in the action', cardRulesText(involved.card)] : [])
  ].join('\n')
  return { system, user }
}

/** Acha o objeto JSON na resposta (pode vir puro, num bloco ```json ou no meio de um texto). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* segue procurando */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      /* segue procurando */
    }
  }
  // objetos {...} com chaves balanceadas, do maior (mais externo) para o menor
  const candidates: string[] = []
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== '{') continue
    let depth = 0
    let inStr = false
    for (let j = i; j < trimmed.length; j++) {
      const ch = trimmed[j]
      if (inStr) {
        if (ch === '\\') j++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        candidates.push(trimmed.slice(i, j + 1))
        break
      }
    }
  }
  for (const c of candidates.sort((a, b) => b.length - a.length)) {
    try {
      return JSON.parse(c)
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error('resposta sem JSON')
}

export function parseJudge(text: string): JudgeVerdict {
  const j = extractJson(text) as Partial<JudgeVerdict>
  const valid = Boolean(j.valid)
  let title = String(j.title ?? '').trim()
  if (!title) title = valid ? 'Jogada válida.' : 'Jogada inválida.'
  return { valid, title: title.slice(0, 300), explanation: String(j.explanation ?? '').trim().slice(0, 1500) }
}

// ---------------- Bot ----------------

export interface BotPlan {
  actions: SAction[]
  say?: string
}

const MTG_VOCAB = `Available actions (use object ids from the state, like "s12"):
The untap step and the draw step happen AUTOMATICALLY at the start of your turn (you are already in main phase 1 with your card drawn). Do NOT untap or draw for the turn yourself.
{"t":"step","to":"declareAttackers"} — move to another step of the turn, in order: beginCombat, declareAttackers, declareBlockers, combatDamage, endCombat, main2, end
{"t":"tapForMana","id":"<permanent id>","color":"R"} — tap a permanent for mana (W,U,B,R,G,C); it adds the full amount the card produces (e.g. Sol Ring adds {C}{C}); for an exact choice add "mana":["R","G"]
{"t":"move","id":"<id>","to":"battlefield"} — play a land or cast a permanent from hand (pay with tapForMana first)
{"t":"move","id":"<id>","to":"graveyard","cast":true} — cast an instant/sorcery (after paying with tapForMana)
{"t":"move","id":"<id>","to":"graveyard"} — discard / put a card in the graveyard without casting it
{"t":"attach","id":"<aura/equipment id>","target":"<creature id>"}
{"t":"attack","id":"<creature id>","attackTarget":<opponent seat or planeswalker id>} — declare an attacker (it taps); do it in the declareAttackers step
{"t":"token","name":"Soldier","types":"Creature — Soldier","power":"1","toughness":"1","count":1} — create tokens; {"t":"token","copyOf":"<id>"} for a copy
{"t":"poison","player":<seat>,"delta":1} — poison counters
{"t":"block","id":"<your creature id>","attacker":"<attacking creature id>"}
{"t":"life","player":<seat>,"delta":-3} — change life (e.g. combat damage in the combatDamage step, spells)
Typical turn: play a land, tap for mana, cast spells (main1) → step declareAttackers → attack → step combatDamage → life changes for unblocked attackers → step main2 → more spells. Passing the turn is automatic after your actions.
{"t":"counter","id":"<id>","key":"+1/+1","delta":1}
{"t":"note","text":"..."} — say something short`

const PKM_VOCAB = `Available actions (use object ids from the state, like "s12"):
The draw at the start of your turn and the Pokémon Checkup between turns happen AUTOMATICALLY. Do NOT draw for the turn yourself.
{"t":"draw","n":1} — draw cards only when a card effect tells you to
{"t":"move","id":"<basic Pokémon id>","to":"bench"} — put a Basic Pokémon on the Bench (max 5)
{"t":"move","id":"<id>","to":"active"} — put a Pokémon in the Active Spot if it is empty
{"t":"evolve","id":"<evolution card id>","target":"<Pokémon in play id>"}
{"t":"attach","id":"<energy or tool id>","target":"<Pokémon id>"} — attach (only 1 Energy from hand per turn)
{"t":"move","id":"<trainer id>","to":"discard"} — play an Item/Supporter (then do its effect with other actions)
{"t":"move","id":"<stadium id>","to":"stadium"}
{"t":"switchActive","id":"<benched Pokémon id>","retreat":true,"discard":["<energy id>"]} — retreat (once per turn), discarding Energy attached to the Active worth the retreat cost
{"t":"switchActive","id":"<benched Pokémon id>"} — switch without cost (only from a card effect, or to promote after a Knock Out)
{"t":"ability","id":"<Pokémon id>","index":0} — use an Ability (then do its effect with other actions)
{"t":"attack","id":"<your Active Pokémon id>","index":0,"target":"<opponent Active id>","damage":60,"endTurn":true} — attack: damage already including Weakness (×2) and Resistance (−30); endTurn:true ends your turn (attacking always ends the turn — do the attack's other effects BEFORE it, or use endTurn:false and the turn ends automatically after your actions)
For extra damage from effects (bench damage, counters):
{"t":"damage","id":"<opponent Pokémon id>","delta":60} — put damage (apply Weakness ×2 / Resistance -30 yourself)
{"t":"condition","id":"<id>","cond":"poisoned|burned|asleep|confused|paralyzed"}
{"t":"move","id":"<knocked out Pokémon id>","to":"discard"} — when a Pokémon has damage ≥ HP it is Knocked Out
{"t":"takePrize","id":"<your face-down prize id>"} — take 1 Prize per Knock Out (2 for ex/V, 3 for VMAX)
{"t":"coin"} — flip a coin when an attack says so (the result appears in the log on your next call)
{"t":"note","text":"..."} — say something short`

export function botPrompt(state: SState, seat: number, task: 'turn' | 'blocks'): { system: string; user: string } {
  const game = state.game === 'mtg' ? 'Magic: The Gathering' : 'Pokémon TCG'
  const system = [
    `You are a competent ${game} player controlling seat ${seat} (${state.players[seat].name}) in a manual tabletop simulator. Nothing is automatic: you must perform every step yourself with actions, following the official rules (pay costs, one land/one Energy per turn, etc.).`,
    task === 'turn'
      ? 'Plan your whole turn now: start-of-turn steps, development, and attacks. Play to win. Do NOT include passing the turn; it happens automatically after your actions.'
      : `The active player declared attackers. Decide your blocks only (block actions), or none.${state.players.length > 2 ? ' This is a multiplayer game: block only creatures attacking YOU or your planeswalkers (see each attacker\'s target).' : ''}`,
    state.game === 'mtg' ? MTG_VOCAB : PKM_VOCAB,
    ...(task === 'turn' && state.players.length > 2
      ? [`Multiplayer free-for-all (${state.players.filter((p) => !p.conceded).length} players left; eliminated players are out). Every attack MUST say which opponent seat (or planeswalker) it attacks with "attackTarget"; you may split attackers between opponents. Think politically: pressure the biggest threat, and keep blockers back if several opponents can attack you.`]
      : []),
    'Answer ONLY with JSON: {"actions": [ ... ], "say": "optional one-line comment to the opponent"}. Use only ids that exist in the state. Keep it under 40 actions.',
    LANG_NOTE
  ].join('\n\n')
  const user = ['# Current state (your hand is visible to you)', describeState(state, { viewer: seat }), '', '# Recent log', recentLog(state, undefined, 30)].join('\n')
  return { system, user }
}

const ALLOWED = new Set(['token', 'poison', 'commanderDamage', 'lookTop', 'ability', 'keep', 'step', 'move', 'attach', 'evolve', 'tap', 'tapForMana', 'untapAll', 'draw', 'shuffle', 'setupPrizes', 'takePrize', 'attack', 'block', 'switchActive', 'damage', 'condition', 'life', 'counter', 'coin', 'note', 'flip', 'mana'])

export function parseBot(text: string): BotPlan {
  const j = extractJson(text) as { actions?: unknown[]; say?: unknown }
  const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a): a is SAction => Boolean(a) && typeof a === 'object' && ALLOWED.has(String((a as { t?: unknown }).t))).slice(0, 40)
  return { actions, say: typeof j.say === 'string' ? j.say.slice(0, 200) : undefined }
}
