// Mesa livre de Magic: tudo manual (virar terrenos para mana, jogar cartas, declarar ataques e
// bloqueios, vida, marcadores...). Brilhos indicam o que dá para pagar com a mana gerada e quem pode atacar.
import { useEffect, useRef, useState } from 'react'
import type { GameCard } from '@shared/engine'
import { attachmentsOf, cardName, mulliganBottomCount, type SObj } from '@shared/sandbox'
import { isLandCard, mtgCanAttack, mtgPlayable } from '@shared/sandbox/hints'
import { manaOptionsOf } from '@shared/sandbox/mana'
import { normalizeMatLayout, DEFAULT_MAT_LAYOUT } from '@shared/board'
import { STEP_LABEL, STEP_ORDER } from '@shared/engine'
import { playmatImageUrl } from '@shared/api'
import { t } from '@shared/i18n'
import { CardBack, ManaCost, Modal, useMenu, type MenuItem } from '../components/common'
import { create } from 'zustand'
import { useApp } from '../store'
import { useOnline } from '../online/onlineStore'
import { useDrawAnimation } from '../components/drawAnimation'
import { Marquee, MultiSelBar, canSelectOn, startMarquee, useMultiSel } from './MultiSelect'
import { DragGhost, GameOverBanner, ObjCard, SbCardDetail, SidePanel, TopBar, ZoneViewer, middleClickDetail, startCardDrag, useSbDrag, useSbSel } from './SandboxCommon'
import { useSandbox } from './sandboxStore'


function seatFor(owner: number): number {
  const m = useSandbox.getState().meta!
  return m.online || m.bots.includes(owner) ? m.mySeat : owner
}

function typeLine(o: SObj): string {
  const c = o.card as GameCard
  return c.faces?.[o.face ?? 0]?.typeLine ?? c.typeLine
}

export default function MtgTable() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const botBusy = useSandbox((s) => s.botBusy)
  const me = meta.mySeat
  const opps = state.players.map((p) => p.id).filter((id) => id !== me)

  // `inMulligan` nas dependências: se um bot começa a partida, o turno dele só pode rodar quando os
  // mulligans terminam (o jogador da vez e o turno não mudam nesse momento)
  const inMulligan = state.step === 'mulligan'
  useEffect(() => {
    if (meta.online || state.winner !== null || botBusy || inMulligan || !meta.bots.includes(state.activePlayer)) return
    const timer = setTimeout(() => void useSandbox.getState().botTurn(), 600)
    return () => clearTimeout(timer)
  }, [state.activePlayer, state.turn, botBusy, meta, state.winner, inMulligan])

  // bot: mantém ou faz mulligan sozinho (2 a 5 terrenos na mão = mantém; no máximo 2 mulligans)
  useEffect(() => {
    if (meta.online || state.step !== 'mulligan') return
    for (const b of meta.bots) {
      const pl = state.players[b]
      if (pl.kept) continue
      const hand = pl.zones.hand.map((id) => state.objects[id])
      const lands = hand.filter((o) => isLandCard(o)).length
      if ((lands >= 2 && lands <= 5) || (pl.mulligans ?? 0) >= 2) {
        // fundo do grimório: as cartas mais caras que não são terreno (ou terrenos, se sobrarem)
        const need = mulliganBottomCount(state, b)
        const order = [...hand].sort((x, y) => Number(isLandCard(x)) - Number(isLandCard(y)) || ((y.card as GameCard).cmc ?? 0) - ((x.card as GameCard).cmc ?? 0))
        useSandbox.getState().act({ t: 'keep', bottom: order.slice(0, need).map((o) => o.id) }, b)
      } else useSandbox.getState().act({ t: 'mulligan' }, b)
      return
    }
  }, [state, meta])

  // bot que perdeu pelas regras (vida 0, 10 venenos ou 21 de dano de um comandante) sai da partida sozinho
  useEffect(() => {
    if (meta.online || state.winner !== null || state.step === 'mulligan') return
    for (const b of meta.bots) {
      const pl = state.players[b]
      if (pl.conceded) continue
      const lost = pl.life <= 0 || (pl.poison ?? 0) >= 10 || Object.values(pl.commanderDamage ?? {}).some((n) => n >= 21)
      if (!lost) continue
      useSandbox.getState().act({ t: 'note', text: t('Perdi — saio da partida.') }, b)
      useSandbox.getState().act({ t: 'concede' }, b)
      return
    }
  }, [state, meta])

  // o bot defende sozinho: ao chegar em "Declarar bloqueadores" com atacantes, ele escolhe os bloqueios
  const askedBlocks = useRef<string>('')
  useEffect(() => {
    if (meta.online || botBusy || state.step !== 'declareBlockers') return
    const key = `${state.turn}`
    if (askedBlocks.current === key) return
    const defends = meta.bots.some((b) => b !== state.activePlayer)
    if (!defends || !Object.values(state.objects).some((o) => o.attacking)) return
    askedBlocks.current = key
    void useSandbox.getState().botBlocks()
  }, [state.step, state.turn, botBusy, meta, state.activePlayer, state.objects])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      useSbSel.getState().set(null)
      useMultiSel.getState().clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="sb-table mtg">
      <div className="sb-main">
        <TopBar showTurn={false} />
        <div className={`mtg-opps n${opps.length}`}>
          {opps.map((p) => (
            <Board key={p} p={p} compact={opps.length > 1} />
          ))}
        </div>
        <CenterStrip />
        <Board p={me} />
        <Hand p={me} />
      </div>
      <SidePanel />
      <DragGhost />
      <GameOverBanner />
      <MulliganModal />
      <MtgDialogs />
      <SbCardDetail />
      <Marquee />
      <MultiSelBar />
    </div>
  )
}

