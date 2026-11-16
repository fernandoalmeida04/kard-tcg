import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Deck, DeckCard, DeckSummary, FormatId } from '@shared/types'
import { FORMATS, canBeCommander, cardLegalityErrors, emptyDeck, getFormat, isCommanderFormat, parseDeckText } from '@shared/formats'
import { CardImage, ColorPips, Modal } from '../components/common'
import { t, fmtDate } from '@shared/i18n'

export async function importDeckText(text: string, base: Deck): Promise<{ deck: Deck; missing: string[] }> {
  const lines = parseDeckText(text)
  const res = await window.kard.db.resolveNames(lines.map((l) => ({ name: l.name, set: l.set, cn: l.cn })))
  const missing: string[] = []
  const deck: Deck = { ...base, commanders: [...base.commanders], main: [...base.main], sideboard: [...base.sideboard], maybeboard: [...base.maybeboard] }
  lines.forEach((l, i) => {
    const r = res[i]
    if (!r.oracleId) {
      missing.push(l.name)
      return
    }
    const section: keyof Pick<Deck, 'commanders' | 'main' | 'sideboard' | 'maybeboard'> =
      l.section === 'commander' ? 'commanders' : l.section === 'sideboard' ? 'sideboard' : l.section === 'maybeboard' ? 'maybeboard' : 'main'
    const list = deck[section] as DeckCard[]
    const existing = list.find((c) => c.oracleId === r.oracleId)
    if (existing) {
      existing.qty += l.qty
      if (l.finish && !existing.finish) existing.finish = l.finish
    } else list.push({ oracleId: r.oracleId, printingId: r.printingId, qty: section === 'commanders' ? 1 : l.qty, name: r.name ?? l.name, ...(l.finish ? { finish: l.finish } : {}) })
  })
  // Commander sem seção "Commander": listas exportadas costumam trazer o comandante
  // num bloco separado (no fim ou no começo). Detecta 1–2 lendárias isoladas.
  if (isCommanderFormat(deck.format) && deck.commanders.length === 0) {
    const groups = [...new Set(lines.map((l) => l.group))]
    const fmt = getFormat(deck.format)
    for (const gid of [groups[groups.length - 1], groups[0]]) {
      if (groups.length < 2 || gid === undefined) break
      const idx = lines.map((l, i) => (l.group === gid && l.section === 'main' ? i : -1)).filter((i) => i >= 0)
      if (idx.length === 0 || idx.length > 2 || idx.some((i) => lines[i].qty !== 1 || !res[i].oracleId)) continue
      const cards = await window.kard.db.cards(idx.map((i) => res[i].oracleId!))
      if (!idx.every((i) => cards[res[i].oracleId!] && canBeCommander(cards[res[i].oracleId!], fmt))) continue
      for (const i of idx) {
        const oid = res[i].oracleId!
        const entry = deck.main.find((c) => c.oracleId === oid)
        if (!entry) continue
        entry.qty -= 1
        deck.commanders.push({ ...entry, qty: 1 })
      }
      deck.main = deck.main.filter((c) => c.qty > 0)
      break
    }
  }
  return { deck, missing }
}

