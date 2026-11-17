// Mesa livre de Pokémon: tudo manual (colocar no Banco, evoluir, ligar Energia, atacar, dano,
// prêmios...). Brilhos indicam o que dá para jogar e qual Pokémon pode atacar.
import { useEffect, useState } from 'react'
import type { PkmCard, PkmType } from '@shared/pokemon/types'
import { attachmentsOf, cardName } from '@shared/sandbox'
import { pkmAttackAffordable, pkmAttackDamage, pkmCanAttack, pkmEnergyUnits, pkmEnergyValue, pkmEvolveTargets, pkmInPlay, pkmPlayable, pkmRetreatPlan } from '@shared/sandbox/hints'
import { create } from 'zustand'
import { Modal } from '../components/common'
import { normalizePkmLayout } from '@shared/types'
import { playmatImageUrl } from '@shared/api'
import { t } from '@shared/i18n'
import { CardBack, useMenu, type MenuItem } from '../components/common'
import { useApp } from '../store'
import { useOnline } from '../online/onlineStore'
import { PkmCost, PkmTypeIcon } from '../pokemon/pkmCommon'
import { useDrawAnimation } from '../components/drawAnimation'
import { DragGhost, GameOverBanner, ObjCard, SbCardDetail, SidePanel, TopBar, ZoneViewer, middleClickDetail, startCardDrag, useSbDrag, useSbSel } from './SandboxCommon'
import { useSandbox } from './sandboxStore'

const COND: Record<string, { ico: string; label: string }> = {
  asleep: { ico: '💤', label: 'Adormecido' },
  confused: { ico: '😵', label: 'Confuso' },
  paralyzed: { ico: '⚡', label: 'Paralisado' },
  poisoned: { ico: '☠', label: 'Envenenado' },
  burned: { ico: '🔥', label: 'Queimado' }
}

/** Assento que age: o meu, ou o dono da carta no modo "controlar os dois lados" (bot desligado). */
function seatFor(owner: number): number {
  const m = useSandbox.getState().meta!
  return m.online || m.bots.includes(owner) ? m.mySeat : owner
}

export default function PkmTable() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const botBusy = useSandbox((s) => s.botBusy)
  const me = meta.mySeat
  const other = state.players.findIndex((_, i) => i !== me)

  // bot por IA joga quando é a vez dele
  // espera todos prepararem o campo (Ativo e Prêmios): se o bot começa, joga só depois da compra do turno 1
  const ready = Boolean(state.firstDrawDone) || state.turn > 1
  useEffect(() => {
    if (meta.online || state.winner !== null || botBusy || !ready || !meta.bots.includes(state.activePlayer)) return
    const timer = setTimeout(() => void useSandbox.getState().botTurn(), 600)
    return () => clearTimeout(timer)
  }, [state.activePlayer, state.turn, botBusy, meta, state.winner, ready])

  // bot sem Ativo (nocaute): promove o Pokémon do Banco com mais PS
  useEffect(() => {
    if (meta.online) return
    for (const b of meta.bots) {
      const z = state.players[b].zones
      if (!z.active.length && z.bench.length && z.prizes.length) {
        const best = [...z.bench].sort((a, c) => ((state.objects[c].card as PkmCard).hp ?? 0) - ((state.objects[a].card as PkmCard).hp ?? 0))[0]
        useSandbox.getState().act({ t: 'switchActive', id: best }, b)
      }
    }
  }, [state, meta])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useSbSel.getState().set(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="sb-table pkm">
      <div className="sb-main">
        <TopBar showTurn={false} />
        <Side p={other} />
        <Center />
        <Side p={me} />
        <Hand p={me} />
      </div>
      <SidePanel />
      <DragGhost />
      <GameOverBanner />
      <AttackDialog />
      <RetreatDialog />
      <SbCardDetail />
    </div>
  )
}

