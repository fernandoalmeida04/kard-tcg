// Zonas do campo de batalha (layout personalizável nas configurações).

export type BoardZone = 'commanders' | 'creatures' | 'planeswalkers' | 'artifacts' | 'enchantments' | 'others' | 'lands'

/** Linhas do campo, da mais próxima do centro da mesa para a mais distante; cada linha lista as zonas da esquerda para a direita. */
export type BoardLayout = BoardZone[][]

export const BOARD_ZONES: BoardZone[] = ['commanders', 'creatures', 'planeswalkers', 'artifacts', 'enchantments', 'others', 'lands']

export const ZONE_LABEL: Record<BoardZone, string> = {
  commanders: 'Comandantes',
  creatures: 'Criaturas',
  planeswalkers: 'Planeswalkers',
  artifacts: 'Artefatos',
  enchantments: 'Encantamentos',
  others: 'Outros (batalhas…)',
  lands: 'Terrenos'
}

export const ZONE_ICON: Record<BoardZone, string> = {
  commanders: '👑',
  creatures: '🐉',
  planeswalkers: '✦',
  artifacts: '⚙',
  enchantments: '✧',
  others: '◈',
  lands: '⛰'
}

export const MAX_BOARD_ROWS = 4

/** Subzonas organizáveis dentro da área "Battlefield" (terrenos têm área própria no playmat). */
export const BATTLEFIELD_SUBZONES: BoardZone[] = BOARD_ZONES.filter((z) => z !== 'lands')

export const DEFAULT_BOARD_LAYOUT: BoardLayout = [
  ['commanders', 'creatures', 'planeswalkers'],
  ['artifacts', 'enchantments', 'others']
]

/** Garante que toda subzona do Battlefield aparece exatamente uma vez e que não há linhas vazias. */
export function normalizeBoardLayout(layout: unknown): BoardLayout {
  if (!Array.isArray(layout)) return DEFAULT_BOARD_LAYOUT.map((r) => [...r])
  const seen = new Set<BoardZone>()
  const rows: BoardLayout = []
  for (const row of layout.slice(0, MAX_BOARD_ROWS)) {
    if (!Array.isArray(row)) continue
    const clean = row.filter((z): z is BoardZone => BATTLEFIELD_SUBZONES.includes(z) && !seen.has(z))
    clean.forEach((z) => seen.add(z))
    if (clean.length) rows.push(clean)
  }
  const missing = BATTLEFIELD_SUBZONES.filter((z) => !seen.has(z))
  if (missing.length) {
    if (!rows.length) rows.push([])
    rows[rows.length - 1].push(...missing)
  }
  return rows
}

// ---------------- Playmat: posição das áreas de cada jogador ----------------

export type MatZone = 'battlefield' | 'lands' | 'tax' | 'command' | 'library' | 'exile' | 'life' | 'graveyard'

/** Grade de 4 linhas × 3 colunas; cada célula diz qual área ocupa aquele espaço (áreas são retângulos). */
export type MatLayout = MatZone[][]

export const MAT_ROWS = 4
export const MAT_COLS = 3

export const MAT_ZONES: MatZone[] = ['battlefield', 'lands', 'tax', 'command', 'library', 'exile', 'life', 'graveyard']

export const MAT_LABEL: Record<MatZone, string> = {
  battlefield: 'Campo de batalha',
  lands: 'Terrenos',
  tax: 'Imposto do comandante',
  command: 'Zona de comando',
  library: 'Grimório',
  exile: 'Exílio',
  life: 'Vida',
  graveyard: 'Cemitério'
}

export const MAT_ICON: Record<MatZone, string> = {
  battlefield: '⚔',
  lands: '⛰',
  tax: '＋',
  command: '👑',
  library: '📚',
  exile: '⛔',
  life: '❤',
  graveyard: '🪦'
}

/** Igual ao playmat de referência: battlefield grande, terrenos embaixo, colunas laterais à direita. */
export const DEFAULT_MAT_LAYOUT: MatLayout = [
  ['battlefield', 'tax', 'life'],
  ['battlefield', 'command', 'life'],
  ['battlefield', 'library', 'graveyard'],
  ['lands', 'exile', 'graveyard']
]

