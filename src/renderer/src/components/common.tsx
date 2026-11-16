import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import { cardImageUrl } from '@shared/api'
import type { CardData, CardFace, CardFinish, Printing } from '@shared/types'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import logo from '../assets/logo.png'

// ---------------- Mana ----------------

const HYB_COLORS: Record<string, string> = { W: 'var(--W)', U: 'var(--U)', B: 'var(--B)', R: 'var(--R)', G: 'var(--G)', C: 'var(--C)', '2': '#999', P: '#c9a' }

export function Pip({ sym, lg }: { sym: string; lg?: boolean }) {
  const s = sym.toUpperCase()
  if (/^[WUBRGC]$/.test(s)) return <span className={`pip ${s} ${lg ? 'lg' : ''}`}>{s === 'C' ? '◇' : ''}</span>
  if (s === 'T') return <span className={`pip ${lg ? 'lg' : ''}`} title={t('Virar')}>↷</span>
  if (s === 'Q') return <span className={`pip ${lg ? 'lg' : ''}`} title={t('Desvirar')}>↶</span>
  if (s.includes('/')) {
    const [a, b] = s.split('/')
    return (
      <span className={`pip hyb ${lg ? 'lg' : ''}`} style={{ ['--a' as string]: HYB_COLORS[a] ?? '#999', ['--b' as string]: HYB_COLORS[b] ?? '#999' } as CSSProperties}>
        {b === 'P' ? 'Φ' : ''}
      </span>
    )
  }
  return <span className={`pip ${lg ? 'lg' : ''}`}>{s}</span>
}

export function ManaCost({ cost, lg }: { cost?: string; lg?: boolean }) {
  if (!cost) return null
  const syms = cost.match(/\{[^}]+\}/g) ?? []
  const parts = cost.split(' // ')
  if (parts.length > 1) {
    return (
      <span className="mana">
        {parts.map((p, i) => (
          <span key={i} className="mana">
            {i > 0 && <span className="muted"> // </span>}
            <ManaCost cost={p} lg={lg} />
          </span>
        ))}
      </span>
    )
  }
  return (
    <span className="mana">
      {syms.map((s, i) => (
        <Pip key={i} sym={s.slice(1, -1)} lg={lg} />
      ))}
    </span>
  )
}

/** Texto de regras com símbolos de mana renderizados. */
export function ManaText({ text }: { text?: string }) {
  if (!text) return null
  const parts = text.split(/(\{[^}]+\})/g)
  return (
    <>
      {parts.map((p, i) => (/^\{[^}]+\}$/.test(p) ? <Pip key={i} sym={p.slice(1, -1)} /> : <span key={i}>{p}</span>))}
    </>
  )
}

export function ColorPips({ colors }: { colors: string[] }) {
  if (!colors.length) return <span className="color-dot" style={{ background: 'var(--C)' }} />
  return (
    <span className="row" style={{ gap: 3 }}>
      {['W', 'U', 'B', 'R', 'G'].filter((c) => colors.includes(c)).map((c) => (
        <span key={c} className="color-dot" style={{ background: `var(--${c})` }} />
      ))}
    </span>
  )
}

// ---------------- Imagens de carta ----------------

export interface FallbackData {
  name: string
  manaCost?: string
  typeLine?: string
  text?: string
  power?: string
  toughness?: string
  loyalty?: string
  colors?: string[]
}

export function CardFallback({ data }: { data: FallbackData }) {
  const colors = data.colors ?? []
  const cls = colors.length > 1 ? 'M' : (colors[0] ?? '')
  return (
    <div className={`card-fallback ${cls}`}>
      <div className="cf-name">
        <span>{data.name}</span>
        <ManaCost cost={data.manaCost} />
      </div>
      <div className="cf-type">{data.typeLine}</div>
      <div className="cf-text">
        <ManaText text={data.text} />
      </div>
      {(data.power !== undefined || data.loyalty) && <div className="cf-pt">{data.loyalty ?? `${data.power}/${data.toughness}`}</div>}
    </div>
  )
}

/**
 * Acabamento visível de uma cópia: o escolhido pelo jogador (se a impressão o tiver)
 * ou, para impressões que só existem em foil/etched, o acabamento obrigatório.
 */
export function finishOf(printing: Pick<Printing, 'finishes'> | undefined, chosen?: CardFinish): CardFinish | undefined {
  const fin = printing?.finishes
  if (chosen && (!fin || fin.includes(chosen))) return chosen
  if (fin && fin.length && !fin.includes('nonfoil')) return fin.includes('foil') ? 'foil' : fin.includes('etched') ? 'etched' : undefined
  return undefined
}

/** A impressão pode ser trocada entre normal e o acabamento dado? (sem dados → permite) */
export function canChooseFinish(printing: Pick<Printing, 'finishes'> | undefined, f: CardFinish): boolean {
  return !printing?.finishes || printing.finishes.includes(f)
}

function onFoilMove(e: React.MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
  e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
}

interface CardImageProps {
  printingId?: string
  face?: number
  size?: 'small' | 'normal' | 'large' | 'art'
  fallback?: FallbackData
  className?: string
  title?: string
  /** Efeito de brilho foil/etched por cima da carta. */
  foil?: CardFinish
  /** URL da imagem (substitui a URL de carta de Magic, ex.: cartas de Pokémon). */
  url?: string
}

