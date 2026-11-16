// Editor de decks de Pokémon: busca (esquerda), lista do deck (meio), pré-visualização e estatísticas (direita).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import type { CardFinish, DeckCard } from '@shared/types'
import type { PkmCard, PkmCardSummary, PkmCategory, PkmDeck, PkmFormatId, PkmPrinting, PkmType } from '@shared/pokemon/types'
import { PKM_CATEGORY_LABEL, PKM_TRAINER_LABEL, PKM_TYPES } from '@shared/pokemon/types'
import { PKM_FORMATS, exportPkmDeckText, getPkmFormat, isBasicEnergy, pkmDeckCount, validatePkmDeck } from '@shared/pokemon/formats'
import { pkmImageUrl } from '@shared/api'
import { t } from '@shared/i18n'
import { Modal, useMenu, type MenuItem } from '../components/common'
import { PkmCardImage, PkmTypeIcon, getPkmCards, getPkmPrintings, importPkmDeckText } from './pkmCommon'
import PkmSearchPanel from './PkmSearchPanel'
import PkmArtPicker, { pkmFinishOf, pkmFinishes } from './PkmArtPicker'
import PkmCardDetail, { PkmCardText } from './PkmCardDetail'

type Section = 'main' | 'maybeboard'

const SECTION_LABEL: Record<Section, string> = { main: 'Principal', maybeboard: 'Talvez' }

const GROUP_LABEL: Record<PkmCategory, string> = { Pokemon: 'Pokémon', Trainer: 'Treinadores', Energy: 'Energias' }

/** Ordem dos Treinadores na lista (como no Pokémon TCG Live). */
const TRAINER_ORDER = ['Supporter', 'Item', 'Tool', 'Technical Machine', "Rocket's Secret Machine", 'Stadium']

const STAGE_RANK: Record<string, number> = { Baby: 0, Basic: 0, RESTORED: 0, Stage1: 1, BREAK: 2, Stage2: 2, VMAX: 2, VSTAR: 2, 'V-UNION': 1, 'LEVEL-UP': 3, MEGA: 2 }

/** Tipo de uma Energia (pelos tipos da carta ou pelo nome, ex.: "Basic Lightning Energy"). */
function energyTypeOf(c: PkmCard): PkmType | undefined {
  if (c.types[0]) return c.types[0]
  return PKM_TYPES.find((x) => c.name.includes(x))
}

