// Busca de cartas de um jogo genérico (painel esquerdo do editor e "Explorar cartas").
// Os filtros são gerados a partir de GameDef.filters.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteScroll } from '../components/useInfiniteScroll'
import type { SetInfo } from '@shared/types'
import type { GameId, GCardSummary, GFilterDef, GSearchQuery, GSet } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { gameImageUrl } from '@shared/api'
import { t, fmtNum } from '@shared/i18n'
import { useMenu, type MenuItem } from '../components/common'
import SetSelect from '../components/SetSelect'
import { ColorChip, GameCardImage } from './gameCommon'

interface Props {
  game: GameId
  format?: string
  inDeck?: Record<string, number>
  onPick?: (c: GCardSummary) => void
  onHover?: (c: GCardSummary | null) => void
  menuFor?: (c: GCardSummary) => MenuItem[]
  quickAdd?: (c: GCardSummary) => void
  defaultView?: 'grid' | 'list'
  pageSize?: number
}

/** Acima disso, um filtro "multi" sem opções fixas vira um <select> (evita dezenas de botões). */
const MAX_CHIPS = 24

export default function GameSearchPanel(props: Props) {
  return <SearchPanel key={props.game} {...props} />
}

function SearchPanel({ game, format, inDeck, onPick, onHover, menuFor, quickAdd, defaultView = 'grid', pageSize = 90 }: Props) {
  const def = getGame(game)!
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [ranges, setRanges] = useState<Record<string, { min?: number; max?: number }>>({})
  const [facets, setFacets] = useState<Record<string, string[]>>({})
  const [sets, setSets] = useState<GSet[]>([])
  const [setId, setSetId] = useState('')
  const [sort, setSort] = useState('name')
  const [legalOnly, setLegalOnly] = useState(true)
  const [view, setView] = useState(defaultView)
  const [results, setResults] = useState<GCardSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const openMenu = useMenu((s) => s.open)
  const reqId = useRef(0)

  /** Filtros do jogo; sem filtro de categoria declarado, um <select> de categorias vem primeiro. */
  const allFilters: GFilterDef[] = useMemo(() => {
    const list = [...def.filters]
    if (!list.some((f) => f.key === 'category') && def.categories.length > 1) {
      list.unshift({ key: 'category', label: 'Categoria', kind: 'select', options: def.categories.map((c) => ({ value: c.id, label: c.label })) })
    }
    return list
  }, [def])

  useEffect(() => {
    window.kard.games.sets(game).then(setSets)
    // valores distintos para filtros sem opções fixas
    for (const f of allFilters) {
      if (f.kind === 'range' || f.options?.length) continue
      window.kard.games.facet(game, f.key).then((vals) => setFacets((cur) => ({ ...cur, [f.key]: vals })))
    }
  }, [game, allFilters])

  const setOptions: SetInfo[] = useMemo(
    () => sets.map((s) => ({ code: s.id, name: s.code ? `${s.name} · ${s.code}` : s.name, releasedAt: s.releasedAt ?? '', cardCount: s.cardCount })),
    [sets]
  )

  const chosenCategories = filters.category ?? []
  const visible = (f: GFilterDef) => !f.categories || chosenCategories.length === 0 || chosenCategories.some((c) => f.categories!.includes(c))
  const visibleFilters = allFilters.filter(visible)
  const visibleKey = visibleFilters.map((f) => f.key).join('|')

  // Consulta efetiva (ignora filtros escondidos pela categoria escolhida)
  const query = useMemo(() => {
    const keys = new Set(visibleKey.split('|'))
    const fs: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(filters)) if (keys.has(k) && v.length) fs[k] = v
    const rs: Record<string, { min?: number; max?: number }> = {}
    for (const [k, v] of Object.entries(ranges)) if (keys.has(k) && (v.min !== undefined || v.max !== undefined)) rs[k] = v
    const extra = def.sorts.find((s) => s.id === sort)
    const q: GSearchQuery = {
      text: text.trim() || undefined,
      filters: Object.keys(fs).length ? fs : undefined,
      ranges: Object.keys(rs).length ? rs : undefined,
      sets: setId ? [setId] : undefined,
      format: legalOnly ? format : undefined,
      sort,
      sortDir: sort === 'release' ? 'desc' : extra ? (extra.dir ?? 'desc') : 'asc'
    }
    return JSON.stringify(q)
  }, [text, filters, ranges, setId, legalOnly, format, sort, def, visibleKey])

  const infinite = useInfiniteScroll({ count: results.length, total, loading, onMore: () => setOffset(results.length) })

  useEffect(() => {
    setOffset(0)
    infinite.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const timer = setTimeout(
      async () => {
        const q: GSearchQuery = { ...JSON.parse(query), limit: pageSize, offset }
        const r = await window.kard.games.search(game, q)
        if (id !== reqId.current) return
        // rolagem infinita: a primeira página substitui, as seguintes acrescentam
        setResults((prev) => {
          if (offset === 0) return r.cards
          const seen = new Set(prev.map((c) => c.id))
          return [...prev, ...r.cards.filter((c) => !seen.has(c.id))]
        })
        setTotal(r.total)
        setLoading(false)
      },
      offset === 0 ? 180 : 0
    )
    return () => clearTimeout(timer)
  }, [game, query, offset, pageSize])

  const setFilter = (key: string, values: string[]) => setFilters((cur) => ({ ...cur, [key]: values }))
  const toggle = (key: string, v: string) => {
    const cur = filters[key] ?? []
    setFilter(key, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  }
  const setRange = (key: string, side: 'min' | 'max', raw: string) => {
    const n = raw.trim() === '' ? undefined : Number(raw)
    setRanges((cur) => ({ ...cur, [key]: { ...cur[key], [side]: n !== undefined && Number.isFinite(n) ? n : undefined } }))
  }

  const optionsOf = (f: GFilterDef): { value: string; label: string; raw?: boolean }[] =>
    f.options?.length ? f.options : (facets[f.key] ?? []).map((v) => ({ value: v, label: v, raw: true }))

  const renderFilter = (f: GFilterDef) => {
    const label = t(f.label)
    if (f.kind === 'range') {
      const r = ranges[f.key] ?? {}
      return (
        <span key={f.key} className="g-range" title={label}>
          <span className="small muted">{label}</span>
          <input type="number" placeholder={t('mín.')} value={r.min ?? ''} onChange={(e) => setRange(f.key, 'min', e.target.value)} />
          <span className="small muted">–</span>
          <input type="number" placeholder={t('máx.')} value={r.max ?? ''} onChange={(e) => setRange(f.key, 'max', e.target.value)} />
        </span>
      )
    }
    const opts = optionsOf(f)
    const optLabel = (o: { label: string; raw?: boolean }) => (o.raw ? o.label : t(o.label))
    if (f.kind === 'multi' && (f.key === 'colors' || opts.length <= MAX_CHIPS)) {
      if (!opts.length) return null
      const cur = filters[f.key] ?? []
      return (
        <span key={f.key} className="g-chips" title={label}>
          {f.key !== 'colors' && <span className="small muted">{label}</span>}
          {opts.map((o) =>
            f.key === 'colors' ? (
              <button key={o.value} className={`g-chip-toggle ${cur.includes(o.value) ? 'on' : ''}`} onClick={() => toggle(f.key, o.value)}>
                <ColorChip def={def} color={o.value} label />
              </button>
            ) : (
              <button key={o.value} className={`btn sm ${cur.includes(o.value) ? 'primary' : ''}`} onClick={() => toggle(f.key, o.value)}>
                {optLabel(o)}
              </button>
            )
          )}
        </span>
      )
    }
    // select (ou multi com muitos valores)
    return (
      <select key={f.key} value={filters[f.key]?.[0] ?? ''} onChange={(e) => setFilter(f.key, e.target.value ? [e.target.value] : [])} title={label}>
        <option value="">{t('{label}: qualquer', { label })}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {optLabel(o)}
          </option>
        ))}
      </select>
    )
  }

  const ctx = (c: GCardSummary) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (menuFor) openMenu(e.clientX, e.clientY, menuFor(c))
  }

  const addBtn = (c: GCardSummary, cls: string) =>
    quickAdd && (
      <button
        className={cls}
        onClick={(e) => {
          e.stopPropagation()
          quickAdd(c)
        }}
        title={t('Adicionar ao deck')}
      >
        ＋
      </button>
    )

  const typeLineOf = (c: GCardSummary) => {
    const cat = def.categories.find((x) => x.id === c.category)
    return [cat ? t(cat.label) : c.category, c.subtype].filter(Boolean).join(' · ')
  }

  const colorFilter = visibleFilters.find((f) => f.key === 'colors' && f.kind === 'multi')
  const otherFilters = visibleFilters.filter((f) => f !== colorFilter)
  const minWidth = Math.round(130 * Math.min(1.4, Math.max(0.7, (def.aspect || 0.716) / 0.716)))

  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <input placeholder={t('Buscar por nome, código ou texto. Ex.: "dragão", o:"compre 1 carta"')} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      {colorFilter && <div className="filters">{renderFilter(colorFilter)}</div>}
      <div className="filters">
        {otherFilters.map(renderFilter)}
        <SetSelect sets={setOptions} value={setId} onChange={setSetId} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">{t('Ordenar: nome')}</option>
          <option value="release">{t('Ordenar: mais recentes')}</option>
          {def.sorts.map((s) => (
            <option key={s.id} value={s.id}>
              {t('Ordenar: {label}', { label: t(s.label) })}
            </option>
          ))}
        </select>
        {format && (
          <label className="check small">
            <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} /> {t('Só legais no formato')}
          </label>
        )}
        <span className="right row" style={{ gap: 4 }}>
          <button className={`btn sm ${view === 'grid' ? 'primary' : ''}`} onClick={() => setView('grid')} title={t('Grade')}>
            ▦
          </button>
          <button className={`btn sm ${view === 'list' ? 'primary' : ''}`} onClick={() => setView('list')} title={t('Lista')}>
            ☰
          </button>
        </span>
      </div>
      <div className="row small muted">
        {loading && offset === 0 ? t('Buscando...') : total === 1 ? t('1 carta') : t('{n} cartas', { n: fmtNum(total) })}
      </div>
      <div className="scroll" style={{ flex: 1 }} ref={infinite.ref} onScroll={infinite.onScroll}>
        {view === 'grid' ? (
          <div className="grid-cards" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 10 }}>
            {results.map((c) => (
              <div
                key={c.id}
                className="result-card"
                style={onPick ? undefined : { cursor: 'default' }}
                onClick={() => onPick?.(c)}
                onMouseEnter={() => onHover?.(c)}
                onMouseLeave={() => onHover?.(null)}
                onContextMenu={ctx(c)}
              >
                <GameCardImage game={game} printingId={c.defaultPrintingId} name={c.displayName} />
                {inDeck?.[c.id] ? <span className="in-deck">{inDeck[c.id]}</span> : null}
                {quickAdd && <span className="add-badge">{addBtn(c, 'btn sm primary')}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="col" style={{ gap: 2 }}>
            {results.map((c) => (
              <div
                key={c.id}
                className="deck-line"
                style={{ gridTemplateColumns: '54px 28px 1fr auto auto', cursor: onPick ? 'pointer' : 'default' }}
                onClick={() => onPick?.(c)}
                onMouseEnter={() => onHover?.(c)}
                onMouseLeave={() => onHover?.(null)}
                onContextMenu={ctx(c)}
              >
                {c.defaultPrintingId ? (
                  <img
                    className="thumb g-thumb"
                    style={{ cursor: 'inherit' }}
                    src={gameImageUrl(game, c.defaultPrintingId, 'small')}
                    loading="lazy"
                    onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                ) : (
                  <div className="thumb" style={{ cursor: 'inherit' }} />
                )}
                <span className="qty">{inDeck?.[c.id] ?? ''}</span>
                <span className="name">
                  {c.displayName}
                  {c.displayName !== c.name && <span className="muted small"> · {c.name}</span>}
                  <div className="muted small">{typeLineOf(c)}</div>
                </span>
                <span className="row" style={{ gap: 3 }}>
                  {c.colors.map((x) => (
                    <ColorChip key={x} def={def} color={x} size={13} />
                  ))}
                </span>
                {addBtn(c, 'btn sm')}
              </div>
            ))}
          </div>
        )}
        {loading && offset > 0 && (
          <div className="small muted" style={{ textAlign: 'center', padding: 12 }}>
            {t('Carregando mais cartas...')}
          </div>
        )}
      </div>
    </div>
  )
}
