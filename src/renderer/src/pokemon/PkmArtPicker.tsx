// Escolha da impressão (arte) de uma carta de Pokémon no deck.
import { useEffect, useMemo, useState } from 'react'
import type { CardFinish } from '@shared/types'
import type { PkmCardDetails, PkmPrinting } from '@shared/pokemon/types'
import { t } from '@shared/i18n'
import { Modal } from '../components/common'
import { PkmCardImage, rememberPkmCard, rememberPkmPrintings } from './pkmCommon'
import { pkmVariantsLabel } from './PkmCardDetail'

// ---------------- Acabamentos (a partir de printing.variants) ----------------

/** Acabamento interno: 'normal' | 'foil' (holo) | 'reverse' (reverse holo). */
export type PkmFinishChoice = 'normal' | 'foil' | 'reverse'

/** Acabamentos em que a impressão existe (sem dados → todos). */
export function pkmFinishes(p: Pick<PkmPrinting, 'variants'> | undefined): PkmFinishChoice[] {
  const v = p?.variants
  if (!v || !(v.normal || v.holo || v.reverse)) return ['normal', 'foil', 'reverse']
  const out: PkmFinishChoice[] = []
  if (v.normal) out.push('normal')
  if (v.holo) out.push('foil')
  if (v.reverse) out.push('reverse')
  return out
}

/**
 * Acabamento visível de uma cópia: o escolhido (se a impressão o tiver) ou o primeiro disponível
 * (ex.: impressão que só existe em holo).
 */
export function pkmFinishOf(p: Pick<PkmPrinting, 'variants'> | undefined, chosen?: CardFinish): CardFinish | undefined {
  const avail = pkmFinishes(p)
  const want: PkmFinishChoice = chosen === 'foil' || chosen === 'reverse' ? chosen : 'normal'
  const f = avail.includes(want) ? want : avail[0]
  return f === 'normal' ? undefined : f
}

interface Props {
  cardId: string
  selected?: string
  onSelect: (printingId: string) => void
  onClose: () => void
  onSetCover?: (printingId: string) => void
}

export default function PkmArtPicker({ cardId, selected, onSelect, onClose, onSetCover }: Props) {
  const [details, setDetails] = useState<PkmCardDetails | null>(null)
  const [onlyStandard, setOnlyStandard] = useState(false)
  const [current, setCurrent] = useState<string | undefined>(selected)

  useEffect(() => {
    window.kard.pkm.details(cardId).then((d) => {
      setDetails(d)
      if (d) {
        rememberPkmCard(d.card)
        rememberPkmPrintings(d.printings)
        if (!selected) setCurrent(d.card.defaultPrintingId)
      }
    })
  }, [cardId, selected])

  const list: PkmPrinting[] = useMemo(() => (details?.printings ?? []).filter((p) => !onlyStandard || p.legal.standard), [details, onlyStandard])

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
        <label className="check small right">
          <input type="checkbox" checked={onlyStandard} onChange={(e) => setOnlyStandard(e.target.checked)} /> {t('Só impressões legais no Standard')}
        </label>
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
            <PkmCardImage printingId={p.id} card={details?.card} name={p.localName ?? details?.card.name} foil={pkmFinishOf(p)} />
            <div className="meta">
              <b style={{ color: 'var(--text)' }}>{p.setName}</b> ({p.setCode ?? p.set.toUpperCase()} #{p.localId})
              <br />
              {[p.releasedAt?.slice(0, 4), p.rarity, p.regulationMark && t('Marca {mark}', { mark: p.regulationMark })].filter(Boolean).join(' · ')}
              {pkmVariantsLabel(p) && (
                <>
                  <br />
                  {pkmVariantsLabel(p)}
                </>
              )}
              {p.illustrator && (
                <>
                  <br />
                  🖌 {p.illustrator}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
