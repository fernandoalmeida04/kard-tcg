// Lê o texto (em inglês) dos ataques, Treinadores e Energias e transforma em efeitos estruturados.
// O que não for reconhecido fica em `unsupported` e vira ajuste manual na partida.
import type { PkmCard, PkmType } from '../pokemon/types.ts'
import type { CardFilter, Gate, ParsedCardRules, ParsedText, PEffect } from './types.ts'

const SYMBOL: Record<string, PkmType> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' }
const TYPES: PkmType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless']
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

const num = (s: string | undefined): number => {
  if (!s) return 1
  const n = parseInt(s, 10)
  return Number.isNaN(n) ? (NUM[s.toLowerCase()] ?? 1) : n
}

/** Normaliza o texto: apóstrofos, símbolos de energia, sinônimos antigos ("Defending Pokémon"). */
export function normalizeEffect(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/\{([GRWLPFDMYNC])\}/g, (_, s: string) => SYMBOL[s])
    .replace(/\[([GRWLPFDMYNC])\]/g, (_, s: string) => SYMBOL[s])
    .replace(/×/g, 'x')
    .replace(/<[^>]*>/g, '')
    .replace(/\s*\((?:Don't apply|This counts|You can't|Pokémon ex|Pokémon V|Any effects|The Defending|Discard|Then)[^)]*\)/gi, '')
    .replace(/the Defending Pokémon/gi, "your opponent's Active Pokémon")
    .replace(/\bPokemon\b/g, 'Pokémon')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Divide em frases (respeitando parênteses). */
