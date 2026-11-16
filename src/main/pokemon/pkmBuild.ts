// Montagem do banco do Pokémon TCG a partir das respostas do TCGdex (sem dependência do Electron: testável com node).
import type { PkmAbility, PkmAttack, PkmCard, PkmCategory, PkmPrinting, PkmSetInfo, PkmType } from '../../shared/pokemon/types.ts'
import { PKM_TYPES } from '../../shared/pokemon/types.ts'
import { PKM_SET_CODES } from '../../shared/pokemon/formats.ts'

export const PKM_DB_VERSION = 1

export interface PkmDbFile {
  version: number
  lang: string
  updatedAt: string
  cards: PkmCard[]
  printings: PkmPrinting[]
  sets: PkmSetInfo[]
}

export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const asType = (x: string | null | undefined): PkmType | null => (x && (PKM_TYPES as string[]).includes(x) ? (x as PkmType) : null)

export interface RawCard {
  id: string
  localId: string
  name: string
  image?: string | null
  category: string
  hp?: number | null
  types?: string[] | null
  stage?: string | null
  evolveFrom?: string | null
  retreat?: number | null
  regulationMark?: string | null
  rarity?: string | null
  illustrator?: string | null
  trainerType?: string | null
  energyType?: string | null
  effect?: string | null
  suffix?: string | null
  dexId?: number[] | null
  legal?: { standard: boolean; expanded: boolean } | null
  variants?: { normal: boolean; reverse: boolean; holo: boolean; firstEdition: boolean } | null
  set?: { id: string } | null
  attacks?: ({ name: string; cost?: string[] | null; damage?: string | number | null; effect?: string | null } | null)[] | null
  abilities?: ({ type?: string | null; name: string; effect?: string | null } | null)[] | null
  weaknesses?: ({ type: string; value?: string | null } | null)[] | null
  resistances?: ({ type: string; value?: string | null } | null)[] | null
}

export interface RawLocal {
  id: string
  name?: string | null
  image?: string | null
  effect?: string | null
  evolveFrom?: string | null
  attacks?: ({ name?: string | null; effect?: string | null } | null)[] | null
  abilities?: ({ name?: string | null; effect?: string | null } | null)[] | null
}

export interface RawSet {
  id: string
  name: string
  releaseDate?: string | null
  tcgOnline?: string | null
  cardCount?: { official?: number | null; total?: number | null } | null
  serie?: { id: string } | null
}

/** Chave de "mesma carta": nome + texto de regras (reimpressões idênticas viram uma carta só). */
function identityKey(c: RawCard): string {
  const n = normalize(c.name)
  if (c.category === 'Pokemon') {
    const atk = (c.attacks ?? []).filter((a) => a?.name).map((a) => `${normalize(a!.name)}:${a!.damage ?? ''}:${normalize(a!.effect ?? '')}`)
    const ab = (c.abilities ?? []).filter((a) => a?.name).map((a) => `${normalize(a!.name)}:${normalize(a!.effect ?? '')}`)
    return `P|${n}|${c.hp ?? ''}|${c.stage ?? ''}|${atk.join(';')}|${ab.join(';')}`
  }
  // Energias básicas: "Lightning Energy" e "Basic Lightning Energy" são a mesma carta
  if (c.category === 'Energy' && c.energyType !== 'Special') return `E|${n.replace(/^basic /, '')}`
  return `${c.category[0]}|${n}|${normalize(c.effect ?? '')}`
}

function hashId(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619)
    h2 = (Math.imul(h2, 31) + s.charCodeAt(i)) | 0
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12)
}

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'card'
}

/** Prioridade para a arte padrão: com imagem, legal, raridade comum, mais recente. */
function printingScore(p: PkmPrinting): number {
  let s = 0
  if (p.localImage || p.image) s += 20
  if (p.legal.standard) s += 4
  else if (p.legal.expanded) s += 2
  if (/^(common|uncommon|rare|rare holo|holo rare|double rare|none)$/i.test(p.rarity)) s += 3
  if (/promo/i.test(p.rarity) || /p$/.test(p.set)) s -= 1
  return s + (Date.parse(p.releasedAt || '1996-01-01') - Date.parse('1996-01-01')) / (Date.parse('2040-01-01') - Date.parse('1996-01-01'))
}

