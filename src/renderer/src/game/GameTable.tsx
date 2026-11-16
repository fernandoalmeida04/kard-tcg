import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STEP_LABEL,
  STEP_ORDER,
  actingPlayer,
  attackTargetDefender,
  attackTargets,
  attackersAgainst,
  botAction,
  canAttack,
  canBlockAny,
  castInfo,
  checkPlayLand,
  currentChoice,
  hasType,
  isCreature,
  keywordLabel,
  keywordsOf,
  landFaceOf,
  manaCostOf,
  objName,
  opponents,
  playableCardIds,
  potentialAttackers,
  power,
  targetCandidates,
  toughness,
  typeLineOf,
  type AttackTarget,
  type GameObject,
  type GameState,
  type PlayerId,
  type TargetChoice
} from '@shared/engine'
import { create } from 'zustand'
import { playmatImageUrl } from '@shared/api'
import {
  DEFAULT_BOARD_LAYOUT,
  DEFAULT_MAT_LAYOUT,
  MAT_ICON,
  MAT_LABEL,
  ZONE_ICON,
  ZONE_LABEL,
  matAreas,
  matTracks,
  normalizeBoardLayout,
  normalizeMatLayout,
  zoneForType,
  type BoardZone,
  type MatZone
} from '@shared/board'
import { useApp } from '../store'
import { CardBack, CardImage, FlipCardImage, FlippableCard, ManaCost, ManaText, Modal, hasBackImage, useMenu, type FallbackData, type MenuItem } from '../components/common'
import { BOT, currentDefender, mySeat, shouldAutoPass, useGame, useMySeat } from './gameStore'
import { useOnline } from '../online/onlineStore'
import { t } from '@shared/i18n'

/** Cor de cada assento (borda da área do oponente, marcador dos atacantes, escolha do defensor). */
const SEAT_COLORS = ['#4d9ce0', '#e45d42', '#3fa267', '#f5b84b']

function seatColor(p: PlayerId): string {
  return SEAT_COLORS[p % SEAT_COLORS.length]
}

/** Textos com o nome dos jogadores (online ou 3+ jogadores) em vez de "o bot"/"o oponente". */
function useNamed(): boolean {
  return useGame((s) => Boolean(s.meta?.online) || (s.state?.players.length ?? 2) > 2)
}

/** Oponentes (inclusive eliminados) na ordem de turno, começando pelo jogador depois de `me`. */
function seatsAfter(state: GameState, me: PlayerId): PlayerId[] {
  const n = state.players.length
  return Array.from({ length: n - 1 }, (_, i) => (me + i + 1) % n)
}

function targetLabel(state: GameState, tg: AttackTarget): string {
  return tg.kind === 'player' ? state.players[tg.player]?.name ?? '?' : objName(state, tg.id)
}

/** Fallback de texto da carta; `face` permite montar o da outra face (estatísticas atuais só valem para a face real). */
function fallbackOf(state: GameState, o: GameObject, face = o.face): FallbackData {
  const f = o.card.faces && ['modal_dfc', 'transform', 'adventure', 'split', 'flip', 'reversible_card', 'double_faced_token'].includes(o.card.layout) ? o.card.faces[face] : null
  const live = face === o.face && o.zone === 'battlefield'
  return {
    name: f?.displayName ?? o.card.displayName,
    manaCost: f?.manaCost ?? o.card.manaCost,
    typeLine: f?.displayType ?? o.card.displayType,
    text: f?.displayText ?? o.card.displayText,
    power: live && isCreature(o) ? String(power(state, o)) : (f?.power ?? o.card.power),
    toughness: live && isCreature(o) ? String(toughness(state, o)) : (f?.toughness ?? o.card.toughness),
    loyalty: live && o.counters.loyalty !== undefined ? String(o.counters.loyalty) : (f?.loyalty ?? o.card.loyalty),
    colors: f?.colors ?? o.card.colors
  }
}

function imgFace(o: GameObject): number {
  return hasBackImage(o.card.layout) ? o.face : 0
}

/** Imagem de uma carta em jogo; dupla-face gira com animação quando transforma. */
function GameCardImage({ state, o, size }: { state: GameState; o: GameObject; size?: 'small' | 'normal' | 'large' }) {
  if (!hasBackImage(o.card.layout)) return <CardImage printingId={o.card.printingId} foil={o.card.finish} size={size} fallback={fallbackOf(state, o)} />
  return <FlipCardImage printingId={o.card.printingId} foil={o.card.finish} face={imgFace(o)} size={size} frontFallback={fallbackOf(state, o, 0)} backFallback={fallbackOf(state, o, 1)} />
}

// ---------------- Jogar cartas: opções por face/zona e arrastar-e-soltar ----------------

interface PlayOption {
  face: number
  kind: 'land' | 'cast'
  /** Zona onde o permanente fica; 'spell' = não fica no campo (instantânea/feitiço). */
  zone: BoardZone | 'spell'
  label: React.ReactNode
}

function playOptions(o: GameObject): PlayOption[] {
  const faces = o.card.faces && ['modal_dfc', 'split'].includes(o.card.layout) ? o.card.faces : null
  if (faces) {
    return faces.map((f, i) =>
      /\bLand\b/.test(f.typeLine)
        ? { face: i, kind: 'land' as const, zone: 'lands' as const, label: t('Jogar {name} (terreno)', { name: f.displayName }) }
        : { face: i, kind: 'cast' as const, zone: zoneForType(f.typeLine, o.isCommander) ?? 'spell', label: <span>{t('Conjurar {name}', { name: f.displayName })} <ManaCost cost={f.manaCost} /></span> }
    )
  }
  if (landFaceOf(o) !== null && !isCreature(o)) return [{ face: 0, kind: 'land', zone: 'lands', label: t('Jogar terreno') }]
  return [{ face: 0, kind: 'cast', zone: zoneForType(typeLineOf(o), o.isCommander) ?? 'spell', label: <span>{t('Conjurar')} <ManaCost cost={manaCostOf(o)} /></span> }]
}

function performPlay(id: string, opt: PlayOption): void {
  const g = useGame.getState()
  if (opt.kind === 'land') g.act(opt.face ? { t: 'playLand', id, face: opt.face } : { t: 'playLand', id })
  else g.beginCast(id, opt.face)
}

/** Solta a carta no seu campo: usa a opção da zona escolhida; se não bater, usa a(s) opção(ões) da carta. */
function dropOnBoard(id: string, zone: BoardZone | null, x: number, y: number): void {
  const st = useGame.getState().state
  const o = st?.objects[id]
  if (!o) return
  const opts = playOptions(o)
  let m = zone ? opts.filter((p) => p.zone === zone) : []
  if (!m.length) m = zone ? opts.filter((p) => p.zone === 'spell') : []
  if (!m.length) m = opts
  if (m.length === 1) performPlay(id, m[0])
  else useMenu.getState().open(x, y - 60, m.map((p) => ({ label: p.label, onClick: () => performPlay(id, p) })))
}

function permanentZone(o: GameObject): BoardZone {
  return zoneForType(typeLineOf(o), o.isCommander) ?? 'others'
}

interface DragState {
  id: string
  x: number
  y: number
  startX: number
  startY: number
  /** Arrastando de fato (passou do limiar de movimento). */
  moving: boolean
  /** Clicou e soltou sem arrastar: zonas continuam acesas até clicar numa zona. */
  armed: boolean
}

const useDrag = create<{ drag: DragState | null }>(() => ({ drag: null }))

function startDrag(e: React.PointerEvent, o: GameObject): void {
  if (e.button !== 0 || useGame.getState().sel) return
  e.preventDefault()
  useDrag.setState({ drag: { id: o.id, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moving: false, armed: false } })
  useGame.getState().setHover(o.id)
}

/** Zonas onde a carta sendo arrastada pode ficar (e se é mágica sem zona). */
function useDropTargets(): { zones: Set<BoardZone>; spell: boolean; active: boolean } {
  const drag = useDrag((s) => s.drag)
  const state = useGame((s) => s.state)
  return useMemo(() => {
    const o = drag && state ? state.objects[drag.id] : undefined
    if (!o) return { zones: new Set<BoardZone>(), spell: false, active: false }
    const opts = playOptions(o)
    return { zones: new Set(opts.map((p) => p.zone).filter((z): z is BoardZone => z !== 'spell')), spell: opts.some((p) => p.zone === 'spell'), active: true }
  }, [drag, state])
}

function dropTargetAt(x: number, y: number): { onBoard: boolean; zone: BoardZone | null } {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const bf = el?.closest('[data-drop-bf]')
  const z = el?.closest('[data-drop-zone]') as HTMLElement | null
  return { onBoard: Boolean(bf), zone: bf ? ((z?.dataset.dropZone as BoardZone) ?? null) : null }
}

