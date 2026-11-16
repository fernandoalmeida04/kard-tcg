// Regras de Yu-Gi-Oh! (banco de cartas + montagem de decks; sem partidas).
// Dados: YGOPRODeck (main/games/ygo/download.ts). Rótulos em português, traduzidos com t() ao exibir.
import type { GameDef, GCard, GParsedLine } from '../types.ts'
import { basicValidate, codeOf, normalizeName } from '../helpers.ts'
import { t } from '../../i18n/index.ts'
import { YGO_ABILITIES, YGO_COLORS, YGO_RACES, YGO_SUBTYPES } from './names.ts'

const EXTRA_FRAMES = ['fusion', 'synchro', 'xyz', 'link']

/** Frame do Extra Deck (fusion/synchro/xyz/link, incluindo as versões de Pêndulo) ou undefined. */
export function ygoExtraKind(frame: string | undefined): string | undefined {
  const base = (frame ?? '').replace(/_pendulum$/, '')
  return EXTRA_FRAMES.includes(base) ? base : undefined
}

const EXTRA_GROUP: Record<string, string> = { fusion: 'Fusão', synchro: 'Sincro', xyz: 'Xyz', link: 'Link' }

const SECTION_HEADERS: [RegExp, string][] = [
  [/^(main|main deck|deck principal|principal|deck|monsters?|spells?|traps?|monstros|magias|armadilhas)$/, 'main'],
  [/^(extra|extra deck|deck extra)$/, 'extra'],
  [/^(side|side deck|sideboard|deck auxiliar)$/, 'side']
]

