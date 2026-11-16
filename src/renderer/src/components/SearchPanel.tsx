import { useEffect, useRef, useState } from 'react'
import { useInfiniteScroll } from './useInfiniteScroll'
import type { CardSearchQuery, CardSummary, SetInfo, SortKey } from '@shared/types'
import { CardImage, ManaCost, useMenu, type MenuItem } from './common'
import SetSelect from './SetSelect'
import { t, fmtNum } from '@shared/i18n'
import { useApp } from '../store'

interface Props {
  format?: string
  identity?: string[]
  inDeck?: Record<string, number>
  onPick?: (c: CardSummary) => void
  onHover?: (c: CardSummary | null) => void
  menuFor?: (c: CardSummary) => MenuItem[]
  quickAdd?: (c: CardSummary) => void
  defaultView?: 'grid' | 'list'
  pageSize?: number
}

const TYPES = ['', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Legendary', 'Battle']
const TYPE_LABEL: Record<string, string> = {
  '': 'Todos os tipos',
  Creature: 'Criatura',
  Instant: 'Mágica instantânea',
  Sorcery: 'Feitiço',
  Artifact: 'Artefato',
  Enchantment: 'Encantamento',
  Planeswalker: 'Planeswalker',
  Land: 'Terreno',
  Legendary: 'Lendária',
  Battle: 'Batalha'
}

export default function SearchPanel({ format, identity, inDeck, onPick, onHover, menuFor, quickAdd, defaultView = 'grid', pageSize = 90 }: Props) {
  const [text, setText] = useState('')
  const [colors, setColors] = useState<string[]>([])
  const [colorMode, setColorMode] = useState<CardSearchQuery['colorMode']>('any')
  const [type, setType] = useState('')
  const [cmcMax, setCmcMax] = useState<string>('')
  const [rarity, setRarity] = useState('')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [setCode, setSetCode] = useState('')
  const dbUpdatedAt = useApp((s) => s.db?.updatedAt)
  const [sort, setSort] = useState<SortKey>('name')
  const [legalOnly, setLegalOnly] = useState(true)
  const [view, setView] = useState(defaultView)
  const [results, setResults] = useState<CardSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const openMenu = useMenu((s) => s.open)
  const reqId = useRef(0)

  useEffect(() => {
    window.kard.db.sets().then(setSets)
  }, [dbUpdatedAt])

  const infinite = useInfiniteScroll({ count: results.length, total, loading, onMore: () => setOffset(results.length) })

  useEffect(() => {
    setOffset(0)
    infinite.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, colors, colorMode, type, cmcMax, rarity, setCode, sort, legalOnly, format, identity?.join('')])


  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const timer = setTimeout(async () => {
      const q: CardSearchQuery = {
        text,
        colors,
        colorMode,
        types: type ? [type] : [],
        cmcMax: cmcMax === '' ? undefined : Number(cmcMax),
        rarity: rarity ? [rarity] : undefined,
        sets: setCode ? [setCode] : undefined,
        format: legalOnly ? format : undefined,
        identity: legalOnly ? identity : undefined,
        sort,
        sortDir: sort === 'edhrec' ? 'asc' : 'asc',
        limit: pageSize,
        offset
      }
      const r = await window.kard.db.search(q)
      if (id !== reqId.current) return
      // rolagem infinita: a primeira página substitui, as seguintes acrescentam
      setResults((prev) => {
        if (offset === 0) return r.cards
        const seen = new Set(prev.map((c) => c.oracleId))
        return [...prev, ...r.cards.filter((c) => !seen.has(c.oracleId))]
      })
      setTotal(r.total)
      setLoading(false)
    }, offset === 0 ? 180 : 0)
    return () => clearTimeout(timer)
  }, [text, colors, colorMode, type, cmcMax, rarity, setCode, sort, legalOnly, format, identity, offset, pageSize])

  const toggleColor = (c: string) => setColors((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))

  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <input
        placeholder={t('Buscar por nome (português ou inglês). Ex.: "raio", t:criatura o:"compre um card" cmc<=3')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="filters">
        {['W', 'U', 'B', 'R', 'G', 'C'].map((c) => (
          <button key={c} className={`color-toggle ${colors.includes(c) ? 'on' : ''}`} style={{ background: `var(--${c})` }} onClick={() => toggleColor(c)} title={c}>
            {c === 'C' ? '◇' : ''}
          </button>
        ))}
        <select value={colorMode} onChange={(e) => setColorMode(e.target.value as CardSearchQuery['colorMode'])} title={t('Modo de cor')}>
          <option value="any">{t('Qualquer uma')}</option>
          <option value="all">{t('Todas')}</option>
          <option value="exact">{t('Exatamente')}</option>
          <option value="identity">{t('Dentro da identidade')}</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(TYPE_LABEL[ty])}
            </option>
          ))}
        </select>
        <select value={cmcMax} onChange={(e) => setCmcMax(e.target.value)} title={t('Custo de mana máximo')}>
          <option value="">{t('Custo: qualquer')}</option>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {t('Custo ≤ {n}', { n })}
            </option>
          ))}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="">{t('Raridade')}</option>
          <option value="common">{t('Comum')}</option>
          <option value="uncommon">{t('Incomum')}</option>
          <option value="rare">{t('Rara')}</option>
          <option value="mythic">{t('Mítica')}</option>
        </select>
        <SetSelect sets={sets} value={setCode} onChange={setSetCode} />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">{t('Ordenar: nome')}</option>
          <option value="cmc">{t('Ordenar: custo de mana')}</option>
          <option value="color">{t('Ordenar: cor')}</option>
          <option value="type">{t('Ordenar: tipo')}</option>
          <option value="rarity">{t('Ordenar: raridade')}</option>
          <option value="edhrec">{t('Ordenar: popularidade')}</option>
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
                key={c.oracleId}
                className="result-card"
                style={onPick ? undefined : { cursor: 'default' }}
                onClick={() => onPick?.(c)}
                onMouseEnter={() => onHover?.(c)}
                onMouseLeave={() => onHover?.(null)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (menuFor) openMenu(e.clientX, e.clientY, menuFor(c))
                }}
              >
                <CardImage printingId={c.defaultPrintingId} fallback={{ name: c.displayName, manaCost: c.manaCost, typeLine: c.displayType, colors: c.colors, power: c.power, toughness: c.toughness }} />
                {inDeck?.[c.oracleId] ? <span className="in-deck">{inDeck[c.oracleId]}</span> : null}
                {quickAdd && (
                  <span className="add-badge">
                    <button
                      className="btn sm primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        quickAdd(c)
                      }}
                      title={t('Adicionar ao deck')}
                    >
                      ＋
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="col" style={{ gap: 2 }}>
            {results.map((c) => (
              <div
                key={c.oracleId}
                className="deck-line"
                style={{ gridTemplateColumns: '54px 28px 1fr auto auto', cursor: onPick ? 'pointer' : 'default' }}
                onClick={() => onPick?.(c)}
                onMouseEnter={() => onHover?.(c)}
                onMouseLeave={() => onHover?.(null)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (menuFor) openMenu(e.clientX, e.clientY, menuFor(c))
                }}
              >
                {c.defaultPrintingId ? (
                  <img
                    className="thumb"
                    style={{ cursor: 'inherit' }}
                    src={`kard-img://card/${c.defaultPrintingId}/art/0`}
                    loading="lazy"
                    onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                ) : (
                  <div className="thumb" style={{ cursor: 'inherit' }} />
                )}
                <span className="qty">{inDeck?.[c.oracleId] ?? ''}</span>
                <span className="name">
                  {c.displayName}
                  {c.displayName !== c.name && <span className="muted small"> · {c.name}</span>}
                  <div className="muted small">{c.displayType}</div>
                </span>
                <ManaCost cost={c.manaCost} />
                {quickAdd && (
                  <button
                    className="btn sm"
                    title={t('Adicionar ao deck')}
                    onClick={(e) => {
                      e.stopPropagation()
                      quickAdd(c)
                    }}
                  >
                    ＋
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {loading && offset > 0 && <div className="small muted" style={{ textAlign: 'center', padding: 12 }}>{t('Carregando mais cartas...')}</div>}
      </div>
    </div>
  )
}
