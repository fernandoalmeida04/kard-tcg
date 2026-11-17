// Magic: seleção de várias permanentes (clicar e arrastar no campo, ou Ctrl/Shift + clique) e uma barra
// com ações em grupo — virar terrenos para mana de uma vez, virar/desvirar, atacar, mover.
import { create } from 'zustand'
import { cardName, type SState } from '@shared/sandbox'
import { manaOptionsOf } from '@shared/sandbox/mana'
import { t } from '@shared/i18n'
import { ManaCost } from '../components/common'
import { useSandbox, type SandboxMeta } from './sandboxStore'

interface MultiSel {
  ids: string[]
  owner: number | null
  rect: { x1: number; y1: number; x2: number; y2: number } | null
  set: (owner: number, ids: string[]) => void
  toggle: (owner: number, id: string) => void
  clear: () => void
}

export const useMultiSel = create<MultiSel>((set, get) => ({
  ids: [],
  owner: null,
  rect: null,
  set: (owner, ids) => set({ owner, ids }),
  toggle: (owner, id) => {
    const cur = get().owner === owner ? get().ids : []
    set({ owner, ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },
  clear: () => set({ ids: [], owner: null })
}))

/** Assento que faz as jogadas pelas cartas de `owner` (igual ao resto da mesa). */
function seatOf(meta: SandboxMeta, owner: number): number {
  return meta.online || meta.bots.includes(owner) ? meta.mySeat : owner
}

export function canSelectOn(meta: SandboxMeta, owner: number): boolean {
  return owner === meta.mySeat || (!meta.online && !meta.bots.includes(owner))
}

/** Começa o retângulo de seleção ao apertar num espaço vazio do campo de batalha de `owner`. */
export function startMarquee(e: React.PointerEvent<HTMLElement>, owner: number): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('.sb-perm, button, input, select, .pkm-opp-hand')) return
  const area = e.currentTarget
  const additive = e.ctrlKey || e.shiftKey || e.metaKey
  const base = additive && useMultiSel.getState().owner === owner ? useMultiSel.getState().ids : []
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const pick = (x2: number, y2: number) => {
    const l = Math.min(sx, x2)
    const r = Math.max(sx, x2)
    const tp = Math.min(sy, y2)
    const b = Math.max(sy, y2)
    const hit: string[] = []
    area.querySelectorAll<HTMLElement>('.sb-perm[data-obj]').forEach((el) => {
      const bx = el.getBoundingClientRect()
      if (bx.right >= l && bx.left <= r && bx.bottom >= tp && bx.top <= b) hit.push(el.dataset.obj!)
    })
    return [...new Set([...base, ...hit])]
  }
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
    moved = true
    useMultiSel.setState({ rect: { x1: sx, y1: sy, x2: ev.clientX, y2: ev.clientY }, owner, ids: pick(ev.clientX, ev.clientY) })
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (moved) useMultiSel.setState({ rect: null, owner, ids: pick(ev.clientX, ev.clientY) })
    else if (!additive) useMultiSel.getState().clear()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** O retângulo desenhado enquanto arrasta. */
export function Marquee() {
  const r = useMultiSel((s) => s.rect)
  if (!r) return null
  return <div className="sb-marquee" style={{ left: Math.min(r.x1, r.x2), top: Math.min(r.y1, r.y2), width: Math.abs(r.x2 - r.x1), height: Math.abs(r.y2 - r.y1) }} />
}

/** Seleção válida agora (as cartas ainda estão no campo daquele jogador). */
function liveIds(state: SState, owner: number | null, ids: string[]): string[] {
  if (owner === null) return []
  const bf = state.players[owner]?.zones.battlefield ?? []
  return ids.filter((id) => bf.includes(id))
}

/** Barra de ações em grupo para as permanentes selecionadas. */
export function MultiSelBar() {
  const state = useSandbox((s) => s.state)!
  const meta = useSandbox((s) => s.meta)!
  const act = useSandbox((s) => s.act)
  const { ids: raw, owner, clear } = useMultiSel()
  const ids = liveIds(state, owner, raw)
  if (owner === null || ids.length < 1) return null
  const seat = seatOf(meta, owner)
  const objs = ids.map((id) => state.objects[id])
  // mana: só permanentes desviradas com habilidade de mana sem custo
  const manaSources = objs.filter((o) => !o.tapped && manaOptionsOf(o).some((x) => x.cost === 0))
  const colors = [...new Set(manaSources.flatMap((o) => manaOptionsOf(o).filter((x) => x.cost === 0).flatMap((x) => x.mana)))]
  const creatures = objs.filter((o) => !o.tapped && !o.attacking && 'typeLine' in o.card && /\bCreature\b/.test(o.card.typeLine))
  const foes = state.players.filter((pl) => pl.id !== owner && !pl.conceded)

  const run = (fn: (id: string) => boolean | void, list = ids) => {
    for (const id of list) if (fn(id) === false) break
    clear()
  }
  const tapMana = (prefer?: string) =>
    run((id) => {
      const opts = manaOptionsOf(state.objects[id]).filter((x) => x.cost === 0)
      const op = (prefer && opts.find((x) => x.mana.includes(prefer))) || opts[0]
      return act({ t: 'tapForMana', id, color: op.mana[0], mana: op.mana }, seat)
    }, manaSources.map((o) => o.id))
  const total = manaSources.reduce((n, o) => n + (manaOptionsOf(o).find((x) => x.cost === 0)?.mana.length ?? 0), 0)

  return (
    <div className="sb-multibar">
      <b>{t('{n} selecionada(s)', { n: ids.length })}</b>
      {manaSources.length > 0 && (
        <>
          <button className="btn sm primary" onClick={() => tapMana()} title={objs.map((o) => cardName(o.card)).join(', ')}>
            ⚡ {t('Virar para mana ({n})', { n: total })}
          </button>
          {colors.length > 1 &&
            colors.map((c) => (
              <button key={c} className="btn sm" onClick={() => tapMana(c)} title={t('Virar priorizando esta cor')}>
                <ManaCost cost={`{${c}}`} />
              </button>
            ))}
        </>
      )}
      <button className="btn sm" onClick={() => run((id) => (state.objects[id].tapped ? undefined : act({ t: 'tap', id }, seat)))}>
        {t('Virar')}
      </button>
      <button className="btn sm" onClick={() => run((id) => (state.objects[id].tapped ? act({ t: 'tap', id }, seat) : undefined))}>
        {t('Desvirar')}
      </button>
      {creatures.length > 0 &&
        foes.map((f) => (
          <button key={f.id} className="btn sm" onClick={() => run((id) => act({ t: 'attack', id, attackTarget: f.id }, seat), creatures.map((o) => o.id))}>
            ⚔ {foes.length > 1 ? t('Atacar {name}', { name: f.name }) : t('Atacar')} ({creatures.length})
          </button>
        ))}
      <span className="sb-multibar-sep" />
      <button className="btn sm" onClick={() => run((id) => act({ t: 'move', id, to: 'graveyard' }, seat))}>
        {t('Cemitério')}
      </button>
      <button className="btn sm" onClick={() => run((id) => act({ t: 'move', id, to: 'exile' }, seat))}>
        {t('Exilar')}
      </button>
      <button className="btn sm" onClick={() => run((id) => act({ t: 'move', id, to: 'hand' }, seat))}>
        {t('Mão')}
      </button>
      <button className="btn sm ghost" onClick={clear} title={t('Limpar seleção (Esc)')}>
        ✕
      </button>
    </div>
  )
}