/** Camada global do arrastar: segue o ponteiro, desenha a carta "na mão" e trata o soltar. */
function DragLayer() {
  const drag = useDrag((s) => s.drag)
  const state = useGame((s) => s.state)
  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = useDrag.getState().drag
      if (!d || d.armed) return
      const moving = d.moving || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6
      useDrag.setState({ drag: { ...d, x: e.clientX, y: e.clientY, moving } })
    }
    const onUp = (e: PointerEvent) => {
      const d = useDrag.getState().drag
      if (!d || d.armed) return
      if (!d.moving) {
        useDrag.setState({ drag: { ...d, armed: true } })
        return
      }
      useDrag.setState({ drag: null })
      const tgt = dropTargetAt(e.clientX, e.clientY)
      if (tgt.onBoard) dropOnBoard(d.id, tgt.zone, e.clientX, e.clientY)
    }
    // Modo "clicou e soltou": o próximo clique decide (zona do campo = jogar; resto = cancelar)
    const onDownCapture = (e: PointerEvent) => {
      const d = useDrag.getState().drag
      if (!d || !d.armed) return
      const tgt = dropTargetAt(e.clientX, e.clientY)
      const sameCard = (e.target as HTMLElement).closest(`[data-hand-id="${d.id}"]`)
      useDrag.setState({ drag: null })
      if (tgt.onBoard) {
        e.stopPropagation()
        e.preventDefault()
        dropOnBoard(d.id, tgt.zone, e.clientX, e.clientY)
      } else if (sameCard) e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useDrag.setState({ drag: null })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointerdown', onDownCapture, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointerdown', onDownCapture, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [drag !== null])
  const o = drag && state ? state.objects[drag.id] : undefined
  if (!drag || !o || !drag.moving || drag.armed) return null
  return (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
      <CardImage printingId={o.card.printingId} foil={o.card.finish} fallback={fallbackOf(state!, o)} />
    </div>
  )
}

function keyOf(tc: TargetChoice): string {
  return tc.kind === 'player' ? `p${tc.player}` : tc.id
}

