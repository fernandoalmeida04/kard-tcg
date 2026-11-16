// Detalhes de uma carta de Pokémon (modal): imagem grande, texto de regras, legalidade e impressões.
import { useEffect, useState } from 'react'
import type { PkmCard, PkmCardDetails, PkmPrinting, PkmType } from '@shared/pokemon/types'
import { PKM_CATEGORY_LABEL } from '@shared/pokemon/types'
import { t } from '@shared/i18n'
import { Modal } from '../components/common'
import { PkmCardImage, PkmCost, PkmText, PkmTypeIcon, pkmTypeLine, rememberPkmCard, rememberPkmPrintings } from './pkmCommon'

/** Rótulo do tipo de habilidade ("Ability" → "Habilidade"; Poké-Poder/Poké-Corpo ficam como estão). */
function abilityLabel(type: string): string {
  return type === 'Ability' ? t('Habilidade') : type
}

/** Variantes de acabamento de uma impressão, traduzidas ("Normal · Holo · Reverse holo"). */
export function pkmVariantsLabel(p: PkmPrinting): string {
  const v = p.variants
  const out: string[] = []
  if (v.normal) out.push(t('Normal (não holo)'))
  if (v.holo) out.push(`✨ ${t('Holo')}`)
  if (v.reverse) out.push(`✨ ${t('Reverse holo')}`)
  if (v.firstEdition) out.push(t('1ª edição'))
  return out.join(' · ')
}

/**
 * Texto de regras de uma carta: PS, tipos, habilidades, ataques, efeito de Treinador/Energia,
 * fraqueza/resistência/recuo. `english` mostra o texto original em inglês.
 */
export function PkmCardText({ card: c, large, english }: { card: PkmCard; large?: boolean; english?: boolean }) {
  const name = english ? c.name : (c.localName ?? c.name)
  const evolveFrom = english ? c.evolveFrom : (c.localEvolveFrom ?? c.evolveFrom)
  const effect = english ? c.effect : (c.localEffect ?? c.effect)
  return (
    <div className={`pkm-text ${large ? 'large' : ''}`}>
      <div className="pkm-head">
        <b className="grow">{name}</b>
        {c.hp ? (
          <span className="pkm-hp">
            {t('PS')} {c.hp}
          </span>
        ) : null}
        {c.category !== 'Trainer' && c.types.map((x) => <PkmTypeIcon key={x} type={x} size={large ? 20 : 16} />)}
      </div>
      <div className="muted small">
        {pkmTypeLine(c)}
        {evolveFrom ? ` · ${t('Evolui de {name}', { name: evolveFrom })}` : ''}
      </div>
      {(c.aceSpec || c.radiant || c.prismStar) && (
        <div className="row" style={{ gap: 6 }}>
          {c.aceSpec && <span className="badge warn">ACE SPEC</span>}
          {c.radiant && <span className="badge warn">{t('Pokémon Radiante')}</span>}
          {c.prismStar && <span className="badge warn">{t('Prisma ◇')}</span>}
        </div>
      )}
      {c.abilities.map((a, i) => (
        <div key={`a${i}`} className="pkm-block">
          <div className="pkm-attack-head">
            <span className="pkm-ability-tag">{abilityLabel(a.type)}</span>
            <span>{english ? a.name : (a.localName ?? a.name)}</span>
          </div>
          <div className="pkm-effect">
            <PkmText text={english ? a.effect : (a.localEffect ?? a.effect)} />
          </div>
        </div>
      ))}
      {c.attacks.map((a, i) => {
        const eff = english ? a.effect : (a.localEffect ?? a.effect)
        return (
          <div key={`k${i}`} className="pkm-block">
            <div className="pkm-attack-head">
              <PkmCost cost={a.cost} size={large ? 17 : 15} />
              <span>{english ? a.name : (a.localName ?? a.name)}</span>
              {a.damage && <span className="dmg">{a.damage}</span>}
            </div>
            {eff && (
              <div className="pkm-effect">
                <PkmText text={eff} />
              </div>
            )}
          </div>
        )
      })}
      {effect && (
        <div className="pkm-effect">
          <PkmText text={effect} />
        </div>
      )}
      {c.category === 'Pokemon' && (
        <div className="pkm-wrr">
          <span>
            {t('Fraqueza')}:{' '}
            {c.weaknesses.length
              ? c.weaknesses.map((w, i) => (
                  <span key={i} style={{ marginRight: 4 }}>
                    <PkmTypeIcon type={w.type} size={14} /> {w.value}
                  </span>
                ))
              : '—'}
          </span>
          <span>
            {t('Resistência')}:{' '}
            {c.resistances.length
              ? c.resistances.map((w, i) => (
                  <span key={i} style={{ marginRight: 4 }}>
                    <PkmTypeIcon type={w.type} size={14} /> {w.value}
                  </span>
                ))
              : '—'}
          </span>
          <span>
            {t('Custo de recuo')}: {c.retreat ? <PkmCost cost={Array<PkmType>(c.retreat).fill('Colorless')} size={14} /> : '0'}
          </span>
        </div>
      )}
    </div>
  )
}

