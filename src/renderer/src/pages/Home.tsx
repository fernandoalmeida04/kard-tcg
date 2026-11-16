import { useEffect, useState } from 'react'
import { useApp } from '../store'
import logo from '../assets/logo.png'
import type { DeckSummary } from '@shared/types'
import { LANGUAGES } from '@shared/types'
import { getFormat } from '@shared/formats'
import { CardImage, ColorPips } from '../components/common'
import { t, fmtNum } from '@shared/i18n'

export default function HomePage() {
  const db = useApp((s) => s.db)
  const settings = useApp((s) => s.settings)
  const go = useApp((s) => s.go)
  const [decks, setDecks] = useState<DeckSummary[]>([])

  useEffect(() => {
    window.kard.decks.list().then(setDecks)
  }, [])

  const langLabel = LANGUAGES.find((l) => l.code === db?.lang)?.label ?? db?.lang

  return (
    <div className="page">
      <div className="hero">
        <img src={logo} alt="" />
        <div className="grow">
          <h1>Kard - TCG Simulator</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            {t('Simulador de trading card games. Começando por Magic: The Gathering: monte decks, escolha as artes e jogue contra o bot com um juiz de regras.')}
          </div>
        </div>
      </div>

      {db && !db.ready && !db.loading && (
        <div className="panel" style={{ marginBottom: 18, borderColor: 'var(--accent)' }}>
          <div className="row">
            <div className="grow">
              <h3 style={{ margin: 0 }}>{t('Primeiro passo: baixe o banco de cartas')}</h3>
              <div className="muted small">{t('O Kard baixa todas as cartas de Magic (dados e traduções) para a pasta database do programa.')}</div>
            </div>
            <button className="btn primary lg" onClick={() => go('database')}>
              ⬇ {t('Baixar cartas')}
            </button>
          </div>
        </div>
      )}

      <div className="row wrap" style={{ alignItems: 'stretch', marginBottom: 18 }}>
        <div className="panel grow">
          <div className="muted small">{t('Banco de cartas')}</div>
          <div className="stat">{db?.loading ? t('Carregando...') : db?.ready ? fmtNum(db.cardCount) : '—'}</div>
          <div className="muted small">{db?.ready ? t('cartas · {n} impressões · {lang}', { n: fmtNum(db.printingCount), lang: langLabel ?? '' }) : t('não baixado')}</div>
        </div>
        <div className="panel grow">
          <div className="muted small">Decks</div>
          <div className="stat">{decks.length}</div>
          <div className="muted small">{t('salvos')}</div>
        </div>
        <div className="panel grow">
          <div className="muted small">{t('Juiz IA (Claude)')}</div>
          <div className="stat" style={{ fontSize: 20, marginTop: 6 }}>{settings?.aiJudgeEnabled && settings.hasApiKey ? t('Ativado') : t('Motor local')}</div>
          <div className="muted small">{settings?.aiJudgeEnabled && settings.hasApiKey ? settings.aiModel : t('regras validadas offline')}</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => go('decks')} disabled={!db?.ready}>
          ＋ {t('Criar / editar decks')}
        </button>
        <button className="btn success" onClick={() => go('play')} disabled={!db?.ready}>
          ⚔ {t('Jogar contra o bot')}
        </button>
      </div>

      {decks.length > 0 && (
        <>
          <h3>{t('Decks recentes')}</h3>
          <div className="grid-cards">
            {decks.slice(0, 8).map((d) => (
              <div key={d.id} className="tile" onClick={() => go('editor', { deckId: d.id })}>
                <div style={{ height: 110, overflow: 'hidden' }}>
                  <CardImage printingId={d.coverPrintingId} size="art" />
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    {t(getFormat(d.format).name)} · {t('{n} cartas', { n: d.cardCount })}
                    <span className="right">
                      <ColorPips colors={d.colors} />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