export default function PkmDeckEditor() {
  const deckId = useApp((s) => s.editingDeckId)
  const go = useApp((s) => s.go)
  const toast = useApp((s) => s.toast)
  const openMenu = useMenu((s) => s.open)
  const [deck, setDeck] = useState<PkmDeck | null>(null)
  const [cards, setCards] = useState<Record<string, PkmCard>>({})
  const [prints, setPrints] = useState<Record<string, PkmPrinting>>({})
  const [tab, setTab] = useState<Section>('main')
  const [hover, setHover] = useState<{ cardId: string; printingId?: string; finish?: CardFinish } | null>(null)
  const [art, setArt] = useState<{ section: Section; cardId: string } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<PkmDeck | null>(null)

  // Carrega o deck
  useEffect(() => {
    if (!deckId) return
    window.kard.pkm.decks.get(deckId).then(async (d) => {
      if (!d) return
      const cs = await getPkmCards([...d.main, ...d.maybeboard].map((c) => c.oracleId))
      setCards(cs)
      setDeck(d)
      latest.current = d
    })
  }, [deckId])

  // Impressões escolhidas (miniaturas, acabamentos e exportação)
  useEffect(() => {
    if (!deck) return
    const ids = [...deck.main, ...deck.maybeboard].map((c) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId).filter(Boolean) as string[]
    getPkmPrintings(ids).then(setPrints)
  }, [deck, cards])

  const persist = useCallback(async () => {
    const d = latest.current
    if (!d) return
    setSaveState('saving')
    await window.kard.pkm.decks.save(d)
    setSaveState('saved')
  }, [])

  const update = useCallback(
    (fn: (d: PkmDeck) => PkmDeck) => {
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
        if (latest.current) window.kard.pkm.decks.save(latest.current)
      }
    },
    []
  )

  const ensureCard = async (id: string) => {
    if (cards[id]) return cards[id]
    const r = await getPkmCards([id])
    setCards((c) => ({ ...c, ...r }))
    return r[id]
  }

  const add = async (c: { id: string }, section: Section = tab, qty = 1) => {
    const card = await ensureCard(c.id)
    if (!card) return
    update((d) => {
      const list = d[section]
      const ex = list.find((x) => x.oracleId === c.id)
      if (ex) ex.qty += qty
      else list.push({ oracleId: c.id, qty, name: card.name })
      return d
    })
  }

  const setQty = (section: Section, id: string, qty: number) =>
    update((d) => {
      const ex = d[section].find((x) => x.oracleId === id)
      if (!ex) return d
      ex.qty = qty
      d[section] = d[section].filter((x) => x.qty > 0)
      return d
    })

  const move = (from: Section, to: Section, id: string) =>
    update((d) => {
      const ex = d[from].find((x) => x.oracleId === id)
      if (!ex) return d
      d[from] = d[from].filter((x) => x.oracleId !== id)
      const target = d[to].find((x) => x.oracleId === id)
      if (target) target.qty += ex.qty
      else d[to].push({ ...ex })
      return d
    })

  const setPrinting = (section: Section, id: string, printingId: string) =>
    update((d) => {
      const ex = d[section].find((x) => x.oracleId === id)
      if (ex) ex.printingId = printingId
      return d
    })

  const setFinish = (section: Section, id: string, finish: CardFinish | undefined) =>
    update((d) => {
      const ex = d[section].find((x) => x.oracleId === id)
      if (ex) {
        if (finish) ex.finish = finish
        else delete ex.finish
      }
      return d
    })

  const validation = useMemo(() => (deck ? validatePkmDeck(deck, cards) : null), [deck, cards])
  const fmt = deck ? getPkmFormat(deck.format) : null

  const inDeck = useMemo(() => {
    const m: Record<string, number> = {}
    if (!deck) return m
    for (const c of deck.main) m[c.oracleId] = (m[c.oracleId] ?? 0) + c.qty
    return m
  }, [deck])

  const stats = useMemo(() => {
    if (!deck) return null
    const pokemonTypes: Partial<Record<PkmType, number>> = {}
    const energyTypes: Partial<Record<PkmType, number>> = {}
    let specialEnergy = 0
    for (const dc of deck.main) {
      const c = cards[dc.oracleId]
      if (!c) continue
      if (c.category === 'Pokemon') for (const x of c.types) pokemonTypes[x] = (pokemonTypes[x] ?? 0) + dc.qty
      if (c.category === 'Energy') {
        if (!isBasicEnergy(c)) specialEnergy += dc.qty
        else {
          const x = energyTypeOf(c)
          if (x) energyTypes[x] = (energyTypes[x] ?? 0) + dc.qty
        }
      }
    }
    return { pokemonTypes, energyTypes, specialEnergy }
  }, [deck, cards])

  if (!deck || !fmt) return <div className="page">{t('Carregando deck...')}</div>

  const thumbOf = (c: DeckCard) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId

  const lineMenu = (section: Section, c: DeckCard): MenuItem[] => {
    const items: MenuItem[] = [
      { label: `🎨 ${t('Escolher arte...')}`, onClick: () => setArt({ section, cardId: c.oracleId }) },
      { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.oracleId) },
      'sep'
    ]
    const other: Section = section === 'main' ? 'maybeboard' : 'main'
    items.push({ label: t('Mover para {section}', { section: t(SECTION_LABEL[other]) }), onClick: () => move(section, other, c.oracleId) })
    const pr = prints[thumbOf(c) ?? '']
    const avail = pkmFinishes(pr)
    if (avail.length > 1) {
      const cur = pkmFinishOf(pr, c.finish) ?? 'normal'
      const label: Record<string, string> = { normal: t('Normal (não holo)'), foil: `✨ ${t('Holo')}`, reverse: `✨ ${t('Reverse holo')}` }
      items.push({ header: t('Acabamento') })
      for (const f of avail) {
        items.push({ label: `${cur === f ? '● ' : ''}${label[f]}`, onClick: () => setFinish(section, c.oracleId, f === 'normal' ? undefined : f) })
      }
      items.push('sep')
    }
    items.push({ label: `🖼 ${t('Usar como capa do deck')}`, onClick: () => update((d) => ({ ...d, coverPrintingId: thumbOf(c) })) })
    items.push('sep', { label: `🗑 ${t('Remover')}`, onClick: () => setQty(section, c.oracleId, 0) })
    return items
  }

  const searchMenu = (c: PkmCardSummary): MenuItem[] => [
    { label: t('Adicionar ao principal'), onClick: () => add(c, 'main') },
    { label: t('Adicionar 4 ao principal'), onClick: () => add(c, 'main', 4) },
    { label: t('Adicionar ao "talvez"'), onClick: () => add(c, 'maybeboard') },
    'sep',
    { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.id) }
  ]

  const renderLine = (section: Section, c: DeckCard) => {
    const card = cards[c.oracleId]
    const pid = thumbOf(c)
    const pr = pid ? prints[pid] : undefined
    const finish = pkmFinishOf(pr, c.finish)
    const code = pr ? (pr.setCode ?? pr.set.toUpperCase()) : ''
    const thumb = pid ? (
      <img
        className="thumb pkm-thumb"
        src={pkmImageUrl(pid, 'low')}
        loading="lazy"
        onClick={() => setArt({ section, cardId: c.oracleId })}
        title={t('Escolher arte')}
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
      />
    ) : (
      <div className="thumb" onClick={() => setArt({ section, cardId: c.oracleId })} title={t('Escolher arte')} />
    )
    const icons = card?.category === 'Pokemon' ? card.types : card?.category === 'Energy' && isBasicEnergy(card) ? [energyTypeOf(card)].filter(Boolean) as PkmType[] : []
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
          title={[card?.name ?? c.name, pr && `${pr.setName} (${code} #${pr.localId})`].filter(Boolean).join('\n')}
        >
          {card?.localName ?? card?.name ?? c.name}
          {pr && (
            <span className="muted small">
              {' '}
              · {code} {pr.localId}
              {finish === 'foil' ? ` · ✨ ${t('Holo')}` : finish === 'reverse' ? ` · ✨ ${t('Reverse holo')}` : ''}
            </span>
          )}
        </span>
        <span className="row" style={{ gap: 2 }}>
          {icons.map((x) => (
            <PkmTypeIcon key={x} type={x} size={14} />
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

  // ---------------- Ordenação ----------------

  const byName = (a: DeckCard, b: DeckCard) => (cards[a.oracleId]?.localName ?? a.name).localeCompare(cards[b.oracleId]?.localName ?? b.name)

  /** Pokémon agrupados por linha evolutiva (Básico → Estágio 1 → Estágio 2). */
  const sortPokemon = (list: DeckCard[]) => {
    const names = new Map<string, PkmCard>()
    for (const dc of list) {
      const c = cards[dc.oracleId]
      if (c) names.set(c.name, c)
    }
    const root = (c: PkmCard | undefined): string => {
      let cur = c
      let r = c?.name ?? ''
      for (let i = 0; cur?.evolveFrom && i < 4; i++) {
        r = cur.evolveFrom
        cur = names.get(cur.evolveFrom)
      }
      return r
    }
    const key = (dc: DeckCard) => {
      const c = cards[dc.oracleId]
      return { root: root(c) || dc.name, rank: STAGE_RANK[c?.stage ?? ''] ?? 1 }
    }
    return [...list].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      return ka.root.localeCompare(kb.root) || ka.rank - kb.rank || byName(a, b)
    })
  }

  const trainerRank = (dc: DeckCard) => {
    const i = TRAINER_ORDER.indexOf(cards[dc.oracleId]?.trainerType ?? '')
    return i < 0 ? TRAINER_ORDER.length : i
  }
  const sortTrainers = (list: DeckCard[]) => [...list].sort((a, b) => trainerRank(a) - trainerRank(b) || b.qty - a.qty || byName(a, b))
  const sortEnergy = (list: DeckCard[]) =>
    [...list].sort((a, b) => Number(isBasicEnergy(cards[a.oracleId] ?? ({} as PkmCard))) - Number(isBasicEnergy(cards[b.oracleId] ?? ({} as PkmCard))) || byName(a, b))

  const catOf = (dc: DeckCard): PkmCategory => cards[dc.oracleId]?.category ?? 'Trainer'
  const groups = (['Pokemon', 'Trainer', 'Energy'] as PkmCategory[]).map((cat) => ({ cat, items: deck.main.filter((c) => catOf(c) === cat) })).filter((g) => g.items.length)

  /** Subgrupos dos Treinadores (Apoiador, Item, Ferramenta, Estádio...). */
  const trainerSubgroups = (list: DeckCard[]) => {
    const out: { type: string; items: DeckCard[] }[] = []
    for (const dc of sortTrainers(list)) {
      const ty = cards[dc.oracleId]?.trainerType ?? ''
      const last = out[out.length - 1]
      if (last && last.type === ty) last.items.push(dc)
      else out.push({ type: ty, items: [dc] })
    }
    return out
  }

  const sortMixed = (list: DeckCard[]) => {
    const order: PkmCategory[] = ['Pokemon', 'Trainer', 'Energy']
    return [...list].sort((a, b) => order.indexOf(catOf(a)) - order.indexOf(catOf(b)) || byName(a, b))
  }

  const hoverCard = hover ? cards[hover.cardId] : undefined
  const totalCount = pkmDeckCount(deck.main)

  const exportText = async () => {
    const txt = exportPkmDeckText(deck, cards, (dc) => {
      const pid = thumbOf(dc)
      const p = pid ? prints[pid] : undefined
      return p ? { code: p.setCode, number: p.localId } : null
    })
    await navigator.clipboard.writeText(txt)
    toast(t('Lista copiada para a área de transferência.'), 'success')
  }

  const typeCounts = (m: Partial<Record<PkmType, number>>) =>
    PKM_TYPES.filter((x) => m[x]).map((x) => (
      <span key={x} className="row" style={{ gap: 4 }}>
        <PkmTypeIcon type={x} size={16} /> {m[x]}
      </span>
    ))

  const maxCat = Math.max(1, ...(validation ? Object.values(validation.byCategory) : [1]))

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
        <select value={deck.format} onChange={(e) => update((d) => ({ ...d, format: e.target.value as PkmFormatId }))} title={t(fmt.description)}>
          {PKM_FORMATS.map((f) => (
            <option key={f.id} value={f.id} title={t(f.description)}>
              {t(f.name)}
            </option>
          ))}
        </select>
        <span className={`badge ${validation?.valid ? 'ok' : 'err'}`}>
          {validation?.valid ? `✓ ${t('Deck válido')}` : `✕ ${validation?.errors.length === 1 ? t('1 problema') : t('{n} problemas', { n: validation?.errors.length ?? 0 })}`}
        </span>
        <span className="badge">
          {totalCount}
          {fmt.size !== null ? ` / ${fmt.size}` : ''}
        </span>
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
          <PkmSearchPanel
            format={deck.format}
            inDeck={inDeck}
            onPick={(c) => setDetail(c.id)}
            quickAdd={(c) => add(c, tab)}
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
            {(['main', 'maybeboard'] as Section[]).map((s) => (
              <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)}>
                {t(SECTION_LABEL[s])} ({pkmDeckCount(deck[s])})
              </button>
            ))}
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            {tab === 'main' && (
              <>
                {groups.map((g) => (
                  <div key={g.cat} className="deck-group">
                    <h4>
                      <span>{t(GROUP_LABEL[g.cat])}</span>
                      <span>{pkmDeckCount(g.items)}</span>
                    </h4>
                    {g.cat === 'Pokemon' && sortPokemon(g.items).map((c) => renderLine('main', c))}
                    {g.cat === 'Trainer' &&
                      trainerSubgroups(g.items).map((sg) => (
                        <div key={sg.type || 'other'}>
                          <div className="pkm-subgroup">
                            <span>{sg.type ? t(PKM_TRAINER_LABEL[sg.type] ?? sg.type) : t('Outros')}</span>
                            <span>{pkmDeckCount(sg.items)}</span>
                          </div>
                          {sg.items.map((c) => renderLine('main', c))}
                        </div>
                      ))}
                    {g.cat === 'Energy' && sortEnergy(g.items).map((c) => renderLine('main', c))}
                  </div>
                ))}
                {deck.main.length === 0 && (
                  <div className="muted small" style={{ marginTop: 20 }}>
                    {t('Clique no "＋" das cartas da busca para adicioná-las ao deck. Botão direito mostra mais opções.')}
                  </div>
                )}
              </>
            )}
            {tab === 'maybeboard' && (
              <div className="deck-group">
                {sortMixed(deck.maybeboard).map((c) => renderLine('maybeboard', c))}
                {deck.maybeboard.length === 0 && <div className="muted small">{t('Vazio. Clique no "＋" das cartas da busca para adicionar aqui.')}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Pré-visualização e estatísticas */}
        <div className="panel">
          <div className="scroll" style={{ flex: 1 }}>
            {hoverCard ? (
              <>
                <PkmCardImage printingId={hover?.printingId} quality="high" card={hoverCard} foil={hover?.finish} />
                <div style={{ marginTop: 8 }}>
                  <PkmCardText card={hoverCard} />
                </div>
              </>
            ) : (
              <div className="muted small">{t('Passe o mouse sobre uma carta para ver os detalhes.')}</div>
            )}

            <h4 style={{ marginBottom: 4 }}>{t('Composição do deck')}</h4>
            {validation &&
              (['Pokemon', 'Trainer', 'Energy'] as PkmCategory[]).map((cat) => (
                <div key={cat} className="pkm-stat-row">
                  <span>{t(PKM_CATEGORY_LABEL[cat])}</span>
                  <div className="pkm-stat-bar">
                    <div style={{ width: `${(validation.byCategory[cat] / maxCat) * 100}%` }} />
                  </div>
                  <b>{validation.byCategory[cat]}</b>
                </div>
              ))}
            <div className="small muted" style={{ marginTop: 6 }}>
              {t('Pokémon Básicos: {n}', { n: validation?.basics ?? 0 })}
            </div>
            {stats && Object.keys(stats.pokemonTypes).length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {t('Tipos de Pokémon')}
                </div>
                <div className="row small" style={{ gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  {typeCounts(stats.pokemonTypes)}
                </div>
              </>
            )}
            {stats && (Object.keys(stats.energyTypes).length > 0 || stats.specialEnergy > 0) && (
              <>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {t('Energias')}
                </div>
                <div className="row small" style={{ gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  {typeCounts(stats.energyTypes)}
                  {stats.specialEnergy > 0 && <span className="muted">{t('Especiais: {n}', { n: stats.specialEnergy })}</span>}
                </div>
              </>
            )}

            <h4 style={{ marginBottom: 4 }}>{t('Validação ({format})', { format: t(fmt.name) })}</h4>
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
        <PkmArtPicker
          cardId={art.cardId}
          selected={deck[art.section].find((c) => c.oracleId === art.cardId)?.printingId}
          onSelect={(pid) => setPrinting(art.section, art.cardId, pid)}
          onSetCover={(pid) => {
            update((d) => ({ ...d, coverPrintingId: pid }))
            toast(t('Capa do deck atualizada.'), 'success')
          }}
          onClose={() => setArt(null)}
        />
      )}
      {detail && <PkmCardDetail cardId={detail} onClose={() => setDetail(null)} />}
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
                  const { deck: merged, missing } = await importPkmDeckText(importText, deck)
                  const cs = await getPkmCards([...merged.main, ...merged.maybeboard].map((c) => c.oracleId))
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
            {t('Cole uma lista no formato do Pokémon TCG Live (quantidade, nome, sigla da coleção e número).')}
          </div>
          <textarea
            rows={14}
            style={{ width: '100%' }}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'Pokémon: 4\n4 Pikachu ex SSP 57\n\nTrainer: 4\n4 Ultra Ball SVI 196\n\nEnergy: 8\n8 Basic {L} Energy SVE 4'}
          />
        </Modal>
      )}
    </div>
  )
}
