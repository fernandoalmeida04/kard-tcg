// Detalhes de uma carta de um jogo genérico (modal): imagem grande, texto, estatísticas, legalidade e impressões.
import { useEffect, useState } from 'react'
import type { GameDef, GameId, GCard, GCardDetails, GPrinting } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { limitOf } from '@shared/games/helpers'
import { t, fmtDate } from '@shared/i18n'
import { Modal } from '../components/common'
import { ColorChip, GameCardImage, rememberGCard, rememberGPrintings } from './gameCommon'

/** Linha de metadados de uma impressão: coleção, código, raridade, variante e data. */
export function printingMeta(p: GPrinting): string {
  return [p.code, p.rarity, p.variant && t(p.variant), p.releasedAt && fmtDate(p.releasedAt)].filter(Boolean).join(' · ')
}

/** Nome, tipo, cores, estatísticas e texto de regras de uma carta. `english` mostra o texto original. */
export function GameCardText({ def, card: c, large, english }: { def: GameDef; card: GCard; large?: boolean; english?: boolean }) {
  const stats = def.stats(c)
  const text = english ? c.text : (c.localText ?? c.text)
  const text2 = english ? c.text2 : (c.localText2 ?? c.text2)
  return (
    <div className={`g-text ${large ? 'large' : ''}`}>
      <div className="g-head">
        <b className="grow">{english ? c.name : (c.localName ?? c.name)}</b>
        {c.colors.map((x) => (
          <ColorChip key={x} def={def} color={x} label />
        ))}
      </div>
      <div className="muted small">{def.typeLine(c)}</div>
      {stats.length > 0 && (
        <div className="g-stats">
          {stats.map((s, i) => (
            <span key={i}>
              <span className="muted">{s.label}</span> <b>{s.value}</b>
            </span>
          ))}
        </div>
      )}
      {text && <div className="g-effect">{text}</div>}
      {text2 && <div className="g-effect g-effect2">{text2}</div>}
    </div>
  )
}

function hasLocalText(c: GCard): boolean {
  return Boolean((c.localName && c.localName !== c.name) || c.localText || c.localText2)
}

export default function GameCardDetail({ game, cardId, onClose, actions }: { game: GameId; cardId: string; onClose: () => void; actions?: React.ReactNode }) {
  const def = getGame(game)!
  const [d, setD] = useState<GCardDetails | null>(null)
  const [printing, setPrinting] = useState<string | undefined>()

  useEffect(() => {
    window.kard.games.details(game, cardId).then((x) => {
      setD(x)
      if (x) {
        rememberGCard(game, x.card)
        rememberGPrintings(game, x.printings)
      }
      setPrinting(x?.card.defaultPrintingId)
    })
  }, [game, cardId])

  if (!d) return null
  const c = d.card
  const p = d.printings.find((x) => x.id === printing)
  const category = def.categories.find((x) => x.id === c.category)

  return (
    <Modal title={c.localName ?? c.name} onClose={onClose} width={980} footer={actions}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ width: def.aspect > 1 ? 400 : 300, flex: 'none' }}>
          <GameCardImage game={game} printingId={printing} size="large" card={c} />
          {p && (
            <div className="small muted" style={{ marginTop: 6, lineHeight: 1.4 }}>
              <b style={{ color: 'var(--text)' }}>{p.setName}</b>
              <br />
              {printingMeta(p)}
            </div>
          )}
        </div>
        <div className="grow col" style={{ gap: 12, minWidth: 0 }}>
          <div className="panel" style={{ padding: 12 }}>
            {c.localName && c.localName !== c.name && (
              <div className="muted small" style={{ marginBottom: 4 }}>
                {c.name}
              </div>
            )}
            <GameCardText def={def} card={c} large />
            {hasLocalText(c) && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted small">{t('Texto original (inglês)')}</summary>
                <div style={{ marginTop: 6 }}>
                  <GameCardText def={def} card={c} english />
                </div>
              </details>
            )}
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Legalidade')}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {def.formats.map((f) => {
                const lim = limitOf(def, c, f.id)
                const status = lim === 0 ? t('Proibida') : lim < def.defaultLimit ? t('Limitada ({n})', { n: lim }) : t('Permitida')
                return (
                  <span key={f.id} className={`badge ${lim === 0 ? 'err' : lim < def.defaultLimit ? 'warn' : 'ok'}`} title={t(f.description)}>
                    {t(f.name)}: {status}
                  </span>
                )
              })}
              {category && <span className="badge">{t(category.label)}</span>}
            </div>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Impressões ({n})', { n: d.printings.length })}
            </div>
            <div className="row wrap" style={{ gap: 6, maxHeight: 260, overflow: 'auto' }}>
              {d.printings.map((pr) => (
                <div
                  key={pr.id}
                  style={{ width: def.aspect > 1 ? 120 : 82, cursor: 'pointer', opacity: pr.id === printing ? 1 : 0.7 }}
                  onClick={() => setPrinting(pr.id)}
                  title={[pr.setName, printingMeta(pr)].filter(Boolean).join('\n')}
                >
                  <GameCardImage game={game} printingId={pr.id} name={pr.code ?? pr.setName} />
                  <div className="small muted" style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pr.code ?? pr.set}
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