export const MAT_PRESETS: { id: string; name: string; layout: MatLayout }[] = [
  { id: 'right', name: 'Laterais à direita (padrão)', layout: DEFAULT_MAT_LAYOUT },
  { id: 'left', name: 'Laterais à esquerda', layout: mirrorMat(DEFAULT_MAT_LAYOUT) },
  {
    id: 'split',
    name: 'Uma coluna de cada lado',
    layout: [
      ['life', 'battlefield', 'tax'],
      ['life', 'battlefield', 'command'],
      ['graveyard', 'battlefield', 'library'],
      ['graveyard', 'lands', 'exile']
    ]
  },
  {
    id: 'landsTop',
    name: 'Terrenos em cima',
    layout: [
      ['lands', 'tax', 'life'],
      ['battlefield', 'command', 'life'],
      ['battlefield', 'library', 'graveyard'],
      ['battlefield', 'exile', 'graveyard']
    ]
  }
]

export function cloneMat(l: MatLayout): MatLayout {
  return l.map((r) => [...r])
}

export function mirrorMat(l: MatLayout): MatLayout {
  return l.map((r) => [...r].reverse())
}

/** Altura fixa (em linhas da grade) de cada área; todas ocupam 1 coluna. */
export const MAT_HEIGHT: Record<MatZone, number> = {
  battlefield: 3,
  lands: 1,
  tax: 1,
  command: 1,
  library: 1,
  exile: 1,
  life: 2,
  graveyard: 2
}

/** Áreas largas: ficam juntas na coluna principal (larga); as outras ficam nas colunas laterais (estreitas). */
const WIDE: MatZone[] = ['battlefield', 'lands']

interface Rect {
  col: number
  top: number
  h: number
}

function rectOf(l: MatLayout, z: MatZone): Rect | null {
  let col = -1
  let top = -1
  let h = 0
  l.forEach((r, ri) =>
    r.forEach((x, ci) => {
      if (x !== z) return
      if (col === -1) {
        col = ci
        top = ri
      }
      h++
    })
  )
  return col === -1 ? null : { col, top, h }
}

function getCol(l: MatLayout, c: number): MatZone[] {
  return l.map((r) => r[c])
}

function setCol(l: MatLayout, c: number, col: MatZone[]): void {
  col.forEach((z, ri) => (l[ri][c] = z))
}

/** A faixa [from, to] da coluna só contém áreas inteiras (nenhuma área atravessa as bordas)? */
function cleanSegment(l: MatLayout, c: number, from: number, to: number): boolean {
  const col = getCol(l, c)
  return (from === 0 || col[from - 1] !== col[from]) && (to === MAT_ROWS - 1 || col[to + 1] !== col[to])
}

/**
 * Troca duas áreas de lugar mantendo o tamanho de cada uma. Retorna null se não houver como sem mudar tamanhos.
 * - mesmo tamanho: trocam de lugar;
 * - mesma coluna, encostadas: invertem a ordem (ex.: terrenos acima do campo de batalha);
 * - colunas diferentes: troca a faixa de linhas de uma pela faixa equivalente da outra coluna
 *   (ex.: vida ⇄ imposto + zona de comando).
 */
export function swapMatZones(l: MatLayout, a: MatZone, b: MatZone): MatLayout | null {
  if (a === b) return cloneMat(l)
  const ra = rectOf(l, a)
  const rb = rectOf(l, b)
  if (!ra || !rb) return null
  // área larga só troca com área larga (e estreita com estreita), senão mudaria a largura
  if (WIDE.includes(a) !== WIDE.includes(b)) return null
  const out = cloneMat(l)
  // mesmo tamanho (todas têm 1 coluna): basta trocar os rótulos
  if (ra.h === rb.h) return out.map((r) => r.map((z) => (z === a ? b : z === b ? a : z)))
  if (ra.col === rb.col) {
    const [first, second] = ra.top < rb.top ? [ra, rb] : [rb, ra]
    if (first.top + first.h !== second.top) return null // só encostadas
    const col = getCol(out, ra.col)
    const seg = col.slice(first.top, second.top + second.h)
    const firstZone = col[first.top]
    const reordered = [...seg.filter((z) => z !== firstZone), ...seg.filter((z) => z === firstZone)]
    col.splice(first.top, seg.length, ...reordered)
    setCol(out, ra.col, col)
    return out
  }
  // colunas diferentes: tenta a faixa de A na coluna de B, depois a de B na coluna de A
  for (const [src, dst, other] of [
    [ra, rb, b],
    [rb, ra, a]
  ] as const) {
    const from = src.top
    const to = src.top + src.h - 1
    const inDst = getCol(out, dst.col).slice(from, to + 1)
    if (!inDst.includes(other) || !cleanSegment(out, dst.col, from, to)) continue
    const colSrc = getCol(out, src.col)
    const colDst = getCol(out, dst.col)
    for (let r = from; r <= to; r++) [colSrc[r], colDst[r]] = [colDst[r], colSrc[r]]
    setCol(out, src.col, colSrc)
    setCol(out, dst.col, colDst)
    return out
  }
  return null
}

