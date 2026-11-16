// Jogar online: criar/entrar numa mesa (lobby) e, quando a partida começa, a mesa de jogo.
import { useEffect, useMemo, useState } from 'react'
import type { Deck, DeckSummary } from '@shared/types'
import { FORMATS, getFormat, validateDeck, type DeckValidation } from '@shared/formats'
import type { RoomMode } from '@shared/online/protocol'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { useAuth } from '../auth/authStore'
import { getCards } from '../cardCache'
import { useGame } from '../game/gameStore'
import GameTable from '../game/GameTable'
import { formatsForMode, useOnline } from './onlineStore'

export default function OnlinePage() {
  const inGame = useApp((s) => s.inGame)
  const gameState = useGame((s) => s.state)
  const phase = useOnline((s) => s.phase)
  if (phase === 'game' && inGame && gameState) return <GameTable />
  return <OnlineLobby />
}

function OnlineLobby() {
  const user = useAuth((s) => s.user)
  const configured = useAuth((s) => s.configured)
  const openAuth = useAuth((s) => s.open)
  const db = useApp((s) => s.db)
  const phase = useOnline((s) => s.phase)
  const error = useOnline((s) => s.error)

  if (!configured) {
    return (
      <Shell>
        <div className="panel muted">{t('O login ainda não foi configurado neste computador. Siga o passo a passo do arquivo SUPABASE.md e reinicie o app.')}</div>
      </Shell>
    )
  }
  if (!user) {
    return (
      <Shell>
        <div className="panel">
          <div style={{ marginBottom: 10 }}>{t('Entre na sua conta para jogar online.')}</div>
          <button className="btn primary" onClick={() => openAuth('login')}>
            {t('Entrar / Cadastre-se')}
          </button>
        </div>
      </Shell>
    )
  }
  if (!db?.ready) {
    return (
      <Shell>
        <div className="panel muted">{t('Baixe o banco de cartas primeiro.')}</div>
      </Shell>
    )
  }
  return (
    <Shell>
      {error && (
        <div className="auth-error" style={{ marginBottom: 12 }}>
          {error}{' '}
          <button className="btn sm" onClick={() => useOnline.setState({ error: null })}>
            ✕
          </button>
        </div>
      )}
      {phase === 'idle' && <CreateOrJoin />}
      {phase === 'connecting' && <div className="panel muted">{t('Conectando à mesa...')}</div>}
      {(phase === 'lobby' || phase === 'game') && <Lobby />}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <h1>{t('Jogar online')}</h1>
      <div className="sub">{t('Partidas com amigos: 1 contra 1 em qualquer formato, ou Commander com até 4 jogadores.')}</div>
      {children}
    </div>
  )
}

function CreateOrJoin() {
  const createRoom = useOnline((s) => s.createRoom)
  const joinRoom = useOnline((s) => s.joinRoom)
  const [mode, setMode] = useState<RoomMode>('duel')
  const [format, setFormat] = useState('casual')
  const [code, setCode] = useState('')
  const formats = useMemo(() => FORMATS.filter((f) => formatsForMode(mode).includes(f.id)), [mode])

  return (
    <div className="row" style={{ alignItems: 'stretch', gap: 16 }}>
      <div className="panel grow">
        <h3>{t('Criar mesa')}</h3>
        <div className="row" style={{ gap: 14, marginBottom: 10 }}>
          <label className="check">
            <input type="radio" checked={mode === 'duel'} onChange={() => setMode('duel')} /> {t('1 contra 1')}
          </label>
          <label className="check">
            <input
              type="radio"
              checked={mode === 'commander'}
              onChange={() => {
                setMode('commander')
                setFormat('commander')
              }}
            />{' '}
            {t('Commander (até 4 jogadores)')}
          </label>
        </div>
        {mode === 'duel' && (
          <label className="field">
            {t('Formato')}
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn primary" style={{ marginTop: 12 }} onClick={() => void createRoom(mode, mode === 'commander' ? 'commander' : format)}>
          ＋ {t('Criar mesa')}
        </button>
        <div className="small muted" style={{ marginTop: 8 }}>
          {t('Você será o anfitrião: as regras rodam no seu computador e você recebe um código para passar aos amigos.')}
        </div>
      </div>
      <div className="panel grow">
        <h3>{t('Entrar numa mesa')}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void joinRoom(code)
          }}
        >
          <input className="auth-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="ABC123" style={{ width: '100%' }} />
          <button className="btn primary" style={{ marginTop: 12 }} disabled={code.trim().length !== 6}>
            {t('Entrar')}
          </button>
        </form>
        <div className="small muted" style={{ marginTop: 8 }}>
          {t('Peça o código de 6 caracteres a quem criou a mesa.')}
        </div>
      </div>
    </div>
  )
}

