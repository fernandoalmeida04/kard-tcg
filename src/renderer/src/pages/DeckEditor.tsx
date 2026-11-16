import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import type { CardData, CardFinish, CardSummary, Deck, DeckCard, FormatId, Printing } from '@shared/types'
import { FORMATS, deckCount, exportDeckText, getFormat, isCommanderFormat, validateDeck } from '@shared/formats'
import { FlippableCard, ManaCost, ManaText, Modal, canChooseFinish, faceFallback, finishOf, hasBackImage, useMenu, type MenuItem } from '../components/common'
import SearchPanel from '../components/SearchPanel'
import ArtPicker from '../components/ArtPicker'
import CardDetail from '../components/CardDetail'
import { getCards, getPrintings, rememberCard } from '../cardCache'
import { importDeckText } from './Decks'
import { t } from '@shared/i18n'

type Section = 'commanders' | 'main' | 'sideboard' | 'maybeboard'

const SECTION_LABEL: Record<Section, string> = { commanders: 'Comandante', main: 'Principal', sideboard: 'Sideboard', maybeboard: 'Talvez' }

const GROUPS: { key: string; label: string; test: (t: string) => boolean }[] = [
  { key: 'creature', label: 'Criaturas', test: (t) => /\bCreature\b/.test(t) },
  { key: 'planeswalker', label: 'Planeswalkers', test: (t) => /\bPlaneswalker\b/.test(t) },
  { key: 'instant', label: 'Mágicas instantâneas', test: (t) => /\bInstant\b/.test(t) },
  { key: 'sorcery', label: 'Feitiços', test: (t) => /\bSorcery\b/.test(t) },
  { key: 'artifact', label: 'Artefatos', test: (t) => /\bArtifact\b/.test(t) },
  { key: 'enchantment', label: 'Encantamentos', test: (t) => /\bEnchantment\b/.test(t) },
  { key: 'battle', label: 'Batalhas', test: (t) => /\bBattle\b/.test(t) },
  { key: 'land', label: 'Terrenos', test: (t) => /\bLand\b/.test(t) },
  { key: 'other', label: 'Outros', test: () => true }
]

function groupOf(card?: CardData): string {
  if (!card) return 'other'
  const front = card.faces?.[0]?.typeLine ?? card.typeLine
  return GROUPS.find((g) => g.test(front))!.key
}