/** O texto em inglês difere do texto mostrado (banco em outro idioma)? */
function hasLocalText(c: PkmCard): boolean {
  return Boolean(c.localName || c.localEffect || c.attacks.some((a) => a.localName || a.localEffect) || c.abilities.some((a) => a.localName || a.localEffect))
}

export default function PkmCardDetail({ cardId, onClose, actions }: { cardId: string; onClose: () => void; actions?: React.ReactNode }) {
  const [d, setD] = useState<PkmCardDetails | null>(null)
  const [printing, setPrinting] = useState<string | undefined>()

  useEffect(() => {
    window.kard.pkm.details(cardId).then((x) => {
      setD(x)
      if (x) {
        rememberPkmCard(x.card)
        rememberPkmPrintings(x.printings)
      }
      setPrinting(x?.card.defaultPrintingId)
    })
  }, [cardId])

  if (!d) return null
  const c = d.card
  const p = d.printings.find((x) => x.id === printing)
  const legal: { label: string; ok: boolean }[] = [
    { label: 'Standard', ok: c.legal.standard },
    { label: 'Expanded', ok: c.legal.expanded },
    { label: 'Ilimitado', ok: true }
  ]

  return (
    <Modal title={c.localName ?? c.name} onClose={onClose} width={980} footer={actions}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ width: 300, flex: 'none' }}>
          <PkmCardImage printingId={printing} quality="high" card={c} foil={p && !p.variants.normal && p.variants.holo && !p.variants.reverse ? 'foil' : undefined} />
          {p && (
            <div className="small muted" style={{ marginTop: 6, lineHeight: 1.4 }}>
              <b style={{ color: 'var(--text)' }}>{p.setName}</b> ({p.setCode ?? p.set.toUpperCase()} #{p.localId})
              <br />
              {[p.releasedAt?.slice(0, 4), p.rarity, p.regulationMark && t('Marca {mark}', { mark: p.regulationMark })].filter(Boolean).join(' · ')}
              {p.illustrator && (
                <>
                  <br />🖌 {p.illustrator}
                </>
              )}
            </div>
          )}
        </div>
        <div className="grow col" style={{ gap: 12 }}>
          <div className="panel" style={{ padding: 12 }}>
            {c.localName && c.localName !== c.name && <div className="muted small" style={{ marginBottom: 4 }}>{c.name}</div>}
            <PkmCardText card={c} large />
            {hasLocalText(c) && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted small">{t('Texto original (inglês)')}</summary>
                <div style={{ marginTop: 6 }}>
                  <PkmCardText card={c} english />
                </div>
              </details>
            )}
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Legalidade')}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {legal.map((l) => (
                <span key={l.label} className={`badge ${l.ok ? 'ok' : ''}`}>
                  {t(l.label)}: {l.ok ? t('Legal') : t('Não legal')}
                </span>
              ))}
              {c.regulationMarks.length > 0 && (
                <span className="badge" title={t('Marcas de regulamentação')}>
                  {t('Marcas de regulamentação')}: {c.regulationMarks.join(', ')}
                </span>
              )}
              <span className="badge">{t(PKM_CATEGORY_LABEL[c.category])}</span>
            </div>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {t('Impressões ({n})', { n: d.printings.length })}
            </div>
            <div className="row wrap" style={{ gap: 6, maxHeight: 240, overflow: 'auto' }}>
              {d.printings.map((pr) => (
                <div
                  key={pr.id}
                  style={{ width: 82, cursor: 'pointer', opacity: pr.id === printing ? 1 : 0.7 }}
                  onClick={() => setPrinting(pr.id)}
                  title={[pr.setName, pr.rarity, pkmVariantsLabel(pr)].filter(Boolean).join('\n')}
                >
                  <PkmCardImage printingId={pr.id} name={pr.setCode ?? pr.set.toUpperCase()} />
                  <div className="small muted" style={{ textAlign: 'center' }}>
                    {pr.setCode ?? pr.set.toUpperCase()} · {pr.localId}
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