function Lobby() {
  const s = useOnline()
  const settings = useApp((st) => st.settings)
  const toast = useApp((st) => st.toast)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [deckId, setDeckId] = useState<string>('')
  const [deck, setDeck] = useState<Deck | null>(null)
  const [validation, setValidation] = useState<DeckValidation | null>(null)
  const [chatText, setChatText] = useState('')
  const [useAi, setUseAi] = useState(false)
  const cfg = s.config!
  const host = cfg.hostId === s.myId
  const me = s.players.find((p) => p.userId === s.myId)
  const fmt = getFormat(cfg.format)
  const onlineIds = new Set(s.presence.map((p) => p.userId))
  const aiAvailable = Boolean(settings?.aiJudgeEnabled && settings.hasApiKey)

  useEffect(() => {
    window.kard.decks.list().then((list) => {
      // decks do formato da mesa primeiro
      const sorted = [...list].sort((a, b) => Number(b.format === cfg.format) - Number(a.format === cfg.format))
      setDecks(sorted)
    })
  }, [cfg.format])

  useEffect(() => {
    if (!deckId) {
      setDeck(null)
      setValidation(null)
      return
    }
    window.kard.decks.get(deckId).then(async (d) => {
      if (!d) return
      // a validação usa o formato da mesa, não o do deck
      const asRoom = { ...d, format: cfg.format }
      setDeck(d)
      setValidation(validateDeck(asRoom, await getCards([...d.commanders, ...d.main, ...d.sideboard].map((c) => c.oracleId))))
      s.setDeck(d)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId])

  const allReady = s.players.length >= 2 && s.players.every((p) => p.deck && p.ready)

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel row" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 2 }}>
          <span className="small muted">{t('Código da mesa')}</span>
          <span className="room-code">{cfg.code}</span>
        </div>
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard.writeText(cfg.code)
            toast(t('Código copiado.'), 'success')
          }}
        >
          ⧉ {t('Copiar')}
        </button>
        <div className="col grow" style={{ gap: 2 }}>
          <span>
            <b>{cfg.mode === 'commander' ? t('Commander (até 4 jogadores)') : t('1 contra 1')}</b> · {t(fmt.name)}
          </span>
          <span className="small muted">{t('{n} de {max} jogadores', { n: s.players.length, max: cfg.maxPlayers })}</span>
        </div>
        <button className="btn danger" onClick={() => void s.leave()}>
          {t('Sair da mesa')}
        </button>
      </div>

      <div className="row" style={{ alignItems: 'stretch', gap: 16 }}>
        <div className="panel grow">
          <h3>{t('Jogadores')}</h3>
          <div className="col" style={{ gap: 6 }}>
            {s.players.map((p) => (
              <div key={p.userId} className="lobby-player">
                <span className={`presence-dot ${onlineIds.has(p.userId) ? 'on' : ''}`} title={onlineIds.has(p.userId) ? t('Conectado') : t('Desconectado')} />
                <b className="grow">
                  {p.username}
                  {p.userId === cfg.hostId && <span className="badge" style={{ marginLeft: 6 }}>{t('anfitrião')}</span>}
                  {p.userId === s.myId && <span className="muted small"> ({t('você')})</span>}
                </b>
                <span className="small muted">{p.deck ? p.deck.name : t('sem deck')}</span>
                {p.ready ? <span className="badge ok">{t('Pronto')}</span> : <span className="badge">{t('Aguardando')}</span>}
                {host && p.userId !== s.myId && !s.started && (
                  <button className="icon-btn" title={t('Remover da mesa')} onClick={() => s.kick(p.userId)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {Array.from({ length: cfg.maxPlayers - s.players.length }, (_, i) => (
              <div key={`empty-${i}`} className="lobby-player empty muted small">
                {t('Vaga livre')}
              </div>
            ))}
          </div>
        </div>

        <div className="panel grow">
          <h3>{t('Seu deck')}</h3>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} style={{ width: '100%' }} disabled={s.started}>
            <option value="">{t('Escolha...')}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {t(getFormat(d.format).name)} ({d.cardCount})
              </option>
            ))}
          </select>
          {deck && validation && (
            <div style={{ marginTop: 8 }}>
              {validation.valid ? (
                <span className="badge ok">{t('Deck válido para {format}', { format: t(fmt.name) })}</span>
              ) : (
                <>
                  <span className="badge err">{t('Deck inválido para {format}', { format: t(fmt.name) })}</span>
                  <ul className="err-list errors">
                    {validation.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
            <button className={`btn ${me?.ready ? '' : 'success'}`} disabled={!deck || !validation?.valid || s.started} onClick={() => s.setReady(!me?.ready)}>
              {me?.ready ? t('Cancelar pronto') : `✓ ${t('Pronto')}`}
            </button>
            {host && (
              <>
                <button className="btn primary" disabled={!allReady || s.started} onClick={() => void s.startGame(useAi && aiAvailable)}>
                  ⚔ {t('Começar partida')}
                </button>
                {aiAvailable && (
                  <label className="check small">
                    <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> {t('Usar o Juiz IA (com a sua chave)')}
                  </label>
                )}
              </>
            )}
          </div>
          {!host && <div className="small muted" style={{ marginTop: 8 }}>{t('O anfitrião começa a partida quando todos estiverem prontos.')}</div>}
        </div>
      </div>

      <div className="panel">
        <h3>{t('Conversa')}</h3>
        <div className="lobby-chat">
          {s.chat.length === 0 && <div className="muted small">{t('Nenhuma mensagem ainda.')}</div>}
          {s.chat.map((m, i) => (
            <div key={i} className="small">
              <b>{m.username}:</b> {m.text}
            </div>
          ))}
        </div>
        <form
          className="row"
          style={{ gap: 6, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault()
            s.sendChat(chatText)
            setChatText('')
          }}
        >
          <input className="grow" value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder={t('Mensagem para a mesa...')} />
          <button className="btn sm primary">{t('Enviar')}</button>
        </form>
      </div>
    </div>
  )
}
