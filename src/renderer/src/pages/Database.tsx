import { useState } from 'react'
import { useApp } from '../store'
import { LANGUAGES, type LangCode } from '@shared/types'
import { formatBytes, ProgressBar } from '../components/common'
import { t, fmtNum, fmtDateTime } from '@shared/i18n'

export default function DatabasePage() {
  const db = useApp((s) => s.db)
  const settings = useApp((s) => s.settings)
  const progress = useApp((s) => s.progress)
  const toast = useApp((s) => s.toast)
  const refreshDb = useApp((s) => s.refreshDb)
  const [lang, setLang] = useState<LangCode>(settings?.cardLanguage ?? 'pt')
  const [busy, setBusy] = useState(false)

  const running = busy || (progress && !['idle', 'done', 'error', 'cancelled'].includes(progress.phase))

  const download = async () => {
    setBusy(true)
    const r = await window.kard.db.download(lang)
    setBusy(false)
    if (r.ok) toast(t('Banco de cartas atualizado!'), 'success')
    else if (r.error && !/cancel|abort/i.test(r.error)) toast(t('Falha no download: {error}', { error: r.error }), 'error')
    refreshDb()
  }

  const prefetchDeckImages = async () => {
    setBusy(true)
    const decks = await window.kard.decks.list()
    const ids: string[] = []
    for (const s of decks) {
      const d = await window.kard.decks.get(s.id)
      if (!d) continue
      const all = [...d.commanders, ...d.main, ...d.sideboard]
      const cards = await window.kard.db.cards(all.map((c) => c.oracleId))
      for (const c of all) ids.push(c.printingId ?? cards[c.oracleId]?.defaultPrintingId)
    }
    const r = await window.kard.db.prefetchImages(ids.filter(Boolean))
    setBusy(false)
    toast(r.ok ? t('Imagens dos decks salvas ({n} novas).', { n: r.downloaded ?? 0 }) : t('Erro: {error}', { error: r.error ?? '' }), r.ok ? 'success' : 'error')
    refreshDb()
  }

  const pct = progress && progress.total > 0 ? progress.current / progress.total : 0

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1>{t('Download de cartas')}</h1>
      <div className="sub">{t('Baixe todas as cartas de Magic: The Gathering para a pasta database do Kard, no idioma escolhido.')}</div>

      <div className="row" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <div className="panel grow">
          <h3>{t('Download')}</h3>
          <div className="row wrap">
            <label className="field">
              {t('Idioma das cartas')}
              <select value={lang} onChange={(e) => setLang(e.target.value as LangCode)} disabled={Boolean(running)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="col" style={{ gap: 6 }}>
              <span className="small muted">&nbsp;</span>
              {running ? (
                <button className="btn danger" onClick={() => window.kard.db.cancel()}>
                  ✕ {t('Cancelar')}
                </button>
              ) : (
                <button className="btn primary" onClick={download}>
                  ⬇ {db?.ready ? t('Atualizar / trocar idioma') : t('Baixar banco de cartas')}
                </button>
              )}
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {t('São baixados os dados de regras em inglês (necessários para o juiz) e as traduções/impressões no idioma escolhido. As imagens são salvas no cache conforme você navega, ou em lote pelo botão abaixo.')}
          </div>
          {progress && progress.phase !== 'idle' && (
            <div style={{ marginTop: 14 }}>
              <ProgressBar value={progress.current} total={progress.total} indeterminate={progress.phase === 'meta' || progress.phase === 'saving' || (progress.phase === 'cards' && !progress.total)} />
              <div className="small" style={{ marginTop: 6, color: progress.phase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
                {progress.message} {pct > 0 && progress.phase !== 'done' ? `(${Math.round(pct * 100)}%)` : ''}
              </div>
            </div>
          )}
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
                <td className="muted">{t('Idioma')}</td>
                <td>{LANGUAGES.find((l) => l.code === db?.lang)?.label ?? '—'}</td>
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
                  {db?.imageCount ?? 0} ({formatBytes(db?.imageCacheBytes)})
                </td>
              </tr>
              <tr>
                <td className="muted">{t('Pasta')}</td>
                <td style={{ wordBreak: 'break-all' }}>{db?.path}</td>
              </tr>
            </tbody>
          </table>
          <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
            <button className="btn sm" onClick={() => window.kard.app.openDatabaseFolder()}>
              📂 {t('Abrir pasta')}
            </button>
            <button className="btn sm" disabled={!db?.ready || Boolean(running)} onClick={prefetchDeckImages}>
              🖼 {t('Baixar imagens dos meus decks')}
            </button>
            <button
              className="btn sm"
              disabled={Boolean(running)}
              onClick={async () => {
                if (!confirm(t('Apagar todas as imagens em cache?'))) return
                await window.kard.db.clearImages()
                refreshDb()
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