export function CardImage({ printingId, face = 0, size = 'normal', fallback, className, title, foil, url }: CardImageProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [printingId, face, size, url])
  const content =
    !(url || printingId) || failed ? (
      fallback ? <CardFallback data={fallback} /> : <div className="card-img" />
    ) : (
      <img
        className={`card-img ${className ?? ''}`}
        src={url || cardImageUrl(printingId, size, face)}
        loading="lazy"
        draggable={false}
        alt={fallback?.name ?? ''}
        title={title}
        onError={() => setFailed(true)}
        style={size === 'art' ? { aspectRatio: '626 / 457', borderRadius: 6 } : undefined}
      />
    )
  if (!foil) return content
  return (
    <div className={`foil-wrap ${foil} ${size === 'art' ? 'art' : ''}`} onMouseMove={onFoilMove}>
      {content}
      <span className="foil-sheen" />
    </div>
  )
}

/** Layouts "2 em 1" cujo verso é uma imagem separada (cartas dupla-face). */
export const DFC_IMAGE_LAYOUTS = ['modal_dfc', 'transform', 'reversible_card', 'double_faced_token']

export function hasBackImage(layout?: string): boolean {
  return !!layout && DFC_IMAGE_LAYOUTS.includes(layout)
}

/** Fallback de texto para uma face específica de uma carta dupla-face. */
export function faceFallback(card: CardData, face: number): FallbackData {
  const f: CardData | CardFace = card.faces?.[face] ?? card
  return {
    name: f.localName ?? f.name,
    manaCost: f.manaCost,
    typeLine: f.localTypeLine ?? f.typeLine,
    text: f.localText ?? f.oracleText,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    colors: f.colors ?? card.colors
  }
}

interface FlipCardImageProps {
  printingId?: string
  /** Face visível (0 frente, 1 verso). Mudar o valor anima o giro. */
  face: number
  size?: 'small' | 'normal' | 'large'
  frontFallback?: FallbackData
  backFallback?: FallbackData
  foil?: CardFinish
}

/** Carta dupla-face com as duas imagens montadas em 3D; trocar `face` gira a carta. */
export function FlipCardImage({ printingId, face, size = 'normal', frontFallback, backFallback, foil }: FlipCardImageProps) {
  return (
    <div className={`flip-card ${face ? 'flipped' : ''}`}>
      <div className="flip-inner">
        <div className="flip-face">
          <CardImage printingId={printingId} face={0} size={size} fallback={frontFallback} foil={foil} />
        </div>
        <div className="flip-face back">
          <CardImage printingId={printingId} face={1} size={size} fallback={backFallback ?? frontFallback} foil={foil} />
        </div>
      </div>
    </div>
  )
}

interface FlippableCardProps extends Omit<FlipCardImageProps, 'face'> {
  layout?: string
  /** Força (ou impede) o giro; padrão: decide pelo layout. */
  flippable?: boolean
  /** Face "real" da carta (ex.: lado transformado em jogo). Padrão: frente. */
  face?: number
  /** Ao mudar, volta a mostrar a face real (ex.: id da carta sob o mouse). */
  resetKey?: string
}

/** Pré-visualização de carta: em cartas dupla-face, clicar gira para ver a outra face. */
export function FlippableCard({ layout, flippable, face = 0, resetKey, ...rest }: FlippableCardProps) {
  const [peek, setPeek] = useState(false)
  useEffect(() => setPeek(false), [rest.printingId, resetKey, face])
  if (!(flippable ?? hasBackImage(layout))) return <CardImage printingId={rest.printingId} face={0} size={rest.size} fallback={rest.frontFallback} foil={rest.foil} />
  return (
    <div>
      <div style={{ cursor: 'pointer' }} onClick={() => setPeek((p) => !p)} title={t('Clique para ver a outra face')}>
        <FlipCardImage {...rest} face={peek ? 1 - face : face} />
      </div>
      <div className="flip-hint">↻ {t('clique para ver a outra carta')}</div>
    </div>
  )
}

export function CardBack() {
  return (
    <div className="card-back">
      <img src={logo} alt="" draggable={false} />
    </div>
  )
}

// ---------------- Modal ----------------

export function Modal({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: width ?? 560 }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn right" onClick={onClose} title={t('Fechar')}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismiss)
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
          {toast.kind === 'judge' && '⚖ '}
          {toast.text}
        </div>
      ))}
    </div>
  )
}

export function ProgressBar({ value, total, indeterminate }: { value: number; total: number; indeterminate?: boolean }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

// ---------------- Menu de contexto ----------------

export type MenuItem = { label: ReactNode; onClick?: () => void; disabled?: boolean; title?: string } | 'sep' | { header: string }

interface MenuStore {
  menu: { x: number; y: number; items: MenuItem[] } | null
  open: (x: number, y: number, items: MenuItem[]) => void
  close: () => void
}

export const useMenu = create<MenuStore>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null })
}))

export function ContextMenu() {
  const menu = useMenu((s) => s.menu)
  const close = useMenu((s) => s.close)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.ctx-menu')) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close])
  if (!menu) return null
  const x = Math.min(menu.x, window.innerWidth - 260)
  const y = Math.min(menu.y, window.innerHeight - 30 - menu.items.length * 32)
  return (
    <div className="ctx-menu" style={{ left: x, top: Math.max(8, y) }}>
      {menu.items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="sep" />
        if ('header' in it) return <div key={i} className="label">{it.header}</div>
        return (
          <button
            key={i}
            disabled={it.disabled}
            title={it.title}
            onClick={() => {
              close()
              it.onClick?.()
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function formatBytes(n?: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
