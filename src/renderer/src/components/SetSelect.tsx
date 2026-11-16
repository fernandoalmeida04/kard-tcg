import { useEffect, useMemo, useRef, useState } from 'react'
import type { SetInfo } from '@shared/types'
import { t } from '@shared/i18n'

interface Props {
  sets: SetInfo[]
  value: string
  onChange: (code: string) => void
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Seletor de coleção com a aparência de um <select>, mas com busca ao abrir. */
export default function SetSelect({ sets, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = sets.find((s) => s.code === value)

  // Primeiro item (índice 0) é "Todas as coleções"
  const filtered = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return sets
    return sets.filter((s) => s.code.includes(q) || norm(s.name).includes(q))
  }, [sets, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    setActive(query.trim() && filtered.length ? 1 : 0)
  }, [query, filtered.length])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const max = filtered.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(max, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(active === 0 ? '' : filtered[active - 1].code)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="set-select" ref={rootRef}>
      <select
        value={value}
        title={t('Filtrar por coleção')}
        onChange={() => {}}
        onMouseDown={(e) => {
          e.preventDefault()
          setQuery('')
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault()
            setQuery('')
            setOpen(true)
          }
        }}
      >
        <option value={value}>{current ? `${current.name} (${current.code.toUpperCase()})` : t('Coleção')}</option>
      </select>
      {open && (
        <div className="set-select-pop">
          <input autoFocus placeholder={t('Digite o nome ou código...')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
          <div className="set-select-list" ref={listRef}>
            <div data-idx={0} className={`set-select-item ${active === 0 ? 'active' : ''} ${!value ? 'selected' : ''}`} onMouseEnter={() => setActive(0)} onClick={() => pick('')}>
              {t('Todas as coleções')}
            </div>
            {filtered.map((s, i) => (
              <div
                key={s.code}
                data-idx={i + 1}
                className={`set-select-item ${active === i + 1 ? 'active' : ''} ${s.code === value ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i + 1)}
                onClick={() => pick(s.code)}
              >
                <span className="grow">{s.name}</span>
                <span className="muted small">
                  {s.code.toUpperCase()} · {s.releasedAt.slice(0, 4)}
                </span>
              </div>
            ))}
            {!filtered.length && <div className="set-select-item muted">{t('Nenhuma coleção encontrada')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
