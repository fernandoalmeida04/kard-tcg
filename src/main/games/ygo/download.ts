// Download do banco de Yu-Gi-Oh! a partir da API pública do YGOPRODeck (v7).
// Uma requisição em massa por idioma + lista de coleções. Imagens não são baixadas aqui
// (o app guarda cada imagem localmente na primeira vez em que ela é exibida).
// Usa só `fetch` global (sem Electron), para rodar também em scripts node.
import type { GameDownloader, GCard, GPrinting, GSet } from '../../../shared/games/types.ts'
import type { DownloadProgress } from '../../../shared/types.ts'
import { t } from '../../../shared/i18n/index.ts'
import { ygoExtraKind } from '../../../shared/games/ygo/def.ts'

const API = 'https://db.ygoprodeck.com/api/v7'
const HEADERS = { 'User-Agent': 'KardTCGSimulator/0.1', Accept: 'application/json' }

interface YSet {
  set_name: string
  set_code: string
  set_rarity?: string
}

interface YImage {
  id: number
  image_url?: string
  image_url_small?: string
}

interface YMisc {
  formats?: string[]
  tcg_date?: string
  ocg_date?: string
}

interface YCard {
  id: number
  name: string
  name_en?: string
  type: string
  humanReadableCardType?: string
  frameType: string
  desc?: string
  pend_desc?: string
  monster_desc?: string
  race?: string
  atk?: number | null
  def?: number | null
  level?: number | null
  attribute?: string | null
  linkval?: number | null
  linkmarkers?: string[]
  scale?: number | null
  archetype?: string
  typeline?: string[]
  card_sets?: YSet[]
  card_images?: YImage[]
  banlist_info?: { ban_tcg?: string; ban_ocg?: string; ban_goat?: string }
  misc_info?: YMisc[]
}

interface YCardSet {
  set_name: string
  set_code: string
  num_of_cards?: number
  tcg_date?: string
}

/** Id estável de coleção (os códigos se repetem entre coleções; os nomes não). */
export function ygoSetId(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'ygo'
  )
}

function setPrefix(code: string): string {
  return code.split('-')[0]
}

async function fetchJson<T>(url: string, signal: AbortSignal, onBytes?: (bytes: number) => void): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal })
  if (!res.ok) throw new Error(t('Falha ao baixar {url} (HTTP {status}).', { url, status: res.status }))
  if (!onBytes || !res.body) return (await res.json()) as T
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total - last > 512 * 1024) {
      last = total
      onBytes(total)
    }
  }
  onBytes(total)
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  return JSON.parse(new TextDecoder('utf-8').decode(buf)) as T
}

const LIMIT: Record<string, number> = { Banned: 0, Forbidden: 0, Limited: 1, 'Semi-Limited': 2 }

function limitValue(v: string | undefined): number | undefined {
  return v ? LIMIT[v] : undefined
}

function category(type: string): 'Monster' | 'Spell' | 'Trap' {
  if (type.includes('Spell')) return 'Spell'
  if (type.includes('Trap')) return 'Trap'
  return 'Monster'
}

function stat(v: number | null | undefined): number | string | undefined {
  if (v === null || v === undefined) return undefined
  return v < 0 ? '?' : v
}

/** Cartas que ficam fora do banco: Skills (Speed Duel), fichas e cartas que não existem no TCG/OCG. */
function keep(c: YCard): boolean {
  if (c.frameType === 'skill' || c.frameType === 'token' || c.type === 'Skill Card' || c.type === 'Token') return false
  if (!c.name || c.name.includes('???')) return false
  const formats = c.misc_info?.[0]?.formats ?? []
  return formats.includes('TCG') || formats.includes('OCG')
}

const LANG_NAMES: Record<string, string> = { pt: 'português', fr: 'francês', de: 'alemão', it: 'italiano' }

