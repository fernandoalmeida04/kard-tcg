// Configurações → Mesa de jogo → Pokémon: onde ficam Deck/Descarte, Prêmios e Banco (com prévia).
import type { PkmMatLayout } from '@shared/types'
import { t } from '@shared/i18n'

export function PkmLayoutEditor({ layout, onChange, image, dim }: { layout: PkmMatLayout; onChange: (l: PkmMatLayout) => void; image?: string | null; dim: number }) {
  const set = <K extends keyof PkmMatLayout>(k: K, v: PkmMatLayout[K]) => onChange({ ...layout, [k]: v })
  const zones = (
    <div className="pkm-prev-col">
      {layout.prizes === 'withZones' && <div className="pkm-prev-box prizes">{t('Prêmios')}</div>}
      <div className="pkm-prev-box">{t('Deck')}</div>
      <div className="pkm-prev-box">{t('Descarte')}</div>
    </div>
  )
  const prizes = layout.prizes === 'opposite' ? (
    <div className="pkm-prev-col">
      <div className="pkm-prev-box prizes">{t('Prêmios')}</div>
    </div>
  ) : null
  const field = (
    <div className={`pkm-prev-field ${layout.bench === 'front' ? 'front' : ''}`}>
      <div className="pkm-prev-row">
        <div className="pkm-prev-box active">{t('Ativo')}</div>
      </div>
      <div className="pkm-prev-row">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="pkm-prev-box bench">
            {i === 2 ? t('Banco') : ''}
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="col" style={{ gap: 10, minWidth: 240 }}>
        <label className="field">
          {t('Deck e Descarte')}
          <select value={layout.zones} onChange={(e) => set('zones', e.target.value as PkmMatLayout['zones'])}>
            <option value="left">{t('À esquerda')}</option>
            <option value="right">{t('À direita')}</option>
          </select>
        </label>
        <label className="field">
          {t('Cartas de Prêmio')}
          <select value={layout.prizes} onChange={(e) => set('prizes', e.target.value as PkmMatLayout['prizes'])}>
            <option value="withZones">{t('Junto do Deck e do Descarte')}</option>
            <option value="opposite">{t('No lado oposto')}</option>
          </select>
        </label>
        <label className="field">
          {t('Banco')}
          <select value={layout.bench} onChange={(e) => set('bench', e.target.value as PkmMatLayout['bench'])}>
            <option value="back">{t('Atrás do Ativo (Ativo perto do centro)')}</option>
            <option value="front">{t('Na frente do Ativo (Banco perto do centro)')}</option>
          </select>
        </label>
      </div>
      <div className="col grow" style={{ gap: 4, minWidth: 280 }}>
        <span className="small muted">{t('Prévia do seu lado da mesa (o centro da mesa fica em cima):')}</span>
        <div className="pkm-prev" style={image ? { backgroundImage: `linear-gradient(rgba(4,6,16,${dim}), rgba(4,6,16,${dim})), url("${image}")` } : undefined}>
          {layout.zones === 'left' ? zones : prizes}
          {field}
          {layout.zones === 'left' ? prizes : zones}
        </div>
      </div>
    </div>
  )
}