function sentences(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    cur += ch
    if (ch === '.' && depth === 0 && (text[i + 1] === ' ' || i === text.length - 1)) {
      out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const COND: Record<string, 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned'> = {
  asleep: 'asleep',
  confused: 'confused',
  paralyzed: 'paralyzed',
  poisoned: 'poisoned',
  burned: 'burned'
}

function typeOf(word: string | undefined): PkmType | undefined {
  if (!word) return undefined
  return TYPES.find((t) => t.toLowerCase() === word.toLowerCase())
}

/** Filtro de busca a partir de frases como "a Basic Pokémon", "up to 2 basic Energy cards", "an Item card". */
function filterOf(phrase: string): CardFilter | null {
  const p = phrase.toLowerCase().replace(/\bcards?\b/g, '').trim()
  let m: RegExpMatchArray | null
  if (/^basic pokémon that doesn't have a rule box$/.test(p)) return { category: 'Pokemon', basicPokemon: true, noRuleBox: true }
  if ((m = p.match(/^basic (\w+) pokémon$/)) && typeOf(m[1])) return { category: 'Pokemon', basicPokemon: true, type: typeOf(m[1]) }
  if (/^basic pokémon$/.test(p)) return { category: 'Pokemon', basicPokemon: true }
  if ((m = p.match(/^(\w+) pokémon$/)) && typeOf(m[1])) return { category: 'Pokemon', type: typeOf(m[1]) }
  if (/^pokémon$/.test(p)) return { category: 'Pokemon' }
  if ((m = p.match(/^basic (\w+) energy$/)) && typeOf(m[1])) return { category: 'Energy', basicEnergy: true, type: typeOf(m[1]) }
  if (/^basic energy$/.test(p)) return { category: 'Energy', basicEnergy: true }
  if (/^energy$/.test(p)) return { category: 'Energy' }
  if (/^item$/.test(p)) return { category: 'Trainer', trainerType: 'Item' }
  if (/^supporter$/.test(p)) return { category: 'Trainer', trainerType: 'Supporter' }
  if (/^stadium$/.test(p)) return { category: 'Trainer', trainerType: 'Stadium' }
  if (/^pokémon tool$/.test(p)) return { category: 'Trainer', trainerType: 'Tool' }
  if (/^trainer$/.test(p)) return { category: 'Trainer' }
  if (/^$/.test(p)) return {}
  return null
}

/** Uma frase sem moeda → efeito (ou null se não reconhecida). */
function sentenceEffect(s: string, gate?: Gate): PEffect | PEffect[] | null {
  const x = s.replace(/\.$/, '').trim()
  const low = x.toLowerCase()
  let m: RegExpMatchArray | null

  // condições especiais
  if ((m = low.match(/^your opponent's active pokémon is now (asleep|confused|paralyzed|poisoned|burned)$/))) return { k: 'condition', target: 'oppActive', cond: COND[m[1]], gate }
  if ((m = low.match(/^your opponent's active pokémon is now (asleep|confused|paralyzed|poisoned|burned) and (asleep|confused|paralyzed|poisoned|burned)$/)))
    return [
      { k: 'condition', target: 'oppActive', cond: COND[m[1]], gate },
      { k: 'condition', target: 'oppActive', cond: COND[m[2]], gate }
    ]
  if ((m = low.match(/^this pokémon is now (asleep|confused|paralyzed|poisoned|burned)$/))) return { k: 'condition', target: 'self', cond: COND[m[1]], gate }

  // dano em si mesmo / cura
  if ((m = low.match(/^this pokémon (?:also )?does (\d+) damage to itself$/))) return { k: 'selfDamage', amount: num(m[1]), gate }
  if ((m = low.match(/^heal (\d+) damage from this pokémon$/))) return { k: 'heal', target: 'self', amount: num(m[1]), gate }
  if ((m = low.match(/^heal (\d+) damage from (?:1|one) of your pokémon$/))) return { k: 'heal', target: 'chooseOwn', amount: num(m[1]), gate }
  if ((m = low.match(/^heal (\d+) damage from your active pokémon$/))) return { k: 'heal', target: 'self', amount: num(m[1]), gate }
  if ((m = low.match(/^remove (\d+|a|an|one|two|three) damage counters? from (?:1|one) of your pokémon/))) return { k: 'heal', target: 'chooseOwn', amount: num(m[1]) * 10, gate }

  // compra
  if ((m = low.match(/^draw (a|an|one|two|three|four|five|six|seven|\d+) cards?$/))) return { k: 'draw', n: num(m[1]), gate }
  if ((m = low.match(/^draw cards until you have (\d+) cards in your hand$/))) return { k: 'drawUntil', n: num(m[1]) }
  if ((m = low.match(/^discard your hand and draw (\d+) cards$/))) return { k: 'discardHandDraw', n: num(m[1]) }
  if ((m = low.match(/^shuffle your hand into your deck(?:\.| and|, then|\. then,?) draw (\d+) cards$/))) return { k: 'shuffleHandDraw', n: num(m[1]) }
  if (/^shuffle your hand into your deck$/.test(low)) return { k: 'shuffleHandDraw', n: 0 }
  if ((m = low.match(/^then,? draw (a|an|one|two|three|four|five|six|seven|\d+) cards?$/))) return { k: 'draw', n: num(m[1]) }

  // energia
  if ((m = low.match(/^discard (an|a|one|two|three|\d+) (?:(\w+) )?energy (?:card )?(?:from|attached to) this pokémon$/))) {
    const type = typeOf(m[2])
    if (m[2] && !type && m[2] !== 'basic') return null
    return { k: 'discardEnergy', from: 'self', count: num(m[1]), type, gate }
  }
  if (/^discard all energy (?:from|attached to) this pokémon$/.test(low)) return { k: 'discardEnergy', from: 'self', count: 'all', gate }
  if ((m = low.match(/^discard (an|a|one|two|\d+) energy (?:card )?(?:from|attached to) your opponent's active pokémon$/))) return { k: 'discardEnergy', from: 'oppActive', count: num(m[1]), gate }

  // efeitos no próximo turno
  if (/^during your next turn, this pokémon can't attack$/.test(low) || /^this pokémon can't attack during your next turn$/.test(low)) return { k: 'cantAttackNext' }
  if (/^during your opponent's next turn, your opponent's active pokémon can't retreat$/.test(low) || /^your opponent's active pokémon can't retreat during your opponent's next turn$/.test(low))
    return { k: 'oppCantRetreat', gate }
  if ((m = low.match(/^during your opponent's next turn, this pokémon takes (\d+) less damage from attacks/)) || (m = low.match(/^during your opponent's next turn, any damage done to this pokémon by attacks is reduced by (\d+)/)))
    return { k: 'reduceDamageNext', amount: num(m[1]), gate }
  if (/^during your opponent's next turn, prevent all damage from and effects of attacks done to this pokémon$/.test(low) || /^during your opponent's next turn, prevent all damage done to this pokémon by attacks$/.test(low))
    return { k: 'preventAllNext', gate }

  // trocas
  if ((m = low.match(/^(you may )?switch this pokémon with (?:1|one) of your benched pokémon$/))) return { k: 'switchSelf', optional: Boolean(m[1]) }
  if (/^switch your active pokémon with (?:1|one) of your benched pokémon$/.test(low)) return { k: 'switchOwnActive' }
  if (/^switch in (?:1|one) of your opponent's benched pokémon to the active spot$/.test(low) || /^switch (?:1|one) of your opponent's benched pokémon with their active pokémon$/.test(low)) return { k: 'gust' }
  if (/^your opponent switches their active pokémon with (?:1|one) of their benched pokémon$/.test(low)) return { k: 'oppSwitches' }

  // dano no banco / em outros Pokémon
  if ((m = low.match(/^this attack (?:also )?does (\d+) damage to (?:1|one) of your opponent's benched pokémon$/))) return { k: 'damage', target: 'chooseOppBench', amount: num(m[1]), gate }
  if ((m = low.match(/^this attack (?:also )?does (\d+) damage to (\d+) of your opponent's benched pokémon$/))) return { k: 'damage', target: 'chooseOppBench', amount: num(m[1]), count: num(m[2]), gate }
  if ((m = low.match(/^this attack does (\d+) damage to (?:1|one) of your opponent's pokémon$/))) return { k: 'damage', target: 'chooseOpp', amount: num(m[1]), gate }
  if ((m = low.match(/^this attack (?:also )?does (\d+) damage to each of your opponent's benched pokémon$/))) return { k: 'damage', target: 'eachOppBench', amount: num(m[1]), gate }
  if ((m = low.match(/^this attack (?:also )?does (\d+) damage to each of your benched pokémon$/))) return { k: 'damage', target: 'eachOwnBench', amount: num(m[1]), gate }

  // deck do oponente
  if ((m = low.match(/^discard the top (?:card|(\d+) cards) of your opponent's deck$/))) return { k: 'millOpp', n: m[1] ? num(m[1]) : 1, gate }
  if ((m = low.match(/^discard the top (?:card|(\d+) cards) of your deck$/))) return { k: 'millSelf', n: m[1] ? num(m[1]) : 1 }
  if (/^discard a random card from your opponent's hand$/.test(low)) return { k: 'discardRandomOpp', gate }
  if (/^your opponent reveals (?:their|his or her) hand$/.test(low)) return []
  if (/^\(?your opponent chooses the new active pokémon\.?\)?$/.test(low)) return []
  if (/^switch out your opponent's active pokémon to the bench$/.test(low)) return { k: 'oppSwitches' }
  if ((m = low.match(/^this attack does (\d+) damage to each of your opponent's pokémon$/))) return { k: 'damage', target: 'eachOpp', amount: num(m[1]), gate }
  if ((m = low.match(/^heal (\d+) damage from each of your pokémon$/))) return { k: 'heal', target: 'eachOwn', amount: num(m[1]), gate }

  // buscas
  if ((m = low.match(/^search your deck for (?:up to )?(a|an|one|two|three|four|\d+) (.+?), (?:reveal (?:it|them), and )?put (?:it|them) into your hand(?:\. then,? shuffle your deck)?$/))) {
    const f = filterOf(m[2])
    if (f) return { k: 'search', filter: f, max: num(m[1]), dest: 'hand', gate }
  }
  if ((m = low.match(/^search your deck for (?:up to )?(a|an|one|two|three|four|\d+) (.+?) and put (?:it|them) onto your bench(?:\. then,? shuffle your deck)?$/))) {
    const f = filterOf(m[2])
    if (f && f.basicPokemon) return { k: 'search', filter: f, max: num(m[1]), dest: 'bench', gate }
  }
  if ((m = low.match(/^search your deck for up to (\d+|a|an|one|two|three) cards?(?:,| and) put (?:it|them) into your hand(?:\. then,? shuffle your deck)?$/))) return { k: 'search', filter: {}, max: num(m[1]), dest: 'hand', gate }
  if (/^then,? shuffle your deck$/.test(low) || /^shuffle your deck afterward$/.test(low)) return []

  // descarte → mão / deck
  if ((m = low.match(/^put (?:up to )?(a|an|one|two|three|four|\d+) (.+?) from your discard pile into your hand$/))) {
    const f = filterOf(m[2])
    if (f) return { k: 'fromDiscard', filter: f, max: num(m[1]), dest: 'hand' }
  }
  if ((m = low.match(/^shuffle (?:up to )?(\d+|a|an) (.+?) from your discard pile into your deck$/))) {
    const f = filterOf(m[2])
    if (f) return { k: 'fromDiscard', filter: f, max: num(m[1]), dest: 'deck' }
  }

  // regras de jogar o Item (lembretes) não mudam nada
  if (/^you may play as many item cards as you like during your turn/.test(low)) return []
  if (/^you may play only (?:1|one) supporter card during your turn/.test(low)) return []
  return null
}

/** Frases de modificação de dano do ataque. */
function damageModifier(s: string): PEffect | null {
  const low = s.replace(/\.$/, '').toLowerCase()
  let m: RegExpMatchArray | null
  if ((m = low.match(/^flip a coin\. if heads, this attack does (\d+) more damage$/))) return { k: 'coinMore', coins: 1, amount: num(m[1]) }
  if ((m = low.match(/^flip (\d+|two|three|four|five) coins\. this attack does (\d+) more damage for each heads$/))) return { k: 'coinMore', coins: num(m[1]), amount: num(m[2]) }
  if ((m = low.match(/^flip (\d+|two|three|four|five) coins\. this attack does (\d+) damage (?:for each heads|times the number of heads)$/))) return { k: 'coinTimes', coins: num(m[1]), amount: num(m[2]) }
  if ((m = low.match(/^flip a coin until you get tails\. this attack does (\d+) damage for each heads$/))) return { k: 'coinTimes', coins: 0, amount: num(m[1]), untilTails: true }
  if ((m = low.match(/^flip a coin until you get tails\. this attack does (\d+) more damage for each heads$/))) return { k: 'coinMore', coins: 0, amount: num(m[1]), untilTails: true }
  if (/^flip a coin\. if tails, this attack does nothing$/.test(low)) return { k: 'coinFail' }
  if ((m = low.match(/^if this pokémon has any damage counters on it, this attack does (\d+) more damage$/))) return { k: 'moreIfDamaged', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) more damage for each energy attached to your opponent's active pokémon$/))) return { k: 'morePerEnergy', who: 'opp', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) more damage for each energy attached to this pokémon$/))) return { k: 'morePerEnergy', who: 'self', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) (?:more )?damage for each damage counter on your opponent's active pokémon$/))) return { k: 'morePerDamageCounterOpp', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) (?:more )?damage for each of your benched pokémon$/))) return { k: 'morePerBench', who: 'self', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) (?:more )?damage for each of your opponent's benched pokémon$/))) return { k: 'morePerBench', who: 'opp', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) (?:more )?damage for each benched pokémon \(both yours and your opponent's\)$/))) return { k: 'morePerBench', who: 'both', amount: num(m[1]) }
  if ((m = low.match(/^if your opponent's active pokémon (?:already )?has any damage counters on it, this attack does (\d+) more damage$/))) return { k: 'moreIfOppDamaged', amount: num(m[1]) }
  if ((m = low.match(/^this attack does (\d+) (more )?damage for each damage counter on this pokémon$/))) return { k: 'perCounterSelf', amount: num(m[1]), replace: !m[2] }
  if ((m = low.match(/^if there is any stadium (?:card )?in play, this attack does (\d+) more damage$/))) return { k: 'moreIfStadium', amount: num(m[1]) }
  if ((m = low.match(/^if your opponent's active pokémon is (poisoned|burned|asleep|confused|paralyzed|affected by a special condition), this attack does (\d+) more damage$/)))
    return { k: 'moreIfOppCondition', cond: m[1].startsWith('affected') ? 'any' : (m[1] as 'poisoned'), amount: num(m[2]) }
  if ((m = low.match(/^if your opponent's active pokémon is an evolution pokémon, this attack does (\d+) more damage$/))) return { k: 'moreIfOppEvolved', amount: num(m[1]) }
  if (/^this attack's damage isn't affected by resistance$/.test(low)) return { k: 'ignoreResistance' }
  if (/^this attack's damage isn't affected by weakness or resistance$/.test(low)) return { k: 'ignoreWeaknessResistance' }
  return null
}

/** Lê o texto de efeito de um ataque, Treinador ou habilidade. */
export function parseEffectText(raw: string | undefined): ParsedText {
  const out: ParsedText = { effects: [], unsupported: [] }
  if (!raw || !raw.trim()) return out
  const text = normalizeEffect(raw)
  const list = sentences(text)
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const next = list[i + 1]
    // modificadores que ocupam duas frases ("Flip a coin. If heads, ... more damage.")
    if (next) {
      const mod2 = damageModifier(`${s} ${next}`)
      if (mod2) {
        out.effects.push(mod2)
        i++
        continue
      }
    }
    const mod = damageModifier(s)
    if (mod) {
      out.effects.push(mod)
      continue
    }
    // "Flip a coin. If heads, X." / "If tails, X."
    if (/^flip a coin\.?$/i.test(s) && next) {
      const g = next.match(/^if (heads|tails), (.+)$/i)
      if (g) {
        const body = g[2].charAt(0).toUpperCase() + g[2].slice(1)
        const e = sentenceEffect(body, g[1].toLowerCase() as Gate)
        if (e) {
          out.effects.push({ k: 'flip' }, ...(Array.isArray(e) ? e : [e]))
          i++
          // "If tails, ..." logo depois, usando a mesma moeda
          const after = list[i + 1]
          const g2 = after?.match(/^if (heads|tails), (.+)$/i)
          if (g2) {
            const e2 = sentenceEffect(g2[2].charAt(0).toUpperCase() + g2[2].slice(1), g2[1].toLowerCase() as Gate)
            if (e2) {
              out.effects.push(...(Array.isArray(e2) ? e2 : [e2]))
              i++
            }
          }
          continue
        }
      }
      out.unsupported.push(`${s} ${next}`)
      i++
      continue
    }
    // "Discard N cards from your hand. If you do, ..." (custo do Ultra Ball e parecidos)
    let m: RegExpMatchArray | null
    if ((m = s.toLowerCase().match(/^discard (a|one|two|\d+) (?:other )?cards? from your hand\.?$/))) {
      out.effects.push({ k: 'discardFromHand', n: num(m[1]), cost: Boolean(next && /^if you do, /i.test(next)) })
      if (next && /^if you do, /i.test(next)) {
        list[i + 1] = next.replace(/^if you do, /i, '').replace(/^\w/, (c) => c.toUpperCase())
      }
      continue
    }
    const e = sentenceEffect(s)
    if (e) out.effects.push(...(Array.isArray(e) ? e : [e]))
    else out.unsupported.push(s)
  }
  return out
}

/** Prêmios por nocaute (regra de Pokémon ex, V, VMAX, GX...). */
export function prizeValue(c: PkmCard): number {
  const suffix = (c.suffix ?? '').toUpperCase()
  const stage = (c.stage ?? '').toUpperCase()
  if (stage === 'VMAX' || stage === 'V-UNION' || suffix.includes('TAG TEAM')) return 3
  if (stage === 'MEGA' && suffix === 'EX') return c.suffix === 'ex' ? 3 : 2
  if (suffix === 'EX' || suffix === 'V' || suffix === 'GX' || suffix === 'VSTAR' || stage === 'VSTAR' || suffix.endsWith('-GX')) return 2
  return 1
}

/** Tem Regra (ex, V, GX...)? */
export function hasRuleBox(c: PkmCard): boolean {
  return prizeValue(c) > 1 || Boolean(c.radiant) || /BREAK|LEGEND|Prism/i.test(c.stage ?? '') || Boolean(c.prismStar)
}

/** Tipo fornecido por uma Energia básica (pelo nome: "Fire Energy", "Basic Fire Energy"). */
export function basicEnergyType(c: PkmCard): PkmType | undefined {
  if (c.category !== 'Energy' || c.energyType === 'Special') return undefined
  const m = c.name.match(/(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon)/i)
  return m ? typeOf(m[1]) : undefined
}

/** Regras de uma carta: efeitos dos ataques, habilidades, Treinador, Energia especial e Ferramenta. */
export function parseCardRules(c: PkmCard): ParsedCardRules {
  const rules: ParsedCardRules = {
    attacks: c.attacks.map((a) => parseEffectText(a.effect)),
    abilities: c.abilities.map((a) => parseEffectText(a.effect))
  }
  if (c.category === 'Trainer') {
    if (c.trainerType === 'Tool') {
      const t = normalizeEffect(c.effect ?? '')
      const hp = t.match(/^The Pokémon this card is attached to gets \+(\d+) HP\.?$/i)
      const dmg = t.match(/^The attacks of the Pokémon this card is attached to do (\d+) more damage to your opponent's Active Pokémon \(before applying Weakness and Resistance\)\.?$/i)
      if (hp) rules.toolHp = num(hp[1])
      else if (dmg) rules.toolDamage = num(dmg[1])
      else rules.trainer = { effects: [], unsupported: t ? [t] : [] }
    } else if (c.trainerType === 'Stadium') {
      // efeitos de Estádio são contínuos: por enquanto, aplicados à mão
      const t = normalizeEffect(c.effect ?? '')
      rules.trainer = { effects: [], unsupported: t ? [t] : [] }
    } else if (/rare candy/i.test(c.name) || /^Choose 1 of your Basic Pokémon in play\. If you have a Stage 2 card in your hand that evolves from that Pokémon/i.test(c.effect ?? '')) {
      rules.trainer = { effects: [{ k: 'rareCandy' }], unsupported: [] }
    } else {
      rules.trainer = parseEffectText(c.effect)
    }
  }
  if (c.category === 'Energy') {
    const basic = basicEnergyType(c)
    if (basic) rules.energyProvides = [basic]
    else {
      const t = normalizeEffect(c.effect ?? '')
      let m: RegExpMatchArray | null
      if ((m = t.match(/provides ((?:Colorless|Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon)+) Energy/i))) {
        const units = m[1].match(/Colorless|Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon/gi) ?? []
        rules.energyProvides = units.map((u) => typeOf(u)!)
      } else if (/provides every type of Energy but provides only 1 Energy at a time/i.test(t)) rules.energyProvides = ['any']
      else rules.energyProvides = ['Colorless']
      // o resto do texto da Energia especial (efeitos extras) fica manual
      const rest = t.replace(/As long as this card is attached to a Pokémon, it provides [^.]+\.\s*/i, '').replace(/This card provides [^.]+\.\s*/i, '').trim()
      if (rest) rules.trainer = { effects: [], unsupported: [rest] }
    }
  }
  return rules
}

/** Tudo da carta é automatizado (ataques, habilidades, Treinador)? */
export function isCardAutomated(c: PkmCard): boolean {
  const r = parseCardRules(c)
  return r.attacks.every((a) => !a.unsupported.length) && r.abilities.every((a) => !a.unsupported.length && a.effects.length > 0) && !r.trainer?.unsupported.length
}

/** Trechos não automatizados de uma carta (para a verificação do deck). */
export function unsupportedParts(c: PkmCard): string[] {
  const r = parseCardRules(c)
  const out: string[] = []
  c.attacks.forEach((a, i) => r.attacks[i].unsupported.forEach((u) => out.push(`${a.name}: ${u}`)))
  c.abilities.forEach((a, i) => {
    const p = r.abilities[i]
    if (p.unsupported.length || !p.effects.length) out.push(`${a.name}: ${p.unsupported.join(' ') || normalizeEffect(a.effect)}`)
  })
  if (r.trainer?.unsupported.length) out.push(...r.trainer.unsupported)
  return out
}
