// Escolha da impressão (arte) de uma carta de um jogo genérico no deck.
import { useEffect, useState } from 'react'
import type { GameId, GCardDetails } from '@shared/games/types'
import { t, fmtDate } from '@shared/i18n'
import { Modal } from '../components/common'
import { GameCardImage, rememberGCard, rememberGPrintings } from './gameCommon'

interface Props {
  game: GameId
  cardId: string
  selected?: string
  onSelect: (printingId: string) => void
  onClose: () => void
  onSetCover?: (printingId: string) => void
}

export default function GameArtPicker({ game, cardId, selected, onSelect, onClose, onSetCover }: Props) {
  const [details, setDetails] = useState<GCardDetails | null>(null)
  const [current, setCurrent] = useState<string | undefined>(selected)

  useEffect(() => {
    window.kard.games.details(game, cardId).then((d) => {
      setDetails(d)
      if (d) {
        rememberGCard(game, d.card)
        rememberGPrintings(game, d.printings)
        if (!selected) setCurrent(d.card.defaultPrintingId)
      }
    })
  }, [game, cardId, selected])

  const list = details?.printings ?? []

  return (
    <Modal
      title={t('Escolher arte — {name}', { name: details?.card.localName ?? details?.card.name ?? '' })}
      onClose={onClose}
      width={1100}
      footer={
        <>
          {onSetCover && current && (
            <button className="btn" onClick={() => onSetCover(current)}>
              🖼 {t('Usar como capa do deck')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="btn primary"
            disabled={!current}
            onClick={() => {
              if (current) onSelect(current)
              onClose()
            }}
          >
            {t('Usar esta arte')}
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted small">{list.length === 1 ? t('1 impressão') : t('{n} impressões', { n: list.length })}</span>
      </div>
      {!details && <div className="muted">{t('Carregando impressões...')}</div>}
      <div className="art-grid">
        {list.map((p) => (
          <div
            key={p.id}
            className={`art-item ${current === p.id ? 'selected' : ''}`}
            onClick={() => setCurrent(p.id)}
            onDoubleClick={() => {
              onSelect(p.id)
              onClose()
            }}
          >
            <GameCardImage game={game} printingId={p.id} card={details?.card} />
            <div className="meta">
              <b style={{ color: 'var(--text)' }}>{p.setName}</b>
              {p.code && <> ({p.code})</>}
              <br />
              {[p.rarity, p.variant && t(p.variant), p.releasedAt && fmtDate(p.releasedAt)].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
