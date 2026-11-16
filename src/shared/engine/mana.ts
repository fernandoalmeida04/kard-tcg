// Custos de mana e pagamento automático (escolhe quais fontes virar).

import type { ManaPool } from './types.ts'

export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const

export interface Req {
  opts: string[]
  phyrexian?: boolean
  genericAlt?: number
}

export interface ParsedCost {
  generic: number
  x: number
  reqs: Req[]
}

export function parseManaCost(cost: string): ParsedCost {
  const out: ParsedCost = { generic: 0, x: 0, reqs: [] }
  const syms = cost.match(/\{[^}]+\}/g) ?? []
  for (const raw of syms) {
    const s = raw.slice(1, -1).toUpperCase()
    if (/^\d+$/.test(s)) out.generic += parseInt(s, 10)
    else if (s === 'X') out.x++
    else if (s === 'Y' || s === 'Z') continue
    else if (s === 'S') out.generic++
    else if (/^[WUBRGC]$/.test(s)) out.reqs.push({ opts: [s] })
    else if (/^2\/[WUBRG]$/.test(s)) out.reqs.push({ opts: [s[2]], genericAlt: 2 })
    else if (/^[WUBRG]\/P$/.test(s)) out.reqs.push({ opts: [s[0]], phyrexian: true })
    else if (/^[WUBRG]\/[WUBRG]\/P$/.test(s)) out.reqs.push({ opts: [s[0], s[2]], phyrexian: true })
    else if (/^[WUBRGC]\/[WUBRG]$/.test(s)) out.reqs.push({ opts: [s[0], s[2]] })
  }
  return out
}

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
}

export function poolTotal(p: ManaPool): number {
  return p.W + p.U + p.B + p.R + p.G + p.C
}

export interface ManaSourceInfo {
  id: string
  units: string[][]
  sacrifice: boolean
  life: number
  /** Menor = usar primeiro. */
  priority: number
}

export interface PaymentPlan {
  tap: string[]
  sacrifice: string[]
  life: number
  produced: ManaPool
  consumed: ManaPool
}

interface Atom {
  key: string
  src: string
  unit: number
  opts: string[]
}

interface St {
  tapped: string[]
  used: Record<string, string> // atomKey -> cor consumida
  life: number
  extraGeneric: number
}

/**
 * Procura um jeito de pagar o custo com a reserva de mana + fontes disponíveis.
 * Retorna null se não for possível.
 */
export function planPayment(
  cost: ParsedCost,
  x: number,
  extraGeneric: number,
  pool: ManaPool,
  sources: ManaSourceInfo[],
  lifeTotal: number
): PaymentPlan | null {
  const reqs = [...cost.reqs].sort((a, b) => a.opts.length - b.opts.length || Number(Boolean(a.phyrexian)) - Number(Boolean(b.phyrexian)))
  const poolAtoms: Atom[] = []
  for (const c of MANA_COLORS) {
    for (let i = 0; i < pool[c]; i++) poolAtoms.push({ key: `pool:${c}:${i}`, src: 'pool', unit: i, opts: [c] })
  }
  const srcs = [...sources].sort((a, b) => a.priority - b.priority)
  const byId = new Map(srcs.map((s) => [s.id, s]))
  let iterations = 0

  const available = (st: St): Atom[] => {
    const out: Atom[] = poolAtoms.filter((a) => !(a.key in st.used))
    for (const id of st.tapped) {
      const s = byId.get(id)!
      s.units.forEach((opts, k) => {
        const key = `${id}:${k}`
        if (!(key in st.used)) out.push({ key, src: id, unit: k, opts })
      })
    }
    return out
  }

  const finish = (st: St): PaymentPlan | null => {
    let need = cost.generic + cost.x * x + extraGeneric + st.extraGeneric
    const used = { ...st.used }
    const tapped = [...st.tapped]
    const avail = available(st)
    // usa primeiro mana da reserva, depois unidades de fontes já viradas
    for (const a of avail) {
      if (need <= 0) break
      used[a.key] = a.opts.includes('C') ? 'C' : a.opts[0]
      need--
    }
    for (const s of srcs) {
      if (need <= 0) break
      if (tapped.includes(s.id)) continue
      tapped.push(s.id)
      s.units.forEach((opts, k) => {
        if (need > 0) {
          used[`${s.id}:${k}`] = opts.includes('C') ? 'C' : opts[0]
          need--
        }
      })
    }
    if (need > 0) return null
    const produced = emptyPool()
    const consumed = emptyPool()
    for (const id of tapped) {
      const s = byId.get(id)!
      s.units.forEach((opts, k) => {
        const key = `${id}:${k}`
        const color = (used[key] ?? (opts.includes('C') ? 'C' : opts[0])) as keyof ManaPool
        produced[color]++
      })
    }
    for (const [key, color] of Object.entries(used)) {
      void key
      consumed[color as keyof ManaPool]++
    }
    return {
      tap: tapped,
      sacrifice: tapped.filter((id) => byId.get(id)!.sacrifice),
      life: st.life + tapped.reduce((s, id) => s + byId.get(id)!.life, 0),
      produced,
      consumed
    }
  }

  const rec = (i: number, st: St): PaymentPlan | null => {
    if (++iterations > 4000) return null
    if (i === reqs.length) return finish(st)
    const r = reqs[i]
    // 1) mana já disponível (reserva ou fontes viradas)
    for (const a of available(st)) {
      const col = a.opts.find((o) => r.opts.includes(o))
      if (!col) continue
      const res = rec(i + 1, { ...st, used: { ...st.used, [a.key]: col } })
      if (res) return res
    }
    // 2) virar uma nova fonte
    for (const s of srcs) {
      if (st.tapped.includes(s.id)) continue
      const k = s.units.findIndex((opts) => opts.some((o) => r.opts.includes(o)))
      if (k < 0) continue
      const col = s.units[k].find((o) => r.opts.includes(o))!
      const res = rec(i + 1, { ...st, tapped: [...st.tapped, s.id], used: { ...st.used, [`${s.id}:${k}`]: col } })
      if (res) return res
    }
    // 3) alternativas: phyrexiana (2 de vida) ou híbrida {2/C}
    if (r.phyrexian && lifeTotal - st.life > 2) {
      const res = rec(i + 1, { ...st, life: st.life + 2 })
      if (res) return res
    }
    if (r.genericAlt) {
      const res = rec(i + 1, { ...st, extraGeneric: st.extraGeneric + r.genericAlt })
      if (res) return res
    }
    return null
  }

  return rec(0, { tapped: [], used: {}, life: 0, extraGeneric: 0 })
}

export function totalAvailable(pool: ManaPool, sources: ManaSourceInfo[]): number {
  return poolTotal(pool) + sources.reduce((s, src) => s + src.units.length, 0)
}

export function costSymbols(cost: string): string[] {
  return (cost.match(/\{[^}]+\}/g) ?? []).map((s) => s.slice(1, -1))
}
