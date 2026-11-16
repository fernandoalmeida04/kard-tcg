// Peças compartilhadas da interface de Pokémon: cache de cartas, imagem de carta e ícones de tipo.
import type { CardFinish, DeckCard } from '@shared/types'
import type { PkmCard, PkmDeck, PkmPrinting, PkmType } from '@shared/pokemon/types'
import { parsePkmDeckText } from '@shared/pokemon/formats'
import { PKM_CATEGORY_LABEL, PKM_STAGE_LABEL, PKM_TRAINER_LABEL, PKM_TYPE_LABEL } from '@shared/pokemon/types'
import { pkmImageUrl } from '@shared/api'
import { t } from '@shared/i18n'
import { CardImage, type FallbackData } from '../components/common'

// ---------------- Cache (evita IPC repetido) ----------------

const cardCache = new Map<string, PkmCard>()
const printCache = new Map<string, PkmPrinting>()

export async function getPkmCards(ids: string[]): Promise<Record<string, PkmCard>> {
  const missing = [...new Set(ids)].filter((id) => id && !cardCache.has(id))
  if (missing.length) {
    const fetched = await window.kard.pkm.cards(missing)
    for (const [id, c] of Object.entries(fetched)) cardCache.set(id, c)
  }
  const out: Record<string, PkmCard> = {}
  for (const id of ids) {
    const c = cardCache.get(id)
    if (c) out[id] = c
  }
  return out
}

export async function getPkmPrintings(ids: string[]): Promise<Record<string, PkmPrinting>> {
  const missing = [...new Set(ids)].filter((id) => id && !printCache.has(id))
  if (missing.length) {
    const fetched = await window.kard.pkm.printings(missing)
    for (const [id, p] of Object.entries(fetched)) printCache.set(id, p)
  }
  const out: Record<string, PkmPrinting> = {}
  for (const id of ids) {
    const p = printCache.get(id)
    if (p) out[id] = p
  }
  return out
}

export function rememberPkmPrintings(list: PkmPrinting[]): void {
  for (const p of list) printCache.set(p.id, p)
}

export function rememberPkmCard(c: PkmCard): void {
  cardCache.set(c.id, c)
}

/** Limpa o cache (após baixar o banco de novo). */
export function clearPkmCache(): void {
  cardCache.clear()
  printCache.clear()
}

// ---------------- Importação de listas ----------------

/**
 * Lê uma lista (formato do Pokémon TCG Live) e soma as cartas ao deck `base`.
 * Linhas com sigla + número escolhem a arte exata; só o nome usa a versão legal mais recente.
 */
export async function importPkmDeckText(text: string, base: PkmDeck): Promise<{ deck: PkmDeck; missing: string[] }> {
  const lines = parsePkmDeckText(text)
  const res = await window.kard.pkm.resolveNames(lines.map((l) => ({ name: l.name, set: l.set, number: l.number })))
  const deck: PkmDeck = { ...base, main: base.main.map((c) => ({ ...c })), maybeboard: base.maybeboard.map((c) => ({ ...c })) }
  const missing: string[] = []
  lines.forEach((l, i) => {
    const r = res[i]
    if (!r?.cardId) {
      missing.push(l.name)
      return
    }
    const list: DeckCard[] = l.section === 'maybeboard' ? deck.maybeboard : deck.main
    const ex = list.find((c) => c.oracleId === r.cardId)
    if (ex) ex.qty += l.qty
    else list.push({ oracleId: r.cardId, printingId: r.printingId, qty: l.qty, name: r.name ?? l.name })
  })
  return { deck, missing }
}

// ---------------- Rótulos ----------------

