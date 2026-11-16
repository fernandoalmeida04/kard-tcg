// Teste de deck: escolhe um deck e testa sozinho (oponente parado) ou contra o bot. Sem outras opções.
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Deck, DeckSummary } from '@shared/types'
import { getFormat, validateDeck, type DeckValidation } from '@shared/formats'
import { CardImage, ColorPips } from '../components/common'
import { getCards } from '../cardCache'
import { deckToGameCards, generateBotDeck, toGameCard } from '../game/gameCards'
import { useGame } from '../game/gameStore'
import GameTable from '../game/GameTable'
import type { GameCard } from '@shared/engine'
import { t } from '@shared/i18n'

export default function PlayPage() {
  const inGame = useApp((s) => s.inGame)
  const gameState = useGame((s) => s.state)
  if (inGame && gameState) return <GameTable />
  return <DeckTestSetup />
}

/** Grimório do oponente parado: só terrenos básicos (nunca fica sem cartas e não faz nada). */
async function goldfishDeck(size: number): Promise<GameCard[]> {
  const basics = await window.kard.db.basicLands()
  const land = basics.C ?? basics.W ?? Object.values(basics)[0]
  if (!land) throw new Error(t('Não foi possível montar o oponente de teste.'))
  return Array.from({ length: size }, () => toGameCard(land))
}

function DeckTestSetup() {
  const playDeckId = useApp((s) => s.playDeckId)
  const settings = useApp((s) => s.settings)
  const db = useApp((s) => s.db)
  const toast = useApp((s) => s.toast)
  const setInGame = useApp((s) => s.setInGame)
  const go = useApp((s) => s.go)
  const start = useGame((s) => s.start)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [deckId, setDeckId] = useState<string | null>(playDeckId)
  const [deck, setDeck] = useState<Deck | null>(null)
  const [validation, setValidation] = useState<DeckValidation | null>(null)
  const [loading, setLoading] = useState<'solo' | 'bot' | null>(null)

  useEffect(() => {
    window.kard.decks.list().then((d) => {
      setDecks(d)
      if (!deckId && d.length) setDeckId(d[0].id)
    })
  }, [deckId])

  useEffect(() => {
    if (!deckId) {
      setDeck(null)
      return
    }
    window.kard.decks.get(deckId).then(async (d) => {
      setDeck(d)
      if (d) setValidation(validateDeck(d, await getCards([...d.commanders, ...d.main, ...d.sideboard].map((c) => c.oracleId))))
    })
  }, [deckId])

  const summary = decks.find((d) => d.id === deckId)
  const fmt = getFormat(deck?.format ?? 'casual')

  const begin = async (mode: 'solo' | 'bot') => {
    if (!deck) return
    setLoading(mode)
    try {
      const mine = await deckToGameCards(deck)
      if (mine.deck.length < 20) throw new Error(t('Seu deck tem poucas cartas para jogar.'))
      let opp: { deck: GameCard[]; commanders: GameCard[]; name: string }
      if (mode === 'solo') {
        opp = { deck: await goldfishDeck(Math.max(60, mine.deck.length + 20)), commanders: [], name: t('Oponente parado') }
      } else {
        // o bot joga nas cores do seu deck (ou vermelho/verde em decks incolores)
        const colors = summary?.colors.length ? summary.colors : ['R', 'G']
        opp = await generateBotDeck(colors, deck.format)
        if (opp.deck.length < 20) throw new Error(t('Não foi possível montar o deck do bot com essas cores.'))
      }
      const aiOn = Boolean(settings?.aiJudgeEnabled && settings.hasApiKey)
      const oppName = mode === 'solo' ? t('Oponente parado') : 'Bot'
      start(
        {
          format: fmt.name,
          startingLife: fmt.startingLife,
          aiEnabled: aiOn,
          // no teste sozinho você sempre começa
          firstPlayer: mode === 'solo' ? 0 : undefined,
          players: [
            { name: t('Você'), isBot: false, deck: mine.deck, commanders: mine.commanders },
            { name: oppName, isBot: true, deck: opp.deck, commanders: opp.commanders }
          ]
        },
        { format: fmt.name, humanName: t('Você'), botName: oppName, humanDeck: deck.name, botDeck: opp.name, goldfish: mode === 'solo' }
      )
      const ids = [...mine.deck, ...mine.commanders, ...opp.deck, ...opp.commanders].map((c) => c.printingId).filter(Boolean) as string[]
      window.kard.db.prefetchImages([...new Set(ids)])
      setInGame(true)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(null)
    }
  }

  if (!db?.ready) {
    return (
      <div className="page">
        <h1>{t('Teste de deck')}</h1>
        <div className="panel muted">{t('Baixe o banco de cartas primeiro.')}</div>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>{t('Teste de deck')}</h1>
      <div className="sub">{t('Escolha um deck e teste como ele joga: sozinho, contra um oponente parado, ou contra o bot.')}</div>

      <div className="panel">
        {decks.length === 0 ? (
          <div className="muted">
            {t('Você ainda não tem decks.')}{' '}
            <button className="btn sm primary" onClick={() => go('decks')}>
              {t('Criar deck')}
            </button>
          </div>
        ) : (
          <>
            <select value={deckId ?? ''} onChange={(e) => setDeckId(e.target.value)} style={{ width: '100%' }}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {t(getFormat(d.format).name)} ({d.cardCount})
                </option>
              ))}
            </select>
            {deck && (
              <div className="row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 150, flex: 'none' }}>
                  <CardImage printingId={summary?.coverPrintingId} size="art" />
                </div>
                <div className="grow">
                  <div>
                    <b>{deck.name}</b> · {t(fmt.name)} · {t('vida inicial {n}', { n: fmt.startingLife })}
                  </div>
                  <div className="row small" style={{ marginTop: 6 }}>
                    <ColorPips colors={summary?.colors ?? []} />
                    {validation &&
                      (validation.valid ? (
                        <span className="badge ok">{t('Deck válido para {format}', { format: t(fmt.name) })}</span>
                      ) : (
                        <span className="badge warn" title={validation.errors.slice(0, 8).join('\n')}>
                          {t('Deck com {n} problema(s) — dá para testar mesmo assim', { n: validation.errors.length })}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            )}
            <div className="row" style={{ marginTop: 18, gap: 10 }}>
              <button className="btn primary lg" disabled={!deck || loading !== null} onClick={() => begin('solo')} title={t('Você joga sozinho; o oponente não faz nada e só recebe dano.')}>
                {loading === 'solo' ? t('Preparando...') : `🧪 ${t('Testar sozinho')}`}
              </button>
              <button className="btn success lg" disabled={!deck || loading !== null} onClick={() => begin('bot')} title={t('O bot monta um deck automático nas cores do seu e joga normalmente.')}>
                {loading === 'bot' ? t('Preparando...') : `🤖 ${t('Testar contra bot')}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