export function buildDatabase(rawSets: RawSet[], rawCards: RawCard[], local: Map<string, RawLocal>, lang: string): PkmDbFile {
  // Cartas do TCG Pocket (série "tcgp") não fazem parte do TCG físico
  const setById = new Map(rawSets.filter((s) => s.serie?.id !== 'tcgp').map((s) => [s.id, s]))
  const sets: PkmSetInfo[] = [...setById.values()]
    .map((s) => ({
      id: s.id,
      name: s.name,
      code: s.tcgOnline || PKM_SET_CODES[s.id] || undefined,
      serie: s.serie?.id ?? '',
      releasedAt: s.releaseDate ?? '',
      cardCount: s.cardCount?.total ?? s.cardCount?.official ?? 0
    }))
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name))
  const setInfo = new Map(sets.map((s) => [s.id, s]))

  const groups = new Map<string, { raw: RawCard; printing: PkmPrinting }[]>()
  for (const c of rawCards) {
    const sid = c.set?.id
    if (!sid || !setInfo.has(sid)) continue
    if (!['Pokemon', 'Trainer', 'Energy'].includes(c.category)) continue
    const s = setInfo.get(sid)!
    const loc = local.get(c.id)
    const printing: PkmPrinting = {
      id: c.id,
      cardId: '',
      set: sid,
      setName: s.name,
      setCode: s.code,
      localId: c.localId,
      rarity: c.rarity ?? '',
      illustrator: c.illustrator ?? undefined,
      regulationMark: c.regulationMark && c.regulationMark !== 'None' ? c.regulationMark.toUpperCase() : undefined,
      releasedAt: s.releasedAt,
      image: c.image ?? undefined,
      localImage: loc?.image ?? undefined,
      localName: loc?.name && loc.name !== c.name ? loc.name : undefined,
      variants: { normal: c.variants?.normal ?? true, reverse: c.variants?.reverse ?? false, holo: c.variants?.holo ?? false, firstEdition: c.variants?.firstEdition ?? false },
      legal: { standard: Boolean(c.legal?.standard), expanded: Boolean(c.legal?.expanded) }
    }
    const key = identityKey(c)
    const list = groups.get(key)
    if (list) list.push({ raw: c, printing })
    else groups.set(key, [{ raw: c, printing }])
  }

  const cards: PkmCard[] = []
  const printings: PkmPrinting[] = []
  const usedIds = new Set<string>()
  for (const [key, list] of groups) {
    list.sort((a, b) => b.printing.releasedAt.localeCompare(a.printing.releasedAt))
    const ref = list[0].raw
    let id = `${slug(ref.name)}-${hashId(key)}`
    while (usedIds.has(id)) id += 'x'
    usedIds.add(id)
    for (const x of list) x.printing.cardId = id
    // texto traduzido: da impressão localizada mais recente
    const loc = list.map((x) => local.get(x.raw.id)).find((l) => l?.name)
    const attacks: PkmAttack[] = (ref.attacks ?? []).filter((a) => a?.name).map((a, i) => {
      const la = loc?.attacks?.[i]
      return {
        name: a!.name,
        localName: la?.name && la.name !== a!.name ? la.name : undefined,
        cost: (a!.cost ?? []).map(asType).filter(Boolean) as PkmType[],
        damage: a!.damage !== null && a!.damage !== undefined && a!.damage !== '' ? String(a!.damage) : undefined,
        effect: a!.effect ?? undefined,
        localEffect: la?.effect && la.effect !== a!.effect ? la.effect : undefined
      }
    })
    const abilities: PkmAbility[] = (ref.abilities ?? []).filter((a) => a?.name).map((a, i) => {
      const la = loc?.abilities?.[i]
      return {
        type: a!.type ?? 'Ability',
        name: a!.name,
        localName: la?.name && la.name !== a!.name ? la.name : undefined,
        effect: a!.effect ?? '',
        localEffect: la?.effect && la.effect !== a!.effect ? la.effect : undefined
      }
    })
    const rarities = list.map((x) => x.raw.rarity ?? '')
    const category = ref.category as PkmCategory
    const best = [...list].sort((a, b) => printingScore(b.printing) - printingScore(a.printing))[0]
    cards.push({
      id,
      name: ref.name,
      localName: loc?.name && loc.name !== ref.name ? loc.name : undefined,
      category,
      hp: ref.hp ?? undefined,
      types: (ref.types ?? []).map(asType).filter(Boolean) as PkmType[],
      stage: ref.stage ?? undefined,
      evolveFrom: ref.evolveFrom ?? undefined,
      localEvolveFrom: loc?.evolveFrom && loc.evolveFrom !== ref.evolveFrom ? loc.evolveFrom : undefined,
      suffix: ref.suffix ?? undefined,
      retreat: ref.retreat ?? undefined,
      weaknesses: (ref.weaknesses ?? []).filter((w) => w?.type).map((w) => ({ type: asType(w!.type), value: w!.value ?? '' })).filter((w) => w.type) as PkmCard['weaknesses'],
      resistances: (ref.resistances ?? []).filter((w) => w?.type).map((w) => ({ type: asType(w!.type), value: w!.value ?? '' })).filter((w) => w.type) as PkmCard['resistances'],
      attacks,
      abilities,
      trainerType: ref.trainerType ?? undefined,
      energyType: category === 'Energy' ? (ref.energyType ?? 'Normal') : undefined,
      effect: ref.effect ?? undefined,
      localEffect: loc?.effect && loc.effect !== ref.effect ? loc.effect : undefined,
      legal: { standard: list.some((x) => x.printing.legal.standard), expanded: list.some((x) => x.printing.legal.expanded) },
      aceSpec: rarities.some((r) => /ace spec/i.test(r)) || undefined,
      radiant: rarities.some((r) => /radiant/i.test(r)) || /^radiant /i.test(ref.name) || undefined,
      prismStar: /◇|prism star/i.test(ref.name) || undefined,
      regulationMarks: [...new Set(list.map((x) => x.printing.regulationMark).filter(Boolean) as string[])],
      dexId: ref.dexId ?? undefined,
      defaultPrintingId: best.printing.id,
      printingIds: list.map((x) => x.printing.id)
    })
    printings.push(...list.map((x) => x.printing))
  }

  return { version: PKM_DB_VERSION, lang, updatedAt: new Date().toISOString(), cards, printings, sets }
}
