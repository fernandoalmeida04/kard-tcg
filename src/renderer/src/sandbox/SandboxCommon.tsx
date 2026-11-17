// Peças comuns das mesas livres (Magic e Pokémon): imagem de carta, histórico colorido com o Juiz IA,
// prévia, visualizador de zonas, barra de cima e o arrastar de cartas da mão.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { GameCard } from '@shared/engine'
import { cardName, isPkmCard, type SObj, type SState } from '@shared/sandbox'
import { cardRulesText } from '@shared/sandbox/summary'
import { t } from '@shared/i18n'
import { CardBack, CardImage, Modal, useMenu, type MenuItem } from '../components/common'
import { PkmCardImage, PkmText, pkmCardText } from '../pokemon/pkmCommon'
import { useApp } from '../store'
import { useOnline } from '../online/onlineStore'
import CardDetail from '../components/CardDetail'
import PkmCardDetail from '../pokemon/PkmCardDetail'
import { useSandbox } from './sandboxStore'

// ---------------- detalhes da carta (clique esquerdo) ----------------

/** Carta aberta na janela de detalhes (botão do meio do mouse numa carta da mesa). */
export const useCardDetail = create<{ id: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null })
}))

/** Dá para abrir os detalhes desta carta? (virada para baixo e fichas criadas na mesa não têm página) */
export function hasCardDetails(state: SState, id: string): boolean {
  const o = state.objects[id]
  if (!o || o.faceDown || o.token) return false
  if (isPkmCard(o.card)) return Boolean(o.card.id)
  const oid = (o.card as GameCard).oracleId
  return Boolean(oid) && !oid.startsWith('token:')
}

/** Abre os detalhes; devolve false se a carta não tiver página (aí quem chamou pode abrir o menu). */
export function openCardDetail(id: string): boolean {
  const st = useSandbox.getState().state
  if (!st || !hasCardDetails(st, id)) return false
  useCardDetail.getState().open(id)
  return true
}

/** Props para abrir os detalhes com o botão do meio (sem disparar a rolagem automática do navegador). */
export function middleClickDetail(id: string): Pick<React.HTMLAttributes<HTMLElement>, 'onMouseDown' | 'onAuxClick'> {
  return {
    onMouseDown: (e) => {
      if (e.button === 1) e.preventDefault()
    },
    onAuxClick: (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      openCardDetail(id)
    }
  }
}

/** Janela de detalhes (a mesma da coleção) da carta clicada. */
export function SbCardDetail() {
  const id = useCardDetail((s) => s.id)
  const close = useCardDetail((s) => s.close)
  const o = useSandbox((s) => (id ? s.state?.objects[id] : undefined))
  if (!id || !o) return null
  if (isPkmCard(o.card)) return <PkmCardDetail cardId={o.card.id} onClose={close} />
  return <CardDetail oracleId={(o.card as GameCard).oracleId} onClose={close} />
}

// ---------------- imagem ----------------

export function ObjCard({ o, hidden, quality = 'low' }: { o: SObj; hidden?: boolean; quality?: 'low' | 'high' }) {
  if (hidden || o.faceDown) return <CardBack />
  if (isPkmCard(o.card)) return <PkmCardImage printingId={o.printingId} card={o.card} quality={quality} />
  const c = o.card as GameCard
  const f = c.faces?.[o.face ?? 0]
  return (
    <CardImage
      printingId={o.printingId ?? c.printingId}
      face={o.face ?? 0}
      size={quality === 'high' ? 'large' : 'normal'}
      foil={c.finish}
      fallback={{ name: f?.displayName ?? c.displayName ?? c.name, typeLine: f?.displayType ?? c.displayType, text: f?.displayText ?? c.displayText, power: f?.power ?? c.power, toughness: f?.toughness ?? c.toughness, colors: c.colors }}
    />
  )
}

// ---------------- seleção de alvo (ligar, evoluir, bloquear) ----------------

export interface SbSel {
  kind: 'attach' | 'evolve' | 'block'
  cardId: string
  /** Destaque (indicador); qualquer carta em jogo pode ser escolhida. */
  hint: string[]
  label: string
}
export const useSbSel = create<{ sel: SbSel | null; set: (s: SbSel | null) => void }>((set) => ({ sel: null, set: (sel) => set({ sel }) }))

