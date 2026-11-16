// Lista de decks de um jogo genérico: criar, importar, duplicar e excluir.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { GameId, GDbStatus, GDeckSummary } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { emptyGDeck, limitOf } from '@shared/games/helpers'
import { Modal } from '../components/common'
import { ColorChip, GameCardImage, gMainLines, getGCards, importGameDeckText } from './gameCommon'
import { t, fmtDate } from '@shared/i18n'

export default function GameDecks({ game }: { game: GameId }) {
  return <Decks key={game} game={game} />
}

function Decks({ game }: { game: GameId }) {
  const def = getGame(game)!
  const firstFormat = def.formats[0]?.id ?? 'casual'
  const go = useApp((s) => s.go)
  const toast = useApp((s) => s.toast)
  const [db, setDb] = useState<GDbStatus | null>(null)
  const [decks, setDecks] = useState<GDeckSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState(() => t('Novo deck'))
  const [format, setFormat] = useState(firstFormat)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // Formatos em que a lista colada é legal (formato → erros). null = não verificado.
  const [formatErrors, setFormatErrors] = useState<Record<string, string[]> | null>(null)
  const [checking, setChecking] = useState(false)

  const reload = () => window.kard.games.decks.list(game).then(setDecks)
  useEffect(() => {
    reload()
    const refresh = () => window.kard.games.status(game).then(setDb)
    refresh()
    return window.kard.games.onProgress((g, p) => {
      if (g === game && (p.phase === 'idle' || p.phase === 'done')) refresh()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

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
        const { deck } = await importGameDeckText(def, text, emptyGDeck(def, '', firstFormat))
        const lines = gMainLines(def, deck)
        const cards = lines.length ? await getGCards(game, lines.map((c) => c.oracleId)) : {}
        if (cancelled) return
        const res: Record<string, string[]> = {}
        for (const f of def.formats) {
          const errs: string[] = []
          for (const dc of lines) {
            const c = cards[dc.oracleId]
            if (c && limitOf(def, c, f.id) === 0) errs.push(t('{name} não é legal em {format}.', { name: c.localName ?? c.name, format: t(f.name) }))
          }
          res[f.id] = [...new Set(errs)]
        }
        setFormatErrors(res)
        setFormat((cur) => {
          if (!res[cur]?.length) return cur
          return def.formats.find((f) => !res[f.id]?.length)?.id ?? cur
        })
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, importing, def, game, firstFormat])

  const formatBlocked = (id: string) => !!formatErrors?.[id]?.length

  const create = async () => {
    const d = await window.kard.games.decks.save(emptyGDeck(def, name.trim() || t('Novo deck'), format))
    setCreating(false)
    go('editor', { deckId: d.id })
  }

  const doImport = async () => {
    setBusy(true)
    try {
      const { deck, missing } = await importGameDeckText(def, text, emptyGDeck(def, name.trim() || t('Deck importado'), format))
      if (!deck.coverPrintingId) deck.coverPrintingId = gMainLines(def, deck).find((c) => c.printingId)?.printingId
      if (!deck.coverPrintingId) {
        const first = gMainLines(def, deck)[0]
        if (first) deck.coverPrintingId = (await getGCards(game, [first.oracleId]))[first.oracleId]?.defaultPrintingId
      }
      const saved = await window.kard.games.decks.save(deck)
      setImporting(false)
      setText('')
      if (missing.length) {
        const list = `${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`
        toast(missing.length === 1 ? t('1 carta não encontrada: {list}', { list }) : t('{n} cartas não encontradas: {list}', { n: missing.length, list }), 'error')
      } else toast(t('Deck importado!'), 'success')
      go('editor', { deckId: saved.id })
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (id: string) => {
    const d = await window.kard.games.decks.get(game, id)
    if (!d) return
    const copy = {
      ...emptyGDeck(def, t('{name} (cópia)', { name: d.name }), d.format),
      description: d.description,
      sections: structuredClone(d.sections),
      maybeboard: structuredClone(d.maybeboard),
      coverPrintingId: d.coverPrintingId
    }
    await window.kard.games.decks.save(copy)
    reload()
  }

  const remove = async (d: GDeckSummary) => {
    if (!confirm(t('Excluir o deck "{name}"?', { name: d.name }))) return
    await window.kard.games.decks.remove(game, d.id)
    reload()
  }

  const formatName = (id: string) => {
    const f = def.formats.find((x) => x.id === id)
    return f ? t(f.name) : id
  }

  const formatSelect = (checkLegality: boolean) => {
    const blockedCount = checkLegality ? def.formats.filter((f) => formatBlocked(f.id)).length : 0
    const desc = def.formats.find((f) => f.id === format)?.description
    return (
      <label className="field">
        {t('Formato')}
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {def.formats.map((f) => {
            const errs = checkLegality ? (formatErrors?.[f.id] ?? []) : []
            return (
              <option key={f.id} value={f.id} disabled={errs.length > 0} title={errs.slice(0, 8).join('\n')}>
                {t(f.name)}
                {errs.length > 0 ? ` — ${errs.length > 1 ? t('indisponível ({n} problemas)', { n: errs.length }) : t('indisponível (1 problema)')}` : ''}
              </option>
            )
          })}
        </select>
        {desc && <span className="small muted">{t(desc)}</span>}
        {checkLegality && checking && <span className="small muted">{t('Verificando formatos da lista…')}</span>}
        {checkLegality && !checking && blockedCount > 0 && (
          <span className="small muted">
            {blockedCount === 1 ? t('1 formato indisponível por cartas fora do formato.') : t('{n} formatos indisponíveis por cartas fora do formato.', { n: blockedCount })}
          </span>
        )}
      </label>
    )
  }

  const ready = !!db?.ready

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="grow">
          <h1>{t('Meus decks')}</h1>
          <div className="muted">{t('Monte decks de {game}, escolha a impressão de cada carta e valide as regras de construção.', { game: def.name })}</div>
        </div>
        <button
          className="btn"
          disabled={!ready}
          onClick={() => {
            setName(t('Deck importado'))
            setImporting(true)
          }}
        >
          ⇩ {t('Importar lista')}
        </button>
        <button
          className="btn primary"
          disabled={!ready}
          onClick={() => {
            setName(t('Novo deck'))
            setFormat(firstFormat)
            setCreating(true)
          }}
        >
          ＋ {t('Novo deck')}
        </button>
      </div>
      {db && !ready && (
        <div className="panel muted">
          {db.loading ? t('Carregando o banco de cartas...') : t('Baixe o banco de cartas antes de montar decks.')}{' '}
          {!db.loading && (
            <button className="btn sm primary" onClick={() => go('database')}>
              ⬇ {t('Baixar cartas')}
            </button>
          )}
        </div>
      )}
      {ready && decks.length === 0 && <div className="panel muted">{t('Nenhum deck ainda. Crie um novo ou importe uma lista.')}</div>}
      <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {decks.map((d) => (
          <div key={d.id} className="tile" onClick={() => go('editor', { deckId: d.id })}>
            <div className="g-cover" style={{ height: 150 }}>
              <GameCardImage game={game} printingId={d.coverPrintingId} name={d.name} />
            </div>
            <div style={{ padding: 12 }}>
              <div className="row">
                <b className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </b>
                <span className="g-deck-colors">
                  {d.colors.map((x) => (
                    <ColorChip key={x} def={def} color={x} size={14} />
                  ))}
                </span>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {formatName(d.format)} · {d.cardCount === 1 ? t('1 carta') : t('{n} cartas', { n: d.cardCount })} · {fmtDate(d.updatedAt)}
              </div>
              <div className="row" style={{ marginTop: 10, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn sm primary" onClick={() => go('editor', { deckId: d.id })}>
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
              <button className="btn primary" disabled={!text.trim() || checking || busy || formatBlocked(format)} onClick={doImport}>
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
              {t('Lista do deck (uma carta por linha, com a quantidade antes do nome ou do código da carta)')}
              <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={def.exampleList} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
