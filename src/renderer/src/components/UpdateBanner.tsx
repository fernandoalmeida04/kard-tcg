// Aviso de atualização na barra lateral (baixando / pronta para instalar).
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { t } from '@shared/i18n'

export default function UpdateBanner() {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    const api = window.kard.app
    if (!api.onUpdate) return
    void api.updateStatus().then(setS)
    return api.onUpdate(setS)
  }, [])

  if (s.state === 'downloading') {
    return <div className="update-banner small muted">{t('Baixando a versão {v}... {p}%', { v: s.version ?? '', p: s.percent ?? 0 })}</div>
  }
  if (s.state === 'ready') {
    return (
      <button className="update-banner ready" onClick={() => window.kard.app.installUpdate()} title={t('Fecha o Kard, instala a nova versão e abre de novo.')}>
        ⬆ {t('Versão {v} pronta — reiniciar', { v: s.version ?? '' })}
      </button>
    )
  }
  return null
}