// ---------------- arrastar ----------------

export interface SbDrag {
  id: string
  x: number
  y: number
}
export const useSbDrag = create<{ drag: SbDrag | null; set: (d: SbDrag | null) => void }>((set) => ({ drag: null, set: (drag) => set({ drag }) }))

/** Inicia o arrastar de uma carta da mão; `onDrop` recebe o elemento sob o ponteiro; clique simples chama `onClick`. */
export function startCardDrag(e: React.PointerEvent, id: string, onDrop: (el: HTMLElement | null) => void, onClick: (x: number, y: number) => void): void {
  if (e.button !== 0) return
  const sx = e.clientX
  const sy = e.clientY
  let dragging = false
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
    dragging = true
    useSbDrag.getState().set({ id, x: ev.clientX, y: ev.clientY })
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (dragging) {
      useSbDrag.getState().set(null)
      onDrop(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)
    } else onClick(ev.clientX, ev.clientY)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

export function DragGhost() {
  const drag = useSbDrag((s) => s.drag)
  const state = useSandbox((s) => s.state)
  if (!drag || !state?.objects[drag.id]) return null
  return (
    <div className="sb-drag-ghost" style={{ left: drag.x, top: drag.y }}>
      <ObjCard o={state.objects[drag.id]} />
    </div>
  )
}

// ---------------- barra de cima ----------------

export function TopBar({ extra, showTurn = true }: { extra?: React.ReactNode; showTurn?: boolean }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const setInGame = useApp((s) => s.setInGame)
  const active = state.players[state.activePlayer]
  const myTurn = state.activePlayer === meta.mySeat
  const quit = () => {
    if (meta.online) {
      if (!confirm(state.winner === null ? t('Sair da mesa? Você concede a partida.') : t('Sair da mesa?'))) return
      if (state.winner === null) act({ t: 'concede' })
      void useOnline.getState().leave()
      return
    }
    if (state.winner === null && !confirm(t('Sair da partida?'))) return
    useSandbox.getState().quit()
    setInGame(false)
  }
  return (
    <div className="sb-topbar">
      {showTurn && (
        <span className="sb-turn" style={{ ['--pc' as string]: active.color }}>
          {t('Turno {n}', { n: state.turn })} · <b>{myTurn ? t('seu turno') : t('vez de {name}', { name: active.name })}</b>
        </span>
      )}
      {extra}
      <span className="grow" />
      {meta.online && <span className="zone-chip">🌐 {t('Mesa {code}', { code: meta.online.code })}</span>}
      <button className="btn sm" onClick={() => act({ t: 'coin' })} title={t('Jogar uma moeda')}>
        🪙
      </button>
      <button className="btn sm" onClick={() => act({ t: 'dice', sides: 6 })} title={t('Rolar um dado de 6 lados')}>
        🎲
      </button>
      {!meta.online && (
        <button className="btn sm" onClick={() => confirm(t('Começar uma nova partida?')) && useSandbox.getState().restart()}>
          ⟲ {t('Nova partida')}
        </button>
      )}
      <button className="btn sm" disabled={state.winner !== null} onClick={() => confirm(t('Conceder a partida?')) && act({ t: 'concede' })}>
        🏳 {t('Conceder')}
      </button>
      <button className="btn sm danger" onClick={quit}>
        ✕ {t('Sair')}
      </button>
    </div>
  )
}

// ---------------- histórico com o Juiz IA ----------------

export function LogPanel() {
  const state = useSandbox((s) => s.state)!
  const verdicts = useSandbox((s) => s.verdicts)
  const ref = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [state.log.length, stick, verdicts])
  return (
    <div className="sb-log" ref={ref} onScroll={(e) => {
      const el = e.currentTarget
      setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
    }}>
      {state.log.map((e) => {
        const color = e.player !== undefined ? state.players[e.player]?.color : undefined
        const v = verdicts[e.id]
        return (
          <div key={e.id} className={`sb-log-line ${e.kind}`} style={color ? { ['--pc' as string]: color } : undefined}>
            <div className="sb-log-row">
              <span className="sb-log-text">{e.text}</span>
              {e.seq >= 0 && e.kind !== 'turn' && e.kind !== 'chat' && !v?.loading && (
                <button className="sb-judge-btn" title={t('O Juiz IA analisa se esta jogada foi válida')} onClick={() => void useSandbox.getState().callJudge(e.id)}>
                  ⚖ {t('Chamar o juiz')}
                </button>
              )}
            </div>
            {v && (
              <div className={`sb-verdict ${v.loading ? 'loading' : v.error ? 'error' : v.valid ? 'valid' : 'invalid'}`}>
                {v.loading ? (
                  <>⚖ {t('O juiz está analisando a jogada...')}</>
                ) : v.error ? (
                  <>⚠ {v.error}</>
                ) : (
                  <>
                    <b>{v.title}</b>
                    {v.explanation && <div>{v.explanation}</div>}
                    <div className="sb-verdict-by">{t('Juiz chamado por {name}', { name: v.by })}</div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------- prévia + histórico + conversa ----------------

export function SidePanel() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const hover = useSandbox((s) => s.hover)
  const o = hover ? state.objects[hover] : null
  const showText = useApp((s) => s.settings?.showCardText !== false)
  return (
    <aside className="sb-side">
      <div className="sb-preview">
        {o && !(o.faceDown && o.owner !== meta.mySeat) ? (
          <>
            <ObjCard o={{ ...o, faceDown: false }} quality="high" />
            {showText && (
              <div className="small sb-preview-text">{isPkmCard(o.card) ? <PkmText text={pkmCardText(o.card)} /> : cardRulesText(o.card)}</div>
            )}
          </>
        ) : (
          <div className="small muted">{t('Botão do meio do mouse numa carta mostra os detalhes. Passe o mouse numa linha do histórico para chamar o juiz.')}</div>
        )}
      </div>
      <LogPanel />
      {meta.online && <OnlineChat />}
    </aside>
  )
}

function OnlineChat() {
  const chat = useOnline((s) => s.chat)
  const sendChat = useOnline((s) => s.sendChat)
  const [text, setText] = useState('')
  return (
    <div className="sb-chat">
      <div className="sb-chat-lines">
        {chat.slice(-30).map((m, i) => (
          <div key={i} className="small">
            <b>{m.username}:</b> {m.text}
          </div>
        ))}
      </div>
      <form
        className="row"
        style={{ gap: 4 }}
        onSubmit={(e) => {
          e.preventDefault()
          sendChat(text)
          setText('')
        }}
      >
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Mensagem...')} />
        <button className="btn sm">{t('Enviar')}</button>
      </form>
    </div>
  )
}

// ---------------- visualizador de zona (cemitério, descarte, deck...) ----------------

export function ZoneViewer({ title, ids, onClose, menuFor, hiddenFor }: { title: string; ids: string[]; onClose: () => void; menuFor: (id: string) => MenuItem[]; hiddenFor?: (id: string) => boolean }) {
  const state = useSandbox((s) => s.state)!
  const setHover = useSandbox((s) => s.setHover)
  const openMenu = useMenu((s) => s.open)
  return (
    <Modal title={`${title} (${ids.length})`} onClose={onClose} width={960}>
      <div className="sb-viewer">
        {ids.map((id) => (
          <div
            key={id}
            className="sb-viewer-card"
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => openMenu(e.clientX, e.clientY, menuFor(id))}
            {...(hiddenFor?.(id) ? {} : middleClickDetail(id))}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu(e.clientX, e.clientY, menuFor(id))
            }}
          >
            <ObjCard o={state.objects[id]} hidden={hiddenFor?.(id)} />
          </div>
        ))}
        {!ids.length && <span className="small muted">{t('Vazio.')}</span>}
      </div>
    </Modal>
  )
}

export function nameOf(state: SState, id: string): string {
  return cardName(state.objects[id].card)
}

/** Vencedor por concessão. */
export function GameOverBanner() {
  const state = useSandbox((s) => s.state)!
  const [closed, setClosed] = useState(false)
  if (state.winner === null || closed) return null
  return (
    <div className="sb-gameover">
      🏆 {t('{name} venceu a partida.', { name: state.players[state.winner].name })}
      <button className="btn xs" onClick={() => setClosed(true)}>
        ✕
      </button>
    </div>
  )
}
