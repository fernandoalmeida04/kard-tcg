import { useEffect, useState } from 'react'
import type { CardDetails } from '@shared/types'
import { FORMATS } from '@shared/formats'
import { t } from '@shared/i18n'
import { CardImage, FlippableCard, ManaCost, ManaText, Modal, faceFallback } from './common'

const LEG_LABEL: Record<string, string> = { legal: 'Legal', restricted: 'Restrita', banned: 'Banida', not_legal: 'Não legal' }

export default function CardDetail({ oracleId, onClose, actions }: { oracleId: string; onClose: () => void; actions?: React.ReactNode }) {
  const [d, setD] = useState<CardDetails | null>(null)
  const [printing, setPrinting] = useState<string | undefined>()

  useEffect(() => {
    window.kard.db.details(oracleId).then((x) => {
      setD(x)
      setPrinting(x?.card.defaultPrintingId)
    })
  }, [oracleId])

  if (!d) return null
  const c = d.card
  const p = d.printings.find((x) => x.id === printing)
  const hasBack = Boolean(p?.img.backNormal)
  const faces = c.faces && c.faces.length > 1 ? c.faces : null

  return (
    <Modal title={c.localName ?? c.name} onClose={onClose} width={980} footer={actions}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ width: 300, flex: 'none' }}>
          <FlippableCard
            printingId={printing}
            flippable={hasBack}
            size="large"
            frontFallback={hasBack ? faceFallback(c, 0) : { name: c.localName ?? c.name, manaCost: c.manaCost, typeLine: c.localTypeLine ?? c.typeLine, text: c.localText ?? c.oracleText, power: c.power, toughness: c.toughness, colors: c.colors }}
            backFallback={faceFallback(c, 1)}
          />
        </div>
        <div className="grow col" style={{ gap: 12 }}>
          {(faces ?? [null]).map((f, i) => (
            <div key={i} className="panel" style={{ padding: 12 }}>
              <div className="row">
                <b>{f ? (f.localName ?? f.name) : (c.localName ?? c.name)}</b>
                {(f?.localName ?? c.localName) && <span className="muted small">({f ? f.name : c.name})</span>}
                <span className="right">
                  <ManaCost cost={f ? f.manaCost : c.manaCost} lg />
                </span>
              </div>
              <div className="muted small" style={{ margin: '4px 0 8px' }}>
                {f ? (f.localTypeLine ?? f.typeLine) : (c.localTypeLine ?? c.typeLine)}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45 }}>
                <ManaText text={f ? (f.localText ?? f.oracleText) : (c.localText ?? c.oracleText)} />
              </div>
              {(f?.localText ?? c.localText) && (
                <details style={{ marginTop: 8 }}>
                  <summary className="muted small">{t('Texto oracle (inglês)')}</summary>
                  <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    <ManaText text={f ? f.oracleText : c.oracleText} />
                  </div>
                </details>
              )}
              {(f ? f.power : c.power) !== undefined && (
                <div style={{ marginTop: 8, fontWeight: 700 }}>
                  {f ? f.power : c.power}/{f ? f.toughness : c.toughness}
                </div>
              )}
              {(f ? f.loyalty : c.loyalty) && <div style={{ marginTop: 8, fontWeight: 700 }}>{t('Lealdade: {n}', { n: (f ? f.loyalty : c.loyalty) ?? '' })}</div>}
            </div>
          ))}
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Legalidade')}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {FORMATS.filter((f) => f.legalityKey).map((f) => {
                const l = c.legalities[f.legalityKey!] ?? 'not_legal'
                return (
                  <span key={f.id} className={`badge ${l === 'legal' ? 'ok' : l === 'banned' ? 'err' : l === 'restricted' ? 'warn' : ''}`}>
                    {t(f.name)}: {t(LEG_LABEL[l] ?? l)}
                  </span>
                )
              })}
            </div>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Impressões ({n})', { n: d.printings.length })}
            </div>
            <div className="row wrap" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
              {d.printings.map((pr) => (
                <div key={pr.id} style={{ width: 82, cursor: 'pointer', opacity: pr.id === printing ? 1 : 0.7 }} onClick={() => setPrinting(pr.id)} title={`${pr.setName} · ${pr.lang}`}>
                  <CardImage printingId={pr.id} size="small" fallback={{ name: pr.set.toUpperCase() }} />
                  <div className="small muted" style={{ textAlign: 'center' }}>
                    {pr.set.toUpperCase()} · {pr.lang}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
