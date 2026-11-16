// Busca de cartas de Pokémon (painel esquerdo do editor de decks).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteScroll } from '../components/useInfiniteScroll'
import type { SetInfo } from '@shared/types'
import type { PkmCardSummary, PkmCategory, PkmFormatId, PkmSearchQuery, PkmSetInfo, PkmSortKey, PkmType } from '@shared/pokemon/types'
import { PKM_CATEGORY_LABEL, PKM_STAGE_LABEL, PKM_TRAINER_LABEL, PKM_TYPES } from '@shared/pokemon/types'
import { pkmImageUrl } from '@shared/api'
import { t, fmtNum } from '@shared/i18n'
import { useMenu, type MenuItem } from '../components/common'
import SetSelect from '../components/SetSelect'
import { PkmCardImage, PkmTypeIcon, pkmTypeLine } from './pkmCommon'

interface Props {
  format?: PkmFormatId
  inDeck?: Record<string, number>
  onPick?: (c: PkmCardSummary) => void
  onHover?: (c: PkmCardSummary | null) => void
  menuFor?: (c: PkmCardSummary) => MenuItem[]
  quickAdd?: (c: PkmCardSummary) => void
  defaultView?: 'grid' | 'list'
  pageSize?: number
}

const CATEGORIES: PkmCategory[] = ['Pokemon', 'Trainer', 'Energy']
const STAGES = ['Basic', 'Stage1', 'Stage2', 'VSTAR', 'VMAX', 'MEGA', 'BREAK', 'LEVEL-UP', 'V-UNION', 'RESTORED', 'Baby']
const TRAINER_TYPES = ['Supporter', 'Item', 'Tool', 'Stadium', 'Technical Machine', "Rocket's Secret Machine"]
const SUFFIXES = ['ex', 'V', 'GX', 'EX', 'TAG TEAM-GX', 'SP', 'Prime', 'Legend']
const REG_MARKS = ['D', 'E', 'F', 'G', 'H', 'I', 'J']

