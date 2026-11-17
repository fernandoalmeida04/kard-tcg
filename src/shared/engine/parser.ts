// Interpreta o texto oracle (inglês) das cartas e gera habilidades executáveis pelo motor.
// Cobre os modelos de texto mais comuns; o que não for reconhecido fica em `unsupported`
// e pode ser resolvido pelo Juiz IA (Claude) ou por ajustes manuais.

import type {
  ActivatedAbility,
  Amount,
  Cost,
  CountExpr,
  DamageTo,
  Effect,
  EffectBlock,
  ManaAbility,
  ObjRef,
  ParsedCard,
  StaticAbility,
  TargetSpec,
  TokenDef,
  TriggerEvent,
  TriggeredAbility,
  Who
} from './types.ts'
import { t } from '../i18n/index.ts'

export interface ParseInput {
  name: string
  typeLine: string
  oracleText: string
  keywords: string[]
  producedMana?: string[]
}

const KNOWN_KEYWORDS = [
  'flying', 'reach', 'haste', 'vigilance', 'trample', 'first strike', 'double strike', 'deathtouch', 'lifelink',
  'defender', 'menace', 'indestructible', 'hexproof', 'flash', 'prowess', 'shroud', 'ward', 'protection', 'changeling',
  'fear', 'intimidate', 'skulk', 'shadow', 'horsemanship', 'landwalk', 'islandwalk', 'swampwalk', 'forestwalk',
  'mountainwalk', 'plainswalk', 'flanking', 'infect', 'wither', 'persist', 'undying', 'exalted', 'convoke', 'delve',
  'affinity', 'kicker', 'multikicker', 'flashback', 'cycling', 'equip', 'enchant', 'cascade', 'storm', 'partner',
  'companion', 'ninjutsu', 'mutate', 'crew', 'devoid', 'emerge', 'escape', 'foretell', 'evoke', 'madness', 'morph',
  'megamorph', 'disguise', 'suspend', 'unearth', 'dash', 'bestow', 'riot', 'training', 'toxic', 'ravenous', 'backup',
  'bargain', 'offspring', 'plot', 'saddle', 'spree', 'gift', 'impending', 'living weapon', 'reconfigure', 'blitz',
  'casualty', 'cleave', 'daybound', 'nightbound', 'decayed', 'disturb', 'boast', 'demonstrate', 'encore', 'improvise',
  'fabricate', 'afflict', 'embalm', 'eternalize', 'exploit', 'surge', 'awaken', 'ingest', 'prowl', 'rebound', 'retrace',
  'scavenge', 'soulbond', 'transmute', 'replicate', 'buyback', 'entwine', 'splice', 'hideaway', 'battle cry', 'bloodthirst',
  'extort', 'evolve', 'fuse', 'outlast', 'raid', 'renown', 'myriad', 'melee', 'annihilator', 'aftermath', 'jump-start',
  'mentor', 'adapt', 'amass', 'spectacle', 'surge', 'overload', 'basic landcycling', 'landcycling', 'plainscycling', 'islandcycling', 'swampcycling', 'mountaincycling', 'forestcycling', 'escape', 'squad', 'enlist', 'read ahead', 'prototype', 'for mirrodin!', 'more than meets the eye'
]

const NUM = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+)'
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

function amountOf(w: string): Amount {
  const s = w.toLowerCase()
  if (s === 'x') return 'X'
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  return NUM_WORDS[s] ?? 1
}

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Substitui o nome da carta e referências "this creature" etc. por "~" e remove texto de lembrete. */
export function normalizeText(text: string, name: string): string {
  let t = text.replace(/−/g, '-').replace(/\s*\([^)]*\)/g, '')
  const names = new Set<string>()
  for (const n of name.split(' // ')) {
    names.add(n)
    if (n.includes(', ')) names.add(n.split(', ')[0])
  }
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (n.length < 2) continue
    t = t.replace(new RegExp(`\\b${escapeRe(n)}\\b`, 'g'), '~')
  }
  t = t.replace(/\bthis (creature|artifact|enchantment|land|planeswalker|permanent|spell|card|aura|equipment|vehicle|battle|saga|token)\b/gi, '~')
  return t
}

// ---------------- Alvos ----------------

interface Ctx {
  targets: TargetSpec[]
  lastTarget: number | null
  lastPlayerTarget: number | null
  hasSelf: boolean
  /** A cláusula anterior criou fichas ou trouxe cartas ao campo ("it"/"them" se referem a elas). */
  lastCreated?: boolean
}

function blankSpec(text: string): TargetSpec {
  return { players: 'none', objTypes: [], zone: 'battlefield', text }
}

const TYPE_CORES: [string, Partial<TargetSpec>][] = [
  ['creature or planeswalker', { objTypes: ['creature', 'planeswalker'] }],
  ['creature or player', { objTypes: ['creature', 'planeswalker'], players: 'any' }],
  ['player or planeswalker', { objTypes: ['planeswalker'], players: 'any' }],
  ['opponent or planeswalker', { objTypes: ['planeswalker'], players: 'opponent' }],
  ['artifact, enchantment, or planeswalker', { objTypes: ['artifact', 'enchantment', 'planeswalker'] }],
  ['artifact or enchantment', { objTypes: ['artifact', 'enchantment'] }],
  ['artifact or creature', { objTypes: ['artifact', 'creature'] }],
  ['creature or enchantment', { objTypes: ['creature', 'enchantment'] }],
  ['creature or vehicle', { objTypes: ['creature', 'artifact'] }],
  ['nonland permanents', { objTypes: ['nonland'] }],
  ['nonland permanent', { objTypes: ['nonland'] }],
  ['noncreature permanent', { objTypes: ['noncreature'] }],
  ['permanents', { objTypes: ['permanent'] }],
  ['permanent', { objTypes: ['permanent'] }],
  ['activated or triggered ability', { objTypes: [], zone: 'stack', spellTypes: 'ability' }],
  ['instant or sorcery spell', { objTypes: [], zone: 'stack', spellTypes: 'instantSorcery' }],
  ['noncreature spell', { objTypes: [], zone: 'stack', spellTypes: 'noncreature' }],
  ['creature spell', { objTypes: [], zone: 'stack', spellTypes: 'creature' }],
  ['spell', { objTypes: [], zone: 'stack', spellTypes: 'any' }],
  ['creature card', { objTypes: ['creature'], zone: 'graveyard' }],
  ['artifact card', { objTypes: ['artifact'], zone: 'graveyard' }],
  ['permanent card', { objTypes: ['permanent'], zone: 'graveyard' }],
  ['instant or sorcery card', { objTypes: ['instant', 'sorcery'], zone: 'graveyard' }],
  ['card', { objTypes: ['permanent', 'instant', 'sorcery'], zone: 'graveyard' }],
  ['creatures', { objTypes: ['creature'] }],
  ['creature', { objTypes: ['creature'] }],
  ['artifacts', { objTypes: ['artifact'] }],
  ['artifact', { objTypes: ['artifact'] }],
  ['enchantments', { objTypes: ['enchantment'] }],
  ['enchantment', { objTypes: ['enchantment'] }],
  ['planeswalkers', { objTypes: ['planeswalker'] }],
  ['planeswalker', { objTypes: ['planeswalker'] }],
  ['lands', { objTypes: ['land'] }],
  ['land', { objTypes: ['land'] }],
  ['battle', { objTypes: ['battle'] }],
  ['players', { players: 'any' }],
  ['player', { players: 'any' }],
  ['opponents', { players: 'opponent' }],
  ['opponent', { players: 'opponent' }]
]