export default function DecksPage() {
  const go = useApp((s) => s.go)
  const toast = useApp((s) => s.toast)
  const db = useApp((s) => s.db)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState(() => t('Novo deck'))
  const [format, setFormat] = useState<FormatId>('standard')
  const [text, setText] = useState('')

  // Formatos em que a lista colada é legal (formato → erros de legalidade/cópias). null = não verificado.
  const [formatErrors, setFormatErrors] = useState<Partial<Record<FormatId, string[]>> | null>(null)
  const [checking, setChecking] = useState(false)

  const reload = () => window.kard.decks.list().then(setDecks)
  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (!importing || !text.trim()) {
      setFormatErrors(null)
      setChecking(false)
      return
    }
    let cancelled = false
    setChecking(true)
    const timer = setTimeout(async () => {
      try {
        const { deck } = await importDeckText(text, emptyDeck('', 'casual'))
        const ids = [...new Set([...deck.commanders, ...deck.main, ...deck.sideboard].map((c) => c.oracleId))]
        const cards = ids.length ? await window.kard.db.cards(ids) : {}
        if (cancelled) return
        const res: Partial<Record<FormatId, string[]>> = {}
        for (const f of FORMATS) res[f.id] = cardLegalityErrors(deck, cards, f)
        setFormatErrors(res)
        setFormat((cur) => {
          if (!res[cur]?.length) return cur
          return FORMATS.find((f) => !res[f.id]?.length)?.id ?? cur
        })
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, importing])

  const formatBlocked = (id: FormatId) => !!formatErrors?.[id]?.length

  const create = async () => {
    const d = await window.kard.decks.save(emptyDeck(name.trim() || t('Novo deck'), format))
    setCreating(false)
    go('editor', { deckId: d.id })
  }

  const doImport = async () => {
    const { deck, missing } = await importDeckText(text, emptyDeck(name.trim() || t('Deck importado'), format))
    const saved = await window.kard.decks.save(deck)
    setImporting(false)
    setText('')
    if (missing.length) {
      const list = `${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`
      toast(missing.length === 1 ? t('1 carta não encontrada: {list}', { list }) : t('{n} cartas não encontradas: {list}', { n: missing.length, list }), 'error')
    } else toast(t('Deck importado!'), 'success')
    go('editor', { deckId: saved.id })
  }

  const duplicate = async (id: string) => {
    const d = await window.kard.decks.get(id)
    if (!d) return
    const copy = { ...emptyDeck(t('{name} (cópia)', { name: d.name }), d.format), commanders: d.commanders, main: d.main, sideboard: d.sideboard, maybeboard: d.maybeboard, coverPrintingId: d.coverPrintingId }
    await window.kard.decks.save(copy)
    reload()
  }

  const remove = async (d: DeckSummary) => {
    if (!confirm(t('Excluir o deck "{name}"?', { name: d.name }))) return
    await window.kard.decks.remove(d.id)
    reload()
  }

  const formatSelect = (checkLegality: boolean) => {
    const blockedCount = checkLegality ? FORMATS.filter((f) => formatBlocked(f.id)).length : 0
    return (
      <label className="field">
        {t('Formato')}
        <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
          {FORMATS.map((f) => {
            const errs = checkLegality ? formatErrors?.[f.id] ?? [] : []
            return (
              <option key={f.id} value={f.id} disabled={errs.length > 0} title={errs.slice(0, 8).join('\n')}>
                {t(f.name)}
                {errs.length > 0 ? ` — ${errs.length > 1 ? t('indisponível ({n} problemas)', { n: errs.length }) : t('indisponível (1 problema)')}` : ''}
              </option>
            )
          })}
        </select>
        <span className="small muted">{t(getFormat(format).description)}</span>
        {checkLegality && checking && <span className="small muted">{t('Verificando formatos da lista…')}</span>}
        {checkLegality && !checking && blockedCount > 0 && (
          <span className="small muted">
            {blockedCount === 1
              ? t('1 formato indisponível por cartas banidas, fora do formato ou cópias acima do limite.')
              : t('{n} formatos indisponíveis por cartas banidas, fora do formato ou cópias acima do limite.', { n: blockedCount })}
          </span>
        )}
      </label>
    )
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="grow">
          <h1>{t('Meus decks')}</h1>
          <div className="muted">{t('Crie decks para qualquer formato, escolha a arte de cada carta e valide as regras de construção.')}</div>
        </div>
        <button className="btn" disabled={!db?.ready} onClick={() => { setName(t('Deck importado')); setImporting(true) }}>
          ⇩ {t('Importar lista')}
        </button>
        <button className="btn primary" disabled={!db?.ready} onClick={() => { setName(t('Novo deck')); setCreating(true) }}>
          ＋ {t('Novo deck')}
        </button>
      </div>
      {!db?.ready && <div className="panel muted">{t('Baixe o banco de cartas antes de montar decks.')}</div>}
      {db?.ready && decks.length === 0 && <div className="panel muted">{t('Nenhum deck ainda. Crie um novo ou importe uma lista (formato MTG Arena/MTGO).')}</div>}
      <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {decks.map((d) => (
          <div key={d.id} className="tile" onClick={() => go('editor', { deckId: d.id })}>
            <div style={{ height: 150, overflow: 'hidden', background: '#111' }}>
              <CardImage printingId={d.coverPrintingId} size="art" />
            </div>
            <div style={{ padding: 12 }}>
              <div className="row">
                <b className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </b>
                <ColorPips colors={d.colors} />
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {t(getFormat(d.format).name)} · {t('{n} cartas', { n: d.cardCount })} · {fmtDate(d.updatedAt)}
              </div>
              <div className="row" style={{ marginTop: 10, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn sm success" onClick={() => go('play', { deckId: d.id })}>
                  ⚔ {t('Jogar')}
                </button>
                <button className="btn sm" onClick={() => go('editor', { deckId: d.id })}>
                  ✎ {t('Editar')}
                </button>
                <button className="btn sm" onClick={() => duplicate(d.id)} title={t('Duplicar')}>
                  ⧉
                </button>
                <button className="btn sm danger right" onClick={() => remove(d)} title={t('Excluir')}>
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Modal
          title={t('Novo deck')}
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                {t('Cancelar')}
              </button>
              <button className="btn primary" onClick={create}>
                {t('Criar')}
              </button>
            </>
          }
        >
          <div className="col">
            <label className="field">
              {t('Nome')}
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
            </label>
            {formatSelect(false)}
          </div>
        </Modal>
      )}

      {importing && (
        <Modal
          title={t('Importar lista de deck')}
          width={640}
          onClose={() => setImporting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setImporting(false)}>
                {t('Cancelar')}
              </button>
              <button className="btn primary" disabled={!text.trim() || checking || formatBlocked(format)} onClick={doImport}>
                {t('Importar')}
              </button>
            </>
          }
        >
          <div className="col">
            <label className="field">
              {t('Nome')}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {formatSelect(true)}
            <label className="field">
              {t('Lista (uma carta por linha: "4 Lightning Bolt", "1 Sol Ring (CMR) 263"; seções Commander / Deck / Sideboard)')}
              <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n35 Forest'} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