/** Linha de "tipo" da carta já traduzida: "Pokémon · Básico · ex", "Treinador · Apoiador", "Energia Básica". */
export function pkmTypeLine(c: Pick<PkmCard, 'category' | 'stage' | 'suffix' | 'trainerType' | 'energyType'>): string {
  if (c.category === 'Pokemon') return [t(PKM_CATEGORY_LABEL.Pokemon), c.stage ? t(PKM_STAGE_LABEL[c.stage] ?? c.stage) : '', c.suffix ?? ''].filter(Boolean).join(' · ')
  if (c.category === 'Trainer') return [t(PKM_CATEGORY_LABEL.Trainer), c.trainerType ? t(PKM_TRAINER_LABEL[c.trainerType] ?? c.trainerType) : ''].filter(Boolean).join(' · ')
  return c.energyType === 'Special' ? t('Energia Especial') : t('Energia Básica')
}

export function pkmTypeName(x: PkmType): string {
  return t(PKM_TYPE_LABEL[x])
}

/** Texto completo da carta (habilidades, ataques ou efeito), no idioma do banco quando houver. */
export function pkmCardText(c: PkmCard): string {
  const parts: string[] = []
  for (const a of c.abilities) parts.push(`[${a.type}] ${a.localName ?? a.name}: ${a.localEffect ?? a.effect}`)
  for (const a of c.attacks) {
    const cost = a.cost.map((x) => `{${x}}`).join('')
    parts.push(`${cost} ${a.localName ?? a.name}${a.damage ? ` — ${a.damage}` : ''}${a.localEffect || a.effect ? `\n${a.localEffect ?? a.effect}` : ''}`)
  }
  if (c.localEffect || c.effect) parts.push(c.localEffect ?? c.effect ?? '')
  return parts.join('\n\n')
}

export function pkmFallback(c: PkmCard | undefined, name?: string): FallbackData {
  if (!c) return { name: name ?? '' }
  return {
    name: c.localName ?? c.name,
    typeLine: pkmTypeLine(c),
    text: pkmCardText(c).replace(/\{(\w+)\}/g, (_, x: string) => `[${pkmTypeName(x as PkmType)}]`),
    power: c.hp ? `${c.hp} HP` : undefined,
    toughness: undefined,
    colors: []
  }
}

// ---------------- Componentes ----------------

/** Imagem de uma carta de Pokémon (cache local); `quality` high para detalhes/pré-visualização. */
export function PkmCardImage({ printingId, quality = 'low', card, name, foil, title }: { printingId?: string; quality?: 'low' | 'high'; card?: PkmCard; name?: string; foil?: CardFinish; title?: string }) {
  return <CardImage printingId={printingId} url={pkmImageUrl(printingId, quality)} fallback={pkmFallback(card, name)} foil={foil} title={title} />
}

const TYPE_LETTER: Record<PkmType, string> = { Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M', Fairy: 'Y', Dragon: 'N', Colorless: 'C' }

/** Símbolo redondo de tipo de energia. */
export function PkmTypeIcon({ type, size = 16 }: { type: PkmType; size?: number }) {
  return (
    <span className={`pkm-type ${type}`} style={{ width: size, height: size, fontSize: size * 0.6 }} title={pkmTypeName(type)}>
      {TYPE_LETTER[type]}
    </span>
  )
}

/** Custo de ataque (lista de símbolos). */
export function PkmCost({ cost, size = 15 }: { cost: PkmType[]; size?: number }) {
  if (!cost.length) return <span className="pkm-cost muted small">—</span>
  return (
    <span className="pkm-cost">
      {cost.map((x, i) => (
        <PkmTypeIcon key={i} type={x} size={size} />
      ))}
    </span>
  )
}

/** Texto com símbolos {Grass} / {Fire}... trocados por ícones. */
export function PkmText({ text }: { text?: string }) {
  if (!text) return null
  const parts = text.split(/(\{\w+\})/g)
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{(\w+)\}$/)
        return m && m[1] in TYPE_LETTER ? <PkmTypeIcon key={i} type={m[1] as PkmType} size={14} /> : <span key={i}>{p}</span>
      })}
    </>
  )
}