/** Faixa central: etapas do turno (clicáveis para avançar), turno atual, combate e os botões de passar. */
function CenterStrip() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const botBusy = useSandbox((s) => s.botBusy)
  const act = useSandbox((s) => s.act)
  const sel = useSbSel((s) => s.sel)
  const step = state.step ?? 'main1'
  const active = state.players[state.activePlayer]
  const myTurn = state.activePlayer === meta.mySeat
  // no modo "dois lados" quem estiver jogando controla os botões; contra o bot, só no meu turno
  const canDrive = !botBusy && state.winner === null && step !== 'mulligan' && (myTurn || (!meta.online && !meta.bots.includes(state.activePlayer)))
  const seat = seatFor(state.activePlayer)
  const idx = STEP_ORDER.indexOf(step)
  const next = STEP_ORDER.slice(idx + 1).find((x) => x !== 'untap' && x !== 'upkeep' && x !== 'draw')
  const attackers = Object.values(state.objects).filter((o) => o.attacking)
  const blockers = Object.values(state.objects).filter((o) => o.blocking)
  const botDefends = !meta.online && meta.bots.some((b) => b !== state.activePlayer)

  let prompt: React.ReactNode
  if (step === 'mulligan') {
    const waiting = state.players.filter((pl) => !pl.kept && !pl.conceded).map((pl) => pl.name)
    prompt = waiting.length ? t('Mãos iniciais: aguardando {names} decidir(em).', { names: waiting.join(', ') }) : ''
  } else if (sel)
    prompt = (
      <>
        {t('Escolha a carta para {label} (Esc cancela).', { label: sel.label })}{' '}
        <button className="btn xs danger" onClick={() => useSbSel.getState().set(null)}>
          {t('Cancelar')}
        </button>
      </>
    )
  else if (botBusy) prompt = <>🤖 {t('O bot está pensando...')}</>
  else if (attackers.length)
    prompt = (
      <>
        ⚔ {t('Atacando: {list}', { list: attackers.map((o) => `${cardName(o.card)}${typeof o.attackTarget === 'number' && state.players.length > 2 ? ` → ${state.players[o.attackTarget]?.name}` : typeof o.attackTarget === 'string' ? ` → ${cardName(state.objects[o.attackTarget]?.card ?? o.card)}` : ''}`).join(', ') })}
        {blockers.length > 0 && ` · 🛡 ${blockers.map((b) => `${cardName(b.card)} → ${cardName(state.objects[b.blocking!]?.card ?? b.card)}`).join(', ')}`}
        {botDefends && step === 'declareBlockers' && (
          <button className="btn xs primary" style={{ marginLeft: 8 }} onClick={() => void useSandbox.getState().botBlocks()}>
            {t('Pedir bloqueios ao bot')}
          </button>
        )}
      </>
    )
  else if (step === 'declareAttackers' && canDrive) prompt = t('Declare os atacantes: clique nas criaturas que brilham e escolha "Atacar".')
  else if (step === 'combatDamage') prompt = t('Aplique o dano de combate ajustando a vida (− / +) e mova as criaturas destruídas para o cemitério.')
  else if (step === 'cleanup') prompt = t('Limpeza: descarte até ficar com 7 cartas na mão, se precisar.')
  else prompt = <span className="small muted">{t('Tudo é manual: clique nas cartas para jogar, virar para mana, atacar e bloquear. Os brilhos são só indicações. Na dúvida, chame o juiz no histórico.')}</span>

  return (
    <div className="center-strip sb-center-strip">
      <div className="col" style={{ gap: 4 }}>
        <div className="phases">
          {STEP_ORDER.filter((x) => x !== 'untap' && x !== 'cleanup').map((x) => {
            const passed = STEP_ORDER.indexOf(x) < idx
            const ahead = STEP_ORDER.indexOf(x) > idx
            return (
              <button
                key={x}
                type="button"
                className={`phase ${myTurn ? '' : 'opp'} ${step === x ? 'on' : ''} ${passed ? 'passed' : ''}`}
                disabled={!canDrive || !ahead}
                title={ahead && canDrive ? t('Ir para: {step}', { step: t(STEP_LABEL[x]) }) : undefined}
                onClick={() => act({ t: 'step', to: x }, seat)}
              >
                {t(STEP_LABEL[x])}
              </button>
            )
          })}
        </div>
        <span className="small" style={{ color: active.color }}>
          {myTurn ? t('Turno {n} · seu turno', { n: state.turn }) : t('Turno {n} · turno de {name}', { n: state.turn, name: active.name })}
          {step === 'cleanup' && ` · ${t('Limpeza')}`}
        </span>
      </div>
      <div className="prompt">{prompt}</div>
      {canDrive && (
        <div className="row" style={{ gap: 6 }}>
          {next && (
            <button className="btn" onClick={() => act({ t: 'step', to: next }, seat)} title={t('Ir para: {step}', { step: t(STEP_LABEL[next]) })}>
              {t('Próxima fase ▶')}
            </button>
          )}
          <button className="btn primary" onClick={() => act({ t: 'passTurn' }, seat)}>
            {t('Passar turno ⏭')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------- tabuleiro de um jogador ----------------

function Board({ p, compact }: { p: number; compact?: boolean }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const settings = useApp((s) => s.settings)
  const act = useSandbox((s) => s.act)
  const openMenu = useMenu((s) => s.open)
  const [viewer, setViewer] = useState<'graveyard' | 'exile' | 'library' | 'command' | null>(null)
  const pl = state.players[p]
  const mine = p === meta.mySeat
  const controllable = mine || (!meta.online && !meta.bots.includes(p))
  const seat = seatFor(p)
  const z = pl.zones
  const oppMat = useOnline((s) => (mine || !meta.online || !s.setup ? undefined : s.mats[s.setup.players[p]?.userId ?? '']))
  const img = mine ? (settings?.playmatImage ? playmatImageUrl(settings.playmatImage) : '') : oppMat || (settings?.playmatImage && settings.playmatBoth ? playmatImageUrl(settings.playmatImage) : '')
  const imgStyle = img ? { ['--mat-img' as string]: `url("${img}")`, ['--mat-dim' as string]: String(settings?.playmatDim ?? 0.35) } : {}
  // lado das pilhas: segue o layout do playmat (Configurações → Magic): grimório à direita por padrão
  const layout = normalizeMatLayout(settings?.matLayout ?? DEFAULT_MAT_LAYOUT)
  const libRow = layout.find((row) => row.includes('library'))
  const pilesLeft = Boolean(libRow && libRow.indexOf('library') < libRow.length / 2)
  const bf = z.battlefield.filter((id) => !state.objects[id].attachedTo)
  const lands = bf.filter((id) => isLandCard(state.objects[id]))
  const others = bf.filter((id) => !isLandCard(state.objects[id]))
  const pool = Object.entries(pl.pool).filter(([, n]) => n > 0)

  const zoneCardMenu = (id: string): MenuItem[] => [
    { header: cardName(state.objects[id].card) },
    { label: t('Para a mão'), onClick: () => act({ t: 'move', id, to: 'hand' }, seat) },
    {
      label: state.objects[id].commander && z.command.includes(id) ? t('Conjurar o comandante (imposto +{n})', { n: 2 * (state.objects[id].commanderCasts ?? 0) }) : t('Para o campo de batalha'),
      onClick: () => act({ t: 'move', id, to: 'battlefield' }, seat)
    },
    { label: t('Para o cemitério'), onClick: () => act({ t: 'move', id, to: 'graveyard' }, seat) },
    { label: t('Exilar'), onClick: () => act({ t: 'move', id, to: 'exile' }, seat) },
    { label: t('Para o topo do grimório'), onClick: () => act({ t: 'move', id, to: 'library', pos: 'top' }, seat) },
    { label: t('Para o fundo do grimório'), onClick: () => act({ t: 'move', id, to: 'library', pos: 'bottom' }, seat) },
    { label: t('Para a zona de comando'), onClick: () => act({ t: 'move', id, to: 'command' }, seat) }
  ]

  const piles = (
    <div className="sb-zones mtg">
      <div className="sb-life" style={{ ['--pc' as string]: pl.color }}>
        <button className="btn xs" onClick={() => act({ t: 'life', player: p, delta: -1 }, seatFor(meta.mySeat))}>
          −
        </button>
        <span className="sb-life-n" title={t('Vida')}>
          {pl.life}
        </span>
        <button className="btn xs" onClick={() => act({ t: 'life', player: p, delta: 1 }, seatFor(meta.mySeat))}>
          +
        </button>
      </div>
      <div className="sb-poison" title={t('Marcadores de veneno (10 = derrota)')}>
        <button className="btn xs" onClick={() => act({ t: 'poison', player: p, delta: -1 }, seatFor(meta.mySeat))}>
          −
        </button>
        <span className={(pl.poison ?? 0) >= 10 ? 'danger' : ''}>☠ {pl.poison ?? 0}</span>
        <button className="btn xs" onClick={() => act({ t: 'poison', player: p, delta: 1 }, seatFor(meta.mySeat))}>
          +
        </button>
      </div>
      {Object.values(state.objects).some((o) => o.commander && o.owner !== p) && (
        <button className="btn xs" onClick={() => useMtgDialog.getState().open({ kind: 'cmdDamage', player: p })} title={t('Dano de comandante recebido (21 do mesmo comandante = derrota)')}>
          ⚔ {t('Cmdr')} {Math.max(0, ...Object.values(pl.commanderDamage ?? {}))}
        </button>
      )}
      <div
        className="sb-zone"
        {...(mine ? { 'data-my-deck': '1' } : {})}
        onClick={(e) =>
          controllable &&
          openMenu(e.clientX, e.clientY, [
            { header: t('Grimório') },
            { label: t('Comprar 1 carta'), onClick: () => act({ t: 'draw', n: 1 }, seat) },
            { label: t('Procurar no grimório…'), onClick: () => setViewer('library') },
            { label: t('Olhar as cartas do topo…'), onClick: () => useMtgDialog.getState().open({ kind: 'lookTop', player: p, seat }) },
            { label: t('Embaralhar'), onClick: () => act({ t: 'shuffle', zone: 'library' }, seat) },
            { label: t('Mulligan (embaralhar a mão e comprar 7)'), onClick: () => confirm(t('Fazer mulligan?')) && act({ t: 'mulligan' }, seat) },
            ...(z.library.length
              ? [
                  { label: t('Moer 1 (topo para o cemitério)'), onClick: () => act({ t: 'move', id: z.library[0], to: 'graveyard' }, seat) },
                  { label: t('Exilar a carta do topo'), onClick: () => act({ t: 'move', id: z.library[0], to: 'exile' }, seat) }
                ]
              : [])
          ])
        }
      >
        <div className="sb-pile">{z.library.length ? <CardBack /> : <div className="sb-empty" />}</div>
        <span className="small">{t('Grimório: {n}', { n: z.library.length })}</span>
      </div>
      <div className="sb-zone" data-drop={controllable ? `graveyard:${p}` : undefined} onClick={() => setViewer('graveyard')}>
        <div className="sb-pile">{z.graveyard.length ? <ObjCard o={state.objects[z.graveyard[z.graveyard.length - 1]]} /> : <div className="sb-empty" />}</div>
        <span className="small">{t('Cemitério: {n}', { n: z.graveyard.length })}</span>
      </div>
      <div className="sb-zone" data-drop={controllable ? `exile:${p}` : undefined} onClick={() => setViewer('exile')}>
        <span className="small">{t('Exílio: {n}', { n: z.exile.length })}</span>
      </div>
      {z.command.length > 0 && (
        <button className="btn xs" onClick={() => setViewer('command')}>
          {t('Comando: {n}', { n: z.command.length })}
        </button>
      )}
      {(mine || controllable) && (
        <div className="sb-pool" title={t('Mana gerada (some ao passar o turno)')}>
          {pool.length ? pool.map(([c, n]) => (
            <span key={c} className="sb-pool-item" onClick={() => act({ t: 'mana', color: c, delta: -1 }, seat)} title={t('Clique para remover 1')}>
              <ManaCost cost={`{${c}}`} /> {n}
            </span>
          )) : <span className="small muted">{t('Sem mana')}</span>}
          {pool.length > 0 && (
            <button className="btn xs" onClick={() => act({ t: 'manaClear' }, seat)} title={t('Esvaziar')}>
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={`sb-board ${mine ? 'me' : 'opp'} ${state.activePlayer === p && state.winner === null ? 'turn' : ''} ${compact ? 'compact' : ''} ${img ? 'has-image' : ''}`} style={{ ...imgStyle, ['--pc' as string]: pl.color }}>
      {pilesLeft && piles}
      <div className="sb-bf" data-drop={controllable ? `battlefield:${p}` : undefined} onPointerDown={controllable ? (e) => startMarquee(e, p) : undefined}>
        <div className="sb-bf-head">
          <b style={{ color: pl.color }}>{pl.name}</b>
          {state.activePlayer === p && <span className="badge ok">{t('turno')}</span>}
          {controllable && (
            <button className="btn xs" onClick={() => useMtgDialog.getState().open({ kind: 'token', seat })} title={t('Criar ficha')}>
              + {t('Ficha')}
            </button>
          )}
          <span className="small muted">{t('{n} na mão', { n: z.hand.length })}</span>
          {!mine && z.hand.length > 0 && (
            <div className="pkm-opp-hand">
              {z.hand.slice(0, 12).map((id) => (
                <div key={id} className="pkm-mini-back">
                  <CardBack />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sb-bf-row">
          {others.map((id) => (
            <Permanent key={id} id={id} owner={p} />
          ))}
          {!others.length && <span className="small muted sb-bf-empty">{t('Campo de batalha')}</span>}
        </div>
        <div className="sb-bf-row lands">
          {lands.map((id) => (
            <Permanent key={id} id={id} owner={p} />
          ))}
          {!lands.length && <span className="small muted sb-bf-empty">{t('Terrenos')}</span>}
        </div>
      </div>
      {!pilesLeft && piles}
      {viewer && (
        <ZoneViewer
          title={viewer === 'library' ? t('Grimório de {name}', { name: pl.name }) : viewer === 'graveyard' ? t('Cemitério de {name}', { name: pl.name }) : viewer === 'exile' ? t('Exílio de {name}', { name: pl.name }) : t('Zona de comando de {name}', { name: pl.name })}
          ids={viewer === 'graveyard' ? [...z.graveyard].reverse() : z[viewer]}
          onClose={() => {
            if (viewer === 'library' && controllable && confirm(t('Embaralhar o grimório depois de procurar?'))) act({ t: 'shuffle', zone: 'library' }, seat)
            setViewer(null)
          }}
          menuFor={(id) => (controllable ? zoneCardMenu(id) : [{ header: cardName(state.objects[id].card) }])}
          hiddenFor={(id) => viewer === 'library' && !controllable && Boolean(id)}
        />
      )}
    </div>
  )
}

// ---------------- permanente ----------------

function Permanent({ id, owner }: { id: string; owner: number }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const sel = useSbSel((s) => s.sel)
  const openMenu = useMenu((s) => s.open)
  const multiSel = useMultiSel((s) => s.ids.includes(id))
  const o = state.objects[id]
  const seat = seatFor(owner)
  const controllable = owner === meta.mySeat || (!meta.online && !meta.bots.includes(owner))
  const canAttack = controllable && mtgCanAttack(state, owner, id)
  const manaOptions = manaOptionsOf(o)
  const att = attachmentsOf(state, id)
  const isCreature = /\bCreature\b/.test(typeLine(o))
  const c = o.card as GameCard

  const menu = (x: number, y: number) => {
    const items: MenuItem[] = [{ header: cardName(c) }]
    if (controllable && !o.tapped)
      for (const op of manaOptions)
        items.push({
          label: (
            <span>
              {t('Virar para mana')} {op.cost > 0 && <>({t('paga')} <ManaCost cost={`{${op.cost}}`} />) </>}
              <ManaCost cost={op.mana.map((c) => `{${c}}`).join('')} />
            </span>
          ),
          onClick: () => act({ t: 'tapForMana', id, color: op.mana[0], mana: op.mana }, seat)
        })
    items.push({ label: o.tapped ? t('Desvirar') : t('Virar'), onClick: () => act({ t: 'tap', id }, seat) })
    if (isCreature && controllable && state.activePlayer === owner) {
      if (o.attacking) items.push({ label: t('Retirar do ataque'), onClick: () => act({ t: 'attack', id }, seat) })
      else {
        // com mais de um oponente (ou planeswalkers), escolhe quem atacar
        const foes = state.players.filter((pl) => pl.id !== owner && !pl.conceded)
        const walkers = foes.flatMap((pl) => pl.zones.battlefield.filter((x) => /\bPlaneswalker\b/.test(typeLine(state.objects[x]))))
        if (foes.length === 1 && !walkers.length) items.push({ label: `⚔ ${t('Atacar')}`, onClick: () => act({ t: 'attack', id, attackTarget: foes[0].id }, seat) })
        else {
          for (const f of foes) items.push({ label: `⚔ ${t('Atacar {name}', { name: f.name })}`, onClick: () => act({ t: 'attack', id, attackTarget: f.id }, seat) })
          for (const w of walkers) items.push({ label: `⚔ ${t('Atacar o planeswalker {name}', { name: cardName(state.objects[w].card) })}`, onClick: () => act({ t: 'attack', id, attackTarget: w }, seat) })
        }
      }
    }
    if (isCreature && state.activePlayer !== owner) {
      const attackers = Object.values(state.objects).filter((x) => x.attacking)
      for (const a of attackers) items.push({ label: `🛡 ${t('Bloquear {name}', { name: cardName(a.card) })}`, onClick: () => act({ t: 'block', id, attacker: a.id }, seat) })
      if (o.blocking) items.push({ label: t('Retirar bloqueio'), onClick: () => act({ t: 'block', id, attacker: null }, seat) })
    }
    items.push(
      'sep',
      { label: t('+1/+1 marcador'), onClick: () => act({ t: 'counter', id, key: '+1/+1', delta: 1 }, seat) },
      { label: t('−1 marcador +1/+1'), onClick: () => act({ t: 'counter', id, key: '+1/+1', delta: -1 }, seat) },
      { label: t('+1 marcador −1/−1'), onClick: () => act({ t: 'counter', id, key: '-1/-1', delta: 1 }, seat) },
      { label: t('Outro marcador…'), onClick: () => useMtgDialog.getState().open({ kind: 'counter', id, seat }) },
      { label: t('+1 lealdade'), onClick: () => act({ t: 'counter', id, key: 'loyalty', delta: 1 }, seat) },
      { label: t('−1 lealdade'), onClick: () => act({ t: 'counter', id, key: 'loyalty', delta: -1 }, seat) },
      ...(c.faces && c.faces.length > 1 ? [{ label: t('Transformar / virar face'), onClick: () => act({ t: 'flip', id }, seat) }] : []),
      { label: t('Ligar a outra carta…'), onClick: () => useSbSel.getState().set({ kind: 'attach', cardId: id, hint: [], label: t('ligar') }) },
      { label: t('Criar cópia (ficha)'), onClick: () => act({ t: 'token', copyOf: id }, seat) },
      'sep',
      { label: t('Para o cemitério'), onClick: () => act({ t: 'move', id, to: 'graveyard' }, seat) },
      { label: t('Exilar'), onClick: () => act({ t: 'move', id, to: 'exile' }, seat) },
      { label: t('Devolver para a mão'), onClick: () => act({ t: 'move', id, to: 'hand' }, seat) },
      { label: t('Para o topo do grimório'), onClick: () => act({ t: 'move', id, to: 'library', pos: 'top' }, seat) },
      { label: t('Para a zona de comando'), onClick: () => act({ t: 'move', id, to: 'command' }, seat) }
    )
    openMenu(x, y, items)
  }
  const attachedMenu = (a: string, x: number, y: number) =>
    openMenu(x, y, [
      { header: cardName(state.objects[a].card) },
      { label: t('Para o cemitério'), onClick: () => act({ t: 'move', id: a, to: 'graveyard' }, seat) },
      { label: t('Devolver para a mão'), onClick: () => act({ t: 'move', id: a, to: 'hand' }, seat) },
      { label: t('Soltar no campo'), onClick: () => act({ t: 'move', id: a, to: 'battlefield' }, seat) }
    ])

  return (
    <div
      data-obj={id}
      className={`sb-perm ${o.tapped ? 'tapped' : ''} ${canAttack ? 'can-attack' : ''} ${o.attacking ? 'attacking' : ''} ${o.blocking ? 'blocking' : ''} ${sel ? 'targetable' : ''} ${multiSel ? 'multi-sel' : ''}`}
      onClick={(e) => {
        if (sel) {
          act({ t: 'attach', id: sel.cardId, target: id }, seatFor(state.objects[sel.cardId].owner))
          useSbSel.getState().set(null)
          return
        }
        // Ctrl/Shift + clique: põe/tira da seleção múltipla
        if ((e.ctrlKey || e.shiftKey || e.metaKey) && canSelectOn(meta, owner)) {
          useMultiSel.getState().toggle(owner, id)
          return
        }
        // o menu espera um instante: se vier o segundo clique (clique duplo = vira/desvira), ele não abre
        const { clientX: x, clientY: y } = e
        if (permClickTimer) clearTimeout(permClickTimer)
        permClickTimer = setTimeout(() => {
          permClickTimer = null
          menu(x, y)
        }, 230)
      }}
      onDoubleClick={() => {
        if (permClickTimer) clearTimeout(permClickTimer)
        permClickTimer = null
        act({ t: 'tap', id }, seat)
      }}
      {...middleClickDetail(id)}
      onContextMenu={(e) => {
        e.preventDefault()
        menu(e.clientX, e.clientY)
      }}
      onMouseEnter={() => setHover(id)}
      onMouseLeave={() => setHover(null)}
      title={canAttack ? t('Pode atacar · clique duplo: vira/desvira · botão do meio: detalhes') : t('Clique duplo: vira/desvira · botão do meio: detalhes')}
    >
      <div className="sb-perm-card">
        <ObjCard o={o} />
        {Object.entries(o.counters).map(([k, v]) => (
          <span key={k} className="sb-counter" title={k}>
            {k === '+1/+1' ? `+${v}/+${v}` : `${k === 'loyalty' ? '◆' : k} ${v}`}
          </span>
        ))}
        {o.attacking && <span className="sb-flag atk">⚔</span>}
        {o.token && <span className="sb-token-badge">{t('ficha')}</span>}
        {o.blocking && <span className="sb-flag blk">🛡</span>}
      </div>
      {att.length > 0 && (
        <div className="sb-attached">
          {att.map((a) => (
            <div
              key={a}
              className="sb-attached-card"
              onMouseEnter={(e) => {
                e.stopPropagation()
                setHover(a)
              }}
              onClick={(e) => {
                e.stopPropagation()
                attachedMenu(a, e.clientX, e.clientY)
              }}
              {...middleClickDetail(a)}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                attachedMenu(a, e.clientX, e.clientY)
              }}
            >
              <ObjCard o={state.objects[a]} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

let permClickTimer: ReturnType<typeof setTimeout> | null = null

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
  const viewSeat = !meta.online && !meta.bots.includes(state.activePlayer) ? state.activePlayer : p
  const pl = state.players[viewSeat]
  const seat = seatFor(viewSeat)
  useDrawAnimation(pl.zones.hand, state.activePlayer === viewSeat ? String(state.turn) : null, drawAnim)

  const menuFor = (id: string, x: number, y: number) => {
    const o = state.objects[id]
    const tl = typeLine(o)
    const items: MenuItem[] = [{ header: cardName(o.card) }]
    if (/\b(Instant|Sorcery)\b/.test(tl)) items.push({ label: t('Conjurar (vai para o cemitério)'), onClick: () => act({ t: 'move', id, to: 'graveyard', cast: true }, seat) })
    items.push({ label: isLandCard(o) ? t('Jogar terreno') : t('Jogar no campo de batalha'), onClick: () => act({ t: 'move', id, to: 'battlefield' }, seat) })
    if (/\b(Aura|Equipment)\b/.test(tl)) items.push({ label: t('Jogar ligada a uma carta…'), onClick: () => useSbSel.getState().set({ kind: 'attach', cardId: id, hint: [], label: t('ligar') }) })
    items.push(
      'sep',
      { label: t('Descartar'), onClick: () => act({ t: 'move', id, to: 'graveyard' }, seat) },
      { label: t('Exilar'), onClick: () => act({ t: 'move', id, to: 'exile' }, seat) },
      { label: t('Para o topo do grimório'), onClick: () => act({ t: 'move', id, to: 'library', pos: 'top' }, seat) },
      { label: t('Para o fundo do grimório'), onClick: () => act({ t: 'move', id, to: 'library', pos: 'bottom' }, seat) }
    )
    openMenu(x, y - 160, items)
  }

  const onDrop = (id: string, el: HTMLElement | null) => {
    const objEl = el?.closest('[data-obj]') as HTMLElement | null
    if (objEl) {
      act({ t: 'attach', id, target: objEl.dataset.obj! }, seat)
      return
    }
    const zone = (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop?.split(':')[0]
    // instantâneo/feitiço solto no campo = conjurar (vai para o cemitério gastando a mana); no cemitério = descartar
    if (zone === 'battlefield' && /\b(Instant|Sorcery)\b/.test(typeLine(state.objects[id]))) act({ t: 'move', id, to: 'graveyard', cast: true }, seat)
    else if (zone === 'battlefield' || zone === 'graveyard' || zone === 'exile') act({ t: 'move', id, to: zone }, seat)
  }

  return (
    <div className={`sb-hand ${dragId ? 'holding' : ''}`}>
      {pl.zones.hand.map((id) => (
        <div
          key={id}
          data-hand-id={id}
          className={`sb-hand-card ${mtgPlayable(state, viewSeat, id) ? 'playable' : ''} ${dragId === id ? 'lifted' : ''}`}
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


// ---------------- mão inicial (manter / mulligan) ----------------

/** Janela da mão inicial: todos decidem ao mesmo tempo (no modo "dois lados", um jogador de cada vez). */
function MulliganModal() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const [picked, setPicked] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)
  // quem decide nesta tela: eu; no modo "dois lados", o primeiro jogador que ainda não manteve
  const seat = meta.online || meta.bots.length ? meta.mySeat : state.players.find((pl) => !pl.kept && !pl.conceded)?.id ?? meta.mySeat
  const pl = state.players[seat]
  const key = `${seat}-${pl?.mulligans ?? 0}`
  useEffect(() => {
    setPicked([])
    setChoosing(false)
  }, [key])
  if (state.step !== 'mulligan' || !pl || pl.kept || pl.conceded) return null
  const need = mulliganBottomCount(state, seat)
  const lands = pl.zones.hand.filter((id) => isLandCard(state.objects[id])).length
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < need ? [...p, id] : p))
  const free = state.freeMulligan && (pl.mulligans ?? 0) === 0
  return (
    <div className="overlay-center">
      <div className="modal" style={{ width: 'min(1180px, 96vw)' }}>
        <div className="modal-head">
          <h3>
            {choosing
              ? t('Escolha {n} carta(s) para o fundo do grimório', { n: need })
              : seat === meta.mySeat
                ? (pl.mulligans ?? 0)
                  ? t('Sua mão inicial (após {n} mulligan(s))', { n: pl.mulligans ?? 0 })
                  : t('Sua mão inicial')
                : (pl.mulligans ?? 0)
                  ? t('Mão inicial de {name} (após {n} mulligan(s))', { name: pl.name, n: pl.mulligans ?? 0 })
                  : t('Mão inicial de {name}', { name: pl.name })}
          </h3>
        </div>
        <div className="modal-body">
          <div className="small muted" style={{ marginBottom: 8 }}>
            {t('{n} terreno(s) na mão.', { n: lands })} {state.players[state.activePlayer].name === pl.name ? t('Você começa a partida.') : t('{name} começa a partida.', { name: state.players[state.activePlayer].name })}{' '}
            {free ? t('O primeiro mulligan é grátis (Commander).') : need > 0 && !choosing ? t('Ao manter, você põe {n} carta(s) no fundo do grimório.', { n: need }) : ''}
          </div>
          <div className="sb-mull-cards">
            {pl.zones.hand.map((id) => (
              <div
                key={id}
                className={`sb-mull-card ${picked.includes(id) ? 'picked' : ''} ${choosing ? 'selectable' : ''}`}
                onClick={() => choosing && toggle(id)}
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
              >
                <ObjCard o={state.objects[id]} quality="high" />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          {choosing ? (
            <>
              <span className="small muted grow">{t('Selecionadas: {n}/{max}', { n: picked.length, max: need })}</span>
              <button className="btn" onClick={() => setChoosing(false)}>
                {t('Voltar')}
              </button>
              <button className="btn primary" disabled={picked.length !== Math.min(need, pl.zones.hand.length)} onClick={() => act({ t: 'keep', bottom: picked }, seat)}>
                {t('Manter')}
              </button>
            </>
          ) : (
            <>
              <span className="grow" />
              <button className="btn" disabled={(pl.mulligans ?? 0) >= 6} onClick={() => act({ t: 'mulligan' }, seat)}>
                ↻ {t('Mulligan')}
              </button>
              <button className="btn primary" onClick={() => (need > 0 ? setChoosing(true) : act({ t: 'keep', bottom: [] }, seat))}>
                ✓ {t('Manter')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------- janelas: ficha, marcador, olhar o topo, dano de comandante ----------------

type MtgDialog =
  | { kind: 'token'; seat: number }
  | { kind: 'counter'; id: string; seat: number }
  | { kind: 'lookTop'; player: number; seat: number }
  | { kind: 'cmdDamage'; player: number }
  | null
const useMtgDialog = create<{ dialog: MtgDialog; open: (d: MtgDialog) => void }>((set) => ({ dialog: null, open: (dialog) => set({ dialog }) }))

function MtgDialogs() {
  const dialog = useMtgDialog((s) => s.dialog)
  const close = () => useMtgDialog.getState().open(null)
  if (!dialog) return null
  if (dialog.kind === 'token') return <TokenDialog seat={dialog.seat} onClose={close} />
  if (dialog.kind === 'counter') return <CounterDialog id={dialog.id} seat={dialog.seat} onClose={close} />
  if (dialog.kind === 'lookTop') return <LookTopDialog player={dialog.player} seat={dialog.seat} onClose={close} />
  return <CmdDamageDialog player={dialog.player} onClose={close} />
}

function TokenDialog({ seat, onClose }: { seat: number; onClose: () => void }) {
  const act = useSandbox((s) => s.act)
  const [name, setName] = useState('')
  const [typesEdited, setTypesEdited] = useState('')
  // enquanto o jogador não mexer no tipo, ele acompanha o nome (ficha "Goblin" = Creature — Goblin)
  const types = typesEdited || `Creature — ${name.trim() || 'Soldier'}`
  const setTypes = (v: string) => setTypesEdited(v || ' ')
  const [pw, setPw] = useState('1')
  const [tg, setTg] = useState('1')
  const [text, setText] = useState('')
  const [count, setCount] = useState(1)
  const creature = /\bCreature\b/i.test(types)
  return (
    <Modal
      title={t('Criar ficha')}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              act({ t: 'token', name, types: types.trim() || 'Creature', power: creature ? pw : undefined, toughness: creature ? tg : undefined, text, count }, seat)
              onClose()
            }}
          >
            {t('Criar')}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 8 }}>
        <label className="field">
          {t('Nome')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Ex.: Soldado, Tesouro, Zumbi')} autoFocus />
        </label>
        <label className="field">
          {t('Tipo')}
          <input value={types.trim() ? types : ''} onChange={(e) => setTypes(e.target.value)} placeholder="Creature — Soldier / Artifact — Treasure" />
        </label>
        {creature && (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {t('Poder/Resistência')}
            <input value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: 60 }} />/
            <input value={tg} onChange={(e) => setTg(e.target.value)} style={{ width: 60 }} />
          </div>
        )}
        <label className="field">
          {t('Texto (opcional)')}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Ex.: Voar; {T}, sacrifique: adicione uma mana de qualquer cor')} />
        </label>
        <label className="field" style={{ maxWidth: 120 }}>
          {t('Quantidade')}
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} />
        </label>
      </div>
    </Modal>
  )
}

function CounterDialog({ id, seat, onClose }: { id: string; seat: number; onClose: () => void }) {
  const act = useSandbox((s) => s.act)
  const [key, setKey] = useState('')
  const [delta, setDelta] = useState(1)
  return (
    <Modal
      title={t('Outro marcador')}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="btn primary"
            disabled={!key.trim()}
            onClick={() => {
              act({ t: 'counter', id, key: key.trim().slice(0, 20), delta }, seat)
              onClose()
            }}
          >
            {t('Aplicar')}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 8 }}>
        <label className="field">
          {t('Tipo de marcador')}
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('Ex.: carga, tempo, escudo, estudo')} autoFocus />
        </label>
        <label className="field" style={{ maxWidth: 140 }}>
          {t('Quantidade (negativo remove)')}
          <input type="number" value={delta} onChange={(e) => setDelta(parseInt(e.target.value, 10) || 0)} />
        </label>
      </div>
    </Modal>
  )
}

/** Olhar as N cartas do topo: só o dono vê; cada carta vai para o topo, o fundo, a mão, o cemitério ou o exílio. */
function LookTopDialog({ player, seat, onClose }: { player: number; seat: number; onClose: () => void }) {
  const state = useSandbox((s) => s.state)!
  const act = useSandbox((s) => s.act)
  const setHover = useSandbox((s) => s.setHover)
  const openMenu = useMenu((s) => s.open)
  const [n, setN] = useState(0)
  const [ids, setIds] = useState<string[]>([])
  const lib = state.players[player].zones.library
  const start = (k: number) => {
    setN(k)
    setIds(lib.slice(0, k))
    act({ t: 'lookTop', n: k }, seat)
  }
  const visible = ids.filter((id) => lib.includes(id) && lib.indexOf(id) < Math.max(n, ids.length) + 5)
  const lookMenu = (id: string, x: number, y: number) =>
    openMenu(x, y, [
      { header: cardName(state.objects[id].card) },
      { label: t('Deixar no topo (vai para o topo)'), onClick: () => send(id, 'library', 'top') },
      { label: t('Para o fundo do grimório'), onClick: () => send(id, 'library', 'bottom') },
      { label: t('Para a mão'), onClick: () => send(id, 'hand') },
      { label: t('Para o cemitério'), onClick: () => send(id, 'graveyard') },
      { label: t('Exilar'), onClick: () => send(id, 'exile') }
    ])
  const send = (id: string, to: 'library' | 'graveyard' | 'hand' | 'exile', pos?: 'top' | 'bottom') => act({ t: 'move', id, to, pos }, seat)
  return (
    <Modal title={n ? t('Topo do grimório ({n})', { n }) : t('Olhar as cartas do topo')} onClose={onClose} width={900}>
      {!n ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5, 6, 7, 10].map((k) => (
            <button key={k} className="btn" onClick={() => start(k)}>
              {k}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            {t('Clique numa carta para decidir para onde ela vai. As que ficarem continuam no topo, nesta ordem (a primeira é o topo).')}
          </div>
          <div className="sb-viewer">
            {visible.map((id) => (
              <div
                key={id}
                className="sb-viewer-card"
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => lookMenu(id, e.clientX, e.clientY)}
                {...middleClickDetail(id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  lookMenu(id, e.clientX, e.clientY)
                }}
              >
                <ObjCard o={state.objects[id]} />
                <span className="small muted">#{lib.indexOf(id) + 1}</span>
              </div>
            ))}
            {!visible.length && <span className="small muted">{t('Nenhuma carta (todas foram movidas).')}</span>}
          </div>
        </>
      )}
    </Modal>
  )
}

function CmdDamageDialog({ player, onClose }: { player: number; onClose: () => void }) {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const pl = state.players[player]
  const commanders = Object.values(state.objects).filter((o) => o.commander && o.owner !== player)
  return (
    <Modal title={t('Dano de comandante em {name}', { name: pl.name })} onClose={onClose} width={520}>
      <div className="col" style={{ gap: 8 }}>
        {commanders.map((c) => {
          const n = pl.commanderDamage?.[c.id] ?? 0
          return (
            <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="grow">
                {cardName(c.card)} <span className="muted small">({state.players[c.owner].name})</span>
              </span>
              <button className="btn xs" onClick={() => act({ t: 'commanderDamage', player, source: c.id, delta: -1 }, seatFor(meta.mySeat))}>
                −1
              </button>
              <b className={n >= 21 ? 'danger' : ''} style={{ minWidth: 30, textAlign: 'center' }}>
                {n}
              </b>
              <button className="btn xs" onClick={() => act({ t: 'commanderDamage', player, source: c.id, delta: 1 }, seatFor(meta.mySeat))}>
                +1
              </button>
            </div>
          )
        })}
        <div className="small muted">{t('O dano de comandante também tira vida. 21 ou mais do mesmo comandante = derrota.')}</div>
      </div>
    </Modal>
  )
}