function TurnButtons() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const botBusy = useSandbox((s) => s.botBusy)
  const act = useSandbox((s) => s.act)
  const actor = meta.online || !meta.bots.length ? state.activePlayer : meta.mySeat
  const myTurn = state.activePlayer === meta.mySeat || (!meta.online && !meta.bots.includes(state.activePlayer))
  if (botBusy) return <span className="small muted">🤖 {t('O bot está pensando...')}</span>
  if (!myTurn) return null
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn" onClick={() => act({ t: 'draw', n: 1 }, seatFor(actor))}>
          {t('Comprar')}
        </button>
        <button className="btn primary" onClick={() => act({ t: 'passTurn' }, seatFor(actor))}>
          {t('Passar turno ⏭')}
        </button>
      </div>
    </>
  )
}

// ---------------- lado de um jogador ----------------

function Side({ p }: { p: number }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const settings = useApp((s) => s.settings)
  const act = useSandbox((s) => s.act)
  const openMenu = useMenu((s) => s.open)
  const [viewer, setViewer] = useState<'discard' | 'deck' | 'lostZone' | null>(null)
  const pl = state.players[p]
  const mine = p === meta.mySeat
  const controllable = mine || (!meta.online && !meta.bots.includes(p))
  const layout = normalizePkmLayout(settings?.pkmLayout)
  const oppMat = useOnline((s) => (mine || !meta.online || !s.setup ? undefined : s.mats[s.setup.players[p]?.userId ?? '']))
  const img = mine ? (settings?.playmatImage ? playmatImageUrl(settings.playmatImage) : '') : oppMat || (settings?.playmatImage && settings.playmatBoth ? playmatImageUrl(settings.playmatImage) : '')
  const imgStyle = img ? { ['--mat-img' as string]: `url("${img}")`, ['--mat-dim' as string]: String(settings?.playmatDim ?? 0.35) } : {}
  const seat = seatFor(p)
  const z = pl.zones
  const bench = [...z.bench, ...Array(Math.max(0, 5 - z.bench.length)).fill(null)] as (string | null)[]

  const prizes = (
    <div className="sb-zone" title={t('Cartas de Prêmio')}>
      <div className="pkm-prizes">
        {Array.from({ length: Math.max(6, z.prizes.length) }, (_, i) => {
          const id = z.prizes[i]
          return (
            <div
              key={i}
              className={`pkm-prize ${id ? '' : 'taken'} ${id && controllable ? 'clickable' : ''}`}
              onClick={() => id && controllable && act({ t: 'takePrize', id }, seat)}
              title={id && controllable ? t('Pegar esta carta de Prêmio') : undefined}
            >
              {id && <CardBack />}
            </div>
          )
        })}
      </div>
      <span className="small">{t('Prêmios: {n}', { n: z.prizes.length })}</span>
      {controllable && !z.prizes.length && state.turn <= 2 && (
        <button className="btn xs" onClick={() => act({ t: 'setupPrizes' }, seat)}>
          {t('Separar 6 Prêmios')}
        </button>
      )}
    </div>
  )
  const zones = (
    <div className="sb-zones">
      {layout.prizes === 'withZones' && prizes}
      <div
        className="sb-zone"
        {...(mine ? { 'data-my-deck': '1' } : {})}
        onClick={(e) =>
          controllable &&
          openMenu(e.clientX, e.clientY, [
            { header: t('Deck') },
            { label: t('Comprar 1 carta'), onClick: () => act({ t: 'draw', n: 1 }, seat) },
            { label: t('Procurar no deck…'), onClick: () => setViewer('deck') },
            { label: t('Embaralhar'), onClick: () => act({ t: 'shuffle', zone: 'deck' }, seat) },
            { label: t('Mulligan (embaralhar a mão e comprar 7)'), onClick: () => confirm(t('Fazer mulligan?')) && act({ t: 'mulligan' }, seat) },
            ...(z.deck.length ? [{ label: t('Descartar a carta do topo'), onClick: () => act({ t: 'move', id: z.deck[0], to: 'discard' }, seat) }] : [])
          ])
        }
      >
        <div className="sb-pile">{z.deck.length ? <CardBack /> : <div className="sb-empty" />}</div>
        <span className="small">{t('Deck: {n}', { n: z.deck.length })}</span>
      </div>
      <div className="sb-zone" data-drop={controllable ? `discard:${p}` : undefined} onClick={() => setViewer('discard')}>
        <div className="sb-pile">{z.discard.length ? <ObjCard o={state.objects[z.discard[z.discard.length - 1]]} /> : <div className="sb-empty" />}</div>
        <span className="small">{t('Descarte: {n}', { n: z.discard.length })}</span>
      </div>
      {z.lostZone.length > 0 && (
        <button className="btn xs" onClick={() => setViewer('lostZone')}>
          {t('Zona Perdida: {n}', { n: z.lostZone.length })}
        </button>
      )}
    </div>
  )
  const prizeCol = layout.prizes === 'opposite' ? <div className="sb-zones">{prizes}</div> : null
  const zoneMenu = (id: string): MenuItem[] => [
    { header: cardName(state.objects[id].card) },
    { label: t('Para a mão'), onClick: () => act({ t: 'move', id, to: 'hand' }, seat) },
    { label: t('Para o Banco'), onClick: () => act({ t: 'move', id, to: 'bench' }, seat) },
    { label: t('Para o descarte'), onClick: () => act({ t: 'move', id, to: 'discard' }, seat) },
    { label: t('Para o topo do deck'), onClick: () => act({ t: 'move', id, to: 'deck', pos: 'top' }, seat) },
    { label: t('Para o fundo do deck'), onClick: () => act({ t: 'move', id, to: 'deck', pos: 'bottom' }, seat) },
    { label: t('Para a Zona Perdida'), onClick: () => act({ t: 'move', id, to: 'lostZone' }, seat) }
  ]
  return (
    <div className={`sb-side-area ${mine ? 'me' : 'opp'} ${state.activePlayer === p && state.winner === null ? 'turn' : ''} ${layout.bench === 'front' ? 'bench-front' : ''} ${img ? 'has-image' : ''}`} style={{ ...imgStyle, ['--pc' as string]: pl.color }}>
      {layout.zones === 'left' ? zones : prizeCol}
      <div className="sb-field">
        <div className="sb-row" data-drop={controllable ? `active:${p}` : undefined}>
          <span className="sb-label">{t('Ativo')}</span>
          {z.active.length ? z.active.map((id) => <PokeSlot key={id} id={id} owner={p} big />) : <div className="pkm-slot empty big" />}
          <div className="sb-player-info">
            <b style={{ color: pl.color }}>{pl.name}</b>
            {state.activePlayer === p && <span className="badge ok">{t('turno')}</span>}
            <span className="small muted">{t('{n} na mão', { n: z.hand.length })}</span>
            {!mine && z.hand.length > 0 && (
              <div className="pkm-opp-hand">
                {z.hand.slice(0, 10).map((id) => (
                  <div key={id} className="pkm-mini-back">
                    <CardBack />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sb-row" data-drop={controllable ? `bench:${p}` : undefined}>
          <span className="sb-label">{t('Banco')}</span>
          {bench.map((id, i) => (id ? <PokeSlot key={id} id={id} owner={p} /> : <div key={`e${i}`} className="pkm-slot empty" />))}
        </div>
      </div>
      {layout.zones === 'left' ? prizeCol : zones}
      {viewer && (
        <ZoneViewer
          title={viewer === 'deck' ? t('Deck de {name}', { name: pl.name }) : viewer === 'discard' ? t('Descarte de {name}', { name: pl.name }) : t('Zona Perdida de {name}', { name: pl.name })}
          ids={viewer === 'discard' ? [...z.discard].reverse() : z[viewer]}
          onClose={() => {
            if (viewer === 'deck' && controllable && confirm(t('Embaralhar o deck depois de procurar?'))) act({ t: 'shuffle', zone: 'deck' }, seat)
            setViewer(null)
          }}
          menuFor={(id) => (controllable ? zoneMenu(id) : [{ header: cardName(state.objects[id].card) }])}
          hiddenFor={(id) => viewer === 'deck' && !controllable && Boolean(id)}
        />
      )}
    </div>
  )
}

// ---------------- Pokémon em jogo ----------------

function PokeSlot({ id, owner, big }: { id: string; owner: number; big?: boolean }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const sel = useSbSel((s) => s.sel)
  const openMenu = useMenu((s) => s.open)
  const o = state.objects[id]
  const c = o.card as PkmCard
  const units = pkmEnergyUnits(state, id)
  const seat = seatFor(owner)
  const att = attachmentsOf(state, id)
  const tool = att.find((a) => (state.objects[a].card as PkmCard).trainerType === 'Tool')
  const canAttack = pkmCanAttack(state, owner, id) && (owner === meta.mySeat || (!meta.online && !meta.bots.includes(owner)))
  const hinted = sel?.hint.includes(id)

  const actions = (e: React.MouseEvent) => {
    if (sel) {
      if (sel.kind === 'attach') act({ t: 'attach', id: sel.cardId, target: id }, seatFor(state.objects[sel.cardId].owner))
      else if (sel.kind === 'evolve') act({ t: 'evolve', id: sel.cardId, target: id }, seatFor(state.objects[sel.cardId].owner))
      useSbSel.getState().set(null)
      return
    }
    const z = state.players[owner].zones
    const isActive = z.active[0] === id
    const items: MenuItem[] = [{ header: cardName(c) }]
    c.attacks.forEach((a, i) => {
      if (!isActive) return
      const ok = pkmAttackAffordable(state, id, i)
      items.push({
        label: (
          <span className={`sb-menu-attack ${ok ? 'ok' : ''}`}>
            <PkmCost cost={a.cost} size={13} /> {a.localName ?? a.name} {a.damage && <b>{a.damage}</b>}
          </span>
        ),
        title: (a.localEffect ?? a.effect ?? '') + (ok ? '' : `\n${t('(as Energias ligadas não pagam este ataque — indicador apenas)')}`),
        onClick: () => usePkmDialog.getState().open({ kind: 'attack', attacker: id, index: i, seat })
      })
    })
    c.abilities.forEach((ab, i) =>
      items.push({ label: `✦ ${t('Usar Habilidade: {name}', { name: ab.localName ?? ab.name })}`, title: ab.localEffect ?? ab.effect, onClick: () => act({ t: 'ability', id, index: i }, seat) })
    )
    if (isActive && z.bench.length) {
      const plan = pkmRetreatPlan(state, id)
      items.push('sep', { header: t('Recuar (custo {n}) para', { n: plan.cost }) })
      for (const b of z.bench) items.push({ label: `↩ ${cardName(state.objects[b].card)}`, onClick: () => (plan.cost > 0 && plan.energies.length ? usePkmDialog.getState().open({ kind: 'retreat', active: id, to: b, seat }) : act({ t: 'switchActive', id: b, retreat: true, discard: [] }, seat)) })
      items.push({ header: t('Trocar sem custo (efeito de carta)') })
      for (const b of z.bench) items.push({ label: `⇄ ${cardName(state.objects[b].card)}`, onClick: () => act({ t: 'switchActive', id: b }, seat) })
    }
    if (!isActive) items.push({ label: t('Promover ao Ativo'), onClick: () => act({ t: 'switchActive', id }, seat) })
    items.push(
      'sep',
      { header: t('Dano e condições') },
      { label: t('+10 de dano'), onClick: () => act({ t: 'damage', id, delta: 10 }, seat) },
      { label: t('+50 de dano'), onClick: () => act({ t: 'damage', id, delta: 50 }, seat) },
      { label: t('−10 de dano'), onClick: () => act({ t: 'damage', id, delta: -10 }, seat) },
      ...Object.entries(COND).map(([k, v]) => ({ label: `${v.ico} ${t(v.label)}`, onClick: () => act({ t: 'condition', id, cond: k }, seat) })),
      { label: t('Remover condições'), onClick: () => act({ t: 'condition', id, cond: 'clear' }, seat) },
      'sep',
      { label: t('Nocauteado → descarte'), onClick: () => act({ t: 'move', id, to: 'discard' }, seat) },
      { label: t('Devolver para a mão'), onClick: () => act({ t: 'move', id, to: 'hand' }, seat) },
      { label: t('Embaralhar no deck'), onClick: () => act({ t: 'move', id, to: 'deck', pos: 'bottom' }, seat) }
    )
    for (const a of att) items.push({ label: t('Descartar {name}', { name: cardName(state.objects[a].card) }), onClick: () => act({ t: 'move', id: a, to: 'discard' }, seat) })
    openMenu(e.clientX, e.clientY, items)
  }
  return (
    <div
      data-obj={id}
      className={`pkm-slot ${big ? 'big' : ''} ${hinted ? 'target' : ''} ${canAttack ? 'can-attack' : ''} ${c.hp && (o.damage ?? 0) >= c.hp ? 'ko' : ''}`}
      onClick={actions}
      {...middleClickDetail(id)}
      onContextMenu={(e) => {
        e.preventDefault()
        actions(e)
      }}
      onMouseEnter={() => setHover(id)}
      onMouseLeave={() => setHover(null)}
      title={canAttack ? t('Pode atacar · botão do meio: detalhes') : t('Botão do meio: detalhes')}
    >
      <div className="pkm-slot-card">
        <ObjCard o={o} />
        {o.under?.length ? <span className="pkm-stack">×{o.under.length + 1}</span> : null}
        {(o.damage ?? 0) > 0 && <span className="pkm-damage">{o.damage}</span>}
        {c.hp && (o.damage ?? 0) >= c.hp ? <span className="pkm-ko" title={t('Nocauteado: mova para o descarte e o oponente pega os Prêmios')}>💥 KO</span> : null}
        {o.conditions?.length ? (
          <div className="pkm-conds">
            {o.conditions.map((k) => (
              <span key={k} title={t(COND[k]?.label ?? k)}>
                {COND[k]?.ico ?? k}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pkm-slot-info">
        <span className="pkm-hp">
          {Math.max(0, (c.hp ?? 0) - (o.damage ?? 0))}/{c.hp ?? 0}
        </span>
        <span className="pkm-energy">
          {units.map((u, i) => (u === 'any' ? <span key={i} className="pkm-type any">★</span> : <PkmTypeIcon key={i} type={u as PkmType} size={big ? 16 : 13} />))}
        </span>
        {tool && <span className="pkm-tool" title={cardName(state.objects[tool].card)}>🔧</span>}
      </div>
      {big && <div className="pkm-slot-name">{cardName(c)}</div>}
    </div>
  )
}

// ---------------- centro ----------------

function Center() {
  const state = useSandbox((s) => s.state)!
  const sel = useSbSel((s) => s.sel)
  const setHover = useSandbox((s) => s.setHover)
  const stadiums = state.players.flatMap((pl) => pl.zones.stadium)
  return (
    <div className="sb-center" data-drop="stadium">
      <div className="pkm-stadium" title={t('Estádio')}>
        {stadiums.length ? (
          stadiums.map((id) => (
            <div key={id} className="pkm-stadium-card" onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} {...middleClickDetail(id)}>
              <ObjCard o={state.objects[id]} />
            </div>
          ))
        ) : (
          <span className="small muted">{t('Sem Estádio')}</span>
        )}
      </div>
      <div className="sb-turn-info">
        <TurnInfo />
      </div>
      <div className="sb-prompt">
        {sel ? (
          <>
            {t('Escolha o Pokémon para {label} (Esc cancela).', { label: sel.label })}{' '}
            <button className="btn xs danger" onClick={() => useSbSel.getState().set(null)}>
              {t('Cancelar')}
            </button>
          </>
        ) : (
          <span className="small muted">{t('Tudo é manual: clique nas cartas para jogar. Os brilhos são só indicações. Na dúvida, chame o juiz no histórico.')}</span>
        )}
      </div>
      <TurnButtons />
    </div>
  )
}

function TurnInfo() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const active = state.players[state.activePlayer]
  return (
    <span style={{ color: active.color, fontWeight: 600 }}>
      {state.activePlayer === meta.mySeat ? t('Turno {n} · seu turno', { n: state.turn }) : t('Turno {n} · turno de {name}', { n: state.turn, name: active.name })}
    </span>
  )
}

// ---------------- mão ----------------

function Hand({ p }: { p: number }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const openMenu = useMenu((s) => s.open)
  const dragMode = useApp((s) => s.settings?.playMode === 'drag')
  const drawAnim = useApp((s) => s.settings?.drawAnimation !== false)
  const dragId = useSbDrag((s) => s.drag?.id)
  // no modo "dois lados" a mão mostrada é a de quem está jogando
  const viewSeat = !meta.online && !meta.bots.includes(state.activePlayer) ? state.activePlayer : p
  const pl = state.players[viewSeat]
  const seat = seatFor(viewSeat)
  useDrawAnimation(pl.zones.hand, state.activePlayer === viewSeat ? String(state.turn) : null, drawAnim)

  const menuFor = (id: string, x: number, y: number) => {
    const c = state.objects[id].card as PkmCard
    const items: MenuItem[] = [{ header: cardName(c) }]
    const inPlay = pkmInPlay(state, viewSeat)
    if (c.category === 'Pokemon') {
      items.push({ label: t('Colocar no Banco'), onClick: () => act({ t: 'move', id, to: 'bench' }, seat) })
      if (!pl.zones.active.length) items.push({ label: t('Colocar no Ativo'), onClick: () => act({ t: 'move', id, to: 'active' }, seat) })
      if (c.evolveFrom) items.push({ label: t('Evoluir…'), onClick: () => useSbSel.getState().set({ kind: 'evolve', cardId: id, hint: pkmEvolveTargets(state, viewSeat, id), label: t('evoluir') }) })
    } else if (c.category === 'Energy' || c.trainerType === 'Tool') {
      items.push({ label: t('Ligar a um Pokémon…'), onClick: () => useSbSel.getState().set({ kind: 'attach', cardId: id, hint: inPlay, label: c.category === 'Energy' ? t('ligar a Energia') : t('ligar a Ferramenta') }) })
    } else if (c.trainerType === 'Stadium') {
      items.push({ label: t('Jogar o Estádio'), onClick: () => act({ t: 'move', id, to: 'stadium' }, seat) })
    } else {
      items.push({ label: t('Jogar (vai para o descarte; faça o efeito à mão)'), onClick: () => act({ t: 'move', id, to: 'discard' }, seat) })
    }
    items.push(
      'sep',
      { label: t('Descartar'), onClick: () => act({ t: 'move', id, to: 'discard' }, seat) },
      { label: t('Colocar no topo do deck'), onClick: () => act({ t: 'move', id, to: 'deck', pos: 'top' }, seat) },
      { label: t('Colocar no fundo do deck'), onClick: () => act({ t: 'move', id, to: 'deck', pos: 'bottom' }, seat) }
    )
    openMenu(x, y - 160, items)
  }

  const onDrop = (id: string, el: HTMLElement | null) => {
    const c = state.objects[id].card as PkmCard
    const objEl = el?.closest('[data-obj]') as HTMLElement | null
    if (objEl) {
      const target = objEl.dataset.obj!
      if (c.category === 'Pokemon' && c.evolveFrom) act({ t: 'evolve', id, target }, seat)
      else if (c.category === 'Energy' || c.trainerType === 'Tool') act({ t: 'attach', id, target }, seat)
      return
    }
    const zone = (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop?.split(':')[0]
    if (zone === 'bench' || zone === 'active') act({ t: 'move', id, to: zone }, seat)
    else if (zone === 'discard') act({ t: 'move', id, to: 'discard' }, seat)
    else if (zone === 'stadium') act({ t: 'move', id, to: c.trainerType === 'Stadium' ? 'stadium' : 'discard' }, seat)
  }

  return (
    <div className={`sb-hand ${dragId ? 'holding' : ''}`}>
      {pl.zones.hand.map((id) => (
        <div
          key={id}
          data-hand-id={id}
          className={`sb-hand-card ${pkmPlayable(state, viewSeat, id) ? 'playable' : ''} ${dragId === id ? 'lifted' : ''}`}
          onClick={dragMode ? undefined : (e) => menuFor(id, e.clientX, e.clientY)}
          onPointerDown={dragMode ? (e) => startCardDrag(e, id, (el) => onDrop(id, el), (x, y) => menuFor(id, x, y)) : undefined}
          {...middleClickDetail(id)}
          onContextMenu={(e) => {
            e.preventDefault()
            menuFor(id, e.clientX, e.clientY)
          }}
          onMouseEnter={() => setHover(id)}
          onMouseLeave={() => setHover(null)}
        >
          <ObjCard o={state.objects[id]} />
        </div>
      ))}
      {!pl.zones.hand.length && <span className="small muted">{t('Mão vazia.')}</span>}
    </div>
  )
}


// ---------------- janelas de ataque e recuo ----------------

type PkmDialog = { kind: 'attack'; attacker: string; index: number; seat: number } | { kind: 'retreat'; active: string; to: string; seat: number } | null
const usePkmDialog = create<{ dialog: PkmDialog; open: (d: PkmDialog) => void }>((set) => ({ dialog: null, open: (dialog) => set({ dialog }) }))

const TYPE_PT: Record<string, string> = { Grass: 'Planta', Fire: 'Fogo', Water: 'Água', Lightning: 'Elétrico', Psychic: 'Psíquico', Fighting: 'Lutador', Darkness: 'Escuridão', Metal: 'Metal', Fairy: 'Fada', Dragon: 'Dragão', Colorless: 'Incolor' }

function partText(p: string): string {
  if (p === 'bench') return t('Pokémon no Banco: sem Fraqueza nem Resistência')
  const m = p.match(/^(weak×2|weak\+(\d+)|res-(\d+)):(\w+)$/)
  if (!m) return p
  const type = t(TYPE_PT[m[4]] ?? m[4])
  if (m[1] === 'weak×2') return t('Fraqueza a {type}: ×2', { type })
  if (m[2]) return t('Fraqueza a {type}: +{n}', { type, n: m[2] })
  return t('Resistência a {type}: −{n}', { type, n: m[3] })
}

/** Ataque: dano já com Fraqueza/Resistência; o jogador confirma (ou ajusta) e o turno termina. */
function AttackDialog() {
  const dialog = usePkmDialog((s) => s.dialog)
  const state = useSandbox((s) => s.state)!
  const act = useSandbox((s) => s.act)
  const close = () => usePkmDialog.getState().open(null)
  const atk = dialog?.kind === 'attack' ? state.objects[dialog.attacker] : undefined
  const owner = atk?.owner ?? 0
  const foe = state.players.find((pl) => pl.id !== owner)
  const targets = foe ? [...foe.zones.active, ...foe.zones.bench] : []
  const [target, setTarget] = useState<string>('')
  const [dmg, setDmg] = useState<number>(0)
  const calc = dialog?.kind === 'attack' && target ? pkmAttackDamage(state, dialog.attacker, dialog.index, target) : null
  useEffect(() => {
    if (dialog?.kind !== 'attack') return
    setTarget(foe?.zones.active[0] ?? targets[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])
  useEffect(() => {
    if (calc) setDmg(calc.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, dialog])
  if (dialog?.kind !== 'attack' || !atk) return null
  const card = atk.card as PkmCard
  const a = card.attacks[dialog.index]
  const go = (endTurn: boolean) => {
    act({ t: 'attack', id: dialog.attacker, index: dialog.index, target: target || undefined, damage: target ? Math.max(0, dmg) : undefined, endTurn }, dialog.seat)
    close()
  }
  const tgtCard = target ? (state.objects[target].card as PkmCard) : null
  const left = tgtCard?.hp ? tgtCard.hp - (state.objects[target].damage ?? 0) - dmg : null
  return (
    <Modal title={t('{name} usa {attack}', { name: cardName(card), attack: a.localName ?? a.name })} onClose={close} width={560}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <PkmCost cost={a.cost} size={15} /> <b>{a.damage || t('sem dano')}</b>
          {!pkmAttackAffordable(state, dialog.attacker, dialog.index) && <span className="badge warn">{t('as Energias ligadas não pagam este ataque')}</span>}
        </div>
        {(a.localEffect ?? a.effect) && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.localEffect ?? a.effect}</div>}
        {targets.length > 0 && (
          <label className="field">
            {t('Alvo do dano')}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {targets.map((id) => (
                <option key={id} value={id}>
                  {cardName(state.objects[id].card)} {foe!.zones.active[0] === id ? `(${t('Ativo')})` : `(${t('Banco')})`}
                </option>
              ))}
            </select>
          </label>
        )}
        {calc && (
          <div className="sb-dmg-calc">
            <div>
              {t('Dano base')}: <b>{calc.base}</b>
            </div>
            {calc.parts.map((p) => (
              <div key={p}>{partText(p)}</div>
            ))}
            {calc.variable && <div className="muted small">{t('O dano deste ataque varia ("+", "×"): ajuste o valor conforme o efeito (moedas, Energias...).')}</div>}
            <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
              {t('Dano a aplicar')}:
              <input type="number" min={0} step={10} value={dmg} onChange={(e) => setDmg(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ width: 90 }} />
              {left !== null && <span className={left <= 0 ? 'badge err' : 'muted small'}>{left <= 0 ? t('Nocauteia!') : t('sobram {n} PS', { n: left })}</span>}
            </label>
          </div>
        )}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn" onClick={close}>
            {t('Cancelar')}
          </button>
          <button className="btn" onClick={() => go(false)} title={t('Aplica o dano e deixa o turno aberto para você fazer os outros efeitos do ataque à mão')}>
            {t('Aplicar e continuar')}
          </button>
          <button className="btn primary" onClick={() => go(true)}>
            {t('Aplicar dano e encerrar o turno')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Recuo: escolher as Energias que pagam o custo (sugestão já marcada). */
function RetreatDialog() {
  const dialog = usePkmDialog((s) => s.dialog)
  const state = useSandbox((s) => s.state)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const close = () => usePkmDialog.getState().open(null)
  const [picked, setPicked] = useState<string[]>([])
  const plan = dialog?.kind === 'retreat' ? pkmRetreatPlan(state, dialog.active) : null
  useEffect(() => {
    if (plan) setPicked(plan.suggested)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])
  if (dialog?.kind !== 'retreat' || !plan) return null
  const paid = picked.reduce((sum, id) => sum + pkmEnergyValue(state, id), 0)
  const retreated = state.players[state.objects[dialog.active].owner].retreatedThisTurn ?? 0
  return (
    <Modal title={t('Recuar {name}', { name: cardName(state.objects[dialog.active].card) })} onClose={close} width={620}>
      <div className="small muted" style={{ marginBottom: 8 }}>
        {t('Custo de recuo: {n}. Escolha as Energias para descartar.', { n: plan.cost })} {retreated > 0 && <b>{t('Você já recuou neste turno (só pode 1 vez).')}</b>}
      </div>
      <div className="sb-viewer">
        {plan.energies.map((id) => (
          <div
            key={id}
            className={`sb-viewer-card ${picked.includes(id) ? 'picked' : ''}`}
            onClick={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(null)}
          >
            <ObjCard o={state.objects[id]} />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 10, alignItems: 'center' }}>
        <span className={paid >= plan.cost ? 'small muted' : 'badge warn'}>{t('Pago: {a} de {b}', { a: paid, b: plan.cost })}</span>
        <button className="btn" onClick={close}>
          {t('Cancelar')}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            act({ t: 'switchActive', id: dialog.to, retreat: true, discard: picked }, dialog.seat)
            close()
          }}
        >
          {t('Recuar')}
        </button>
      </div>
    </Modal>
  )
}