export default function DeckEditor() {
  const deckId = useApp((s) => s.editingDeckId)
  const go = useApp((s) => s.go)
  const toast = useApp((s) => s.toast)
  const openMenu = useMenu((s) => s.open)
  const [deck, setDeck] = useState<Deck | null>(null)
  const [cards, setCards] = useState<Record<string, CardData>>({})
  const [prints, setPrints] = useState<Record<string, Printing>>({})
  const [tab, setTab] = useState<Section>('main')
  const [hover, setHover] = useState<{ oracleId: string; printingId?: string; finish?: CardFinish } | null>(null)
  const [art, setArt] = useState<{ section: Section; oracleId: string } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [basics, setBasics] = useState<Record<string, CardData>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<Deck | null>(null)

  // Carrega o deck
  useEffect(() => {
    if (!deckId) return
    window.kard.decks.get(deckId).then(async (d) => {
      if (!d) return
      const all = [...d.commanders, ...d.main, ...d.sideboard, ...d.maybeboard]
      const cs = await getCards(all.map((c) => c.oracleId))
      setCards(cs)
      setDeck(d)
      latest.current = d
    })
    window.kard.db.basicLands().then((b) => {
      setBasics(b)
      Object.values(b).forEach(rememberCard)
    })
  }, [deckId])

  // Impressões escolhidas (para miniaturas)
  useEffect(() => {
    if (!deck) return
    const ids = [...deck.commanders, ...deck.main, ...deck.sideboard, ...deck.maybeboard].map((c) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId).filter(Boolean) as string[]
    getPrintings(ids).then(setPrints)
  }, [deck, cards])

  const persist = useCallback(async () => {
    const d = latest.current
    if (!d) return
    setSaveState('saving')
    await window.kard.decks.save(d)
    setSaveState('saved')
  }, [])

  const update = useCallback(
    (fn: (d: Deck) => Deck) => {
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
        if (latest.current) window.kard.decks.save(latest.current)
      }
    },
    []
  )

  const ensureCard = async (oracleId: string) => {
    if (cards[oracleId]) return cards[oracleId]
    const r = await getCards([oracleId])
    setCards((c) => ({ ...c, ...r }))
    return r[oracleId]
  }

  const add = async (c: CardSummary | CardData, section: Section = tab, qty = 1) => {
    const card = await ensureCard(c.oracleId)
    if (!card) return
    update((d) => {
      const list = d[section]
      const ex = list.find((x) => x.oracleId === c.oracleId)
      if (section === 'commanders') {
        if (ex) return d
        if (d.commanders.length >= 2) {
          toast(t('No máximo 2 comandantes.'), 'error')
          return d
        }
        list.push({ oracleId: c.oracleId, qty: 1, name: card.name })
        // remove do principal, se estiver lá
        d.main = d.main.filter((x) => x.oracleId !== c.oracleId)
        return d
      }
      if (ex) ex.qty += qty
      else list.push({ oracleId: c.oracleId, qty, name: card.name })
      return d
    })
  }

  const setQty = (section: Section, oracleId: string, qty: number) =>
    update((d) => {
      const list = d[section]
      const ex = list.find((x) => x.oracleId === oracleId)
      if (!ex) return d
      ex.qty = qty
      d[section] = list.filter((x) => x.qty > 0)
      return d
    })

  const move = (from: Section, to: Section, oracleId: string) =>
    update((d) => {
      const ex = d[from].find((x) => x.oracleId === oracleId)
      if (!ex) return d
      d[from] = d[from].filter((x) => x.oracleId !== oracleId)
      const target = d[to].find((x) => x.oracleId === oracleId)
      if (to === 'commanders') {
        if (!target) d.commanders.push({ ...ex, qty: 1 })
        if (ex.qty > 1) d[from].push({ ...ex, qty: ex.qty - 1 })
      } else if (target) target.qty += ex.qty
      else d[to].push({ ...ex })
      return d
    })

  const setPrinting = (section: Section, oracleId: string, printingId: string) =>
    update((d) => {
      const ex = d[section].find((x) => x.oracleId === oracleId)
      if (ex) ex.printingId = printingId
      return d
    })

  const setFinish = (section: Section, oracleId: string, finish: CardFinish | undefined) =>
    update((d) => {
      const ex = d[section].find((x) => x.oracleId === oracleId)
      if (ex) {
        if (finish) ex.finish = finish
        else delete ex.finish
      }
      return d
    })

  const validation = useMemo(() => (deck ? validateDeck(deck, cards) : null), [deck, cards])
  const fmt = deck ? getFormat(deck.format) : null
  const cmdFormat = deck ? isCommanderFormat(deck.format) : false

  const inDeck = useMemo(() => {
    const m: Record<string, number> = {}
    if (!deck) return m
    for (const c of [...deck.commanders, ...deck.main]) m[c.oracleId] = (m[c.oracleId] ?? 0) + c.qty
    return m
  }, [deck])

  const stats = useMemo(() => {
    if (!deck) return null
    const curve = [0, 0, 0, 0, 0, 0, 0, 0]
    const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    let lands = 0
    for (const c of [...deck.commanders, ...deck.main]) {
      const card = cards[c.oracleId]
      if (!card) continue
      if (/\bLand\b/.test(card.faces?.[0]?.typeLine ?? card.typeLine)) {
        lands += c.qty
        continue
      }
      curve[Math.min(7, Math.floor(card.cmc))] += c.qty
      for (const s of card.manaCost.match(/\{[^}]+\}/g) ?? []) {
        for (const ch of s.slice(1, -1).split('/')) if (colors[ch] !== undefined) colors[ch] += c.qty
      }
    }
    return { curve, colors, lands }
  }, [deck, cards])

  if (!deck || !fmt) return <div className="page">{t('Carregando deck...')}</div>

  const identity = cmdFormat && deck.commanders.length ? validation?.identity : undefined
  const thumbOf = (c: DeckCard) => c.printingId ?? cards[c.oracleId]?.defaultPrintingId

  const lineMenu = (section: Section, c: DeckCard): MenuItem[] => {
    const items: MenuItem[] = [
      { label: `🎨 ${t('Escolher arte...')}`, onClick: () => setArt({ section, oracleId: c.oracleId }) },
      { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.oracleId) },
      'sep'
    ]
    for (const s of ['main', 'sideboard', 'maybeboard'] as Section[]) {
      if (s !== section && (s !== 'sideboard' || fmt.sideboardMax > 0 || section === 'sideboard')) items.push({ label: t('Mover para {section}', { section: t(SECTION_LABEL[s]) }), onClick: () => move(section, s, c.oracleId) })
    }
    if (cmdFormat && section !== 'commanders') items.push({ label: `👑 ${t('Definir como comandante')}`, onClick: () => move(section, 'commanders', c.oracleId) })
    if (section === 'commanders') items.push({ label: t('Mover para o principal'), onClick: () => move('commanders', 'main', c.oracleId) })
    const pr = prints[thumbOf(c) ?? '']
    const forced = finishOf(pr) // impressão que só existe em foil/etched
    if (!forced) {
      items.push({ header: t('Acabamento') })
      items.push({ label: `${!c.finish ? '● ' : ''}${t('Normal')}`, onClick: () => setFinish(section, c.oracleId, undefined) })
      for (const f of ['foil', 'etched'] as CardFinish[]) {
        if (!canChooseFinish(pr, f)) continue
        items.push({ label: `${c.finish === f ? '● ' : ''}${f === 'foil' ? `✨ ${t('Foil')}` : `✨ ${t('Etched (foil gravado)')}`}`, onClick: () => setFinish(section, c.oracleId, f) })
      }
      items.push('sep')
    }
    items.push({ label: `🖼 ${t('Usar como capa do deck')}`, onClick: () => update((d) => ({ ...d, coverPrintingId: thumbOf(c) })) })
    items.push('sep', { label: `🗑 ${t('Remover')}`, onClick: () => setQty(section, c.oracleId, 0) })
    return items
  }

  const searchMenu = (c: CardSummary): MenuItem[] => {
    const items: MenuItem[] = [
      { label: t('Adicionar ao principal'), onClick: () => add(c, 'main') },
      { label: t('Adicionar 4 ao principal'), onClick: () => add(c, 'main', 4) }
    ]
    if (fmt.sideboardMax > 0) items.push({ label: t('Adicionar ao sideboard'), onClick: () => add(c, 'sideboard') })
    items.push({ label: t('Adicionar ao "talvez"'), onClick: () => add(c, 'maybeboard') })
    if (cmdFormat) items.push({ label: `👑 ${t('Definir como comandante')}`, onClick: () => add(c, 'commanders') })
    items.push('sep', { label: `🔍 ${t('Ver detalhes')}`, onClick: () => setDetail(c.oracleId) })
    return items
  }

  const renderLine = (section: Section, c: DeckCard) => {
    const card = cards[c.oracleId]
    const pid = thumbOf(c)
    const pr = pid ? prints[pid] : undefined
    const finish = finishOf(pr, c.finish)
    const thumb = pr?.img.artCrop ? (
      <img className="thumb" src={`kard-img://card/${pid}/art/0`} onClick={() => setArt({ section, oracleId: c.oracleId })} title={t('Escolher arte')} />
    ) : (
      <div className="thumb" onClick={() => setArt({ section, oracleId: c.oracleId })} title={t('Escolher arte')} />
    )
    return (
      <div
        key={`${section}-${c.oracleId}`}
        className="deck-line"
        onMouseEnter={() => setHover({ oracleId: c.oracleId, printingId: pid, finish })}
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
          title={[card?.name ?? c.name, pr && `${pr.setName || pr.set.toUpperCase()} (${pr.set.toUpperCase()} #${pr.collectorNumber})`].filter(Boolean).join('\n')}
        >
          {card?.localName ?? card?.name ?? c.name}
          {pr && (
            <span className="muted small">
              {' '}
              · {pr.set.toUpperCase()}
              {pr.lang !== 'en' ? ` · ${pr.lang}` : ''}
              {finish ? ` · ✨${finish === 'etched' ? ' etched' : ''}` : ''}
            </span>
          )}
        </span>
        <ManaCost cost={card?.manaCost} />
        <span className="acts">
          {section !== 'commanders' && (
            <button className="icon-btn" onClick={() => setQty(section, c.oracleId, c.qty + 1)} title="+1">
              ＋
            </button>
          )}
          <button className="icon-btn" onClick={() => setQty(section, c.oracleId, c.qty - 1)} title="−1">
            −
          </button>
          <button
            className="icon-btn"
            onClick={(e) => openMenu(e.clientX, e.clientY, lineMenu(section, c))}
            title={t('Mais opções')}
          >
            ⋯
          </button>
        </span>
      </div>
    )
  }

  const mainGrouped = GROUPS.map((g) => ({ ...g, items: deck.main.filter((c) => groupOf(cards[c.oracleId]) === g.key) })).filter((g) => g.items.length)
  const sortByCmc = (list: DeckCard[]) => [...list].sort((a, b) => (cards[a.oracleId]?.cmc ?? 0) - (cards[b.oracleId]?.cmc ?? 0) || a.name.localeCompare(b.name))

  const hoverCard = hover ? cards[hover.oracleId] : undefined
  const maxCurve = Math.max(1, ...(stats?.curve ?? [1]))
  const totalCount = deckCount(deck.main) + deckCount(deck.commanders)

  const exportText = async () => {
    const txt = exportDeckText(deck, (pid) => {
      const p = pid ? prints[pid] : undefined
      return p ? { set: p.set, cn: p.collectorNumber } : null
    })
    await navigator.clipboard.writeText(txt)
    toast(t('Lista copiada para a área de transferência.'), 'success')
  }

  return (
    <div className="page" style={{ paddingBottom: 10 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn ghost" onClick={() => { persist(); go('decks') }}>
          ← Decks
        </button>
        <input value={deck.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} style={{ fontSize: 18, fontWeight: 700, width: 320 }} />
        <select value={deck.format} onChange={(e) => update((d) => ({ ...d, format: e.target.value as FormatId }))}>
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.name)}
            </option>
          ))}
        </select>
        <span className={`badge ${validation?.valid ? 'ok' : 'err'}`}>{validation?.valid ? `✓ ${t('Deck válido')}` : `✕ ${validation?.errors.length === 1 ? t('1 problema') : t('{n} problemas', { n: validation?.errors.length ?? 0 })}`}</span>
        <span className="badge">
          {totalCount} {fmt.exactSize ? `/ ${fmt.exactSize}` : t('(mín. {n})', { n: fmt.minMain })}
        </span>
        <span className="small muted">{saveState === 'saved' ? t('Salvo') : saveState === 'saving' ? t('Salvando...') : t('Alterações pendentes')}</span>
        <span className="right row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setImportOpen(true)}>
            ⇩ {t('Importar')}
          </button>
          <button className="btn sm" onClick={exportText}>
            ⇧ {t('Exportar')}
          </button>
          <button className="btn sm success" onClick={async () => { await persist(); go('play', { deckId: deck.id }) }}>
            ⚔ {t('Jogar')}
          </button>
        </span>
      </div>

      <div className="editor">
        {/* Busca */}
        <div className="panel">
          <SearchPanel
            format={deck.format}
            identity={identity}
            inDeck={inDeck}
            onPick={(c) => setDetail(c.oracleId)}
            quickAdd={(c) => add(c, tab === 'commanders' ? 'main' : tab)}
            onHover={(c) => {
              if (!c) return
              setHover({ oracleId: c.oracleId, printingId: c.defaultPrintingId })
              // Cartas da busca ainda não estão no cache do deck: carrega para a pré-visualização.
              if (!cards[c.oracleId]) ensureCard(c.oracleId)
            }}
            menuFor={searchMenu}
            pageSize={90}
          />
          <div className="row small muted" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
            {t('Terrenos básicos:')}
            {Object.entries(basics).map(([color, card]) => (
              <button key={color} className="btn sm" onClick={() => add(card, 'main')} title={card.localName ?? card.name}>
                <span className={`pip ${color}`} /> +1
              </button>
            ))}
          </div>
        </div>

        {/* Lista do deck */}
        <div className="panel">
          <div className="tabs">
            {(['main', 'sideboard', 'maybeboard'] as Section[])
              .filter((s) => s !== 'sideboard' || fmt.sideboardMax > 0 || deck.sideboard.length > 0)
              .map((s) => (
                <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)}>
                  {t(SECTION_LABEL[s])} ({deckCount(deck[s]) + (s === 'main' ? deckCount(deck.commanders) : 0)})
                </button>
              ))}
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            {tab === 'main' && (
              <>
                {cmdFormat && (
                  <div className="deck-group">
                    <h4>
                      <span>👑 {fmt.commander === 'oathbreaker' ? t('Oathbreaker / assinatura') : t('Comandante')}</span>
                      <span>{deck.commanders.length}</span>
                    </h4>
                    {deck.commanders.length === 0 && <div className="small muted">{t('Clique com o botão direito em uma carta lendária da busca → "Definir como comandante".')}</div>}
                    {deck.commanders.map((c) => renderLine('commanders', c))}
                  </div>
                )}
                {mainGrouped.map((g) => (
                  <div key={g.key} className="deck-group">
                    <h4>
                      <span>{t(g.label)}</span>
                      <span>{deckCount(g.items)}</span>
                    </h4>
                    {sortByCmc(g.items).map((c) => renderLine('main', c))}
                  </div>
                ))}
                {deck.main.length === 0 && <div className="muted small" style={{ marginTop: 20 }}>{t('Clique no "＋" das cartas da busca para adicioná-las ao deck. Botão direito mostra mais opções.')}</div>}
              </>
            )}
            {tab !== 'main' && (
              <div className="deck-group">
                {sortByCmc(deck[tab]).map((c) => renderLine(tab, c))}
                {deck[tab].length === 0 && <div className="muted small">{t('Vazio. Clique no "＋" das cartas da busca para adicionar aqui.')}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Pré-visualização e estatísticas */}
        <div className="panel">
          <div className="scroll" style={{ flex: 1 }}>
            {hoverCard ? (
              <>
                <FlippableCard
                  printingId={hover?.printingId}
                  layout={hoverCard.layout}
                  resetKey={hover?.oracleId}
                  foil={hover?.finish}
                  size="normal"
                  frontFallback={hasBackImage(hoverCard.layout) ? faceFallback(hoverCard, 0) : { name: hoverCard.localName ?? hoverCard.name, manaCost: hoverCard.manaCost, typeLine: hoverCard.localTypeLine ?? hoverCard.typeLine, text: hoverCard.localText ?? hoverCard.oracleText, power: hoverCard.power, toughness: hoverCard.toughness, colors: hoverCard.colors }}
                  backFallback={faceFallback(hoverCard, 1)}
                />
                <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 8, color: 'var(--muted)' }}>
                  <ManaText text={hoverCard.localText ?? hoverCard.oracleText} />
                </div>
              </>
            ) : (
              <div className="muted small">{t('Passe o mouse sobre uma carta para ver os detalhes.')}</div>
            )}
            <h4 style={{ marginBottom: 4 }}>{t('Curva de mana')}</h4>
            <div className="curve">
              {stats?.curve.map((n, i) => (
                <div key={i} className="bar" style={{ height: `${(n / maxCurve) * 100}%` }}>
                  <span>{n || ''}</span>
                </div>
              ))}
            </div>
            <div className="curve-labels">
              {['0', '1', '2', '3', '4', '5', '6', '7+'].map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
            <div className="row small" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
              {stats &&
                Object.entries(stats.colors)
                  .filter(([, n]) => n > 0)
                  .map(([c, n]) => (
                    <span key={c} className="row" style={{ gap: 4 }}>
                      <span className={`pip ${c}`} /> {n}
                    </span>
                  ))}
              <span className="muted">{t('Terrenos: {n}', { n: stats?.lands ?? 0 })}</span>
            </div>
            <h4 style={{ marginBottom: 4 }}>{t('Validação ({format})', { format: t(fmt.name) })}</h4>
            {validation && validation.errors.length === 0 && <div className="small" style={{ color: 'var(--ok)' }}>{t('Nenhum problema encontrado.')}</div>}
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
        <ArtPicker
          oracleId={art.oracleId}
          selected={deck[art.section].find((c) => c.oracleId === art.oracleId)?.printingId}
          onSelect={(pid) => setPrinting(art.section, art.oracleId, pid)}
          onSetCover={(pid) => {
            update((d) => ({ ...d, coverPrintingId: pid }))
            toast(t('Capa do deck atualizada.'), 'success')
          }}
          onClose={() => setArt(null)}
        />
      )}
      {detail && <CardDetail oracleId={detail} onClose={() => setDetail(null)} />}
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
                  const { deck: merged, missing } = await importDeckText(importText, deck)
                  const all = [...merged.commanders, ...merged.main, ...merged.sideboard, ...merged.maybeboard]
                  const cs = await getCards(all.map((c) => c.oracleId))
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
          <textarea rows={14} style={{ width: '100%' }} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'4 Lightning Bolt\n4 Goblin Guide (ZEN) 126\n\nSideboard\n2 Pyroblast'} />
        </Modal>
      )}
    </div>
  )
}
