// Editor de decks de um jogo genérico: busca (esquerda), lista do deck por seção (meio), pré-visualização e estatísticas (direita).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import type { CardFinish, DeckCard } from '@shared/types'
import type { GameId, GCard, GCardSummary, GDeck, GPrinting } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { gCount } from '@shared/games/helpers'
import { gameImageUrl } from '@shared/api'
import { t } from '@shared/i18n'
import { Modal, useMenu, type MenuItem } from '../components/common'
import { ColorChip, GameCardImage, defaultSectionOf, gAllLines, gMainLines, gSectionList, getGCards, getGPrintings, importGameDeckText } from './gameCommon'
import GameSearchPanel from './GameSearchPanel'
import GameArtPicker from './GameArtPicker'
import GameCardDetail, { GameCardText } from './GameCardDetail'

/** Aba aberta: id de uma seção do GameDef ou 'maybeboard' ("talvez"). */
type Tab = string

const MAYBE = 'maybeboard'

export default function GameDeckEditor({ game }: { game: GameId }) {
  return <Editor key={game} game={game} />
}

function Editor({ game }: { game: GameId }) {
  const def = getGame(game)!
  const deckId = useApp((s) => s.editingDeckId)
  const go = useApp((s) => s.go)
  const toast = useApp((s) => s.toast)
  const openMenu = useMenu((s) => s.open)
  const [deck, setDeck] = useState<GDeck | null>(null)
  const [cards, setCards] = useState<Record<string, GCard>>({})
  const [prints, setPrints] = useState<Record<string, GPrinting>>({})
  const [tab, setTab] = useState<Tab>(def.sections[0]?.id ?? MAYBE)
  const [hover, setHover] = useState<{ cardId: string; printingId?: string; finish?: CardFinish } | null>(null)
  const [art, setArt] = useState<{ section: Tab; cardId: string } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<GDeck | null>(null)

  const sectionLabel = (s: Tab) => (s === MAYBE ? t('Talvez') : t(def.sections.find((x) => x.id === s)?.label ?? s))

  // Carrega o deck
  useEffect(() => {
    if (!deckId) return
    window.kard.games.decks.get(game, deckId).then(async (d) => {
      if (!d) return
      for (const s of def.sections) if (!d.sections[s.id]) d.sections[s.id] = []
      const cs = await getGCards(
        game,
        gAllLines(d).map((c) => c.oracleId)
      )
      setCards(cs)
      setDeck(d)
      latest.current = d
    })
  }, [deckId, game, def])

  // Impressões escolhidas (miniaturas, exportação)
  useEffect(() => {
    if (!deck) return
    const ids = gAllLines(deck)
      .map((c) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId)
      .filter(Boolean) as string[]
    getGPrintings(game, ids).then(setPrints)
  }, [deck, cards, game])

  const persist = useCallback(async () => {
    const d = latest.current
    if (!d) return
    setSaveState('saving')
    await window.kard.games.decks.save(d)
    setSaveState('saved')
  }, [])

  const update = useCallback(
    (fn: (d: GDeck) => GDeck) => {
      setDeck((prev) => {
        if (!prev) return prev
        const next = fn(structuredClone(prev))
        latest.current = next
        return next
      })
      setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 700)
    },
    [persist]
  )

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        if (latest.current) window.kard.games.decks.save(latest.current)
      }
    },
    []
  )

  const ensureCard = async (id: string) => {
    if (cards[id]) return cards[id]
    const r = await getGCards(game, [id])
    setCards((c) => ({ ...c, ...r }))
    return r[id]
  }

  /**
   * Destino do "＋": a aba aberta. Na aba da primeira seção (Principal), cartas que pertencem a outra
   * seção (ex.: Deck Extra) vão para a seção delas.
   */
  const targetFor = (card: GCard): Tab => {
    if (tab === MAYBE) return MAYBE
    const home = defaultSectionOf(def, card)
    if (tab === def.sections[0]?.id && home !== tab) return home
    return tab
  }

  const add = async (c: { id: string }, section?: Tab, qty = 1) => {
    const card = await ensureCard(c.id)
    if (!card) return
    const target = section ?? targetFor(card)
    update((d) => {
      const list = gSectionList(d, target)
      const ex = list.find((x) => x.oracleId === c.id)
      if (ex) ex.qty += qty
      else list.push({ oracleId: c.id, qty, name: card.name })
      return d
    })
  }

  const setQty = (section: Tab, id: string, qty: number) =>
    update((d) => {
      const list = gSectionList(d, section)
      const ex = list.find((x) => x.oracleId === id)
      if (!ex) return d
      ex.qty = qty
      const kept = list.filter((x) => x.qty > 0)
      if (section === MAYBE) d.maybeboard = kept
      else d.sections[section] = kept
      return d
    })

  const move = (from: Tab, to: Tab, id: string) =>
    update((d) => {
      const src = gSectionList(d, from)
      const ex = src.find((x) => x.oracleId === id)
      if (!ex) return d
      const rest = src.filter((x) => x.oracleId !== id)
      if (from === MAYBE) d.maybeboard = rest
      else d.sections[from] = rest
      const dst = gSectionList(d, to)
      const target = dst.find((x) => x.oracleId === id)
      if (target) target.qty += ex.qty
      else dst.push({ ...ex })
      return d
    })

  const editLine = (section: Tab, id: string, fn: (dc: DeckCard) => void) =>
    update((d) => {
      const ex = gSectionList(d, section).find((x) => x.oracleId === id)
      if (ex) fn(ex)
      return d
    })

  const validation = useMemo(() => (deck ? def.validate(deck, cards) : null), [deck, cards, def])
  const fmt = deck ? def.formats.find((f) => f.id === deck.format) : undefined

  const inDeck = useMemo(() => {
    const m: Record<string, number> = {}
    if (!deck) return m
    for (const c of gMainLines(def, deck)) m[c.oracleId] = (m[c.oracleId] ?? 0) + c.qty
    return m
  }, [deck, def])

  const stats = useMemo(() => {
    if (!deck) return null
    const colors: Record<string, number> = {}
    const categories: Record<string, number> = {}
    for (const dc of gMainLines(def, deck)) {
      const c = cards[dc.oracleId]
      if (!c) continue
      for (const x of c.colors) colors[x] = (colors[x] ?? 0) + dc.qty
      categories[c.category] = (categories[c.category] ?? 0) + dc.qty
    }
    return { colors, categories }
  }, [deck, cards, def])

  if (!deck) return <div className="page">{t('Carregando deck...')}</div>

  const thumbOf = (c: DeckCard) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId
  const allTabs: Tab[] = [...def.sections.map((s) => s.id), MAYBE]

  const lineMenu = (section: Tab, c: DeckCard): MenuItem[] => {
    const items: MenuItem[] = [
      { label: `🎨 ${t('Escolher arte...')}`, onClick: () => setArt({ section, cardId: c.oracleId }) },
      { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.oracleId) },
      'sep'
    ]
    for (const other of allTabs) {
      if (other === section) continue
      items.push({ label: t('Mover para {section}', { section: sectionLabel(other) }), onClick: () => move(section, other, c.oracleId) })
    }
    items.push('sep', { header: t('Acabamento') })
    items.push({ label: `${!c.finish ? '● ' : ''}${t('Normal')}`, onClick: () => editLine(section, c.oracleId, (dc) => delete dc.finish) })
    items.push({ label: `${c.finish === 'foil' ? '● ' : ''}✨ ${t('Foil')}`, onClick: () => editLine(section, c.oracleId, (dc) => (dc.finish = 'foil')) })
    items.push('sep', { label: `🖼 ${t('Usar como capa do deck')}`, onClick: () => update((d) => ({ ...d, coverPrintingId: thumbOf(c) })) })
    items.push('sep', { label: `🗑 ${t('Remover')}`, onClick: () => setQty(section, c.oracleId, 0) })
    return items
  }

  const searchMenu = (c: GCardSummary): MenuItem[] => [
    ...def.sections.map((s) => ({ label: t('Adicionar a: {section}', { section: t(s.label) }), onClick: () => add(c, s.id) })),
    { label: t('Adicionar ao "talvez"'), onClick: () => add(c, MAYBE) },
    'sep',
    { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.id) }
  ]

  const renderLine = (section: Tab, c: DeckCard) => {
    const card = cards[c.oracleId]
    const pid = thumbOf(c)
    const pr = pid ? prints[pid] : undefined
    const finish = c.finish
    const thumb = pid ? (
      <img
        className="thumb g-thumb"
        src={gameImageUrl(game, pid, 'small')}
        loading="lazy"
        onClick={() => setArt({ section, cardId: c.oracleId })}
        title={t('Escolher arte')}
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
      />
    ) : (
      <div className="thumb" onClick={() => setArt({ section, cardId: c.oracleId })} title={t('Escolher arte')} />
    )
    return (
      <div
        key={`${section}-${c.oracleId}`}
        className="deck-line"
        onMouseEnter={() => setHover({ cardId: c.oracleId, printingId: pid, finish })}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu(e.clientX, e.clientY, lineMenu(section, c))
        }}
      >
        {finish ? (
          <span className={`foil-wrap art ${finish}`}>
            {thumb}
            <span className="foil-sheen" />
          </span>
        ) : (
          thumb
        )}
        <span className="qty">{c.qty}</span>
        <span
          className="name"
          style={{ cursor: 'pointer' }}
          onClick={() => setDetail(c.oracleId)}
          title={[card?.name ?? c.name, pr && [pr.setName, pr.code].filter(Boolean).join(' · ')].filter(Boolean).join('\n')}
        >
          {card?.localName ?? card?.name ?? c.name}
          {(pr?.code || finish) && (
            <span className="muted small">
              {pr?.code ? ` · ${pr.code}` : ''}
              {finish === 'foil' ? ` · ✨ ${t('Foil')}` : ''}
            </span>
          )}
        </span>
        <span className="row" style={{ gap: 2 }}>
          {(card?.colors ?? []).map((x) => (
            <ColorChip key={x} def={def} color={x} size={12} />
          ))}
        </span>
        <span className="acts">
          <button className="icon-btn" onClick={() => setQty(section, c.oracleId, c.qty + 1)} title="+1">
            ＋
          </button>
          <button className="icon-btn" onClick={() => setQty(section, c.oracleId, c.qty - 1)} title="−1">
            −
          </button>
          <button className="icon-btn" onClick={(e) => openMenu(e.clientX, e.clientY, lineMenu(section, c))} title={t('Mais opções')}>
            ⋯
          </button>
        </span>
      </div>
    )
  }

  // ---------------- Ordenação e grupos ----------------

  const catRank = (dc: DeckCard) => {
    const i = def.categories.findIndex((x) => x.id === cards[dc.oracleId]?.category)
    return i < 0 ? def.categories.length : i
  }
  const byName = (a: DeckCard, b: DeckCard) => (cards[a.oracleId]?.localName ?? cards[a.oracleId]?.name ?? a.name).localeCompare(cards[b.oracleId]?.localName ?? cards[b.oracleId]?.name ?? b.name)

  /** Linhas agrupadas por def.groupOf, na ordem das categorias do jogo. */
  const groupsOf = (list: DeckCard[]) => {
    const sorted = [...list].sort((a, b) => catRank(a) - catRank(b) || byName(a, b))
    const out: { label: string; items: DeckCard[] }[] = []
    for (const dc of sorted) {
      const c = cards[dc.oracleId]
      const label = c ? def.groupOf(c) : t('Outros')
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(dc)
      else out.push({ label, items: [dc] })
    }
    return out
  }

  const sizeLabel = (n: number, s: { min: number; max: number }) => {
    if (s.max >= 999) return s.min > 0 ? `${n} / ${s.min}+` : `${n}`
    return s.min === s.max || s.min === 0 ? `${n} / ${s.max}` : `${n} / ${s.min}–${s.max}`
  }

  const hoverCard = hover ? cards[hover.cardId] : undefined
  const totalCount = gCount(gMainLines(def, deck))
  const tabList = gSectionList(deck, tab)

  const exportText = async () => {
    const txt = def.exportText(deck, cards, prints)
    await navigator.clipboard.writeText(txt)
    toast(t('Lista copiada para a área de transferência.'), 'success')
  }

  const maxCat = Math.max(1, ...Object.values(stats?.categories ?? {}))

  return (
    <div className="page" style={{ paddingBottom: 10 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className="btn ghost"
          onClick={() => {
            persist()
            go('decks')
          }}
        >
          ← Decks
        </button>
        <input value={deck.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} style={{ fontSize: 18, fontWeight: 700, width: 320 }} />
        <select value={deck.format} onChange={(e) => update((d) => ({ ...d, format: e.target.value }))} title={fmt ? t(fmt.description) : ''}>
          {!fmt && <option value={deck.format}>{deck.format}</option>}
          {def.formats.map((f) => (
            <option key={f.id} value={f.id} title={t(f.description)}>
              {t(f.name)}
            </option>
          ))}
        </select>
        <span className={`badge ${validation?.valid ? 'ok' : 'err'}`}>
          {validation?.valid ? `✓ ${t('Deck válido')}` : `✕ ${validation?.errors.length === 1 ? t('1 problema') : t('{n} problemas', { n: validation?.errors.length ?? 0 })}`}
        </span>
        <span className="badge">{totalCount === 1 ? t('1 carta') : t('{n} cartas', { n: totalCount })}</span>
        <span className="small muted">{saveState === 'saved' ? t('Salvo') : saveState === 'saving' ? t('Salvando...') : t('Alterações pendentes')}</span>
        <span className="right row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setImportOpen(true)}>
            ⇩ {t('Importar')}
          </button>
          <button className="btn sm" onClick={exportText}>
            ⇧ {t('Exportar')}
          </button>
        </span>
      </div>

      <div className="editor">
        {/* Busca */}
        <div className="panel">
          <GameSearchPanel
            game={game}
            format={deck.format}
            inDeck={inDeck}
            onPick={(c) => setDetail(c.id)}
            quickAdd={(c) => add(c)}
            onHover={(c) => {
              if (!c) return
              setHover({ cardId: c.id, printingId: c.defaultPrintingId })
              // Cartas da busca ainda não estão no cache do deck: carrega para a pré-visualização.
              if (!cards[c.id]) ensureCard(c.id)
            }}
            menuFor={searchMenu}
            pageSize={90}
          />
        </div>

        {/* Lista do deck */}
        <div className="panel">
          <div className="tabs">
            {allTabs.map((s) => {
              const n = gCount(s === MAYBE ? deck.maybeboard : deck.sections[s])
              const sec = def.sections.find((x) => x.id === s)
              return (
                <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)}>
                  {sectionLabel(s)} ({sec ? sizeLabel(n, sec) : n})
                </button>
              )
            })}
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            {groupsOf(tabList).map((g) => (
              <div key={g.label} className="deck-group">
                <h4>
                  <span>{g.label}</span>
                  <span>{gCount(g.items)}</span>
                </h4>
                {g.items.map((c) => renderLine(tab, c))}
              </div>
            ))}
            {tabList.length === 0 && (
              <div className="muted small" style={{ marginTop: 20 }}>
                {tab === MAYBE
                  ? t('Vazio. Clique no "＋" das cartas da busca para adicionar aqui.')
                  : t('Clique no "＋" das cartas da busca para adicioná-las ao deck. Botão direito mostra mais opções.')}
              </div>
            )}
          </div>
        </div>

        {/* Pré-visualização e estatísticas */}
        <div className="panel">
          <div className="scroll" style={{ flex: 1 }}>
            {hoverCard ? (
              <>
                <GameCardImage game={game} printingId={hover?.printingId} size="large" card={hoverCard} foil={hover?.finish} />
                <div style={{ marginTop: 8 }}>
                  <GameCardText def={def} card={hoverCard} />
                </div>
              </>
            ) : (
              <div className="muted small">{t('Passe o mouse sobre uma carta para ver os detalhes.')}</div>
            )}

            <h4 style={{ marginBottom: 4 }}>{t('Composição do deck')}</h4>
            {def.sections.map((s) => {
              const n = validation?.counts[s.id] ?? gCount(deck.sections[s.id])
              const ok = n >= s.min && n <= s.max
              const scale = s.max >= 999 ? Math.max(1, n, s.min) : s.max || 1
              return (
                <div key={s.id} className="g-stat-row">
                  <span>{t(s.label)}</span>
                  <div className="pkm-stat-bar">
                    <div style={{ width: `${Math.min(1, n / scale) * 100}%` }} />
                  </div>
                  <b style={{ color: ok ? undefined : 'var(--danger)' }}>{sizeLabel(n, s)}</b>
                </div>
              )
            })}
            {stats && def.categories.length > 1 && Object.keys(stats.categories).length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {t('Categorias')}
                </div>
                {def.categories
                  .filter((c) => stats.categories[c.id])
                  .map((c) => (
                    <div key={c.id} className="g-stat-row">
                      <span>{t(c.label)}</span>
                      <div className="pkm-stat-bar">
                        <div style={{ width: `${(stats.categories[c.id] / maxCat) * 100}%` }} />
                      </div>
                      <b>{stats.categories[c.id]}</b>
                    </div>
                  ))}
              </>
            )}
            {stats && Object.keys(stats.colors).length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {t('Cores')}
                </div>
                <div className="row small" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {def.colors
                    .filter((c) => stats.colors[c.id])
                    .map((c) => (
                      <ColorChip key={c.id} def={def} color={c.id} label count={stats.colors[c.id]} />
                    ))}
                </div>
              </>
            )}

            <h4 style={{ marginBottom: 4 }}>{t('Validação ({format})', { format: fmt ? t(fmt.name) : deck.format })}</h4>
            {validation && validation.errors.length === 0 && (
              <div className="small" style={{ color: 'var(--ok)' }}>
                {t('Nenhum problema encontrado.')}
              </div>
            )}
            {validation && validation.errors.length > 0 && (
              <ul className="err-list errors">
                {validation.errors.slice(0, 30).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {validation && validation.warnings.length > 0 && (
              <ul className="err-list warnings">
                {validation.warnings.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {art && (
        <GameArtPicker
          game={game}
          cardId={art.cardId}
          selected={gSectionList(deck, art.section).find((c) => c.oracleId === art.cardId)?.printingId}
          onSelect={(pid) => editLine(art.section, art.cardId, (dc) => (dc.printingId = pid))}
          onSetCover={(pid) => {
            update((d) => ({ ...d, coverPrintingId: pid }))
            toast(t('Capa do deck atualizada.'), 'success')
          }}
          onClose={() => setArt(null)}
        />
      )}
      {detail && <GameCardDetail game={game} cardId={detail} onClose={() => setDetail(null)} />}
      {importOpen && (
        <Modal
          title={t('Importar cartas para este deck')}
          width={620}
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setImportOpen(false)}>
                {t('Cancelar')}
              </button>
              <button
                className="btn primary"
                disabled={!importText.trim()}
                onClick={async () => {
                  const { deck: merged, missing } = await importGameDeckText(def, importText, deck)
                  const cs = await getGCards(
                    game,
                    gAllLines(merged).map((c) => c.oracleId)
                  )
                  setCards((c) => ({ ...c, ...cs }))
                  update(() => merged)
                  setImportOpen(false)
                  setImportText('')
                  toast(missing.length ? t('Não encontradas: {list}', { list: missing.slice(0, 6).join(', ') }) : t('Cartas importadas!'), missing.length ? 'error' : 'success')
                }}
              >
                {t('Importar')}
              </button>
            </>
          }
        >
          <div className="small muted" style={{ marginBottom: 6 }}>
            {t('Cole uma lista de deck (uma carta por linha, com a quantidade antes do nome ou do código da carta). As cartas são somadas ao deck.')}
          </div>
          <textarea rows={14} style={{ width: '100%' }} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={def.exampleList} />
        </Modal>
      )}
    </div>
  )
}