export default function PkmSearchPanel({ format, inDeck, onPick, onHover, menuFor, quickAdd, defaultView = 'grid', pageSize = 90 }: Props) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<PkmCategory | ''>('')
  const [types, setTypes] = useState<PkmType[]>([])
  const [stage, setStage] = useState('')
  const [trainerType, setTrainerType] = useState('')
  const [energyType, setEnergyType] = useState('')
  const [suffix, setSuffix] = useState('')
  const [sets, setSets] = useState<PkmSetInfo[]>([])
  const [setId, setSetId] = useState('')
  const [regMark, setRegMark] = useState('')
  const [sort, setSort] = useState<PkmSortKey>('name')
  const [legalOnly, setLegalOnly] = useState(true)
  const [view, setView] = useState(defaultView)
  const [results, setResults] = useState<PkmCardSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const openMenu = useMenu((s) => s.open)
  const reqId = useRef(0)

  useEffect(() => {
    window.kard.pkm.sets().then(setSets)
  }, [])

  // SetSelect usa o formato das coleções de Magic: o "código" é o id do TCGdex.
  const setOptions: SetInfo[] = useMemo(
    () => sets.map((s) => ({ code: s.id, name: s.code ? `${s.name} · ${s.code}` : s.name, releasedAt: s.releasedAt ?? '', cardCount: s.cardCount })),
    [sets]
  )

  const showPokemonFilters = category === '' || category === 'Pokemon'
  const showTrainerFilter = category === '' || category === 'Trainer'

  const infinite = useInfiniteScroll({ count: results.length, total, loading, onMore: () => setOffset(results.length) })

  useEffect(() => {
    setOffset(0)
    infinite.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, category, types, stage, trainerType, energyType, suffix, setId, regMark, sort, legalOnly, format])

  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const timer = setTimeout(async () => {
      const q: PkmSearchQuery = {
        text,
        categories: category ? [category] : undefined,
        types: types.length ? types : undefined,
        stage: showPokemonFilters && stage ? stage : undefined,
        suffix: showPokemonFilters && suffix ? suffix : undefined,
        trainerType: showTrainerFilter && trainerType ? trainerType : undefined,
        energyType: category === 'Energy' && energyType ? energyType : undefined,
        sets: setId ? [setId] : undefined,
        regulationMarks: regMark ? [regMark] : undefined,
        format: legalOnly ? format : undefined,
        sort,
        sortDir: sort === 'release' || sort === 'hp' ? 'desc' : 'asc',
        limit: pageSize,
        offset
      }
      const r = await window.kard.pkm.search(q)
      if (id !== reqId.current) return
      // rolagem infinita: a primeira página substitui, as seguintes acrescentam
      setResults((prev) => {
        if (offset === 0) return r.cards
        const seen = new Set(prev.map((c) => c.id))
        return [...prev, ...r.cards.filter((c) => !seen.has(c.id))]
      })
      setTotal(r.total)
      setLoading(false)
    }, offset === 0 ? 180 : 0)
    return () => clearTimeout(timer)
  }, [text, category, types, stage, trainerType, energyType, suffix, setId, regMark, sort, legalOnly, format, offset, pageSize, showPokemonFilters, showTrainerFilter])

  const toggleType = (x: PkmType) => setTypes((cs) => (cs.includes(x) ? cs.filter((y) => y !== x) : [...cs, x]))

  const ctx = (c: PkmCardSummary) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (menuFor) openMenu(e.clientX, e.clientY, menuFor(c))
  }

  const addBtn = (c: PkmCardSummary, cls: string) =>
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

  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <input
        placeholder={t('Buscar por nome (português ou inglês). Ex.: "pikachu", o:"compre 2 cartas" hp>=120')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="filters">
        {PKM_TYPES.map((x) => (
          <button key={x} className={`pkm-type-toggle ${types.includes(x) ? 'on' : ''}`} onClick={() => toggleType(x)}>
            <PkmTypeIcon type={x} size={20} />
          </button>
        ))}
      </div>
      <div className="filters">
        <select value={category} onChange={(e) => setCategory(e.target.value as PkmCategory | '')} title={t('Categoria')}>
          <option value="">{t('Todas as categorias')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(PKM_CATEGORY_LABEL[c])}
            </option>
          ))}
        </select>
        {showPokemonFilters && (
          <select value={stage} onChange={(e) => setStage(e.target.value)} title={t('Estágio')}>
            <option value="">{t('Estágio: qualquer')}</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {t(PKM_STAGE_LABEL[s] ?? s)}
              </option>
            ))}
          </select>
        )}
        {showPokemonFilters && (
          <select value={suffix} onChange={(e) => setSuffix(e.target.value)} title={t('Regra especial (ex, V, GX...)')}>
            <option value="">{t('Sufixo: qualquer')}</option>
            {SUFFIXES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {showTrainerFilter && (
          <select value={trainerType} onChange={(e) => setTrainerType(e.target.value)} title={t('Tipo de Treinador')}>
            <option value="">{t('Treinador: qualquer')}</option>
            {TRAINER_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(PKM_TRAINER_LABEL[s] ?? s)}
              </option>
            ))}
          </select>
        )}
        {category === 'Energy' && (
          <select value={energyType} onChange={(e) => setEnergyType(e.target.value)}>
            <option value="">{t('Todas as Energias')}</option>
            <option value="Normal">{t('Energia Básica')}</option>
            <option value="Special">{t('Energia Especial')}</option>
          </select>
        )}
        <SetSelect sets={setOptions} value={setId} onChange={setSetId} />
        <select value={regMark} onChange={(e) => setRegMark(e.target.value)} title={t('Marca de regulamentação')}>
          <option value="">{t('Marca: qualquer')}</option>
          {REG_MARKS.map((m) => (
            <option key={m} value={m}>
              {t('Marca {mark}', { mark: m })}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as PkmSortKey)}>
          <option value="name">{t('Ordenar: nome')}</option>
          <option value="type">{t('Ordenar: tipo')}</option>
          <option value="hp">{t('Ordenar: PS')}</option>
          <option value="release">{t('Ordenar: mais recentes')}</option>
          <option value="category">{t('Ordenar: categoria')}</option>
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
          <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
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
                <PkmCardImage printingId={c.hasImage ? c.defaultPrintingId : undefined} name={c.displayName} />
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
                {c.hasImage ? (
                  <img
                    className="thumb pkm-thumb"
                    style={{ cursor: 'inherit' }}
                    src={pkmImageUrl(c.defaultPrintingId, 'low')}
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
                  <div className="muted small">{pkmTypeLine(c)}</div>
                </span>
                <span className="row" style={{ gap: 3 }}>
                  {c.hp ? (
                    <span className="small muted">
                      {t('PS')} {c.hp}
                    </span>
                  ) : null}
                  {c.types.map((x) => (
                    <PkmTypeIcon key={x} type={x} size={15} />
                  ))}
                </span>
                {addBtn(c, 'btn sm')}
              </div>
            ))}
          </div>
        )}
        {loading && offset > 0 && <div className="small muted" style={{ textAlign: 'center', padding: 12 }}>{t('Carregando mais cartas...')}</div>}
      </div>
    </div>
  )
}