function headerSection(line: string): string | undefined {
  const s = line
    .toLowerCase()
    .replace(/^[#!/\s]+/, '')
    .replace(/\(\d+\)|\d+\s*cards?|[:\-=*]+/g, '')
    .trim()
    .replace(/\s+\d+$/, '')
  return SECTION_HEADERS.find(([re]) => re.test(s))?.[1]
}

/** Decodifica um link ydke:// (main!extra!side!, cada parte = base64 de uint32 little-endian). */
function parseYdke(url: string): GParsedLine[] {
  const parts = url.trim().slice('ydke://'.length).split('!')
  const sections = ['main', 'extra', 'side']
  const out: GParsedLine[] = []
  parts.slice(0, 3).forEach((b64, i) => {
    if (!b64) return
    let bin: string
    try {
      bin = atob(b64)
    } catch {
      return
    }
    for (let o = 0; o + 3 < bin.length; o += 4) {
      const id = (bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) | (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24)) >>> 0
      out.push({ qty: 1, code: String(id), section: sections[i] })
    }
  })
  return merge(out)
}

/** Junta linhas repetidas (mesma seção e mesmo código/nome), preservando a ordem. */
function merge(lines: GParsedLine[]): GParsedLine[] {
  const out: GParsedLine[] = []
  const idx = new Map<string, GParsedLine>()
  for (const l of lines) {
    const k = `${l.section ?? ''}|${l.code ?? ''}|${normalizeName(l.name)}`
    const cur = idx.get(k)
    if (cur) cur.qty += l.qty
    else {
      const copy = { ...l }
      idx.set(k, copy)
      out.push(copy)
    }
  }
  return out
}

const PASSCODE = /^\d{3,10}$/

function num(v: unknown): number | undefined {
  return typeof v === 'number' && !isNaN(v) ? v : undefined
}

export const def: GameDef = {
  id: 'ygo',
  name: 'Yu-Gi-Oh!',
  short: 'Yu-Gi-Oh!',
  ico: '◆',
  source: {
    name: 'YGOPRODeck',
    url: 'https://ygoprodeck.com',
    note: 'Dados e imagens das cartas: API pública do YGOPRODeck (db.ygoprodeck.com). Yu-Gi-Oh! é marca da Konami; este app não é afiliado a eles.'
  },
  languages: [
    { code: 'pt', label: 'Português' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'it', label: 'Italiano' }
  ],
  categories: [
    { id: 'Monster', label: 'Monstro' },
    { id: 'Spell', label: 'Magia' },
    { id: 'Trap', label: 'Armadilha' }
  ],
  colors: YGO_COLORS.map(([id, label, , css]) => ({ id, label, css })),
  sections: [
    { id: 'main', label: 'Principal', min: 40, max: 60 },
    { id: 'extra', label: 'Extra', min: 0, max: 15 },
    { id: 'side', label: 'Side', min: 0, max: 15 }
  ],
  defaultLimit: 3,
  formats: [
    { id: 'tcg', name: 'Avançado TCG', description: 'Lista de proibidas e limitadas do TCG (Ocidente). Só cartas já lançadas no TCG.' },
    { id: 'ocg', name: 'OCG', description: 'Lista de proibidas e limitadas do OCG (Japão/Ásia). Só cartas lançadas no OCG.' },
    { id: 'goat', name: 'GOAT', description: 'Formato retrô de 2005: apenas cartas daquela época, com a lista de proibidas GOAT.' },
    { id: 'casual', name: 'Livre', description: 'Sem lista de proibidas: qualquer carta, até 3 cópias.' }
  ],
  filters: [
    {
      key: 'category',
      label: 'Categoria',
      kind: 'select',
      options: [
        { value: 'Monster', label: 'Monstro' },
        { value: 'Spell', label: 'Magia' },
        { value: 'Trap', label: 'Armadilha' }
      ]
    },
    {
      key: 'subtype',
      label: 'Tipo de carta',
      kind: 'select',
      options: Object.entries(YGO_SUBTYPES)
        .filter(([en]) => en !== 'Monster')
        .map(([value, label]) => ({ value, label }))
    },
    {
      key: 'colors',
      label: 'Atributo',
      kind: 'multi',
      options: YGO_COLORS.filter(([id]) => id !== 'SPELL' && id !== 'TRAP').map(([value, label]) => ({ value, label })),
      categories: ['Monster']
    },
    {
      key: 'race',
      label: 'Tipo de monstro',
      kind: 'select',
      options: Object.entries(YGO_RACES).map(([value, label]) => ({ value, label })),
      categories: ['Monster']
    },
    {
      key: 'abilities',
      label: 'Habilidade',
      kind: 'multi',
      options: Object.entries(YGO_ABILITIES).map(([value, label]) => ({ value, label })),
      categories: ['Monster']
    },
    { key: 'level', label: 'Nível / Classe', kind: 'range', categories: ['Monster'] },
    { key: 'link', label: 'Link', kind: 'range', categories: ['Monster'] },
    { key: 'atk', label: 'ATK', kind: 'range', categories: ['Monster'] },
    { key: 'def', label: 'DEF', kind: 'range', categories: ['Monster'] },
    { key: 'scale', label: 'Escala', kind: 'range', categories: ['Monster'] },
    { key: 'archetype', label: 'Arquétipo', kind: 'select' }
  ],
  sorts: [
    { id: 'atk', label: 'ATK', field: 'atk', dir: 'desc' },
    { id: 'def', label: 'DEF', field: 'def', dir: 'desc' },
    { id: 'level', label: 'Nível', field: 'level', dir: 'desc' }
  ],

  typeLine(card: GCard): string {
    const parts: string[] = []
    const sub = card.subtype ?? ''
    parts.push(t(YGO_SUBTYPES[sub] ?? (sub || (def.categories.find((c) => c.id === card.category)?.label ?? card.category))))
    if (card.category === 'Monster') {
      const race = String(card.fields.race ?? '')
      if (race) parts.push(t(YGO_RACES[race] ?? race))
      const frame = String(card.fields.frame ?? '')
      const level = num(card.fields.level)
      const link = num(card.fields.link)
      if (frame === 'link' && link !== undefined) parts.push(t('Link-{n}', { n: link }))
      else if (frame.startsWith('xyz') && level !== undefined) parts.push(t('Classe {n}', { n: level }))
      else if (level !== undefined) parts.push(t('Nível {n}', { n: level }))
    }
    return parts.join(' · ')
  },

  stats(card: GCard): { label: string; value: string }[] {
    if (card.category !== 'Monster') return []
    const out: { label: string; value: string }[] = []
    const show = (v: unknown) => (v === undefined || v === null ? '?' : String(v))
    out.push({ label: 'ATK', value: show(card.fields.atk) })
    if (card.fields.frame === 'link') out.push({ label: 'LINK', value: show(card.fields.link) })
    else out.push({ label: 'DEF', value: show(card.fields.def) })
    if (card.fields.scale !== undefined) out.push({ label: t('Escala'), value: String(card.fields.scale) })
    return out
  },

  groupOf(card: GCard): string {
    const extra = ygoExtraKind(String(card.fields.frame ?? ''))
    if (extra) return t(EXTRA_GROUP[extra])
    if (card.category === 'Spell') return t('Magias')
    if (card.category === 'Trap') return t('Armadilhas')
    return t('Monstros')
  },

  validate(deck, cards) {
    const v = basicValidate(def, deck, cards, (c) => normalizeName(c.name))
    const wrongMain = new Set<string>()
    const wrongExtra = new Set<string>()
    for (const dc of deck.sections.main ?? []) {
      const c = cards[dc.oracleId]
      if (c && c.section === 'extra') wrongMain.add(c.localName ?? c.name)
    }
    for (const dc of deck.sections.extra ?? []) {
      const c = cards[dc.oracleId]
      if (c && c.section !== 'extra') wrongExtra.add(c.localName ?? c.name)
    }
    for (const name of wrongMain) v.errors.push(t('{name} é um monstro do Extra Deck e não pode ficar no Deck Principal.', { name }))
    for (const name of wrongExtra) v.errors.push(t('{name} não é um monstro de Fusão, Sincro, Xyz ou Link e não pode ficar no Extra Deck.', { name }))
    v.valid = v.errors.length === 0
    return v
  },

  parseText(text: string): GParsedLine[] {
    const trimmed = text.trim()
    if (/^ydke:\/\//i.test(trimmed)) return parseYdke(trimmed)
    const out: GParsedLine[] = []
    let section = 'main'
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const head = headerSection(line)
      if (head) {
        section = head
        continue
      }
      // Comentários de YDK (#created by ...) e linhas de marcação
      if (line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) continue
      if (PASSCODE.test(line)) {
        out.push({ qty: 1, code: String(Number(line)), section })
        continue
      }
      let qty = 1
      let name = line
      const pre = line.match(/^(\d{1,2})\s*x?\s+(.+)$/i)
      const post = line.match(/^(.+?)\s+x\s*(\d{1,2})$/i)
      if (pre) {
        qty = Number(pre[1])
        name = pre[2]
      } else if (post) {
        qty = Number(post[2])
        name = post[1]
      }
      name = name.trim()
      if (!name || qty <= 0) continue
      if (PASSCODE.test(name)) out.push({ qty, code: String(Number(name)), section })
      else out.push({ qty, name, section })
    }
    return merge(out)
  },

  exportText(deck, cards, printings): string {
    const lines = ['#created by Kard']
    const ids = (sec: string) =>
      (deck.sections[sec] ?? []).flatMap((dc) => {
        const p = dc.printingId ? printings[dc.printingId] : undefined
        const code = codeOf(p, cards[dc.oracleId]) || dc.printingId || dc.oracleId
        return Array.from({ length: Math.max(0, dc.qty) }, () => code)
      })
    lines.push('#main', ...ids('main'), '#extra', ...ids('extra'), '!side', ...ids('side'))
    return lines.join('\n') + '\n'
  },

  exampleList: [
    '#created by Kard',
    '#main',
    '46986414',
    '46986414',
    '46986414',
    '14558127',
    '14558127',
    '24094653',
    '#extra',
    '98502113',
    '!side',
    '14558127'
  ].join('\n'),
  aspect: 59 / 86
}