/** Coluna principal (campo de batalha + terrenos). */
export function mainColumnOf(l: MatLayout): number {
  return rectOf(l, 'battlefield')?.col ?? 0
}

/** Move a coluna principal para a posição 0 (esquerda), 1 (centro) ou 2 (direita). */
export function moveMainColumn(l: MatLayout, to: number): MatLayout {
  const from = mainColumnOf(l)
  const cols = Array.from({ length: MAT_COLS }, (_, c) => getCol(l, c))
  const [main] = cols.splice(from, 1)
  cols.splice(Math.max(0, Math.min(MAT_COLS - 1, to)), 0, main)
  return Array.from({ length: MAT_ROWS }, (_, r) => cols.map((col) => col[r]))
}

/** Valida a grade: 4×3, toda área com sua altura fixa e 1 coluna, e as áreas largas juntas na mesma coluna. */
export function normalizeMatLayout(l: unknown): MatLayout {
  const ok =
    Array.isArray(l) &&
    l.length === MAT_ROWS &&
    l.every((r) => Array.isArray(r) && r.length === MAT_COLS && r.every((z) => MAT_ZONES.includes(z))) &&
    MAT_ZONES.every((z) => {
      const rc = rectOf(l as MatLayout, z)
      if (!rc || rc.h !== MAT_HEIGHT[z]) return false
      // contígua e numa coluna só
      return getCol(l as MatLayout, rc.col).slice(rc.top, rc.top + rc.h).every((x) => x === z)
    }) &&
    rectOf(l as MatLayout, 'battlefield')!.col === rectOf(l as MatLayout, 'lands')!.col
  return ok ? cloneMat(l as MatLayout) : cloneMat(DEFAULT_MAT_LAYOUT)
}

/** Tamanhos das colunas/linhas da grade: onde há battlefield/terrenos é flexível; o resto é compacto. */
export function matTracks(l: MatLayout): { cols: string; rows: string } {
  const big = (z: MatZone) => z === 'battlefield' || z === 'lands'
  const cols = Array.from({ length: MAT_COLS }, (_, c) => (l.some((r) => big(r[c])) ? 'minmax(0, 1fr)' : 'var(--mat-side-w)')).join(' ')
  const rows = l.map((r) => (r.includes('battlefield') ? 'minmax(0, 1fr)' : r.includes('lands') ? 'var(--mat-lands-h)' : 'minmax(0, 0.7fr)')).join(' ')
  return { cols, rows }
}

export function matAreas(l: MatLayout): string {
  return l.map((r) => `"${r.join(' ')}"`).join(' ')
}

/** Zona de um permanente a partir da linha de tipo (null = mágica que não fica no campo). */
export function zoneForType(typeLine: string, isCommander = false): BoardZone | null {
  const has = (t: string) => new RegExp(`\\b${t}\\b`, 'i').test(typeLine)
  if (isCommander && (has('Creature') || has('Planeswalker') || has('Artifact') || has('Enchantment') || has('Land') || has('Battle'))) return 'commanders'
  if (has('Land') && !has('Creature')) return 'lands'
  if (has('Creature')) return 'creatures'
  if (has('Planeswalker')) return 'planeswalkers'
  if (has('Artifact')) return 'artifacts'
  if (has('Enchantment')) return 'enchantments'
  if (has('Battle')) return 'others'
  return null
}
