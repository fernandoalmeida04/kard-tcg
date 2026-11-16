import { useEffect, useMemo, useState } from 'react'
import type { CardDetails, Printing } from '@shared/types'
import { LANGUAGES } from '@shared/types'
import { CardImage, Modal, finishOf } from './common'
import { t } from '@shared/i18n'
import { rememberCard, rememberPrintings } from '../cardCache'

const TAG_LABEL: Record<string, string> = {
  promo: 'Promo',
  'full-art': 'Arte total',
  textless: 'Sem texto',
  borderless: 'Sem borda',
  showcase: 'Showcase',
  extended: 'Arte estendida',
  etched: 'Etched',
  variation: 'Variação'
}

const FINISH_LABEL: Record<string, string> = { nonfoil: 'Normal', foil: 'Foil', etched: 'Etched' }

const RARITY_LABEL: Record<string, string> = { common: 'Comum', uncommon: 'Incomum', rare: 'Rara', mythic: 'Mítica', special: 'Especial', bonus: 'Bônus' }

interface Props {
  oracleId: string
  selected?: string
  onSelect: (printingId: string) => void
  onClose: () => void
  onSetCover?: (printingId: string) => void
}

export default function ArtPicker({ oracleId, selected, onSelect, onClose, onSetCover }: Props) {
  const [details, setDetails] = useState<CardDetails | null>(null)
  const [lang, setLang] = useState<string>('all')
  const [current, setCurrent] = useState<string | undefined>(selected)

  useEffect(() => {
    window.kard.db.details(oracleId).then((d) => {
      setDetails(d)
      if (d) {
        rememberCard(d.card)
        rememberPrintings(d.printings)
        if (!selected) setCurrent(d.card.defaultPrintingId)
      }
    })
  }, [oracleId, selected])

  const langs = useMemo(() => [...new Set(details?.printings.map((p) => p.lang) ?? [])], [details])
  const list: Printing[] = useMemo(() => (details?.printings ?? []).filter((p) => lang === 'all' || p.lang === lang), [details, lang])

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
        <select className="right" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="all">{t('Todos os idiomas')}</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {LANGUAGES.find((x) => x.code === l)?.label ?? l}
            </option>
          ))}
        </select>
      </div>
      {!details && <div className="muted">{t('Carregando impressões...')}</div>}
      <div className="art-grid">
        {list.map((p) => (
          <div key={p.id} className={`art-item ${current === p.id ? 'selected' : ''}`} onClick={() => setCurrent(p.id)} onDoubleClick={() => { onSelect(p.id); onClose() }}>
            <CardImage printingId={p.id} fallback={{ name: p.localName ?? details?.card.name ?? '' }} foil={finishOf(p)} />
            <div className="meta">
              <b style={{ color: 'var(--text)' }}>{p.setName}</b> ({p.set.toUpperCase()} #{p.collectorNumber})
              <br />
              {p.releasedAt?.slice(0, 4)} · {LANGUAGES.find((x) => x.code === p.lang)?.label ?? p.lang} · {RARITY_LABEL[p.rarity] ? t(RARITY_LABEL[p.rarity]) : p.rarity}
              {p.tags.length > 0 && <br />}
              {p.tags.map((tag) => (TAG_LABEL[tag] ? t(TAG_LABEL[tag]) : tag)).join(' · ')}
              {p.finishes && p.finishes.length > 0 && (
                <>
                  <br />
                  {p.finishes.map((f) => (FINISH_LABEL[f] ? (f === 'nonfoil' ? '' : '✨ ') + t(FINISH_LABEL[f]) : f)).join(' · ')}
                  {!p.finishes.includes('nonfoil') && ` ${t('(só foil)')}`}
                </>
              )}
              {p.artist && (
                <>
                  <br />
                  🖌 {p.artist}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
