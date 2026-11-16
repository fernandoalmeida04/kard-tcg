// Página inicial do Pokémon TCG: situação do banco (TCGdex), atalhos e decks recentes.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import logo from '../assets/logo.png'
import type { PkmDbStatus, PkmDeckSummary } from '@shared/pokemon/types'
import { PKM_DB_LANGUAGES } from '@shared/pokemon/types'
import { getPkmFormat } from '@shared/pokemon/formats'
import { PkmCardImage, PkmTypeIcon } from './pkmCommon'
import { t, fmtNum } from '@shared/i18n'

export default function PkmHome() {
  const go = useApp((s) => s.go)
  const [db, setDb] = useState<PkmDbStatus | null>(null)
  const [decks, setDecks] = useState<PkmDeckSummary[]>([])

  useEffect(() => {
    const refresh = () => window.kard.pkm.status().then(setDb)
    refresh()
    window.kard.pkm.decks.list().then(setDecks)
    return window.kard.pkm.onProgress((p) => {
      if (p.phase === 'idle' || p.phase === 'done') refresh()
    })
  }, [])

  const langLabel = PKM_DB_LANGUAGES.find((l) => l.code === db?.lang)?.label ?? db?.lang ?? ''

  return (
    <div className="page">
      <div className="hero">
        <img src={logo} alt="" />
        <div className="grow">
          <h1>{t('Kard - Pokémon TCG')}</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            {t('Monte decks de Pokémon TCG com as cartas do TCGdex: escolha a impressão de cada carta, importe listas do Pokémon TCG Live e valide as regras de Standard e Expanded.')}
          </div>
        </div>
      </div>

      {db && !db.ready && !db.loading && (
        <div className="panel" style={{ marginBottom: 18, borderColor: 'var(--accent)' }}>
          <div className="row">
            <div className="grow">
              <h3 style={{ margin: 0 }}>{t('Primeiro passo: baixe o banco de cartas')}</h3>
              <div className="muted small">{t('O Kard baixa todas as cartas de Pokémon TCG (dados e traduções) do TCGdex para a pasta database do programa.')}</div>
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
          <div className="muted small">
            {db?.ready ? t('cartas · {n} impressões · {sets} coleções · {lang}', { n: fmtNum(db.printingCount), sets: fmtNum(db.setCount), lang: langLabel }) : t('não baixado')}
          </div>
        </div>
        <div className="panel grow">
          <div className="muted small">Decks</div>
          <div className="stat">{decks.length}</div>
          <div className="muted small">{t('salvos')}</div>
        </div>
        <div className="panel grow">
          <div className="muted small">{t('Partidas')}</div>
          <div className="stat" style={{ fontSize: 20, marginTop: 6 }}>
            {t('Em breve')}
          </div>
          <div className="muted small">{t('o simulador de partidas de Pokémon ainda está em desenvolvimento')}</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => go('decks')} disabled={!db?.ready}>
          ＋ {t('Meus decks')}
        </button>
        <button className="btn" onClick={() => go('database')}>
          ⬇ {t('Download de cartas')}
        </button>
      </div>

      {decks.length > 0 && (
        <>
          <h3>{t('Decks recentes')}</h3>
          <div className="grid-cards">
            {decks.slice(0, 8).map((d) => (
              <div key={d.id} className="tile" onClick={() => go('editor', { deckId: d.id })}>
                <div className="pkm-cover" style={{ height: 110 }}>
                  <PkmCardImage printingId={d.coverPrintingId} name={d.name} />
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    {t(getPkmFormat(d.format).name)} · {d.cardCount === 1 ? t('1 carta') : t('{n} cartas', { n: d.cardCount })}
                    <span className="right pkm-deck-types">
                      {d.types.map((x) => (
                        <PkmTypeIcon key={x} type={x} size={14} />
                      ))}
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
