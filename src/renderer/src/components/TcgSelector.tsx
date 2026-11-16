import { useEffect, useRef, useState } from 'react'
import type { TcgId } from '@shared/types'
import { t } from '@shared/i18n'
import { useApp } from '../store'

export const TCGS: { id: TcgId; name: string; short: string; ico: string }[] = [
  { id: 'mtg', name: 'Magic: The Gathering', short: 'Magic', ico: '✦' },
  { id: 'pokemon', name: 'Pokémon TCG', short: 'Pokémon', ico: '◓' },
  { id: 'ygo', name: 'Yu-Gi-Oh!', short: 'Yu-Gi-Oh!', ico: '◬' }
]

/** Seletor do jogo de cartas ativo (fica abaixo da marca na barra lateral). */
export default function TcgSelector() {
  const tcg = useApp((s) => s.settings?.tcg ?? 'mtg')
  const save = useApp((s) => s.saveSettings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = TCGS.find((x) => x.id === tcg) ?? TCGS[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tcg-select" ref={ref}>
      <button className={`tcg-current ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title={t('Escolher jogo de cartas')} aria-haspopup="listbox" aria-expanded={open}>
        <span className="tcg-ico">{cur.ico}</span>
        <span className="tcg-name">{cur.name}</span>
        <span className="tcg-caret">▾</span>
      </button>
      {open && (
        <div className="tcg-menu" role="listbox">
          {TCGS.map((x) => (
            <button
              key={x.id}
              role="option"
              aria-selected={x.id === tcg}
              className={`tcg-opt ${x.id === tcg ? 'on' : ''}`}
              onClick={() => {
                setOpen(false)
                // ao trocar de jogo, sempre volta para a aba Início (o editor aberto pertence ao outro jogo)
                if (x.id !== tcg) {
                  useApp.getState().go('home')
                  save({ tcg: x.id })
                }
              }}
            >
              <span className="tcg-ico">{x.ico}</span>
              <span className="tcg-name">{x.name}</span>
              <span className="tcg-check">{x.id === tcg ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Tela para jogos que ainda não têm suporte (mesmas páginas, sem funcionalidades). */
export function ComingSoon({ title, message }: { title: string; message?: string }) {
  const tcg = useApp((s) => s.settings?.tcg ?? 'mtg')
  const go = useApp((s) => s.go)
  const cur = TCGS.find((x) => x.id === tcg) ?? TCGS[0]
  return (
    <div className="page">
      <h1>{title}</h1>
      <div className="panel coming-soon">
        <div className="cs-ico">{cur.ico}</div>
        <h3>{t('{game} — em breve', { game: cur.name })}</h3>
        <div className="muted">{message ?? t('O suporte a este jogo ainda está em desenvolvimento. Por enquanto, apenas Magic: The Gathering tem banco de cartas, decks e partidas.')}</div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={() => useApp.getState().saveSettings({ tcg: 'mtg' }).then(() => go('home'))}>
          {t('Voltar para Magic: The Gathering')}
        </button>
      </div>
    </div>
  )
}