export const download: GameDownloader = async (lang, signal, progress) => {
  const report = (phase: DownloadProgress['phase'], current: number, total: number, message: string) => progress({ phase, current, total, message })
  const mb = (n: number) => (n / 1048576).toFixed(1)
  const today = new Date().toISOString().slice(0, 10)

  // 1) Coleções
  report('meta', 0, 1, t('Baixando a lista de coleções...'))
  const rawSets = await fetchJson<YCardSet[]>(`${API}/cardsets.php`, signal)
  const setInfo = new Map<string, YCardSet>()
  for (const s of rawSets) setInfo.set(ygoSetId(s.set_name), s)

  // 2) Cartas em inglês (base)
  const EST = 25 * 1048576
  report('cards', 0, EST, t('Baixando cartas (inglês)...'))
  const en = await fetchJson<{ data: YCard[] }>(`${API}/cardinfo.php?misc=yes`, signal, (b) =>
    report('cards', Math.min(b, EST), EST, t('Baixando cartas (inglês)... {mb} MB', { mb: mb(b) }))
  )

  // 3) Traduções
  const local = new Map<number, YCard>()
  if (lang && lang !== 'en') {
    const LEST = 18 * 1048576
    const langName = t(LANG_NAMES[lang] ?? lang)
    report('localized', 0, LEST, t('Baixando traduções ({lang})...', { lang: langName }))
    try {
      const loc = await fetchJson<{ data: YCard[] }>(`${API}/cardinfo.php?language=${encodeURIComponent(lang)}`, signal, (b) =>
        report('localized', Math.min(b, LEST), LEST, t('Baixando traduções ({lang})... {mb} MB', { lang: langName, mb: mb(b) }))
      )
      for (const c of loc.data ?? []) {
        // Os ids das traduções às vezes são de outra arte da mesma carta: indexa todas.
        local.set(c.id, c)
        for (const img of c.card_images ?? []) if (!local.has(img.id)) local.set(img.id, c)
      }
    } catch (err) {
      if (signal.aborted) throw err
      console.warn('[ygo] traduções indisponíveis:', (err as Error).message)
    }
  }

  // 4) Normalização
  report('saving', 0, 1, t('Processando cartas...'))
  const cards: GCard[] = []
  const printings: GPrinting[] = []
  const usedSets = new Map<string, { name: string; code?: string; cards: Set<string> }>()
  const seenPrinting = new Set<string>()
  const byEnName = new Map<string, YCard>()
  for (const c of local.values()) if (c.name_en) byEnName.set(c.name_en, c)

  for (const c of en.data ?? []) {
    if (!keep(c)) continue
    const id = String(c.id)
    const cat = category(c.type)
    const misc = c.misc_info?.[0] ?? {}
    const formats = misc.formats ?? []
    const dates = [misc.tcg_date, misc.ocg_date].filter(Boolean).sort() as string[]
    const releasedAt = dates[0]
    const frame = c.frameType
    const isPend = frame.endsWith('_pendulum')

    // Textos (Pêndulo: texto do monstro + efeito de Pêndulo separados)
    const text = (isPend ? (c.monster_desc ?? c.desc) : c.desc) ?? ''
    const text2 = isPend ? c.pend_desc : undefined
    const loc = local.get(c.id) ?? (c.card_images ?? []).map((i) => local.get(i.id)).find(Boolean) ?? byEnName.get(c.name)
    const locName = loc?.name && loc.name !== c.name ? loc.name : undefined
    const locTextRaw = loc ? ((isPend ? (loc.monster_desc ?? loc.desc) : loc.desc) ?? '') : ''
    const locText = locTextRaw && locTextRaw !== text ? locTextRaw : undefined
    const locText2 = loc && isPend && loc.pend_desc && loc.pend_desc !== text2 ? loc.pend_desc : undefined

    // Banlists e legalidade
    const limits: Record<string, number> = {}
    const tcgLim = limitValue(c.banlist_info?.ban_tcg)
    const ocgLim = limitValue(c.banlist_info?.ban_ocg)
    const goatLim = limitValue(c.banlist_info?.ban_goat)
    if (tcgLim !== undefined) limits.tcg = tcgLim
    if (ocgLim !== undefined) limits.ocg = ocgLim
    if (goatLim !== undefined) limits.goat = goatLim
    const notLegal: string[] = []
    if (!formats.includes('TCG') || !misc.tcg_date || misc.tcg_date > today) notLegal.push('tcg')
    if (!formats.includes('OCG') || (misc.ocg_date && misc.ocg_date > today)) notLegal.push('ocg')
    if (!formats.includes('GOAT')) notLegal.push('goat')

    // Coleções da carta (ordem: mais antiga primeiro)
    const sets = (c.card_sets ?? []).map((s) => {
      const sid = ygoSetId(s.set_name)
      return { ...s, sid, date: setInfo.get(sid)?.tcg_date ?? '9999' }
    })
    sets.sort((a, b) => a.date.localeCompare(b.date) || a.set_code.localeCompare(b.set_code))
    for (const s of sets) {
      const u = usedSets.get(s.sid) ?? { name: s.set_name, code: setPrefix(s.set_code), cards: new Set<string>() }
      u.cards.add(id)
      usedSets.set(s.sid, u)
    }

    // Uma impressão por arte (cada arte tem seu passcode); a principal é a de id = passcode da carta.
    const images = [...(c.card_images ?? [])]
    images.sort((a, b) => (a.id === c.id ? -1 : b.id === c.id ? 1 : 0))
    if (!images.length) images.push({ id: c.id })
    const printingIds: string[] = []
    images.forEach((img, i) => {
      const pid = String(img.id)
      if (seenPrinting.has(pid)) return
      seenPrinting.add(pid)
      // Não há como saber em qual coleção saiu cada arte: a principal fica com a primeira coleção,
      // as alternativas com a mais recente.
      const s = i === 0 ? sets[0] : sets[sets.length - 1]
      printings.push({
        id: pid,
        cardId: id,
        set: s ? s.sid : 'ygo',
        setName: s ? s.set_name : 'Yu-Gi-Oh!',
        code: pid,
        rarity: s?.set_rarity || undefined,
        releasedAt: s && s.date !== '9999' ? s.date : releasedAt,
        image: img.image_url,
        imageSmall: img.image_url_small,
        variant: i === 0 ? undefined : 'Arte alternativa'
      })
      printingIds.push(pid)
    })

    const abilities = cat === 'Monster' ? (c.typeline ?? []).filter((x) => x && x !== c.race).map((x) => (x === 'XYZ' ? 'Xyz' : x)) : undefined
    const fields: GCard['fields'] = {
      race: c.race || undefined,
      archetype: c.archetype || undefined,
      frame
    }
    if (cat === 'Monster') {
      fields.atk = stat(c.atk)
      if (frame !== 'link') fields.def = stat(c.def)
      if (typeof c.level === 'number') fields.level = c.level
      if (typeof c.linkval === 'number') fields.link = c.linkval
      if (typeof c.scale === 'number') fields.scale = c.scale
      if (c.linkmarkers?.length) fields.arrows = c.linkmarkers
      if (abilities?.length) fields.abilities = abilities
    }
    const prefixes = [...new Set(sets.map((s) => setPrefix(s.set_code)))]
    if (prefixes.length) fields.sets = prefixes
    for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k]

    const card: GCard = {
      id,
      name: c.name,
      category: cat,
      subtype: c.humanReadableCardType || c.type,
      colors: cat === 'Monster' ? (c.attribute ? [c.attribute] : []) : [cat === 'Spell' ? 'SPELL' : 'TRAP'],
      fields,
      text,
      limits,
      section: ygoExtraKind(frame) ? 'extra' : 'main',
      defaultPrintingId: printingIds[0] ?? id,
      printingIds: printingIds.length ? printingIds : [id],
      releasedAt
    }
    if (locName) card.localName = locName
    if (locText) card.localText = locText
    if (text2) card.text2 = text2
    if (locText2) card.localText2 = locText2
    if (notLegal.length) card.notLegal = notLegal
    cards.push(card)
  }

  // Coleções usadas por alguma carta (+ a coleção genérica das cartas sem coleção)
  const sets: GSet[] = []
  for (const [sid, u] of usedSets) {
    const info = setInfo.get(sid)
    sets.push({ id: sid, name: u.name, code: info?.set_code ?? u.code, releasedAt: info?.tcg_date ?? '', cardCount: info?.num_of_cards ?? u.cards.size })
  }
  if (printings.some((p) => p.set === 'ygo'))
    sets.push({ id: 'ygo', name: 'Yu-Gi-Oh!', releasedAt: '', cardCount: printings.filter((p) => p.set === 'ygo').length })
  sets.sort((a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || '') || a.name.localeCompare(b.name))

  report('saving', 1, 1, t('{n} cartas processadas.', { n: cards.length }))
  return { cards, printings, sets }
}