/** Lê "tipo + restrições" (após "target "/"each "/"all "). */
function parseTypePhrase(s: string, spec: TargetSpec): number | null {
  let i = 0
  const rest = () => s.slice(i)
  // prefixos
  for (;;) {
    const m = rest().match(/^(non(white|blue|black|red|green)|nonartifact|nonlegendary|nonbasic|nontoken|tapped|untapped|attacking or blocking|attacking|blocking|other|another) /)
    if (!m) break
    const p = m[1]
    if (p.startsWith('non') && COLOR_WORDS[p.slice(3)]) (spec.nonColors ??= []).push(COLOR_WORDS[p.slice(3)])
    else if (p === 'nonartifact') spec.objTypes = spec.objTypes // tratado abaixo como restrição simples
    else if (p === 'nonlegendary') spec.nonLegendary = true
    else if (p === 'nonbasic') spec.nonbasic = true
    else if (p === 'nontoken') spec.nonToken = true
    else if (p === 'tapped') spec.tapped = true
    else if (p === 'untapped') spec.untapped = true
    else if (p === 'attacking or blocking') spec.attackingOrBlocking = true
    else if (p === 'attacking') spec.attacking = true
    else if (p === 'blocking') spec.blocking = true
    else if (p === 'other' || p === 'another') spec.other = true
    i += m[0].length
  }
  // cores ("target red creature", "white creature")
  const cm = rest().match(/^(white|blue|black|red|green) /)
  if (cm) {
    spec.colors = [COLOR_WORDS[cm[1]]]
    i += cm[0].length
  }
  // subtipo simples ("target Elf creature", "Goblin creatures")
  const sub = rest().match(/^([a-z]+) (creatures?)\b/)
  if (sub && !TYPE_CORES.some(([core]) => rest().startsWith(core)) && !['each', 'target', 'all'].includes(sub[1])) {
    spec.subtype = sub[1]
    i += sub[1].length + 1
  }
  let matched = false
  for (const [core, part] of TYPE_CORES) {
    if (rest().startsWith(core) && !/^[a-z]/.test(rest().slice(core.length))) {
      Object.assign(spec, { ...part, objTypes: part.objTypes ?? spec.objTypes })
      if (part.players) spec.players = part.players
      i += core.length
      matched = true
      break
    }
  }
  if (!matched) return null
  // sufixos
  for (;;) {
    const r = rest()
    let m: RegExpMatchArray | null
    if ((m = r.match(/^ you control/))) spec.controller = 'you'
    else if ((m = r.match(/^ (an opponent controls|you don't control|your opponents control|target opponent controls)/))) spec.controller = 'opponent'
    else if ((m = r.match(/^ with flying/))) spec.flying = true
    else if ((m = r.match(/^ without flying/))) spec.noFlying = true
    else if ((m = r.match(/^ with power (\d+) or less/))) spec.maxPower = parseInt(m[1], 10)
    else if ((m = r.match(/^ with power (\d+) or greater/))) spec.minPower = parseInt(m[1], 10)
    else if ((m = r.match(/^ with toughness (\d+) or less/))) spec.maxToughness = parseInt(m[1], 10)
    else if ((m = r.match(/^ with (?:mana value|converted mana cost) (\d+) or less/))) spec.maxCmc = parseInt(m[1], 10)
    else if ((m = r.match(/^ (?:from|in) your graveyard/))) {
      spec.zone = 'graveyard'
      spec.controller = 'you'
    } else if ((m = r.match(/^ (?:from|in) a graveyard/))) spec.zone = 'graveyard'
    else break
    i += m[0].length
  }
  return i
}

function parseTargetPhrase(s: string, ctx: Ctx): { indices: number[]; len: number } | null {
  if (/^any target/.test(s)) {
    const spec = blankSpec('any target')
    spec.players = 'any'
    spec.objTypes = ['creature', 'planeswalker', 'battle']
    ctx.targets.push(spec)
    ctx.lastTarget = ctx.targets.length - 1
    return { indices: [ctx.lastTarget], len: 'any target'.length }
  }
  const m = s.match(/^(up to (one|two|three|four) )?(another )?target /)
  if (!m) return null
  const spec = blankSpec('')
  if (m[3]) spec.other = true
  const len = parseTypePhrase(s.slice(m[0].length), spec)
  if (len === null) return null
  const total = m[0].length + len
  spec.text = s.slice(0, total)
  const count = m[2] ? (amountOf(m[2]) as number) : 1
  const indices: number[] = []
  for (let k = 0; k < count; k++) {
    ctx.targets.push({ ...spec, optional: Boolean(m[1]) })
    indices.push(ctx.targets.length - 1)
  }
  if (spec.players !== 'none' && spec.objTypes.length === 0) ctx.lastPlayerTarget = indices[0]
  ctx.lastTarget = indices[indices.length - 1]
  return { indices, len: total }
}

function parseAllPhrase(s: string): { filter: TargetSpec; len: number } | null {
  const m = s.match(/^(each|all) /)
  let start = 0
  const spec = blankSpec('')
  if (m) start = m[0].length
  else if (!/^(other )?(creatures|[a-z]+ creatures) (you control|your opponents control)/.test(s)) return null
  const len = parseTypePhrase(s.slice(start), spec)
  if (len === null) return null
  if (spec.players !== 'none' && spec.objTypes.length === 0) return null
  spec.text = s.slice(0, start + len)
  return { filter: spec, len: start + len }
}

/** Objeto afetado: alvo, "each/all ...", "~", "it", "that creature". */
function parseObjRef(s: string, ctx: Ctx): { ref: ObjRef; len: number } | null {
  const t = parseTargetPhrase(s, ctx)
  if (t) return { ref: { ref: 'target', indices: t.indices }, len: t.len }
  const a = parseAllPhrase(s)
  if (a) return { ref: { ref: 'all', filter: a.filter }, len: a.len }
  let m: RegExpMatchArray | null
  if ((m = s.match(/^~/))) return { ref: { ref: 'self' }, len: 1 }
  if ((m = s.match(/^enchanted (creature|permanent|land|artifact)/))) return { ref: { ref: 'enchanted' }, len: m[0].length }
  if ((m = s.match(/^equipped creature/))) return { ref: { ref: 'equipped' }, len: m[0].length }
  if ((m = s.match(/^(the tokens?|that token|those tokens)\b/)) && ctx.lastCreated) return { ref: { ref: 'created' }, len: m[0].length }
  if ((m = s.match(/^(it|that creature|that permanent|that card|them|those creatures|those cards)\b/))) {
    if (ctx.lastCreated) return { ref: { ref: 'created' }, len: m[0].length }
    if (ctx.lastTarget !== null) return { ref: { ref: 'target', indices: [ctx.lastTarget] }, len: m[0].length }
    if (ctx.hasSelf) return { ref: { ref: 'self' }, len: m[0].length }
  }
  return null
}

function parseWho(s: string, ctx: Ctx): { who: Who; len: number } | null {
  let m: RegExpMatchArray | null
  if ((m = s.match(/^you\b/))) return { who: { k: 'you' }, len: m[0].length }
  if ((m = s.match(/^defending player\b/))) return { who: { k: 'defending' }, len: m[0].length }
  if ((m = s.match(/^(each opponent|target opponent's? controller|your opponents?)\b/))) return { who: { k: 'opponent' }, len: m[0].length }
  if ((m = s.match(/^each player\b/))) return { who: { k: 'each' }, len: m[0].length }
  if ((m = s.match(/^target (player|opponent)\b/))) {
    const spec = blankSpec(m[0])
    spec.players = m[1] === 'opponent' ? 'opponent' : 'any'
    ctx.targets.push(spec)
    ctx.lastPlayerTarget = ctx.targets.length - 1
    return { who: { k: 'target', index: ctx.lastPlayerTarget }, len: m[0].length }
  }
  if ((m = s.match(/^(its controller|that creature's controller|that permanent's controller|its owner|that spell's controller)\b/))) {
    if (ctx.lastTarget !== null) return { who: { k: 'controllerOf', index: ctx.lastTarget }, len: m[0].length }
    return { who: { k: 'you' }, len: m[0].length }
  }
  if ((m = s.match(/^that player\b/))) {
    if (ctx.lastPlayerTarget !== null) return { who: { k: 'target', index: ctx.lastPlayerTarget }, len: m[0].length }
    if (ctx.lastTarget !== null) return { who: { k: 'controllerOf', index: ctx.lastTarget }, len: m[0].length }
    // sem antecedente ("deals combat damage to a player, that player ..."): o jogador defensor
    return { who: { k: 'defending' }, len: m[0].length }
  }
  return null
}

function whoPrefix(p: string | undefined, ctx: Ctx, dryRun = false): Who | null {
  if (!p) return { k: 'you' }
  const save = ctx.targets.length
  const saveP = ctx.lastPlayerTarget
  const w = parseWho(p, ctx)
  if (!w || w.len !== p.length || dryRun) {
    ctx.targets.length = save
    ctx.lastPlayerTarget = saveP
    return w && w.len === p.length ? w.who : null
  }
  return w.who
}

function parseKeywordList(s: string): string[] {
  return s
    .replace(/\.$/, '')
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => KNOWN_KEYWORDS.includes(k) || k === "can't be blocked")
}

// ---------------- Cláusulas de efeito ----------------

type ClauseResult = { effects: Effect[]; len: number } | null

function parseClause(s: string, ctx: Ctx): ClauseResult {
  let m: RegExpMatchArray | null
  let prefix = 0
  if ((m = s.match(/^(you may |then |and )/))) {
    prefix = m[0].length
    s = s.slice(prefix)
  }
  const done = (effects: Effect[], len: number): ClauseResult => ({ effects, len: len + prefix })

  // Frases sem efeito
  if ((m = s.match(/^(it|they|that creature) can't be regenerated|^then shuffle|^shuffle\b( your library| it into your library)?|^this spell can't be countered/))) {
    return done([], m[0].length)
  }

  // Dano
  if ((m = s.match(new RegExp(`^(?:~|it|they) deals? ${NUM} damage to `)))) {
    const amount = amountOf(m[1])
    let len = m[0].length
    const effects: Effect[] = []
    const recipient = parseDamageRecipient(s.slice(len), ctx)
    if (!recipient) return null
    effects.push(...recipient.tos.map((to) => ({ k: 'damage', amount, to }) as Effect))
    len += recipient.len
    // "... and 2 damage to that creature's controller"
    const more = s.slice(len).match(new RegExp(`^ and ${NUM} damage to `))
    if (more) {
      const r2 = parseDamageRecipient(s.slice(len + more[0].length), ctx)
      if (r2) {
        effects.push(...r2.tos.map((to) => ({ k: 'damage', amount: amountOf(more[1]), to }) as Effect))
        len += more[0].length + r2.len
      }
    }
    return done(effects, len)
  }

  // Compra
  if ((m = s.match(new RegExp(`^(?:([a-z' ]+?) )?draws? ${NUM} cards?`)))) {
    const who = whoPrefix(m[1], ctx)
    const each = forEachSuffix(s.slice(m[0].length))
    if (who) return done([{ k: 'draw', amount: each ? { per: each.per, mult: amountOf(m[2]) as number } : amountOf(m[2]), who }], m[0].length + (each?.len ?? 0))
  }

  // Ganhar / perder vida
  if ((m = s.match(new RegExp(`^(?:([a-z' ]+?) )?(gain|gains|lose|loses) ${NUM} life`)))) {
    const who = whoPrefix(m[1], ctx)
    const gain = m[2].startsWith('gain')
    const each = forEachSuffix(s.slice(m[0].length))
    if (who) return done([{ k: gain ? 'gainLife' : 'loseLife', amount: each ? { per: each.per, mult: amountOf(m[3]) as number } : amountOf(m[3]), who }], m[0].length + (each?.len ?? 0))
  }

  // Descartar / moer
  if ((m = s.match(new RegExp(`^(?:([a-z' ]+?) )?(discards?|mills?) ${NUM} cards?( at random)?`))) && whoPrefix(m[1], ctx, true)) {
    const who = whoPrefix(m[1], ctx)!
    const kind = m[2].startsWith('discard') ? 'discard' : 'mill'
    return done([kind === 'discard' ? { k: 'discard', amount: amountOf(m[3]), who, random: Boolean(m[4]) } : { k: 'mill', amount: amountOf(m[3]), who }], m[0].length)
  }

  // Frases sem efeito adicional
  if ((m = s.match(/^(you may )?choose new targets for (the|that) copy|^it's still a land/))) return done([], m[0].length)

  // Proliferar
  if ((m = s.match(/^proliferate/))) return done([{ k: 'proliferate' }], m[0].length)

  // Neblina
  if ((m = s.match(/^prevent all combat damage that would be dealt this turn/))) return done([{ k: 'fog' }], m[0].length)

  // Turno extra
  if ((m = s.match(/^take an extra turn after this one/))) return done([{ k: 'extraTurn' }], m[0].length)

  // Monarca
  if ((m = s.match(/^you become the monarch/))) return done([{ k: 'monarch' }], m[0].length)

  // Transformar
  if ((m = s.match(/^transform (~|it)(?![a-z])/))) return done([{ k: 'transform', what: { ref: 'self' } }], m[0].length)

  // Regenerar
  if ((m = s.match(/^regenerate /))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (o) return done([{ k: 'regenerate', what: o.ref }], m[0].length + o.len)
  }

  // Devolver uma permanente própria (terrenos-ponte: "return a land you control to its owner's hand")
  if ((m = s.match(/^return (a|an) (land|creature|nonland permanent|permanent|artifact|enchantment) you control to its owner's hand/))) {
    const filter = blankSpec(m[2])
    parseTypePhrase(m[2], filter)
    return done([{ k: 'returnOwn', filter }], m[0].length)
  }

  // Exilar o topo e poder jogar ("impulse draw")
  if (
    (m = s.match(
      /^exile the top (card|two cards|three cards|four cards|five cards|x cards) of your library\.? (?:you may play (?:it|that card|them|those cards) this turn|until end of turn, you may play (?:it|that card|them|those cards)|until the end of your next turn, you may play (?:it|that card|them|those cards))/
    ))
  ) {
    const n = m[1] === 'card' ? 1 : amountOf(m[1].split(' ')[0])
    return done([{ k: 'impulse', n, until: /next turn/.test(m[0]) ? 'nextTurn' : 'thisTurn' }], m[0].length)
  }

  // Olhar o topo e pegar uma carta ("dig")
  if (
    (m = s.match(
      new RegExp(
        `^look at the top ${NUM} cards of your library\\. (?:you may reveal (?:a|an|up to one) ([a-z, ]+?) cards? from among them and put (?:it|that card) (into your hand|onto the battlefield)|you may put (?:a|an|up to one) ([a-z, ]+?) cards? from among them (into your hand|onto the battlefield)|put (?:one|up to one) of them into your hand)(?:\\. put| and)? the rest (on the bottom of your library in (?:a random|any) order|into your graveyard)`
      )
    ))
  ) {
    const typesText = m[2] ?? m[4]
    const cardTypes = typesText ? typesText.split(/,? or |, /).map((x) => x.trim()) : null
    const dest = (m[3] ?? m[5] ?? 'into your hand').includes('battlefield') ? 'battlefield' : 'hand'
    return done([{ k: 'dig', n: amountOf(m[1]), take: 1, cardTypes, dest, rest: m[6].includes('graveyard') ? 'graveyard' : 'bottom' }], m[0].length)
  }

  // Colocar um terreno da mão no campo
  if ((m = s.match(/^put a land card from your hand onto the battlefield( tapped)?/))) return done([{ k: 'putLandFromHand' }], m[0].length)

  // Copiar mágica / habilidade
  if ((m = s.match(/^copy /))) {
    const t = parseTargetPhrase(s.slice(m[0].length), ctx)
    if (t && ctx.targets[t.indices[0]].zone === 'stack') return done([{ k: 'copyStack', index: t.indices[0] }], m[0].length + t.len)
    return null
  }

  // Ficha que é cópia de uma criatura
  if ((m = s.match(/^create a token that's a copy of /))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (o) return done([{ k: 'copyToken', what: o.ref }], m[0].length + o.len)
  }

  // Ação atrasada: "sacrifice it at the beginning of the next end step" / "at the beginning of the next end step, exile it"
  if ((m = s.match(/^(sacrifice|exile|return) (it|them|that creature|that token|those tokens|the token|the tokens)( to its owner's hand)? at the beginning of the next end step/))) {
    const o = parseObjRef(m[2], ctx)
    if (o) return done([{ k: 'delayed', what: o.ref, action: m[1] === 'return' ? 'bounce' : (m[1] as 'sacrifice' | 'exile') }], m[0].length)
  }
  if ((m = s.match(/^at the beginning of the next end step, (sacrifice|exile|return) (it|them|that creature|that token|those tokens|the token|the tokens)( to its owner's hand)?/))) {
    const o = parseObjRef(m[2], ctx)
    if (o) return done([{ k: 'delayed', what: o.ref, action: m[1] === 'return' ? 'bounce' : (m[1] as 'sacrifice' | 'exile') }], m[0].length)
  }

  // Destruir / exilar (e "piscar": exile ..., then return it to the battlefield)
  if ((m = s.match(/^(destroy|exile) /))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (!o) return null
    const len = m[0].length + o.len
    if (m[1] === 'exile') {
      const fl = s.slice(len).match(/^,? then return (it|that card|that creature|them|those cards) to the battlefield (tapped )?under (its owner's|their owners'|your) control/)
      if (fl) return done([{ k: 'flicker', what: o.ref, yourControl: fl[3] === 'your' }], len + fl[0].length)
    }
    return done([{ k: m[1] === 'destroy' ? 'destroy' : 'exile', what: o.ref }], len)
  }

  // Devolver à mão / do cemitério
  if ((m = s.match(/^return /))) {
    const rest = s.slice(m[0].length)
    const o = parseObjRef(rest, ctx)
    if (!o) return null
    const after = rest.slice(o.len)
    let m2: RegExpMatchArray | null
    const isGraveyardTarget = o.ref.ref === 'target' && ctx.targets[o.ref.indices[0]]?.zone === 'graveyard'
    if ((m2 = after.match(/^ to (its|their) owner'?s'? hands?|^ to your hand/))) {
      if (isGraveyardTarget && o.ref.ref === 'target') return done([{ k: 'graveyardReturn', index: o.ref.indices[0], dest: 'hand' }], m[0].length + o.len + m2[0].length)
      return done([{ k: 'bounce', what: o.ref }], m[0].length + o.len + m2[0].length)
    }
    if ((m2 = after.match(/^ to the battlefield( under (your|its owner's) control)?( tapped)?/)) && isGraveyardTarget && o.ref.ref === 'target') {
      return done([{ k: 'graveyardReturn', index: o.ref.indices[0], dest: 'battlefield' }], m[0].length + o.len + m2[0].length)
    }
    return null
  }

  // Virar / desvirar
  if ((m = s.match(/^(tap|untap) /))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (!o) return null
    return done([{ k: m[1] === 'tap' ? 'tap' : 'untap', what: o.ref }], m[0].length + o.len)
  }

  // Marcadores
  if ((m = s.match(new RegExp(`^put ${NUM} ([+-]1/[+-]1) counters? on `)))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (!o) return null
    return done([{ k: 'counters', what: o.ref, n: amountOf(m[1]), counter: m[2] === '+1/+1' ? '+1/+1' : '-1/-1' }], m[0].length + o.len)
  }

  // Fichas
  if ((m = s.match(new RegExp(`^create ${NUM} (tapped )?(\\d+|x)/(\\d+|x) ([a-z, ]+?) (artifact creature|enchantment creature|creature) tokens?( with ([a-z, ]+?))?(?= and |\\.|,|$| that| named)`)))) {
    const words = m[5].split(/[ ,]+/).filter(Boolean)
    const colors = words.filter((w) => COLOR_WORDS[w]).map((w) => COLOR_WORDS[w])
    const subtypes = words.filter((w) => !COLOR_WORDS[w] && w !== 'and' && w !== 'colorless')
    const sub = subtypes.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
    const token: TokenDef = {
      name: sub || 'Token',
      power: m[3] === 'x' ? 0 : parseInt(m[3], 10),
      toughness: m[4] === 'x' ? 0 : parseInt(m[4], 10),
      colors,
      types: `${m[6] === 'artifact creature' ? 'Artifact Creature' : m[6] === 'enchantment creature' ? 'Enchantment Creature' : 'Creature'} — ${sub}`,
      keywords: m[8] ? parseKeywordList(m[8]) : [],
      kind: 'creature'
    }
    return done([{ k: 'token', n: amountOf(m[1]), token, who: { k: 'you' } }], m[0].length)
  }
  if ((m = s.match(new RegExp(`^create ${NUM} (treasure|food|clue|blood) tokens?`)))) {
    const kind = m[2] as TokenDef['kind']
    const name = m[2][0].toUpperCase() + m[2].slice(1)
    return done([{ k: 'token', n: amountOf(m[1]), token: { name, colors: [], types: `Artifact — ${name}`, keywords: [], kind }, who: { k: 'you' } }], m[0].length)
  }

  // Anular
  if ((m = s.match(/^counter /))) {
    const t = parseTargetPhrase(s.slice(m[0].length), ctx)
    if (!t || ctx.targets[t.indices[0]].zone !== 'stack') return null
    let len = m[0].length + t.len
    const unless = s.slice(len).match(/^ unless its controller pays \{(\d+)\}/)
    if (unless) len += unless[0].length
    return done([{ k: 'counterSpell', index: t.indices[0], unlessPay: unless ? parseInt(unless[1], 10) : undefined }], len)
  }

  // "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."
  if ((m = s.match(/^(target opponent|target player|each opponent) reveals (?:their|his or her) hand\. you choose (?:a|an) ([a-z, ]*?)card (?:from it|from among them)\. (?:that player|they) discards? that card/))) {
    const w = parseWho(m[1], ctx)
    if (w) {
      const f = m[2].trim().replace(/,$/, '')
      const filter = f === 'nonland' ? 'nonland' : f === 'noncreature, nonland' || f === 'noncreature nonland' ? 'noncreatureNonland' : f === 'creature' ? 'creature' : f === 'instant or sorcery' ? 'instantSorcery' : 'any'
      return done([{ k: 'discardChosen', who: w.who, filter }], m[0].length)
    }
  }
  if ((m = s.match(/^gain control of /))) {
    const o = parseObjRef(s.slice(m[0].length), ctx)
    if (o) {
      let len = m[0].length + o.len
      const eot = s.slice(len).match(/^ until end of turn/)
      if (eot) len += eot[0].length
      return done([{ k: 'gainControl', what: o.ref, untilEOT: Boolean(eot) }], len)
    }
  }

  // Vidência / vigiar
  if ((m = s.match(new RegExp(`^(scry|surveil) ${NUM}`)))) {
    return done([{ k: 'scry', n: amountOf(m[2]), surveil: m[1] === 'surveil' }], m[0].length)
  }

  // Tutores: "search your library for a [creature] card, put it into your hand, then shuffle"
  if ((m = s.match(/^search your library for a card, then shuffle and put that card on top/))) {
    return done([{ k: 'search', basic: false, cardTypes: [], n: 1, dest: 'top', tapped: false }], m[0].length)
  }
  if (
    (m = s.match(
      /^search your library for (a|an|up to one|up to two|up to three) ((?:creature|artifact|enchantment|instant|sorcery|planeswalker|legendary|equipment|aura|historic|noncreature|nonland|permanent)(?:(?:,| or|, or) (?:creature|artifact|enchantment|instant|sorcery|planeswalker|legendary|equipment|aura|permanent))* )?cards?(, reveal (?:it|them|that card|those cards))?,? (?:and )?put (?:it|that card|them|those cards) (into your hand|onto the battlefield( tapped)?|on top of your library)/
    ))
  ) {
    const n = m[1].startsWith('up to') ? (amountOf(m[1].split(' ')[2]) as number) : 1
    const cardTypes = m[2] ? m[2].trim().split(/,? or |, /).map((x) => x.trim()) : []
    const dest = m[4].startsWith('into') ? 'hand' : m[4].startsWith('onto') ? 'battlefield' : 'top'
    return done([{ k: 'search', basic: false, cardTypes, n, dest, tapped: Boolean(m[5]) }], m[0].length)
  }

  // Buscar terreno
  if ((m = s.match(/^search your library for (a|an|up to (one|two|three)) (basic land|land|basic (plains|island|swamp|mountain|forest)|(plains|island|swamp|mountain|forest)(?: or (plains|island|swamp|mountain|forest))?) cards?(, reveal (it|them|those cards))?,? (and )?(put (it|them|that card|those cards|one) (onto the battlefield( tapped)?|into your hand))/))) {
    const n = m[2] ? (amountOf(m[2]) as number) : 1
    const basic = m[3].startsWith('basic')
    const landTypes = [m[4], m[5], m[6]].filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1))
    const toBf = m[12].startsWith('onto')
    return done([{ k: 'search', basic, landTypes: landTypes.length ? landTypes : undefined, n, dest: toBf ? 'battlefield' : 'hand', tapped: Boolean(m[13]) }], m[0].length)
  }

  // Mana (rituais)
  if ((m = s.match(/^add (\{[wubrgc]\})(?:, | or )(\{[wubrgc]\})(?:,? or (\{[wubrgc]\}))?/))) {
    const oneOf = [m[1], m[2], m[3]].filter(Boolean).map((x) => x[1].toUpperCase())
    return done([{ k: 'addMana', mana: [], oneOf }], m[0].length)
  }
  if ((m = s.match(/^add ((?:\{[wubrgc]\})+)/))) {
    const syms = m[1].match(/\{([wubrgc])\}/g)!.map((x) => x[1].toUpperCase())
    return done([{ k: 'addMana', mana: syms }], m[0].length)
  }
  if ((m = s.match(new RegExp(`^add ${NUM} mana of any (one )?colou?r`)))) {
    return done([{ k: 'addMana', mana: [], anyColor: amountOf(m[1]) as number }], m[0].length)
  }

  // Sacrificar
  if ((m = s.match(/^(each player|each opponent|target player|target opponent|defending player) sacrifices? (a|an|one) (creature or planeswalker|creature|artifact|enchantment|nonland permanent|permanent|land)( of their choice)?/))) {
    const w = parseWho(m[1], ctx)
    if (!w) return null
    const filter = blankSpec(m[3])
    parseTypePhrase(m[3], filter)
    return done([{ k: 'sacrifice', who: w.who, filter }], m[0].length)
  }
  if ((m = s.match(/^sacrifice ~/))) return done([{ k: 'sacrificeSelf' }], m[0].length)

  // Lutar / morder
  {
    const save = ctx.targets.length
    const saveLast = ctx.lastTarget
    const a = parseObjRef(s, ctx)
    if (a) {
      const rest = s.slice(a.len)
      let m2: RegExpMatchArray | null
      if ((m2 = rest.match(/^ fights? /))) {
        const b = parseObjRef(rest.slice(m2[0].length), ctx)
        if (b) return done([{ k: 'fight', a: a.ref, b: b.ref }], a.len + m2[0].length + b.len)
      }
      if ((m2 = rest.match(/^ deals damage equal to its power to /))) {
        const b = parseObjRef(rest.slice(m2[0].length), ctx)
        if (b) return done([{ k: 'fight', a: a.ref, b: b.ref, oneSided: true }], a.len + m2[0].length + b.len)
      }
      // Bônus até o fim do turno
      if ((m2 = rest.match(/^ (?:each )?gets? ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and gains? ([a-z ,']+?))? until end of turn/))) {
        const p = m2[1].toLowerCase().replace('+', '')
        const tt = m2[2].toLowerCase().replace('+', '')
        const pa: Amount = p.includes('x') ? 'X' : parseInt(p, 10)
        const ta: Amount = tt.includes('x') ? 'X' : parseInt(tt, 10)
        return done(
          [{ k: 'pump', what: a.ref, power: pa, toughness: ta, keywords: m2[3] ? parseKeywordList(m2[3]) : [], negative: p.startsWith('-') && p.includes('x') }],
          a.len + m2[0].length
        )
      }
      if ((m2 = rest.match(/^ (?:each )?gains? ([a-z ,']+?) until end of turn/))) {
        const kws = parseKeywordList(m2[1])
        if (kws.length) return done([{ k: 'pump', what: a.ref, power: 0, toughness: 0, keywords: kws }], a.len + m2[0].length)
      }
      if ((m2 = rest.match(/^ can't be blocked this turn/))) {
        return done([{ k: 'pump', what: a.ref, power: 0, toughness: 0, keywords: ['unblockable'] }], a.len + m2[0].length)
      }
      // concessão permanente: "It gains haste."
      if ((m2 = rest.match(/^ (?:each )?gains? ([a-z ,']+?)(?=\.|$)/))) {
        const kws = parseKeywordList(m2[1])
        if (kws.length && kws.length === m2[1].split(/,\s*(?:and\s+)?|\s+and\s+/).length) return done([{ k: 'grant', what: a.ref, keywords: kws }], a.len + m2[0].length)
      }
      // não reconhecido: desfaz alvos adicionados
      ctx.targets.length = save
      ctx.lastTarget = saveLast
    }
  }

  return null
}

/** " for each creature you control" etc. */
function forEachSuffix(s: string): { per: CountExpr; len: number } | null {
  const m = s.match(/^ for each ([a-z ]+?)(?=\.|,|$| and )/)
  if (!m) return null
  const per = countExprOf(m[1])
  return per ? { per, len: m[0].length } : null
}

function parseDamageRecipient(s: string, ctx: Ctx): { tos: DamageTo[]; len: number } | null {
  let m: RegExpMatchArray | null
  if ((m = s.match(/^each creature and each player|^each creature and player/))) {
    const f = blankSpec('each creature')
    f.objTypes = ['creature']
    return { tos: [{ ref: 'all', filter: f }, { ref: 'player', who: { k: 'each' } }], len: m[0].length }
  }
  if ((m = s.match(/^each opponent and each creature (your opponents control|they control)/))) {
    const f = blankSpec('each creature your opponents control')
    f.objTypes = ['creature']
    f.controller = 'opponent'
    return { tos: [{ ref: 'player', who: { k: 'opponent' } }, { ref: 'all', filter: f }], len: m[0].length }
  }
  const t = parseTargetPhrase(s, ctx)
  if (t) return { tos: [{ ref: 'target', indices: t.indices }], len: t.len }
  const w = parseWho(s, ctx)
  if (w) return { tos: [{ ref: 'player', who: w.who }], len: w.len }
  const a = parseAllPhrase(s)
  if (a) return { tos: [{ ref: 'all', filter: a.filter }], len: a.len }
  if ((m = s.match(/^(it|that creature)\b/)) && ctx.lastTarget !== null) return { tos: [{ ref: 'target', indices: [ctx.lastTarget] }], len: m[0].length }
  if ((m = s.match(/^~/))) return { tos: [{ ref: 'self' }], len: 1 }
  return null
}

/** Interpreta uma sequência de frases de efeito. */
export function parseEffectText(text: string, ctx?: Partial<Ctx>, hasSelf = true): EffectBlock {
  const c: Ctx = { targets: ctx?.targets ?? [], lastTarget: null, lastPlayerTarget: null, hasSelf }
  const effects: Effect[] = []
  const unsupported: string[] = []
  let s = text.trim().replace(/\s+/g, ' ')
  const original = s
  s = s.toLowerCase()
  while (s.length) {
    s = s.replace(/^[\s.,;]+/, '')
    if (!s) break
    const saveT = c.targets.length
    const saveL = c.lastTarget
    const saveP = c.lastPlayerTarget
    const r = parseClause(s, c)
    if (r && r.len > 0) {
      if (r.effects.some((e) => e.k === 'token' || e.k === 'copyToken' || (e.k === 'graveyardReturn' && e.dest === 'battlefield'))) c.lastCreated = true
      else if (c.targets.length > saveT) c.lastCreated = false
    }
    if (!r || r.len === 0) {
      c.targets.length = saveT
      c.lastTarget = saveL
      c.lastPlayerTarget = saveP
      // pula até o fim da frase
      const end = s.search(/\.(\s|$)/)
      const chunk = end >= 0 ? s.slice(0, end + 1) : s
      const origChunk = original.slice(original.length - s.length, original.length - s.length + chunk.length)
      unsupported.push(origChunk.trim())
      s = s.slice(chunk.length)
      continue
    }
    effects.push(...r.effects)
    s = s.slice(r.len)
    s = s.replace(/^(,? then |,? and |\. |, |\.|;)/, '')
  }
  return { effects, targets: c.targets, unsupported, text }
}

// ---------------- Custos ----------------

function parseCost(s: string): Cost | null {
  const cost: Cost = { mana: '', tap: false, sacrificeSelf: false, payLife: 0, discard: 0 }
  const parts = s.split(/,\s*/)
  for (const part of parts) {
    const p = part.trim().toLowerCase()
    if (/^(\{[^}]+\})+$/.test(p)) {
      const syms = p.match(/\{[^}]+\}/g)!
      for (const sym of syms) {
        if (sym === '{t}') cost.tap = true
        else if (sym === '{q}') return null
        else cost.mana += sym.toUpperCase()
      }
    } else if (/^sacrifice ~$/.test(p)) cost.sacrificeSelf = true
    else if (/^exile ~$/.test(p)) cost.exileSelf = true
    else if (/^pay (\d+) life$/.test(p)) cost.payLife = parseInt(p.match(/\d+/)![0], 10)
    else if (/^discard (a|one) card$/.test(p)) cost.discard = 1
    else return null
  }
  return cost
}

function parseManaEffect(s: string): string[][] | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '')
  let m: RegExpMatchArray | null
  const ANY = ['W', 'U', 'B', 'R', 'G']
  if ((m = t.match(/^add one mana of any colou?r( in your commander's color identity)?$/))) return [ANY]
  if ((m = t.match(/^add one mana of the chosen colou?r$/))) return [ANY]
  if ((m = t.match(/^add two mana in any combination of colou?rs$/))) return [ANY, ANY]
  if ((m = t.match(/^add \{[wubrgc]\} or one mana of the chosen colou?r$/))) return [ANY]
  // terrenos-filtro: "Add {B}{B}, {B}{R}, or {R}{R}."
  if ((m = t.match(/^add \{([wubrg])\}\{\1\}, \{\1\}\{([wubrg])\}, or \{\2\}\{\2\}$/))) {
    const pair = [m[1].toUpperCase(), m[2].toUpperCase()]
    return [pair, pair]
  }
  if ((m = t.match(/^add two mana of any one colou?r$/))) return [['W', 'U', 'B', 'R', 'G'], ['W', 'U', 'B', 'R', 'G']]
  if ((m = t.match(/^add three mana of any one colou?r$/))) return [['W', 'U', 'B', 'R', 'G'], ['W', 'U', 'B', 'R', 'G'], ['W', 'U', 'B', 'R', 'G']]
  if ((m = t.match(/^add ((?:\{[wubrgc]\})+)$/))) {
    return m[1].match(/\{([wubrgc])\}/g)!.map((x) => [x[1].toUpperCase()])
  }
  // "Add {R} or {G}." / "Add {W}, {U}, or {B}."
  if ((m = t.match(/^add ((?:\{[wubrgc]\}(?:, | or |, or ))+\{[wubrgc]\})$/))) {
    return [m[1].match(/\{([wubrgc])\}/g)!.map((x) => x[1].toUpperCase())]
  }
  return null
}

// ---------------- Carta completa ----------------

const BASIC_TYPES: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

export function parseCard(input: ParseInput): ParsedCard {
  const parsed: ParsedCard = {
    triggers: [],
    activated: [],
    mana: [],
    statics: [],
    entersTapped: false,
    cantBlock: false,
    cantAttack: false,
    unblockable: false,
    keywords: input.keywords.map((k) => k.toLowerCase()),
    unsupported: []
  }
  const type = input.typeLine
  const isInstantSorcery = /\b(Instant|Sorcery)\b/.test(type)
  const text = normalizeText(input.oracleText ?? '', input.name)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // Terrenos básicos por tipo (inclui duais com tipos básicos)
  if (/\bLand\b/.test(type)) {
    const colors = Object.entries(BASIC_TYPES).filter(([t]) => new RegExp(`\\b${t}\\b`).test(type)).map(([, c]) => c)
    if (colors.length) parsed.mana.push({ cost: { mana: '', tap: true, sacrificeSelf: false, payLife: 0, discard: 0 }, units: [colors], text: t('{T}: adiciona {mana}', { mana: colors.map((c) => `{${c}}`).join(t(' ou ')) }) })
  }

  const spellLines: string[] = []
  let modal: { header: string; modes: string[]; count?: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^[A-Z][A-Za-z' ]+ — (?=(When|Whenever|At|{|~|Creatures|Other|You|Target|Draw|Destroy|Exile|Return|Add|Put|Create))/, '')
    const low = line.toLowerCase()

    // Modal: "Choose one —" seguido de "• ..."
    if (/^choose one\b/.test(low)) {
      modal = { header: line, modes: [] }
      while (i + 1 < lines.length && lines[i + 1].startsWith('•')) {
        modal.modes.push(lines[++i].replace(/^•\s*/, ''))
      }
      continue
    }
    if (/^choose two\s*—?$/.test(low) && isInstantSorcery) {
      modal = { header: line, modes: [], count: 2 }
      while (i + 1 < lines.length && lines[i + 1].startsWith('•')) modal.modes.push(lines[++i].replace(/^•\s*/, ''))
      continue
    }
    if (/^choose (two|three|one or more|any number)/.test(low)) {
      parsed.unsupported.push(line)
      while (i + 1 < lines.length && lines[i + 1].startsWith('•')) parsed.unsupported.push(lines[++i])
      continue
    }

    // Linha só de palavras-chave
    const kwParts = low.replace(/\.$/, '').split(/,\s*/)
    if (kwParts.every((p) => KNOWN_KEYWORDS.some((k) => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—') || p.startsWith(k + ' {')))) {
      for (const p of kwParts) {
        let m: RegExpMatchArray | null
        if ((m = p.match(/^equip (\{[^}]+\}(?:\{[^}]+\})*)/))) {
          const cost = parseCost(m[1])
          const tspec = blankSpec('target creature you control')
          tspec.objTypes = ['creature']
          tspec.controller = 'you'
          if (cost) parsed.activated.push({ cost, sorcerySpeed: true, isEquip: true, effects: [], targets: [tspec], unsupported: [], text: line, label: t('Equipar {cost}', { cost: m[1] }) })
        } else if ((m = p.match(/^enchant (.+)$/))) {
          const spec = blankSpec(`enchant ${m[1]}`)
          if (parseTypePhrase(m[1], spec) !== null) parsed.aura = spec
        } else if ((m = p.match(/^(basic land|plains|island|swamp|mountain|forest)cycling (\{[^}]+\}(?:\{[^}]+\})*)/))) {
          const cost = parseCost(m[2])
          const lt = m[1] === 'basic land' ? undefined : [m[1][0].toUpperCase() + m[1].slice(1)]
          if (cost) parsed.activated.push({ cost, sorcerySpeed: false, fromHand: 'cycling', effects: [{ k: 'search', basic: m[1] === 'basic land', landTypes: lt, n: 1, dest: 'hand', tapped: false }], targets: [], unsupported: [], text: line, label: t('Reciclar terreno {cost}', { cost: m[2] }) })
        } else if ((m = p.match(/^cycling (\{[^}]+\}(?:\{[^}]+\})*)/))) {
          const cost = parseCost(m[1])
          if (cost) parsed.activated.push({ cost, sorcerySpeed: false, fromHand: 'cycling', effects: [{ k: 'draw', amount: 1, who: { k: 'you' } }], targets: [], unsupported: [], text: line, label: t('Reciclar {cost}', { cost: m[1] }) })
        } else if (!parsed.keywords.includes(p) && KNOWN_KEYWORDS.includes(p)) {
          parsed.keywords.push(p)
        }
      }
      continue
    }

    // Habilidade de lealdade
    let m: RegExpMatchArray | null
    if ((m = line.match(/^([+-]?)(\d+|X): (.+)$/))) {
      const n = m[2] === 'X' ? 0 : parseInt(m[2], 10)
      const loyalty = m[1] === '-' ? -n : n
      const block = parseEffectText(m[3])
      parsed.activated.push({
        ...block,
        cost: { mana: '', tap: false, sacrificeSelf: false, payLife: 0, discard: 0, loyalty },
        sorcerySpeed: true,
        isLoyalty: true,
        label: `${loyalty > 0 ? '+' : ''}${loyalty}: ${m[3]}`
      })
      continue
    }

    // Habilidade ativada "custo: efeito"
    if ((m = line.match(/^([^:"]+?): (.+)$/)) && !/^(when|whenever|at)\b/i.test(line)) {
      const cost = parseCost(m[1])
      if (cost) {
        // talismãs/terrenos de dor: "Add {G} or {U}. ~ deals 1 damage to you." (tratado como pagar vida)
        const pain = m[2].match(/^(.*?\.)\s*~ deals (\d+) damage to you\.?$/i)
        const units = parseManaEffect(pain ? pain[1] : m[2])
        if (units && !cost.discard) {
          parsed.mana.push({ cost: pain ? { ...cost, payLife: cost.payLife + parseInt(pain[2], 10) } : cost, units, text: line })
          continue
        }
        const sorcery = /activate only as a sorcery/i.test(m[2])
        const effText = m[2].replace(/\s*activate only (as a sorcery|once each turn)\.?/i, '').trim()
        const block = parseEffectText(effText)
        parsed.activated.push({ ...block, cost, sorcerySpeed: sorcery, label: line })
        continue
      }
    }

    // Habilidade disparada
    if ((m = line.match(/^(when|whenever|at) ([^,]+), (.+)$/i))) {
      const cond = `${m[1]} ${m[2]}`.toLowerCase()
      const effText = m[3]
      const events = triggerEvents(cond)
      // gatilho modal: "When ~ enters, choose one —" + linhas "• ..."
      if (events && /^choose one\s*—?$/i.test(effText.trim())) {
        const modes: EffectBlock[] = []
        while (i + 1 < lines.length && lines[i + 1].startsWith('•')) modes.push(parseEffectText(lines[++i].replace(/^•\s*/, '')))
        for (const ev of events.events) {
          parsed.triggers.push({ effects: [], targets: [], unsupported: [], text: line, event: ev, spellFilter: events.spellFilter, creatureFilter: events.creatureFilter, modes })
        }
        continue
      }
      if (events && !/^if\b/i.test(effText)) {
        const block = parseEffectText(effText)
        for (const ev of events.events) {
          parsed.triggers.push({ ...block, event: ev, spellFilter: events.spellFilter, creatureFilter: events.creatureFilter })
        }
        continue
      }
      parsed.unsupported.push(line)
      continue
    }

    // Estáticas
    if (/^~ enters( the battlefield)? tapped\.?$/i.test(line)) {
      parsed.entersTapped = true
      continue
    }
    if (/^~ can't block\.?$/i.test(line)) {
      parsed.cantBlock = true
      continue
    }
    if (/^~ can't attack( or block)?\.?$/i.test(line)) {
      parsed.cantAttack = true
      if (/or block/i.test(line)) parsed.cantBlock = true
      continue
    }
    if (/^~ can't be blocked\.?$/i.test(line)) {
      parsed.unblockable = true
      continue
    }
    if (/^you may play an additional land on each of your turns\.?$/i.test(line)) {
      parsed.statics.push({ k: 'extraLand' })
      continue
    }
    if ((m = low.match(/^(enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,']+?))?\.?$/))) {
      parsed.statics.push({ k: 'attachedBuff', power: parseInt(m[2], 10), toughness: parseInt(m[3], 10), keywords: m[4] ? parseKeywordList(m[4]) : [] })
      continue
    }
    if ((m = low.match(/^(enchanted|equipped) creature has ([a-z ,']+?)\.?$/))) {
      const kws = parseKeywordList(m[2])
      if (kws.length) {
        parsed.statics.push({ k: 'attachedBuff', power: 0, toughness: 0, keywords: kws })
        continue
      }
    }
    if ((m = low.match(/^enchanted (creature|permanent) can't attack( or block)?(,? and its activated abilities can't be activated)?\.?$/))) {
      parsed.statics.push({ k: 'attachedLock', cantAttack: true, cantBlock: Boolean(m[2]), noUntap: false, noActivate: Boolean(m[3]) })
      continue
    }
    if ((m = low.match(/^enchanted creature can't block\.?$/))) {
      parsed.statics.push({ k: 'attachedLock', cantAttack: false, cantBlock: true, noUntap: false, noActivate: false })
      continue
    }
    if (/^enchanted (creature|permanent) doesn't untap during its controller's untap step\.?$/.test(low)) {
      parsed.statics.push({ k: 'attachedLock', cantAttack: false, cantBlock: false, noUntap: true, noActivate: false })
      continue
    }
    if (/^you control enchanted (creature|permanent|artifact|land)\.?$/.test(low)) {
      parsed.statics.push({ k: 'attachedControl' })
      continue
    }
    if ((m = low.match(/^(other )?(?:([a-z]+) )?creatures (you control|your opponents control) get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,']+?))?\.?$/))) {
      const filter = blankSpec(m[0])
      filter.objTypes = ['creature']
      filter.controller = m[3] === 'you control' ? 'you' : 'opponent'
      if (m[1]) filter.other = true
      if (m[2] && m[2] !== 'other') filter.subtype = m[2]
      parsed.statics.push({ k: 'anthem', filter, power: parseInt(m[4], 10), toughness: parseInt(m[5], 10), keywords: m[6] ? parseKeywordList(m[6]) : [] })
      continue
    }
    if ((m = low.match(/^(other )?(?:([a-z]+) )?creatures you control have ([a-z ,']+?)\.?$/))) {
      const kws = parseKeywordList(m[3])
      if (kws.length) {
        const filter = blankSpec(m[0])
        filter.objTypes = ['creature']
        filter.controller = 'you'
        if (m[1]) filter.other = true
        if (m[2]) filter.subtype = m[2]
        parsed.statics.push({ k: 'anthem', filter, power: 0, toughness: 0, keywords: kws })
        continue
      }
    }
    if (/^this spell can't be countered\.?$/i.test(line) || /^~ can't be countered\.?$/i.test(line)) continue
    if (/^(~ can be your commander|choose a background|partner with [^.]+|you may choose not to untap ~ during your untap step)\.?$/i.test(line)) continue
    if (/^—$/.test(line)) continue
    if (/^~ attacks each (combat|turn) if able\.?$/i.test(line)) {
      parsed.mustAttack = true
      continue
    }
    if (/^~ doesn't untap during your untap step\.?$/i.test(line)) {
      parsed.noUntapSelf = true
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? with (a|an|one|two|three|four|five|six|x|\d+) \+1\/\+1 counters? on it\.?$/))) {
      parsed.entersWithCounters = amountOf(m[2])
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? tapped unless you control (?:a|an) (plains|island|swamp|mountain|forest)(?: or (?:a|an) (plains|island|swamp|mountain|forest))?\.?$/))) {
      parsed.entersTappedUnless = { kind: 'controlType', types: [m[2], m[3]].filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)) }
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? tapped unless you control (two|three) or fewer other lands\.?$/))) {
      parsed.entersTappedUnless = { kind: 'fewLands', max: amountOf(m[2]) as number }
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? tapped unless you control (two|three) or more other lands\.?$/))) {
      parsed.entersTappedUnless = { kind: 'manyLands', min: amountOf(m[2]) as number }
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? tapped unless you control (two|three) or more basic lands\.?$/))) {
      parsed.entersTappedUnless = { kind: 'manyBasics', min: amountOf(m[2]) as number }
      continue
    }
    if (/^~ enters( the battlefield)? tapped unless you control a basic land\.?$/.test(low)) {
      parsed.entersTappedUnless = { kind: 'manyBasics', min: 1 }
      continue
    }
    if (/^~ enters( the battlefield)? tapped unless you control a legendary creature\.?$/.test(low)) {
      parsed.entersTappedUnless = { kind: 'legendaryCreature' }
      continue
    }
    if ((m = low.match(/^~ enters( the battlefield)? tapped unless a player has (\d+) or less life\.?$/))) {
      parsed.entersTappedUnless = { kind: 'lowLife', max: parseInt(m[2], 10) }
      continue
    }
    if (/^~ enters( the battlefield)? tapped unless you have two or more opponents\.?$/.test(low)) {
      parsed.entersTappedUnless = { kind: 'multiplayer' }
      continue
    }
    if ((m = low.match(/^as ~ enters( the battlefield)?, you may pay (\d+) life\. if you don't, it enters( the battlefield)? tapped\.?$/))) {
      parsed.shockLife = parseInt(m[2], 10)
      continue
    }
    if (/^you have no maximum hand size\.?$/.test(low)) {
      parsed.statics.push({ k: 'noMaxHandSize' })
      continue
    }
    if ((m = low.match(/^(instant and sorcery|instant|sorcery|artifact|creature|noncreature|enchantment|aura|equipment|legendary|historic|dragon|elf|goblin)? ?spells you cast cost \{(\d+)\} less to cast\.?$/))) {
      const types = m[1] ? (m[1] === 'instant and sorcery' ? ['instant', 'sorcery'] : [m[1]]) : []
      parsed.statics.push({ k: 'costReduction', types, amount: parseInt(m[2], 10) })
      continue
    }
    if ((m = low.match(/^~'s power and toughness are each equal to (?:the number of )?(.+?)\.?$/))) {
      const ce = countExprOf(m[1])
      if (ce) {
        parsed.ptFrom = ce
        continue
      }
    }
    if ((m = low.match(/^~ gets \+(\d+)\/\+(\d+) for each (.+?)\.?$/))) {
      const ce = countExprOf(m[3])
      if (ce) {
        parsed.selfBuffPer = { count: ce, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) }
        continue
      }
    }
    if (/^as ~ enters( the battlefield)?, choose a creature type\.?$/.test(low)) {
      parsed.chooseCreatureType = true
      continue
    }
    if (/^as ~ enters( the battlefield)?, choose a colou?r( other than [a-z]+)?\.?$/.test(low)) continue
    if ((m = low.match(/^(other )?creatures you control of the chosen type get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,']+?))?\.?$/))) {
      const filter = blankSpec(m[0])
      filter.objTypes = ['creature']
      filter.controller = 'you'
      filter.subtype = '$chosen'
      if (m[1]) filter.other = true
      parsed.statics.push({ k: 'anthem', filter, power: parseInt(m[2], 10), toughness: parseInt(m[3], 10), keywords: m[4] ? parseKeywordList(m[4]) : [] })
      continue
    }
    if ((m = low.match(/^as an additional cost to cast ~, (?:sacrifice (?:a|an) (creature|artifact|artifact or creature|creature or artifact|land|permanent|nonland permanent|creature or planeswalker)|discard (a|one|two) cards?)\.?$/))) {
      if (m[1]) {
        const filter = blankSpec(m[1])
        parseTypePhrase(m[1], filter)
        parsed.additionalCost = { kind: 'sacrifice', filter, text: line }
      } else parsed.additionalCost = { kind: 'discard', n: amountOf(m[2]) as number, text: line }
      continue
    }
    if (/^\(.*\)$/.test(line)) continue

    if (isInstantSorcery) {
      spellLines.push(line)
      continue
    }
    parsed.unsupported.push(line)
  }

  if (isInstantSorcery) {
    if (modal) {
      const modes = modal.modes.map((t) => parseEffectText(t, undefined, false))
      parsed.spell = { effects: [], targets: [], unsupported: [], text: [modal.header, ...modal.modes].join('\n'), modes, chooseCount: modal.count ?? 1 }
      if (spellLines.length) {
        const extra = parseEffectText(spellLines.join(' '), undefined, false)
        parsed.spell.unsupported.push(...extra.unsupported)
        parsed.spell.effects.push(...extra.effects)
      }
    } else {
      parsed.spell = parseEffectText(spellLines.join(' '), undefined, false)
    }
  }

  // Terrenos sem habilidade reconhecida: usa produced_mana do Scryfall
  if (/\bLand\b/.test(type) && parsed.mana.length === 0 && input.producedMana?.length && /\{T\}[^.]*: Add/i.test(input.oracleText)) {
    parsed.mana.push({ cost: { mana: '', tap: true, sacrificeSelf: false, payLife: 0, discard: 0 }, units: [input.producedMana.map((c) => c.toUpperCase())], text: t('Adiciona mana') })
  }

  return parsed
}

function triggerEvents(cond: string): { events: TriggerEvent[]; spellFilter?: TriggeredAbility['spellFilter']; creatureFilter?: 'you' | 'any' } | null {
  if (/^when(ever)? ~ enters( the battlefield)? or attacks$/.test(cond)) return { events: ['etb', 'attacks'] }
  if (/^when(ever)? ~ enters( the battlefield)?( under your control)?$/.test(cond)) return { events: ['etb'] }
  if (/^when(ever)? ~ dies$|^when(ever)? ~ is put into a graveyard from the battlefield$/.test(cond)) return { events: ['dies'] }
  if (/^when(ever)? ~ leaves the battlefield$/.test(cond)) return { events: ['ltb'] }
  if (/^whenever ~ attacks or blocks$/.test(cond)) return { events: ['attacks', 'blocks'] }
  if (/^whenever ~ attacks$/.test(cond)) return { events: ['attacks'] }
  if (/^whenever ~ blocks$/.test(cond)) return { events: ['blocks'] }
  if (/^whenever ~ deals combat damage to a player$/.test(cond)) return { events: ['combatDamagePlayer'] }
  if (/^at the beginning of your upkeep$/.test(cond)) return { events: ['upkeep'] }
  if (/^at the beginning of each upkeep$/.test(cond)) return { events: ['eachUpkeep'] }
  if (/^at the beginning of your end step$/.test(cond)) return { events: ['endStep'] }
  if (/^at the beginning of each end step$/.test(cond)) return { events: ['eachEndStep'] }
  if (/^at the beginning of combat on your turn$/.test(cond)) return { events: ['beginCombat'] }
  let m: RegExpMatchArray | null
  if ((m = cond.match(/^whenever you cast (?:a|an) ?(noncreature|instant or sorcery|creature)? spell$/))) {
    const f = m[1] === 'noncreature' ? 'noncreature' : m[1] === 'instant or sorcery' ? 'instantSorcery' : m[1] === 'creature' ? 'creature' : 'any'
    return { events: ['castSpell'], spellFilter: f }
  }
  if (/^whenever a land (you control )?enters( the battlefield)?( under your control)?$/.test(cond)) return { events: ['landfall'], creatureFilter: 'you' }
  if (/^whenever you gain life$/.test(cond)) return { events: ['lifeGain'] }
  if (/^whenever a creature you control deals combat damage to a player$/.test(cond)) return { events: ['allyCombatDamage'] }
  if ((m = cond.match(/^whenever (another|a) creature (you control )?enters( the battlefield)?( under your control)?$/))) {
    return { events: ['otherCreatureEtb'], creatureFilter: m[2] || m[4] ? 'you' : 'any' }
  }
  return null
}

/** Uma carta é considerada "totalmente suportada" quando nada ficou sem interpretação. */
export function isFullySupported(p: ParsedCard): boolean {
  if (p.unsupported.length) return false
  if (p.spell && (p.spell.unsupported.length || (p.spell.effects.length === 0 && !p.spell.modes))) return false
  if (p.spell?.modes?.some((m) => m.unsupported.length || m.effects.length === 0)) return false
  if (p.triggers.some((t) => (t.modes ? t.modes.some((m) => m.unsupported.length || m.effects.length === 0) : t.unsupported.length || t.effects.length === 0))) return false
  if (p.activated.some((a) => a.unsupported.length || (a.effects.length === 0 && !a.isEquip))) return false
  return true
}

const FACE_LAYOUTS_P = ['modal_dfc', 'transform', 'adventure', 'split', 'flip', 'reversible_card']

/** Interpreta cada face separadamente (cartas dupla-face, aventura, divididas). */
export function parseCardFaces(input: ParseInput & { layout?: string; faces?: { name: string; typeLine: string; oracleText: string }[] }): ParsedCard[] {
  if (input.faces && input.faces.length > 1 && input.layout && FACE_LAYOUTS_P.includes(input.layout)) {
    return input.faces.map((f) => parseCard({ name: f.name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: input.keywords, producedMana: input.producedMana }))
  }
  return [parseCard(input)]
}

function countExprOf(phrase: string): CountExpr | null {
  const p = phrase.replace(/^the number of /, '').trim()
  const map: [RegExp, CountExpr][] = [
    [/^lands? you control$/, 'lands'],
    [/^creatures? you control$/, 'creatures'],
    [/^other creatures? you control$/, 'otherCreatures'],
    [/^artifacts? you control$/, 'artifacts'],
    [/^enchantments? you control$/, 'enchantments'],
    [/^cards? in your hand$/, 'hand'],
    [/^cards? in your graveyard$/, 'graveyard'],
    [/^creature cards? in your graveyard$/, 'creatureCardsGraveyard'],
    [/^forests? you control$/, 'forests'],
    [/^swamps? you control$/, 'swamps'],
    [/^islands? you control$/, 'islands'],
    [/^mountains? you control$/, 'mountains'],
    [/^plains you control$/, 'plains']
  ]
  for (const [re, ce] of map) if (re.test(p)) return ce
  // "your devotion to white" / "your devotion to white and blue"
  const COLOR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }
  const d = p.match(/^your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))?$/)
  if (d) return `devotion:${COLOR[d[1]]}${d[2] ? COLOR[d[2]] : ''}`
  return null
}

export function keywordLabel(k: string): string {
  const map: Record<string, string> = {
    flying: 'Voar', reach: 'Alcance', haste: 'Ímpeto', vigilance: 'Vigilância', trample: 'Atropelar', 'first strike': 'Iniciativa',
    'double strike': 'Golpe Duplo', deathtouch: 'Toque Mortífero', lifelink: 'Vínculo com a Vida', defender: 'Defensor',
    menace: 'Ameaça', indestructible: 'Indestrutível', hexproof: 'Resistência a Magia', flash: 'Lampejo', prowess: 'Destreza',
    shroud: 'Manto', ward: 'Proteção (Ward)', unblockable: 'Não pode ser bloqueada'
  }
  return map[k] ? t(map[k]) : k
}

export type { ParsedCard, StaticAbility, ManaAbility, ActivatedAbility }