export default function GameTable() {
  const state = useGame((s) => s.state)!
  const meta = useGame((s) => s.meta)!
  const sel = useGame((s) => s.sel)
  const aiBusy = useGame((s) => s.aiBusy)
  const passUntilTurn = useGame((s) => s.passUntilTurn)
  const settings = useApp((s) => s.settings)
  const me = useMySeat()
  const [overDismissed, setOverDismissed] = useState(false)
  useEffect(() => {
    if (state.winner === null) setOverDismissed(false)
  }, [state.winner])

  // Laço principal: bot (só local), Juiz IA (local ou anfitrião online) e passe automático
  useEffect(() => {
    const g = useGame.getState()
    if (!state || state.winner !== null) return
    if (state.pendingAI) {
      // online: só o anfitrião consulta o Juiz IA; os outros esperam a ação publicada
      if (!aiBusy && (!meta.online || meta.online.isHost)) g.aiStep()
      return
    }
    const p = actingPlayer(state)
    if (!meta.online && p === BOT) {
      // passes de prioridade são rápidos; jogadas reais respeitam a velocidade configurada
      let quick = false
      try {
        const a = meta.goldfish ? null : botAction(state, BOT)
        quick = !a || a.t === 'pass'
      } catch {
        quick = true
      }
      const timer = setTimeout(() => useGame.getState().botStep(), quick ? 150 : (settings?.botDelayMs ?? 700))
      return () => clearTimeout(timer)
    }
    if (p === me) {
      const ch = state.choices[0]
      if (ch && ch.kind === 'targets' && ch.player === me && !g.sel) {
        useGame.setState({ sel: { kind: 'trigger', sourceId: ch.trigger.sourceId, specs: ch.trigger.ability.targets, chosen: [], label: ch.trigger.sourceName } })
        return
      }
      // online o passe vai pelo act → submit (que não reenvia o mesmo passe enquanto o anfitrião não confirma)
      if (shouldAutoPass(state, { autoPass: settings?.autoPass ?? true, stopAtEveryStep: settings?.stopAtEveryStep ?? false, passUntilTurn }, me)) {
        const timer = setTimeout(() => useGame.getState().act({ t: 'pass' }), 90)
        return () => clearTimeout(timer)
      }
    }
    return undefined
  }, [state, aiBusy, settings, passUntilTurn, me, meta])

  // Atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = useGame.getState()
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Escape') g.cancelSel()
      if ((e.key === ' ' || e.key === 'Enter') && g.state && !g.sel && actingPlayer(g.state) === mySeat() && !g.state.awaiting && !g.state.choices.length) {
        e.preventDefault()
        g.act({ t: 'pass' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const candidateKeys = useMemo(() => {
    if (!sel) return new Set<string>()
    const spec = sel.specs[sel.chosen.length]
    if (!spec) return new Set<string>()
    return new Set(targetCandidates(state, me, spec, sel.sourceId).map(keyOf))
  }, [sel, state, me])

  const opps = seatsAfter(state, me)
  const single = opps.length === 1

  return (
    <div className="table">
      <div className={`board ${single ? '' : 'multi'}`}>
        {single ? (
          <>
            <PlayerBar p={opps[0]} controls />
            <Playmat p={opps[0]} candidateKeys={candidateKeys} />
          </>
        ) : (
          <div className={`opp-row n${opps.length}`}>
            {opps.map((p) => (
              <OpponentSeat key={p} p={p} candidateKeys={candidateKeys} />
            ))}
          </div>
        )}
        <CenterStrip candidateKeys={candidateKeys} />
        <Playmat p={me} candidateKeys={candidateKeys} />
        <Hand />
        <PlayerBar p={me} controls={!single} />
      </div>
      <SidePanel />
      <ChoiceModal />
      <PromptModal />
      <DragLayer />
      {state.winner !== null && !overDismissed && <GameOver onDismiss={() => setOverDismissed(true)} />}
      <div style={{ display: 'none' }}>{meta.format}</div>
    </div>
  )
}

// ---------------- Barra do jogador ----------------

/** Área de um oponente na fileira de cima (3–4 jogadores): barra compacta + playmat espelhado menor. */
function OpponentSeat({ p, candidateKeys }: { p: PlayerId; candidateKeys: Set<string> }) {
  const state = useGame((s) => s.state)!
  const defender = useGame((s) => s.defender)
  const me = useMySeat()
  const pl = state.players[p]
  const declaring = state.awaiting?.kind === 'attackers' && state.awaiting.player === me
  const isDefender = declaring && !pl.lost && currentDefender(state, me, defender) === p
  return (
    <div
      className={`opp-seat ${pl.lost ? 'out' : ''} ${state.activePlayer === p && !pl.lost ? 'active' : ''} ${isDefender ? 'defender' : ''}`}
      style={{ ['--seat' as string]: seatColor(p) }}
    >
      <PlayerBar p={p} compact />
      <Playmat p={p} candidateKeys={candidateKeys} compact />
    </div>
  )
}

/** Botões da mesa (nova partida, conceder, sair) e, online, o código da mesa. */
function TableControls() {
  const state = useGame((s) => s.state)!
  const meta = useGame((s) => s.meta)!
  const act = useGame((s) => s.act)
  const restart = useGame((s) => s.restart)
  const quit = useGame((s) => s.quit)
  const setInGame = useApp((s) => s.setInGame)
  const me = useMySeat()
  const online = meta.online
  const iLost = state.players[me]?.lost ?? false
  return (
    <span className="right row" style={{ gap: 6 }}>
      {online && (
        <span className="zone-chip" title={online.isHost ? t('Você é o anfitrião: as regras rodam no seu computador.') : t('Partida online')}>
          🌐 {t('Mesa {code}', { code: online.code })}
          {online.isHost && ` · ${t('anfitrião')}`}
        </span>
      )}
      <span className="small muted">{t(meta.format)}</span>
      {!online && (
        <button className="btn sm" onClick={() => confirm(t('Começar uma nova partida?')) && restart()}>
          ⟲ {t('Nova partida')}
        </button>
      )}
      <button className="btn sm" onClick={() => confirm(t('Conceder a partida?')) && act({ t: 'concede' })} disabled={state.winner !== null || iLost}>
        🏳 {t('Conceder')}
      </button>
      <button
        className="btn sm danger"
        onClick={() => {
          if (online) {
            const ongoing = state.winner === null && !iLost
            if (!confirm(ongoing ? t('Sair da mesa? Você concede a partida.') : t('Sair da mesa?'))) return
            // sair no meio da partida = conceder, para os outros não ficarem esperando por você
            if (ongoing) act({ t: 'concede' })
            void useOnline.getState().leave()
            return
          }
          if (state.winner === null && !confirm(t('Sair da partida?'))) return
          quit()
          setInGame(false)
        }}
      >
        ✕ {t('Sair')}
      </button>
    </span>
  )
}

function PlayerBar({ p, controls, compact }: { p: PlayerId; controls?: boolean; compact?: boolean }) {
  const state = useGame((s) => s.state)!
  const meta = useGame((s) => s.meta)!
  const defender = useGame((s) => s.defender)
  const presence = useOnline((s) => s.presence)
  const onlineSetup = useOnline((s) => s.setup)
  const me = useMySeat()
  const pl = state.players[p]
  const isMe = p === me
  const isBot = !meta.online && p === BOT
  const isActive = state.activePlayer === p && !pl.lost
  const pool = Object.entries(pl.pool).filter(([, n]) => n > 0)
  const cmdDamage = Object.entries(pl.commanderDamage).filter(([, n]) => n > 0)
  const multi = state.players.length > 2
  const userId = meta.online ? onlineSetup?.players[p]?.userId : undefined
  const connected = userId ? presence.some((x) => x.userId === userId) : false
  // durante a minha declaração de ataque, clicar na barra de um oponente o escolhe como defensor
  const canPickDefender = !isMe && !pl.lost && state.awaiting?.kind === 'attackers' && state.awaiting.player === me && opponents(state, me).length > 1
  const isDefender = canPickDefender && currentDefender(state, me, defender) === p
  const handTitle = pl.hand.length === 1 ? t('{n} carta na mão', { n: pl.hand.length }) : t('{n} cartas na mão', { n: pl.hand.length })

  return (
    <div
      className={`player-bar ${isMe ? 'me' : ''} ${compact ? 'compact' : ''} ${pl.lost ? 'out' : ''} ${canPickDefender ? 'pickable' : ''} ${isDefender ? 'defender' : ''}`}
      onClick={canPickDefender ? () => useGame.getState().setDefender(p) : undefined}
      title={canPickDefender ? t('Clique para atacar {name}', { name: pl.name }) : undefined}
    >
      <div className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="pname">
          {userId && <span className={`presence-dot ${connected ? 'on' : ''}`} title={connected ? t('Conectado') : t('Desconectado')} style={{ display: 'inline-block', marginRight: 5 }} />}
          {isBot ? '🤖 ' : '🧙 '}
          {pl.name} {isActive && <span className="badge ok">{t('turno')}</span>}
          {pl.lost && <span className="badge elim">{t('Eliminado')}</span>}
          {state.monarch === p && (
            <span className="badge warn" title={t('Monarca: compra uma carta extra no fim do turno')}>
              👑 {t('Monarca')}
            </span>
          )}
        </span>
        {!compact && <span className="small muted">{isMe ? meta.humanDeck : isBot ? meta.botDeck : ''}</span>}
      </div>
      {compact && (
        <span className={`zone-chip life-chip ${pl.life <= 5 ? 'low' : ''}`} title={t('Vida')}>
          ♥ <b>{pl.life}</b>
          {pl.poison > 0 && <span title={t('Veneno')}> ☠{pl.poison}</span>}
        </span>
      )}
      {!isMe &&
        (compact ? (
          <span className="zone-chip" title={handTitle}>
            🂠 {pl.hand.length}
          </span>
        ) : (
          <div className="opp-hand" title={handTitle}>
            {pl.hand.slice(0, 12).map((id) => (
              <div key={id} className="mini-back">
                <CardBack />
              </div>
            ))}
            <span className="small muted" style={{ marginLeft: 18 }}>
              {pl.hand.length}
            </span>
          </div>
        ))}
      {cmdDamage.length > 0 && (
        <span className="zone-chip" title={t('Dano de comandante recebido')}>
          ⚔👑{' '}
          {cmdDamage
            .map(([id, n]) => {
              const owner = state.objects[id]?.owner
              return multi && owner !== undefined ? `${objName(state, id)} (${state.players[owner]?.name}): ${n}` : `${objName(state, id)}: ${n}`
            })
            .join(', ')}
        </span>
      )}
      {pool.length > 0 && (
        <span className="pool" title={t('Reserva de mana')}>
          {pool.map(([c, n]) => (
            <span key={c} className="row" style={{ gap: 2 }}>
              <span className={`pip ${c}`}>{c === 'C' ? '◇' : ''}</span>
              <b className="small">{n}</b>
            </span>
          ))}
        </span>
      )}
      {controls && <TableControls />}
    </div>
  )
}

function ZoneViewer({ p, zone, onClose }: { p: PlayerId; zone: 'graveyard' | 'exile'; onClose: () => void }) {
  const state = useGame((s) => s.state)!
  const act = useGame((s) => s.act)
  const setHover = useGame((s) => s.setHover)
  const openMenu = useMenu((s) => s.open)
  const me = useMySeat()
  const named = useNamed()
  const ids = [...state.players[p][zone]].reverse()
  const vars = { n: ids.length, name: state.players[p].name }
  return (
    <Modal
      title={
        p === me
          ? t(zone === 'graveyard' ? 'Seu cemitério ({n})' : 'Seu exílio ({n})', vars)
          : named
            ? t(zone === 'graveyard' ? 'Cemitério de {name} ({n})' : 'Exílio de {name} ({n})', vars)
            : t(zone === 'graveyard' ? 'Cemitério do oponente ({n})' : 'Exílio do oponente ({n})', vars)
      }
      onClose={onClose}
      width={900}
    >
      {ids.length === 0 && <div className="muted">{t('Vazio.')}</div>}
      <div className="choice-cards">
        {ids.map((id) => {
          const o = state.objects[id]
          return (
            <div
              key={id}
              className="cc"
              onMouseEnter={() => setHover(id)}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu(e.clientX, e.clientY, [
                  { header: t('Ajuste manual') },
                  { label: t('Devolver para a mão'), onClick: () => act({ t: 'manual', op: { op: 'move', id, to: 'hand' } }) },
                  { label: t('Colocar no campo de batalha'), onClick: () => act({ t: 'manual', op: { op: 'move', id, to: 'battlefield' } }) },
                  { label: zone === 'graveyard' ? t('Exilar') : t('Colocar no cemitério'), onClick: () => act({ t: 'manual', op: { op: 'move', id, to: zone === 'graveyard' ? 'exile' : 'graveyard' } }) },
                  { label: t('Topo do grimório'), onClick: () => act({ t: 'manual', op: { op: 'move', id, to: 'libraryTop' } }) }
                ])
              }}
            >
              <CardImage printingId={o.card.printingId} foil={o.card.finish} fallback={fallbackOf(state, o)} />
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ---------------- Campo de batalha ----------------

/** Lado de um jogador: grade de áreas como um playmat (posições configuráveis). O do oponente é espelhado na vertical. */
function Playmat({ p, candidateKeys, compact }: { p: PlayerId; candidateKeys: Set<string>; compact?: boolean }) {
  const state = useGame((s) => s.state)!
  const settings = useApp((s) => s.settings)
  const seat = useMySeat()
  const [viewer, setViewer] = useState<'graveyard' | 'exile' | null>(null)
  const me = p === seat
  const layout = useMemo(() => {
    const l = normalizeMatLayout(settings?.matLayout ?? DEFAULT_MAT_LAYOUT)
    return me ? l : [...l].reverse()
  }, [settings?.matLayout, me])
  const { cols, rows } = matTracks(layout)
  const img = settings?.playmatImage && (me || settings.playmatBoth) ? playmatImageUrl(settings.playmatImage) : ''
  const imgStyle = img ? { ['--mat-img' as string]: `url("${img}")`, ['--mat-dim' as string]: String(settings?.playmatDim ?? 0.35) } : {}
  const mine = state.battlefield.map((id) => state.objects[id]).filter((o) => o && o.controller === p && !(o.attachedTo && state.objects[o.attachedTo]?.zone === 'battlefield'))
  const byZone = new Map<BoardZone, GameObject[]>()
  for (const o of mine) {
    const z = permanentZone(o)
    byZone.set(z, [...(byZone.get(z) ?? []), o])
  }
  return (
    <div className={`playmat ${me ? 'me' : 'opp'} ${compact ? 'compact' : ''} ${img ? 'has-image' : ''}`} style={{ ...imgStyle, gridTemplateColumns: cols, gridTemplateRows: rows, gridTemplateAreas: matAreas(layout) }} {...(me ? { 'data-drop-bf': '1' } : {})}>
      <Battlefield p={p} byZone={byZone} candidateKeys={candidateKeys} />
      <LandsArea p={p} lands={byZone.get('lands') ?? []} candidateKeys={candidateKeys} />
      <LifeArea p={p} candidateKeys={candidateKeys} />
      <PileArea p={p} zone="graveyard" onOpen={() => setViewer('graveyard')} />
      <PileArea p={p} zone="exile" onOpen={() => setViewer('exile')} />
      <LibraryArea p={p} />
      <CommandArea p={p} />
      <TaxArea p={p} />
      {viewer && <ZoneViewer p={p} zone={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}

function MatLabel({ z }: { z: MatZone }) {
  return (
    <span className="mat-label">
      {MAT_ICON[z]} {t(MAT_LABEL[z])}
    </span>
  )
}

function LandsArea({ p, lands, candidateKeys }: { p: PlayerId; lands: GameObject[]; candidateKeys: Set<string> }) {
  const targets = useDropTargets()
  const me = useMySeat() === p
  const ok = me && targets.active && targets.zones.has('lands')
  return (
    <div className={`mat-area lands ${ok ? 'drop-ok' : ''}`} style={{ gridArea: 'lands' }} data-drop-zone={me ? 'lands' : undefined}>
      {lands.length === 0 && <MatLabel z="lands" />}
      <div className="mat-lands">
        {lands.map((o) => (
          <Permanent key={o.id} o={o} candidateKeys={candidateKeys} />
        ))}
      </div>
    </div>
  )
}

function LifeArea({ p, candidateKeys }: { p: PlayerId; candidateKeys: Set<string> }) {
  const state = useGame((s) => s.state)!
  const act = useGame((s) => s.act)
  const chooseTarget = useGame((s) => s.chooseTarget)
  const openMenu = useMenu((s) => s.open)
  const pl = state.players[p]
  const targetable = candidateKeys.has(`p${p}`)
  return (
    <div
      className={`mat-area life-area ${targetable ? 'target-ok' : ''} ${pl.life <= 5 ? 'low' : ''}`}
      style={{ gridArea: 'life' }}
      onClick={() => targetable && chooseTarget({ kind: 'player', player: p })}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, [
          { header: t('Ajuste manual de vida') },
          { label: t('+1 de vida'), onClick: () => act({ t: 'manual', op: { op: 'life', player: p, delta: 1 } }) },
          { label: t('−1 de vida'), onClick: () => act({ t: 'manual', op: { op: 'life', player: p, delta: -1 } }) },
          { label: t('+5 de vida'), onClick: () => act({ t: 'manual', op: { op: 'life', player: p, delta: 5 } }) },
          { label: t('−5 de vida'), onClick: () => act({ t: 'manual', op: { op: 'life', player: p, delta: -5 } }) },
          'sep',
          { label: t('Comprar 1 carta (manual)'), onClick: () => act({ t: 'manual', op: { op: 'draw', player: p } }) }
        ])
      }}
      title={t('Vida (botão direito: ajuste manual)')}
    >
      <MatLabel z="life" />
      <span className="life-num">{pl.life}</span>
    </div>
  )
}

function PileArea({ p, zone, onOpen }: { p: PlayerId; zone: 'graveyard' | 'exile'; onOpen: () => void }) {
  const state = useGame((s) => s.state)!
  const setHover = useGame((s) => s.setHover)
  const ids = state.players[p][zone]
  const top = ids.length ? state.objects[ids[ids.length - 1]] : undefined
  return (
    <div className="mat-area pile" style={{ gridArea: zone }} onClick={onOpen} onMouseEnter={() => top && setHover(top.id)} title={t('{zone}: {n} (clique para ver)', { zone: t(MAT_LABEL[zone]), n: ids.length })}>
      <MatLabel z={zone} />
      {top && (
        <div className="mat-slot">
          <div className="mat-card">
            <CardImage printingId={top.card.printingId} foil={top.card.finish} size="small" fallback={fallbackOf(state, top)} />
          </div>
        </div>
      )}
      <span className="mat-count">{ids.length}</span>
    </div>
  )
}

function LibraryArea({ p }: { p: PlayerId }) {
  const state = useGame((s) => s.state)!
  const n = state.players[p].library.length
  return (
    <div className="mat-area pile" style={{ gridArea: 'library' }} title={n === 1 ? t('Grimório: {n} carta', { n }) : t('Grimório: {n} cartas', { n })}>
      <MatLabel z="library" />
      {n > 0 && (
        <div className="mat-slot">
          <div className="mat-card stacked">
            <CardBack />
          </div>
        </div>
      )}
      <span className="mat-count">{n}</span>
    </div>
  )
}

function CommandArea({ p }: { p: PlayerId }) {
  const state = useGame((s) => s.state)!
  const setHover = useGame((s) => s.setHover)
  const beginCast = useGame((s) => s.beginCast)
  const dragMode = useApp((s) => s.settings?.playMode === 'drag')
  const pl = state.players[p]
  const mine = p === useMySeat()
  return (
    <div className={`mat-area command ${state.commanderGame ? '' : 'unused'}`} style={{ gridArea: 'command' }}>
      <MatLabel z="command" />
      <div className="mat-slot mat-cmd-cards">
        {pl.command.map((id) => {
          const o = state.objects[id]
          return (
            <div
              key={id}
              className={`mat-card ${mine ? 'castable' : ''}`}
              data-hand-id={id}
              onMouseEnter={() => setHover(id)}
              onClick={() => mine && !dragMode && beginCast(id)}
              onPointerDown={mine && dragMode ? (e) => startDrag(e, o) : undefined}
              title={mine ? (dragMode ? t('Arraste {name} para o campo para conjurar', { name: o.card.displayName }) : t('Conjurar {name}', { name: o.card.displayName })) : o.card.displayName}
            >
              <CardImage printingId={o.card.printingId} foil={o.card.finish} size="small" fallback={fallbackOf(state, o)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaxArea({ p }: { p: PlayerId }) {
  const state = useGame((s) => s.state)!
  const pl = state.players[p]
  const cmdIds = Object.values(state.objects).filter((o) => o.isCommander && o.owner === p).map((o) => o.id)
  return (
    <div className={`mat-area tax ${state.commanderGame ? '' : 'unused'}`} style={{ gridArea: 'tax' }} title={t('Imposto do comandante: +2 a cada vez que foi conjurado da zona de comando')}>
      <MatLabel z="tax" />
      <div className="mat-tax">
        {cmdIds.map((id) => (
          <span key={id} className="tax-val" title={objName(state, id)}>
            +{2 * (pl.commanderCasts[id] ?? 0)}
          </span>
        ))}
        {cmdIds.length === 0 && <span className="muted small">—</span>}
      </div>
    </div>
  )
}

function Battlefield({ p, byZone, candidateKeys }: { p: PlayerId; byZone: Map<BoardZone, GameObject[]>; candidateKeys: Set<string> }) {
  const settings = useApp((s) => s.settings)
  const layout = useMemo(() => normalizeBoardLayout(settings?.boardLayout ?? DEFAULT_BOARD_LAYOUT), [settings?.boardLayout])
  const targets = useDropTargets()
  const me = p === useMySeat()
  const dragging = me && targets.active
  const empty = layout.every((row) => row.every((z) => !(byZone.get(z) ?? []).length))
  return (
    <div className={`mat-area bf ${me ? '' : 'opp'} ${dragging && targets.spell ? 'drop-ok' : ''}`} style={{ gridArea: 'battlefield' }}>
      {empty && !dragging && <MatLabel z="battlefield" />}
      {layout.map((row, ri) => (
        <div key={ri} className="bf-row">
          {row.map((z) => {
            const list = byZone.get(z) ?? []
            const ok = dragging && targets.zones.has(z)
            // zonas vazias só aparecem durante o arrastar (como alvos)
            if (!list.length && !dragging) return null
            return (
              <div key={z} className={`bf-zone ${ok ? 'drop-ok' : ''} ${dragging ? 'dragging' : ''}`} data-drop-zone={me ? z : undefined}>
                {dragging && (
                  <span className="bf-zone-label">
                    {ZONE_ICON[z]} {t(ZONE_LABEL[z])}
                  </span>
                )}
                {list.map((o) => (
                  <Permanent key={o.id} o={o} candidateKeys={candidateKeys} />
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function permanentMenu(state: GameState, o: GameObject): MenuItem[] {
  const g = useGame.getState()
  const items: MenuItem[] = [{ header: objName(state, o.id) }]
  if (o.controller === mySeat()) {
    const mana = o.parsed.mana.find((m) => m.cost.tap && !m.cost.mana)
    if (mana && !o.tapped) {
      const colors = [...new Set(mana.units.flat())]
      if (colors.length > 1 && mana.units.length === 1) {
        for (const c of colors) items.push({ label: <span>{t('Virar para mana')} <span className={`pip ${c}`} /></span>, onClick: () => g.act({ t: 'tapMana', id: o.id, color: c }) })
      } else items.push({ label: <span>{t('Virar para mana')} <ManaCost cost={mana.units.map((u) => `{${u[0]}}`).join('')} /></span>, onClick: () => g.act({ t: 'tapMana', id: o.id }) })
    }
    o.parsed.activated.forEach((ab, i) => {
      if (ab.fromHand) return
      items.push({ label: <span>⚡ <ManaText text={ab.label} /></span>, onClick: () => g.beginActivate(o.id, i) })
    })
  }
  items.push(
    'sep',
    { header: t('Ajustes manuais (registrados pelo juiz)') },
    { label: o.tapped ? t('Desvirar') : t('Virar'), onClick: () => g.act({ t: 'manual', op: { op: 'tap', id: o.id } }) },
    { label: hasType(o, 'Planeswalker') && !isCreature(o) ? t('+1 lealdade') : t('+1/+1 marcador'), onClick: () => g.act({ t: 'manual', op: { op: 'counter', id: o.id, delta: 1 } }) },
    { label: hasType(o, 'Planeswalker') && !isCreature(o) ? t('−1 lealdade') : t('−1 marcador'), onClick: () => g.act({ t: 'manual', op: { op: 'counter', id: o.id, delta: -1 } }) },
    { label: t('Mover para o cemitério'), onClick: () => g.act({ t: 'manual', op: { op: 'move', id: o.id, to: 'graveyard' } }) },
    { label: t('Exilar'), onClick: () => g.act({ t: 'manual', op: { op: 'move', id: o.id, to: 'exile' } }) },
    { label: t('Devolver para a mão'), onClick: () => g.act({ t: 'manual', op: { op: 'move', id: o.id, to: 'hand' } }) }
  )
  return items
}

function Permanent({ o, candidateKeys }: { o: GameObject; candidateKeys: Set<string> }) {
  const state = useGame((s) => s.state)!
  const attackersSel = useGame((s) => s.attackers)
  const blocksSel = useGame((s) => s.blocks)
  const pendingBlocker = useGame((s) => s.pendingBlocker)
  const sel = useGame((s) => s.sel)
  const me = useMySeat()
  const g = useGame.getState
  const openMenu = useMenu((s) => s.open)

  const c = state.combat
  const combatAtk = c?.attackers.find((a) => a.id === o.id)
  const atkTarget: AttackTarget | undefined = attackersSel[o.id] ?? combatAtk?.target
  const attacking = Boolean(combatAtk || attackersSel[o.id])
  const blocking = Boolean(c?.blockers.some((b) => b.blocker === o.id) || blocksSel.some((b) => b.blocker === o.id))
  // bloqueios já declarados (de qualquer defensor) + os que eu estou montando
  const blockedBy = [...(c?.blockers ?? []), ...blocksSel].filter((b) => b.attacker === o.id).map((b) => objName(state, b.blocker))
  const awaitingMine = state.awaiting?.player === me
  const blockingNow = state.awaiting?.kind === 'blockers' && awaitingMine
  const canAct =
    !sel &&
    ((state.awaiting?.kind === 'attackers' && awaitingMine && o.controller === me && canAttack(state, o)) ||
      (blockingNow && o.controller === me && canBlockAny(state, o)) ||
      // escolhendo o que bloquear: acende os atacantes que estão me atacando
      (blockingNow && pendingBlocker !== null && attackersAgainst(state, me).includes(o.id)))
  // com 3+ jogadores, mostra quem cada atacante está atacando
  const showTarget = attacking && atkTarget && (state.players.length > 2 || atkTarget.kind === 'planeswalker')
  const targetSeat = atkTarget ? attackTargetDefender(state, atkTarget) : null
  const attachedObjs = state.battlefield.map((id) => state.objects[id]).filter((x) => x && x.attachedTo === o.id)
  const cre = isCreature(o)
  const pw = cre ? power(state, o) : 0
  const tg = cre ? toughness(state, o) : 0
  const baseP = parseInt(o.card.faces?.[o.face]?.power ?? o.card.power ?? '0', 10) || 0
  const baseT = parseInt(o.card.faces?.[o.face]?.toughness ?? o.card.toughness ?? '0', 10) || 0
  const ptCls = pw > baseP || tg > baseT ? 'buff' : pw < baseP || tg < baseT || o.damage > 0 ? 'debuff' : ''

  const onClick = () => {
    const st = g().state!
    if (g().sel) {
      g().chooseTarget({ kind: 'object', id: o.id })
      return
    }
    if (st.awaiting?.kind === 'attackers' && st.awaiting.player === me) {
      if (o.controller === me && canAttack(st, o)) g().toggleAttacker(o.id)
      return
    }
    if (st.awaiting?.kind === 'blockers' && st.awaiting.player === me) {
      if (o.controller === me && canBlockAny(st, o)) g().pickBlocker(o.id)
      // só dá para bloquear quem está atacando a mim ou aos meus planeswalkers
      else if (attackersAgainst(st, me).includes(o.id)) g().assignBlock(o.id)
      return
    }
    if (o.controller === me) {
      const mana = o.parsed.mana.find((m) => m.cost.tap && !m.cost.mana)
      const abilities = o.parsed.activated.filter((a) => !a.fromHand)
      if (mana && !o.tapped && abilities.length === 0) {
        const colors = [...new Set(mana.units.flat())]
        if (colors.length > 1 && mana.units.length === 1) {
          const r = document.getElementById(`perm-${o.id}`)?.getBoundingClientRect()
          openMenu(r?.right ?? 200, r?.top ?? 200, permanentMenu(st, o).slice(0, colors.length + 1))
        } else g().act({ t: 'tapMana', id: o.id })
        return
      }
      if (abilities.length || mana) {
        const r = document.getElementById(`perm-${o.id}`)?.getBoundingClientRect()
        openMenu(r?.right ?? 200, r?.top ?? 200, permanentMenu(st, o))
      }
    }
  }

  const attackMenu = (): MenuItem[] => {
    // atacar um oponente específico (3+ jogadores) ou um planeswalker de um oponente
    const st = g().state!
    const multi = opponents(st, me).length > 1
    return attackTargets(st, me)
      .filter((x) => x.kind === 'planeswalker' || multi)
      .map((x) => {
        const owner = x.kind === 'planeswalker' ? attackTargetDefender(st, x) : null
        const name = x.kind === 'planeswalker' && multi && owner !== null ? `${objName(st, x.id)} (${st.players[owner].name})` : targetLabel(st, x)
        return { label: t('Atacar {name}', { name }), onClick: () => g().toggleAttacker(o.id, x) }
      })
  }

  return (
    <div
      id={`perm-${o.id}`}
      className={`perm ${o.tapped ? 'tapped' : ''} ${attacking ? 'attacking' : ''} ${blocking ? 'blocking' : ''} ${pendingBlocker === o.id ? 'selected' : ''} ${candidateKeys.has(o.id) ? 'target-ok' : ''} ${canAct ? 'can-act' : ''}`}
      onClick={onClick}
      onMouseEnter={() => g().setHover(o.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        const st = g().state!
        const atk = st.awaiting?.kind === 'attackers' && st.awaiting.player === me && o.controller === me && canAttack(st, o) ? attackMenu() : []
        openMenu(e.clientX, e.clientY, [...atk, ...(atk.length ? ['sep' as const] : []), ...permanentMenu(st, o)])
      }}
      title={blockedBy.length ? t('Bloqueada por: {names}', { names: [...new Set(blockedBy)].join(', ') }) : undefined}
    >
      {attachedObjs.map((a, i) => (
        <div key={a.id} className="attached" style={{ top: `${-14 - i * 10}%` }} onMouseEnter={(e) => { e.stopPropagation(); g().setHover(a.id) }}>
          <CardImage printingId={a.card.printingId} foil={a.card.finish} fallback={fallbackOf(state, a)} />
        </div>
      ))}
      <GameCardImage state={state} o={o} />
      {cre && <span className={`pt ${ptCls}`}>{pw}/{tg}</span>}
      <span className="counters">
        {o.counters['+1/+1'] ? <span>+{o.counters['+1/+1']}</span> : null}
        {o.counters['-1/-1'] ? <span>−{o.counters['-1/-1']}</span> : null}
        {o.counters.loyalty !== undefined && hasType(o, 'Planeswalker') ? <span className="loy">◆{o.counters.loyalty}</span> : null}
        {o.damage > 0 ? <span className="dmg">✶{o.damage}</span> : null}
      </span>
      {showTarget && atkTarget && (
        <span className="atk-badge" style={{ ['--seat' as string]: targetSeat !== null ? seatColor(targetSeat) : 'var(--danger)' }} title={t('Atacando {name}', { name: targetLabel(state, atkTarget) })}>
          ⚔ {targetLabel(state, atkTarget)}
        </span>
      )}
      {cre && o.sick && o.controller === state.activePlayer && !keywordsOf(state, o).includes('haste') && <span className="sick" title={t('Enjoo de invocação')}>💤</span>}
    </div>
  )
}

// ---------------- Mão ----------------

function Hand() {
  const state = useGame((s) => s.state)!
  const sel = useGame((s) => s.sel)
  const g = useGame.getState
  const openMenu = useMenu((s) => s.open)
  const me = useMySeat()
  // mão + cartas exiladas que podem ser jogadas ("impulse draw")
  const exiled = playableCardIds(state, me).filter((id) => state.objects[id]?.zone === 'exile')
  const hand = [...state.players[me].hand, ...exiled].map((id) => state.objects[id]).filter(Boolean)
  const myPriority = actingPlayer(state) === me && !state.awaiting && !state.choices.length
  const dragMode = useApp((s) => s.settings?.playMode === 'drag')
  const dragId = useDrag((s) => s.drag?.id)

  const playable = (o: GameObject): boolean => {
    if (!myPriority) return false
    if (landFaceOf(o) !== null && !checkPlayLand(state, me, o.id)) return true
    if (o.card.layout === 'modal_dfc' || o.card.layout === 'split') return !castInfo(state, me, o.id, 0).error || !castInfo(state, me, o.id, 1).error
    return !castInfo(state, me, o.id, 0).error
  }

  const handMenu = (o: GameObject): MenuItem[] => {
    const items: MenuItem[] = [{ header: o.card.displayName }]
    for (const opt of playOptions(o)) items.push({ label: opt.label, onClick: () => performPlay(o.id, opt) })
    o.parsed.activated.forEach((ab, i) => {
      if (ab.fromHand) items.push({ label: <span>{ab.label.replace(/^(Reciclar|Cycling)/, '♻ $1')}</span>, onClick: () => g().beginActivate(o.id, i) })
    })
    items.push(
      'sep',
      { header: t('Ajustes manuais') },
      { label: t('Descartar'), onClick: () => g().act({ t: 'manual', op: { op: 'move', id: o.id, to: 'graveyard' } }) },
      { label: t('Exilar'), onClick: () => g().act({ t: 'manual', op: { op: 'move', id: o.id, to: 'exile' } }) },
      { label: t('Colocar no topo do grimório'), onClick: () => g().act({ t: 'manual', op: { op: 'move', id: o.id, to: 'libraryTop' } }) },
      { label: t('Colocar no fundo do grimório'), onClick: () => g().act({ t: 'manual', op: { op: 'move', id: o.id, to: 'libraryBottom' } }) },
      { label: t('Colocar no campo de batalha'), onClick: () => g().act({ t: 'manual', op: { op: 'move', id: o.id, to: 'battlefield' } }) }
    )
    return items
  }

  const onClick = (o: GameObject, e: React.MouseEvent) => {
    if (sel) return
    const opts = playOptions(o)
    if (opts.length > 1) {
      openMenu(e.clientX, e.clientY - 120, [{ header: o.card.displayName }, ...opts.map((p) => ({ label: p.label, onClick: () => performPlay(o.id, p) }))])
      return
    }
    performPlay(o.id, opts[0])
  }

  return (
    <div className={`hand ${dragId ? 'holding' : ''}`}>
      {hand.map((o) => (
        <div
          key={o.id}
          data-hand-id={o.id}
          className={`hand-card ${playable(o) ? 'playable' : ''} ${dragId === o.id ? 'lifted' : ''}`}
          onClick={dragMode ? undefined : (e) => onClick(o, e)}
          onPointerDown={dragMode ? (e) => startDrag(e, o) : undefined}
          onMouseEnter={() => g().setHover(o.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(e.clientX, e.clientY - 200, handMenu(o))
          }}
        >
          <CardImage printingId={o.card.printingId} foil={o.card.finish} fallback={fallbackOf(state, o)} />
          {o.zone === 'exile' && (
            <span className="badge warn" style={{ position: 'absolute', top: 6, left: 6 }} title={t('Exilada: pode ser jogada por tempo limitado')}>
              {t('exílio')}

            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------- Faixa central: fases, pilha e ações ----------------

function CenterStrip({ candidateKeys }: { candidateKeys: Set<string> }) {
  const state = useGame((s) => s.state)!
  const meta = useGame((s) => s.meta)!
  const sel = useGame((s) => s.sel)
  const attackers = useGame((s) => s.attackers)
  const blocks = useGame((s) => s.blocks)
  const pendingBlocker = useGame((s) => s.pendingBlocker)
  const defender = useGame((s) => s.defender)
  const aiBusy = useGame((s) => s.aiBusy)
  const me = useMySeat()
  const named = useNamed()
  const g = useGame.getState
  const acting = actingPlayer(state)
  const top = state.stack[state.stack.length - 1]
  const oppTurn = state.activePlayer !== me
  const hasBot = !meta.online
  const nameOf = (p: PlayerId) => state.players[p]?.name ?? '?'
  // online, quem não é o anfitrião só espera o resultado do Juiz IA
  const aiWorking = aiBusy || Boolean(meta.online && !meta.online.isHost)

  let prompt = ''
  let buttons: React.ReactNode = null
  let extra: React.ReactNode = null

  if (state.winner !== null) prompt = t('Partida encerrada.')
  else if (state.players[me]?.lost) prompt = t('Você foi eliminado. Pode continuar assistindo à partida.')
  else if (sel) {
    const spec = sel.specs[sel.chosen.length]
    const pv = { label: sel.label, target: spec?.text ?? t('alvo'), i: sel.chosen.length + 1, n: sel.specs.length }
    prompt = spec?.optional ? t('🎯 {label}: escolha até {target} ({i}/{n})', pv) : t('🎯 {label}: escolha {target} ({i}/{n})', pv)
    buttons = (
      <>
        {spec?.optional && (
          <button className="btn" onClick={() => g().chooseTarget(null)}>
            {t('Pular')}
          </button>
        )}
        {sel.kind !== 'trigger' && (
          <button className="btn danger" onClick={() => g().cancelSel()}>
            {t('Cancelar (Esc)')}
          </button>
        )}
      </>
    )
  } else if (state.pendingAI) prompt = aiWorking ? t('⚖ Juiz IA analisando o efeito da carta...') : t('⚖ Aguardando o Juiz IA...')
  else if (state.awaiting?.kind === 'attackers' && state.awaiting.player === me) {
    const n = Object.keys(attackers).length
    const opps = opponents(state, me)
    const def = currentDefender(state, me, defender)
    prompt =
      opps.length > 1
        ? t('Declarar atacantes: escolha o oponente e clique nas suas criaturas (botão direito: atacar outro oponente ou um planeswalker).')
        : t('Declarar atacantes: clique nas suas criaturas (botão direito para atacar planeswalkers).')
    if (opps.length > 1) {
      extra = (
        <div className="defender-pick" title={t('Oponente atacado pelas criaturas que você clicar')}>
          <span className="small muted">{t('Atacar:')}</span>
          {opps.map((p) => (
            <button key={p} className={`seat-chip ${def === p ? 'on' : ''}`} style={{ ['--seat' as string]: seatColor(p) }} onClick={() => g().setDefender(p)}>
              {nameOf(p)}
            </button>
          ))}
        </div>
      )
    }
    buttons = (
      <>
        <button className="btn" onClick={() => g().setAllAttackers(potentialAttackers(state, me).map((o) => o.id))}>
          {t('Todas')}
        </button>
        <button className="btn" onClick={() => g().act({ t: 'attack', attackers: [] })}>
          {t('Não atacar')}
        </button>
        <button className="btn primary" disabled={n === 0} onClick={() => g().act({ t: 'attack', attackers: Object.entries(attackers).map(([id, target]) => ({ id, target })) })}>
          {t('⚔ Atacar com {n}', { n })}
        </button>
      </>
    )
  } else if (state.awaiting?.kind === 'blockers' && state.awaiting.player === me) {
    const against = attackersAgainst(state, me)
    const names = against
      .map((id) => {
        const a = state.combat?.attackers.find((x) => x.id === id)
        return a?.target.kind === 'planeswalker' ? `${objName(state, id)} → ${objName(state, a.target.id)}` : objName(state, id)
      })
      .join(', ')
    prompt = pendingBlocker
      ? t('Agora clique na criatura atacante que {name} vai bloquear.', { name: objName(state, pendingBlocker) })
      : named
        ? t('{name} atacou você com {names}. Clique numa criatura sua e depois no atacante.', { name: nameOf(state.activePlayer), names })
        : t('O bot atacou com {names}. Clique numa criatura sua e depois no atacante.', { names })
    buttons = (
      <>
        <button className="btn" onClick={() => g().act({ t: 'block', blocks: [] })}>
          {t('Sem bloqueios')}
        </button>
        <button className="btn primary" onClick={() => g().act({ t: 'block', blocks })}>
          {t('🛡 Confirmar bloqueios ({n})', { n: blocks.length })}
        </button>
      </>
    )
  } else if (acting === me && !state.choices.length) {
    if (top && top.controller !== me) {
      prompt = named
        ? t('{player} jogou {name}. Responda com uma mágica instantânea ou passe.', { player: nameOf(top.controller), name: top.sourceName })
        : t('O bot jogou {name}. Responda com uma mágica instantânea ou passe.', { name: top.sourceName })
    } else if (top) prompt = t('{name} está na pilha. Passe para resolver.', { name: top.sourceName })
    else if (!oppTurn && (state.step === 'main1' || state.step === 'main2')) prompt = t('Sua {step}: jogue um terreno e conjure mágicas.', { step: t(STEP_LABEL[state.step]).toLowerCase() })
    else prompt = t('{step} — você tem prioridade.', { step: t(STEP_LABEL[state.step]) })
    buttons = (
      <>
        <button className="btn" onClick={() => g().passTurn()} title={t('Passa automaticamente até o fim do turno (ainda para em bloqueios e escolhas)')}>
          ⏭ {t('Encerrar turno')}
        </button>
        <button className="btn primary" onClick={() => g().act({ t: 'pass' })} title={t('Espaço / Enter')}>
          {top ? t('Resolver ▶') : t('Passar ▶')}
        </button>
      </>
    )
  } else if (hasBot && acting === BOT) prompt = t('🤖 O bot está pensando...')
  else if (state.awaiting && state.awaiting.player !== me) {
    prompt =
      state.awaiting.kind === 'blockers'
        ? t('Aguardando {name} declarar bloqueadores...', { name: nameOf(state.awaiting.player) })
        : t('Aguardando {name} declarar atacantes...', { name: nameOf(state.awaiting.player) })
  } else if (state.choices.length) prompt = named && state.choices[0].player !== me ? t('Aguardando {name} escolher...', { name: nameOf(state.choices[0].player) }) : t('Aguardando escolha...')
  else if (acting !== null && acting !== me) prompt = t('Aguardando {name}...', { name: nameOf(acting) })

  return (
    <div className="center-strip">
      <div className="col" style={{ gap: 4 }}>
        <div className="phases">
          {STEP_ORDER.filter((s) => s !== 'untap' && s !== 'cleanup').map((s) => (
            <span key={s} className={`phase ${oppTurn ? 'opp' : ''} ${state.step === s ? 'on' : ''}`}>
              {t(STEP_LABEL[s])}
            </span>
          ))}
        </div>
        <span className="small muted">
          {!oppTurn
            ? t('Turno {n} · seu turno', { n: state.turn })
            : named
              ? t('Turno {n} · turno de {name}', { n: state.turn, name: nameOf(state.activePlayer) })
              : t('Turno {n} · turno do bot', { n: state.turn })}
          {state.step === 'mulligan' && ' · mulligans'}
        </span>
      </div>
      <div className="stack-view">
        {state.stack.length > 0 && <span className="small muted">{t('Pilha:')}</span>}
        {state.stack.map((s) => (
          <div
            key={s.id}
            className={`stack-item ${candidateKeys.has(s.id) ? 'target-ok' : ''}`}
            onClick={() => g().sel && g().chooseTarget({ kind: 'stack', id: s.id })}
            onMouseEnter={() => g().setHover(s.objectId ?? s.sourceId ?? null)}
            title={`${s.sourceName} (${state.players[s.controller].name})`}
          >
            <CardImage printingId={s.printingId} size="small" fallback={{ name: s.sourceName, text: s.block.text }} />
            <span className="who">
              {s.kind === 'spell' ? '' : '⚡'}
              {s.controller === me ? t('você') : named ? nameOf(s.controller) : 'bot'}
            </span>
          </div>
        ))}
      </div>
      <div className="prompt">{prompt}</div>
      {extra}
      <div className="row" style={{ gap: 6 }}>
        {buttons}
      </div>
    </div>
  )
}

// ---------------- Painel lateral ----------------

function SidePanel() {
  const state = useGame((s) => s.state)!
  const hover = useGame((s) => s.hover)
  const chat = useGame((s) => s.chat)
  const ask = useGame((s) => s.ask)
  const settings = useApp((s) => s.settings)
  const online = useGame((s) => Boolean(s.meta?.online))
  const me = useMySeat()
  const [tab, setTab] = useState<'table' | 'judge'>('table')
  const [q, setQ] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const o = hover ? state.objects[hover] : undefined
  const visible = o && !(o.zone === 'hand' && o.owner !== me) && !(o.zone === 'library')

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [state.log.length])

  const aiOn = Boolean(settings?.aiJudgeEnabled && settings.hasApiKey)

  return (
    <div className="side">
      <div className="preview">
        {visible && o ? (
          <>
            <div style={{ width: '100%', maxWidth: 260, margin: '0 auto' }}>
              <FlippableCard
                printingId={o.card.printingId} foil={o.card.finish}
                layout={o.card.layout}
                face={imgFace(o)}
                resetKey={o.id}
                size="normal"
                frontFallback={hasBackImage(o.card.layout) ? fallbackOf(state, o, 0) : fallbackOf(state, o)}
                backFallback={fallbackOf(state, o, 1)}
              />
            </div>
            {settings?.showCardText !== false && (
              <div className="ptext">
                <b style={{ color: 'var(--text)' }}>{objName(state, o.id)}</b> — {typeLineOf(o)}
                {'\n'}
                <ManaText text={(o.card.faces && ['modal_dfc', 'transform', 'adventure', 'split'].includes(o.card.layout) ? o.card.faces[o.face]?.displayText : undefined) ?? o.card.displayText} />
                {o.zone === 'battlefield' && keywordsOf(state, o).length > 0 && '\n' + t('Palavras-chave: {list}', { list: keywordsOf(state, o).map(keywordLabel).join(', ') })}
                {o.parsed.unsupported.length > 0 && '\n' + t('⚠ Não automatizado: {list}', { list: o.parsed.unsupported.join(' / ') })}
              </div>
            )}
          </>
        ) : (
          <div className="muted small" style={{ padding: 20, textAlign: 'center' }}>
            {t('Passe o mouse sobre uma carta para ampliar.')}
          </div>
        )}
      </div>
      <div className="log" ref={logRef}>
        {state.log.map((l) => (
          <div key={l.id} className={`${l.kind} ${l.player !== undefined && l.player !== me ? 'p1' : ''}`}>
            {l.kind === 'judge' && '⚖ '}
            {l.kind === 'ai' && '✨ '}
            {l.kind === 'manual' && '✋ '}
            {l.text}
          </div>
        ))}
      </div>
      <div className="chat">
        {online && (
          <div className="side-tabs">
            <button className={`side-tab ${tab === 'table' ? 'on' : ''}`} onClick={() => setTab('table')}>
              💬 {t('Conversa')}
            </button>
            <button className={`side-tab ${tab === 'judge' ? 'on' : ''}`} onClick={() => setTab('judge')}>
              ⚖ {t('Juiz')}
            </button>
          </div>
        )}
        {online && tab === 'table' && <TableChat />}
        {(!online || tab === 'judge') && <div className="small muted">{aiOn ? t('⚖ Juiz IA (Claude) — pergunte sobre regras') : t('⚖ Juiz local ativo · ative o Juiz IA em Configurações para tirar dúvidas')}</div>}
        {aiOn && (!online || tab === 'judge') && (
          <>
            <div className="msgs">
              {chat.map((m, i) => (
                <div key={i} className="col" style={{ gap: 4 }}>
                  <div className="q">{m.q}</div>
                  <div className="a">{m.a ?? (m.error ? t('Erro: {error}', { error: m.error }) : t('Consultando o juiz...'))}</div>
                </div>
              ))}
            </div>
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (!q.trim()) return
                ask(q.trim())
                setQ('')
              }}
            >
              <input className="grow" placeholder={t('Ex.: posso bloquear essa criatura com voar?')} value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn sm primary">{t('Perguntar')}</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

/** Conversa da mesa online (mesma do lobby). */
function TableChat() {
  const chat = useOnline((s) => s.chat)
  const myId = useOnline((s) => s.myId)
  const sendChat = useOnline((s) => s.sendChat)
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [chat.length])
  return (
    <>
      <div className="msgs" ref={ref}>
        {chat.length === 0 && <div className="muted small">{t('Nenhuma mensagem ainda.')}</div>}
        {chat.map((m, i) => (
          <div key={i} className={m.userId === myId ? 'q' : 'a table-msg'}>
            <b>{m.username}:</b> {m.text}
          </div>
        ))}
      </div>
      <form
        className="row"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          sendChat(text)
          setText('')
        }}
      >
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Mensagem para a mesa...')} />
        <button className="btn sm primary">{t('Enviar')}</button>
      </form>
    </>
  )
}

// ---------------- Escolhas (mulligan, descarte, vidência...) ----------------

function ChoiceModal() {
  const state = useGame((s) => s.state)!
  const act = useGame((s) => s.act)
  const setHover = useGame((s) => s.setHover)
  const me = useMySeat()
  const [picked, setPicked] = useState<string[]>([])
  const [shuffling, setShuffling] = useState(false)
  const ch = currentChoice(state)
  const chKey = ch ? `${ch.kind}-${state.log.length}` : ''
  useEffect(() => setPicked([]), [chKey])
  useEffect(() => {
    if (!shuffling) return
    const timer = setTimeout(() => setShuffling(false), 560)
    return () => clearTimeout(timer)
  }, [shuffling])
  if (!ch || ch.player !== me || ch.kind === 'targets') return null
  const pl = state.players[me]
  const toggle = (id: string, max: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max || max === Infinity ? [...p, id] : [...p.slice(1), id]))

  let title = ''
  let ids: string[] = []
  let max = 0
  let exact = false
  let tag = ''
  let footer: React.ReactNode = null
  switch (ch.kind) {
    case 'mulligan':
      {
        const mv = { n: pl.mulligans, name: state.players[state.firstPlayer].name }
        title = !pl.mulligans
          ? t('Mão inicial — {name} começa', mv)
          : pl.mulligans === 1
            ? t('Mão inicial (após {n} mulligan) — {name} começa', mv)
            : t('Mão inicial (após {n} mulligans) — {name} começa', mv)
      }
      ids = pl.hand
      footer = (
        <>
          <button
            className="btn"
            onClick={() => {
              setShuffling(true)
              act({ t: 'mulligan' })
            }}
            disabled={pl.mulligans >= 6 || shuffling}
          >
            ↻ Mulligan
          </button>
          <button className="btn primary" disabled={shuffling} onClick={() => act({ t: 'keep' })}>
            ✓ {t('Manter mão')}
          </button>
        </>
      )
      break
    case 'bottom':
      title = t('Escolha {n} carta(s) para colocar no fundo do grimório', { n: ch.count })
      ids = pl.hand
      max = ch.count
      exact = true
      tag = t('Fundo')
      break
    case 'discard':
      title = t('Descarte {n} carta(s) — {reason}', { n: ch.count, reason: ch.reason })
      ids = pl.hand
      max = ch.count
      exact = true
      tag = t('Descartar')
      break
    case 'scry':
      title = ch.surveil
        ? t('Vigiar {n}: marque as cartas que vão para o CEMITÉRIO', { n: ch.cards.length })
        : t('Vidência {n}: marque as cartas que vão para o FUNDO do grimório', { n: ch.cards.length })
      ids = ch.cards
      max = Infinity
      tag = ch.surveil ? t('Cemitério') : t('Fundo')
      break
    case 'search':
      title = t('Busque até {n} carta(s) no grimório', { n: ch.count })
      ids = ch.candidates
      max = ch.count
      tag = t('Escolhida')
      break
    case 'pickDiscard':
      title = t('Mão revelada de {name}: escolha a carta que será descartada', { name: state.players[ch.target].name })
      ids = ch.revealed
      max = 1
      exact = true
      tag = t('Descartar')
      break
    case 'returnOwn':
      title = t('Escolha {n} permanente(s) sua(s) para devolver à mão', { n: ch.count })
      ids = ch.candidates
      max = ch.count
      exact = true
      tag = t('Devolver')
      break
    case 'handLand':
      title = t('Você pode colocar um terreno da sua mão no campo de batalha')
      ids = ch.candidates
      max = 1
      tag = t('Colocar')
      break
    case 'dig':
      title =
        ch.dest === 'hand'
          ? ch.rest === 'graveyard'
            ? t('Topo do grimório: escolha até {n} carta(s) para a mão (o resto vai para o cemitério)', { n: ch.take })
            : t('Topo do grimório: escolha até {n} carta(s) para a mão (o resto vai para o fundo)', { n: ch.take })
          : ch.rest === 'graveyard'
            ? t('Topo do grimório: escolha até {n} carta(s) para o campo de batalha (o resto vai para o cemitério)', { n: ch.take })
            : t('Topo do grimório: escolha até {n} carta(s) para o campo de batalha (o resto vai para o fundo)', { n: ch.take })
      ids = ch.cards
      max = ch.take
      tag = t('Pegar')
      break
    case 'mode':
      title = t('{name}: escolha um modo', { name: ch.trigger.sourceName })
      footer = (
        <div className="col" style={{ width: '100%' }}>
          {(ch.trigger.ability.modes ?? []).map((m, i) => (
            <button key={i} className="btn" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => act({ t: 'chooseMode', index: i })}>
              • <ManaText text={m.text} />
            </button>
          ))}
        </div>
      )
      break
    case 'sacrifice':
      title = t('Escolha {n} permanente(s) para sacrificar', { n: ch.count })
      ids = ch.candidates
      max = ch.count
      exact = true
      tag = t('Sacrificar')
      break
  }
  if (!footer) {
    footer = (
      <button className="btn primary" disabled={exact && picked.length !== max} onClick={() => act({ t: 'chooseCards', ids: picked })}>
        {max !== Infinity ? t('Confirmar ({n}/{max})', { n: picked.length, max }) : t('Confirmar')}
      </button>
    )
  }
  return (
    <div className="overlay-center">
      <div className="modal" style={{ width: ch.kind === 'mulligan' ? 'min(1180px, 96vw)' : 'min(1000px, 94vw)' }}>
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <div className={`choice-cards ${ch.kind === 'mulligan' ? 'opening' : ''} ${shuffling ? 'shuffling' : ''}`}>
            {ids.map((id, i) => {
              const o = state.objects[id]
              const on = picked.includes(id)
              const dim = (ch.kind === 'pickDiscard' && !ch.candidates.includes(id)) || (ch.kind === 'dig' && !ch.eligible.includes(id))
              return (
                <div
                  key={id}
                  className={`cc ${on ? 'on' : ''}`}
                  style={{ ...(dim ? { opacity: 0.4, pointerEvents: 'none' } : {}), ['--i' as string]: i, ['--c' as string]: (ids.length - 1) / 2 - i }}
                  onClick={() => ch.kind !== 'mulligan' && toggle(id, max)}
                  onMouseEnter={() => setHover(id)}
                >
                  <CardImage printingId={o.card.printingId} foil={o.card.finish} fallback={fallbackOf(state, o)} />
                  {ch.kind === 'mulligan' && (
                    <span className="cc-back">
                      <CardBack />
                    </span>
                  )}
                  {on && <span className="tag">{tag}</span>}
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  )
}

function PromptModal() {
  const prompt = useGame((s) => s.prompt)
  const state = useGame((s) => s.state)
  const cont = useGame((s) => s.continuePrompt)
  const contCost = useGame((s) => s.continueCost)
  const setHover = useGame((s) => s.setHover)
  const [x, setX] = useState(1)
  const [multi, setMulti] = useState<number[]>([])
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    setMulti([])
    setPicked([])
  }, [prompt])
  if (!prompt || !state) return null
  const close = () => useGame.setState({ prompt: null })
  if (prompt.kind === 'cost') {
    const count = prompt.count ?? 1
    return (
      <Modal
        title={prompt.costKind === 'sacrifice' ? t('Custo adicional: sacrifique {n} permanente(s)', { n: count }) : t('Custo adicional: descarte {n} carta(s)', { n: count })}
        onClose={close}
        width={900}
        footer={
          <button className="btn primary" disabled={picked.length !== count} onClick={() => contCost(picked)}>
            {t('Pagar e continuar ({n}/{max})', { n: picked.length, max: count })}
          </button>
        }
      >
        <div className="muted small" style={{ marginBottom: 10 }}>
          {prompt.costText}
        </div>
        <div className="choice-cards">
          {(prompt.candidates ?? []).map((id) => {
            const o = state.objects[id]
            if (!o) return null
            const on = picked.includes(id)
            return (
              <div
                key={id}
                className={`cc ${on ? 'on' : ''}`}
                onMouseEnter={() => setHover(id)}
                onClick={() => setPicked((p) => (p.includes(id) ? p.filter((y) => y !== id) : p.length < count ? [...p, id] : [...p.slice(1), id]))}
              >
                <CardImage printingId={o.card.printingId} foil={o.card.finish} fallback={fallbackOf(state, o)} />
                {on && <span className="tag">{prompt.costKind === 'sacrifice' ? t('Sacrificar') : t('Descartar')}</span>}
              </div>
            )
          })}
        </div>
      </Modal>
    )
  }
  if (prompt.kind === 'mode') {
    const n = prompt.chooseCount ?? 1
    if (n > 1) {
      return (
        <Modal
          title={t('Escolha {n} modos', { n })}
          onClose={close}
          width={620}
          footer={
            <button className="btn primary" disabled={multi.length !== n} onClick={() => cont([...multi].sort((a, b) => a - b))}>
              {t('Confirmar ({n}/{max})', { n: multi.length, max: n })}
            </button>
          }
        >
          <div className="col">
            {prompt.modes!.map((m, i) => (
              <label key={i} className="check" style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={multi.includes(i)}
                  onChange={() => setMulti((cur) => (cur.includes(i) ? cur.filter((y) => y !== i) : cur.length < n ? [...cur, i] : cur))}
                />
                <span>
                  <ManaText text={m.text} /> {m.unsupported.length > 0 && <span className="badge warn">{t('parcial')}</span>}
                </span>
              </label>
            ))}
          </div>
        </Modal>
      )
    }
    return (
      <Modal title={t('Escolha um modo')} onClose={close} width={620}>
        <div className="col">
          {prompt.modes!.map((m, i) => (
            <button key={i} className="btn" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => cont(i)}>
              • <ManaText text={m.text} />
              {m.unsupported.length > 0 && <span className="badge warn">{t('parcial')}</span>}
            </button>
          ))}
        </div>
      </Modal>
    )
  }
  return (
    <Modal
      title={t('Escolha o valor de X')}
      onClose={close}
      width={380}
      footer={
        <button className="btn primary" onClick={() => cont(x)}>
          {t('Confirmar X = {x}', { x })}
        </button>
      }
    >
      <div className="row">
        <input type="range" min={0} max={Math.max(1, prompt.maxX ?? 10)} value={x} onChange={(e) => setX(Number(e.target.value))} className="grow" />
        <input type="number" min={0} value={x} onChange={(e) => setX(Math.max(0, Number(e.target.value)))} style={{ width: 70 }} />
      </div>
    </Modal>
  )
}

function GameOver({ onDismiss }: { onDismiss: () => void }) {
  const state = useGame((s) => s.state)!
  const restart = useGame((s) => s.restart)
  const quit = useGame((s) => s.quit)
  const setInGame = useApp((s) => s.setInGame)
  const online = useGame((s) => s.meta?.online)
  const me = useMySeat()
  const named = useNamed()
  const won = state.winner === me
  const winnerName = typeof state.winner === 'number' ? state.players[state.winner]?.name : undefined
  return (
    <div className="overlay-center">
      <div className="panel gameover">
        <h1>{state.winner === 'draw' ? t('Empate') : won ? t('🏆 Vitória!') : t('💀 Derrota')}</h1>
        {named && winnerName && !won && <h3 style={{ margin: '0 0 10px' }}>{t('🏆 {name} venceu a partida.', { name: winnerName })}</h3>}
        <div className="muted" style={{ marginBottom: 20 }}>
          {t('Partida encerrada no turno {n}.', { n: state.turn })} {state.log.filter((l) => l.kind === 'judge').slice(-1)[0]?.text}
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={onDismiss}>
            {t('Ver mesa')}
          </button>
          {online ? (
            <button className="btn primary" onClick={() => void useOnline.getState().leave()}>
              {t('Sair da mesa')}
            </button>
          ) : (
            <>
              <button className="btn primary" onClick={restart}>
                ⟲ {t('Jogar novamente')}
              </button>
              <button
                className="btn"
                onClick={() => {
                  quit()
                  setInGame(false)
                }}
              >
                {t('Voltar')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
