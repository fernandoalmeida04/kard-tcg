// Página inicial de um jogo genérico (ex.: Yu-Gi-Oh!): situação do banco, atalhos e decks recentes.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import logo from '../assets/logo.png'
import type { GameId, GDbStatus, GDeckSummary } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { t, fmtNum } from '@shared/i18n'
import { ColorChip, GameCardImage } from './gameCommon'

export default function GameHome({ game }: { game: GameId }) {
  return <Home key={game} game={game} />
}

function Home({ game }: { game: GameId }) {
  const def = getGame(game)!
  const go = useApp((s) => s.go)
  const [db, setDb] = useState<GDbStatus | null>(null)
  const [decks, setDecks] = useState<GDeckSummary[]>([])

  useEffect(() => {
    const refresh = () => window.kard.games.status(game).then(setDb)
    refresh()
    window.kard.games.decks.list(game).then(setDecks)
    return window.kard.games.onProgress((g, p) => {
      if (g === game && (p.phase === 'idle' || p.phase === 'done')) refresh()
    })
  }, [game])

  const langLabel = def.languages.find((l) => l.code === db?.lang)?.label ?? db?.lang ?? ''
  const formatName = (id: string) => {
    const f = def.formats.find((x) => x.id === id)
    return f ? t(f.name) : id
  }

  return (
    <div className="page">
      <div className="hero">
        <img src={logo} alt="" />
        <div className="grow">
          <h1>{t('Kard - {game}', { game: def.name })}</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            {t('Monte decks de {game} com as cartas de {source}: escolha a impressão de cada carta, importe listas e valide as regras de construção.', { game: def.name, source: def.source.name })}
          </div>
        </div>
      </div>

      {db && !db.ready && !db.loading && (
        <div className="panel" style={{ marginBottom: 18, borderColor: 'var(--accent)' }}>
          <div className="row">
            <div className="grow">
              <h3 style={{ margin: 0 }}>{t('Primeiro passo: baixe o banco de cartas')}</h3>
              <div className="muted small">{t('O Kard baixa todas as cartas de {game} de {source} para a pasta database do programa.', { game: def.name, source: def.source.name })}</div>
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
                <div className="g-cover" style={{ height: 110 }}>
                  <GameCardImage game={game} printingId={d.coverPrintingId} name={d.name} />
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    {formatName(d.format)} · {d.cardCount === 1 ? t('1 carta') : t('{n} cartas', { n: d.cardCount })}
                    <span className="right g-deck-colors">
                      {d.colors.map((x) => (
                        <ColorChip key={x} def={def} color={x} size={12} />
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
