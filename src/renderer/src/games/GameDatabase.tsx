// Banco de cartas de um jogo genérico: download no idioma escolhido, progresso, situação e exploração das cartas.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { DownloadProgress } from '@shared/types'
import type { GameId, GDbStatus } from '@shared/games/types'
import { getGame } from '@shared/games/registry'
import { formatBytes, ProgressBar } from '../components/common'
import { clearGCache } from './gameCommon'
import { t, fmtNum, fmtDateTime } from '@shared/i18n'

export default function GameDatabase({ game }: { game: GameId }) {
  return <Database key={game} game={game} />
}

function Database({ game }: { game: GameId }) {
  const def = getGame(game)!
  const settings = useApp((s) => s.settings)
  const toast = useApp((s) => s.toast)
  const [db, setDb] = useState<GDbStatus | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [lang, setLang] = useState<string>(() => {
    const pref = settings?.cardLanguage
    return pref && def.languages.some((l) => l.code === pref) ? pref : (def.languages[0]?.code ?? 'en')
  })
  const [langTouched, setLangTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () => window.kard.games.status(game).then(setDb)

  useEffect(() => {
    refresh()
    return window.kard.games.onProgress((g, p) => {
      if (g !== game) return
      if (p.phase === 'idle') {
        // 'db-loaded': o banco terminou de carregar na inicialização.
        refresh()
        return
      }
      setProgress(p)
      if (p.phase === 'done') {
        clearGCache(game)
        refresh()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  // Com um banco já baixado, o idioma padrão é o dele (para "Atualizar" não trocar o idioma sem querer).
  useEffect(() => {
    if (!langTouched && db?.ready && def.languages.some((l) => l.code === db.lang)) setLang(db.lang)
  }, [db?.ready, db?.lang, langTouched, def])

  const running = busy || (progress !== null && !['idle', 'done', 'error', 'cancelled'].includes(progress.phase))

  const download = async () => {
    setBusy(true)
    const r = await window.kard.games.download(game, lang)
    setBusy(false)
    if (r.ok) toast(t('Banco de cartas atualizado!'), 'success')
    else if (r.error && !/cancel|abort/i.test(r.error)) toast(t('Falha no download: {error}', { error: r.error }), 'error')
    clearGCache(game)
    refresh()
  }

  const pct = progress && progress.total > 0 ? progress.current / progress.total : 0
  const langLabel = def.languages.find((l) => l.code === db?.lang)?.label

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1>{t('Download de cartas')}</h1>
      <div className="sub">{t('Baixe todas as cartas de {game} de {source} para a pasta database do Kard.', { game: def.name, source: def.source.name })}</div>

      <div className="row" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <div className="panel grow">
          <h3>{t('Download')}</h3>
          <div className="row wrap">
            <label className="field">
              {t('Idioma das cartas')}
              <select
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value)
                  setLangTouched(true)
                }}
                disabled={running || def.languages.length < 2}
              >
                {def.languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="col" style={{ gap: 6 }}>
              <span className="small muted">&nbsp;</span>
              {running ? (
                <button className="btn danger" onClick={() => window.kard.games.cancel(game)}>
                  ✕ {t('Cancelar')}
                </button>
              ) : (
                <button className="btn primary" onClick={download} disabled={db?.loading}>
                  ⬇ {db?.ready ? (def.languages.length > 1 ? t('Atualizar / trocar idioma') : t('Atualizar')) : t('Baixar banco de cartas')}
                </button>
              )}
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {t('As imagens das cartas são salvas no cache conforme você navega.')}
          </div>
          {progress && progress.phase !== 'idle' && (
            <div style={{ marginTop: 14 }}>
              <ProgressBar value={progress.current} total={progress.total} indeterminate={progress.phase === 'meta' || progress.phase === 'saving' || !progress.total} />
              <div className="small" style={{ marginTop: 6, color: progress.phase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
                {progress.message} {pct > 0 && progress.phase !== 'done' ? `(${Math.round(pct * 100)}%)` : ''}
              </div>
            </div>
          )}
          <div className="small muted" style={{ marginTop: 16, lineHeight: 1.5 }}>
            {t('Dados e imagens das cartas:')}{' '}
            <a
              href={def.source.url}
              onClick={(e) => {
                e.preventDefault()
                window.kard.app.openExternal(def.source.url)
              }}
            >
              {def.source.name}
            </a>
            {def.source.note && (
              <>
                <br />
                {t(def.source.note)}
              </>
            )}
          </div>
        </div>
        <div className="panel" style={{ width: 380 }}>
          <h3>{t('Status')}</h3>
          <table className="small" style={{ width: '100%', lineHeight: 1.8 }}>
            <tbody>
              <tr>
                <td className="muted">{t('Situação')}</td>
                <td>{db?.loading ? t('Carregando...') : db?.ready ? <span className="badge ok">{t('Pronto')}</span> : <span className="badge err">{t('Não baixado')}</span>}</td>
              </tr>
              <tr>
                <td className="muted">{t('Cartas')}</td>
                <td>{db ? fmtNum(db.cardCount) : ''}</td>
              </tr>
              <tr>
                <td className="muted">{t('Impressões')}</td>
                <td>{db ? fmtNum(db.printingCount) : ''}</td>
              </tr>
              <tr>
                <td className="muted">{t('Coleções')}</td>
                <td>{db ? fmtNum(db.setCount) : ''}</td>
              </tr>
              <tr>
                <td className="muted">{t('Idioma')}</td>
                <td>{db?.ready ? (langLabel ?? db.lang) : '—'}</td>
              </tr>
              <tr>
                <td className="muted">{t('Atualizado em')}</td>
                <td>{db?.updatedAt ? fmtDateTime(db.updatedAt) : '—'}</td>
              </tr>
              <tr>
                <td className="muted">{t('Tamanho')}</td>
                <td>{formatBytes(db?.sizeBytes)}</td>
              </tr>
              <tr>
                <td className="muted">{t('Imagens em cache')}</td>
                <td>
                  {fmtNum(db?.imageCount ?? 0)} ({formatBytes(db?.imageCacheBytes)})
                </td>
              </tr>
            </tbody>
          </table>
          <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
            <button className="btn sm" onClick={() => window.kard.app.openDatabaseFolder()}>
              📂 {t('Abrir pasta')}
            </button>
            <button
              className="btn sm"
              disabled={running}
              onClick={async () => {
                if (!confirm(t('Apagar todas as imagens em cache?'))) return
                await window.kard.db.clearImages()
                refresh()
              }}
            >
              🗑 {t('Limpar imagens')}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
