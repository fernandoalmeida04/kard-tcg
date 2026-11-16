// Banco de cartas do Pokémon TCG (TCGdex): download no idioma escolhido, progresso e situação.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { DownloadProgress } from '@shared/types'
import type { PkmDbStatus } from '@shared/pokemon/types'
import { PKM_DB_LANGUAGES } from '@shared/pokemon/types'
import { formatBytes, ProgressBar } from '../components/common'
import { clearPkmCache } from './pkmCommon'
import { t, fmtNum, fmtDateTime } from '@shared/i18n'

export default function PkmDatabase() {
  const settings = useApp((s) => s.settings)
  const toast = useApp((s) => s.toast)
  const [db, setDb] = useState<PkmDbStatus | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [lang, setLang] = useState<string>(() => {
    const pref = settings?.cardLanguage
    return pref && PKM_DB_LANGUAGES.some((l) => l.code === pref) ? pref : 'pt'
  })
  const [langTouched, setLangTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () => window.kard.pkm.status().then(setDb)

  useEffect(() => {
    refresh()
    return window.kard.pkm.onProgress((p) => {
      if (p.phase === 'idle') {
        // 'db-loaded': o banco terminou de carregar na inicialização.
        refresh()
        return
      }
      setProgress(p)
      if (p.phase === 'done') {
        clearPkmCache()
        refresh()
      }
    })
  }, [])

  // Com um banco já baixado, o idioma padrão é o dele (para "Atualizar" não trocar o idioma sem querer).
  useEffect(() => {
    if (!langTouched && db?.ready && PKM_DB_LANGUAGES.some((l) => l.code === db.lang)) setLang(db.lang)
  }, [db?.ready, db?.lang, langTouched])

  const running = busy || (progress !== null && !['idle', 'done', 'error', 'cancelled'].includes(progress.phase))

  const download = async () => {
    setBusy(true)
    const r = await window.kard.pkm.download(lang)
    setBusy(false)
    if (r.ok) toast(t('Banco de cartas atualizado!'), 'success')
    else if (r.error && !/cancel|abort/i.test(r.error)) toast(t('Falha no download: {error}', { error: r.error }), 'error')
    clearPkmCache()
    refresh()
  }

  const pct = progress && progress.total > 0 ? progress.current / progress.total : 0
  const langLabel = PKM_DB_LANGUAGES.find((l) => l.code === db?.lang)?.label

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1>{t('Download de cartas')}</h1>
      <div className="sub">{t('Baixe todas as cartas de Pokémon TCG do TCGdex para a pasta database do Kard, no idioma escolhido.')}</div>

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
                disabled={running}
              >
                {PKM_DB_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="col" style={{ gap: 6 }}>
              <span className="small muted">&nbsp;</span>
              {running ? (
                <button className="btn danger" onClick={() => window.kard.pkm.cancel()}>
                  ✕ {t('Cancelar')}
                </button>
              ) : (
                <button className="btn primary" onClick={download} disabled={db?.loading}>
                  ⬇ {db?.ready ? t('Atualizar / trocar idioma') : t('Baixar banco de cartas')}
                </button>
              )}
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {t('São baixados os dados de regras em inglês (usados na validação dos decks e nas listas do Pokémon TCG Live) e os nomes, textos e imagens no idioma escolhido. As imagens são salvas no cache conforme você navega.')}
          </div>
          {progress && progress.phase !== 'idle' && (
            <div style={{ marginTop: 14 }}>
              <ProgressBar value={progress.current} total={progress.total} indeterminate={progress.phase === 'meta' || progress.phase === 'saving' || (progress.phase === 'cards' && !progress.total)} />
              <div className="small" style={{ marginTop: 6, color: progress.phase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
                {progress.message} {pct > 0 && progress.phase !== 'done' ? `(${Math.round(pct * 100)}%)` : ''}
              </div>
            </div>
          )}
          <div className="small muted" style={{ marginTop: 16, lineHeight: 1.5 }}>
            {t('Dados e imagens das cartas:')}{' '}
            <a
              href="https://tcgdex.dev"
              onClick={(e) => {
                e.preventDefault()
                window.kard.app.openExternal('https://tcgdex.dev')
              }}
            >
              TCGdex (tcgdex.dev)
            </a>
            <br />
            {t('Pokémon e seus nomes são marcas registradas da Nintendo, Creatures e Game Freak; o Kard não é afiliado.')}
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
