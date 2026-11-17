// Teste de deck (Magic e Pokémon) na mesa livre: seu deck contra o bot por IA (com o deck que você
// escolher, para treinar um confronto) ou controlando os dois lados. Cada jogador escolhe uma cor.
import { useEffect, useState } from 'react'
import type { DeckSummary } from '@shared/types'
import type { PkmDeckSummary } from '@shared/pokemon/types'
import { getFormat, isCommanderFormat } from '@shared/formats'
import { getPkmFormat } from '@shared/pokemon/formats'
import type { SGame, SSetup } from '@shared/sandbox'
import { t } from '@shared/i18n'
import { useApp } from '../store'
import { deckToGameCards } from '../game/gameCards'
import { pkmDeckToGameCards } from '../pokemon/play/pkmSetup'
import { PLAYER_COLORS, useSandbox } from './sandboxStore'
import MtgTable from './MtgTable'
import PkmTable from './PkmTable'

/** Mesa livre do jogo em andamento. */
export function SandboxTable() {
  const game = useSandbox((s) => s.state?.game)
  return game === 'pokemon' ? <PkmTable /> : <MtgTable />
}

export function ColorPicker({ value, onChange, taken = [] }: { value: string; onChange: (c: string) => void; taken?: string[] }) {
  return (
    <div className="sb-colors">
      {PLAYER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`sb-color ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          disabled={taken.includes(c) && value !== c}
          title={taken.includes(c) && value !== c ? t('Cor já escolhida por outro jogador') : c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

type AnySummary = DeckSummary | PkmDeckSummary

/** Monta as cartas de um deck salvo (Magic ou Pokémon). */
async function loadDeck(game: SGame, id: string): Promise<{ name: string; format: string; deck: SSetup['players'][number]['deck']; commanders: SSetup['players'][number]['deck'] } | null> {
  if (game === 'pokemon') {
    const d = await window.kard.pkm.decks.get(id)
    if (!d) return null
    const g = await pkmDeckToGameCards(d.main.map((c) => ({ cardId: c.oracleId, printingId: c.printingId, qty: c.qty })))
    return { name: d.name, format: getPkmFormat(d.format).name, deck: g.cards.map((x) => ({ card: x.card, printingId: x.printingId })), commanders: [] }
  }
  const d = await window.kard.decks.get(id)
  if (!d) return null
  const g = await deckToGameCards(d)
  return { name: d.name, format: d.format, deck: g.deck.map((card) => ({ card, printingId: card.printingId })), commanders: g.commanders.map((card) => ({ card, printingId: card.printingId })) }
}

export default function SandboxPlay({ game }: { game: SGame }) {
  const inGame = useApp((s) => s.inGame)
  const state = useSandbox((s) => s.state)
  if (inGame && state && state.game === game && !useSandbox.getState().meta?.online) return <SandboxTable />
  return <Setup game={game} />
}

function Setup({ game }: { game: SGame }) {
  const playDeckId = useApp((s) => s.playDeckId)
  const toast = useApp((s) => s.toast)
  const go = useApp((s) => s.go)
  const setInGame = useApp((s) => s.setInGame)
  const user = useApp((s) => s.settings) // só para re-render ao mudar configurações
  const [decks, setDecks] = useState<AnySummary[]>([])
  const [mine, setMine] = useState<string>('')
  const [theirs, setTheirs] = useState<string>('')
  const [mode, setMode] = useState<'bot' | 'both'>('bot')
  const [myColor, setMyColor] = useState(PLAYER_COLORS[1])
  const [oppColor, setOppColor] = useState(PLAYER_COLORS[0])
  // Commander multijogador: até 3 bots (o 1º usa `theirs`/`oppColor`; os extras ficam aqui)
  const [botCount, setBotCount] = useState(1)
  const [extraDecks, setExtraDecks] = useState<string[]>(['', ''])
  const [extraColors, setExtraColors] = useState<string[]>([PLAYER_COLORS[2], PLAYER_COLORS[3]])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = game === 'pokemon' ? window.kard.pkm.decks.list() : window.kard.decks.list()
    void load.then((d: AnySummary[]) => {
      setDecks(d)
      const first = d.find((x) => x.id === playDeckId) ?? d[0]
      if (first) {
        setMine(first.id)
        setTheirs((d.find((x) => x.id !== first.id) ?? first).id)
        const cmd = d.filter((x) => game === 'mtg' && isCommanderFormat(x.format))
        const pool = cmd.length ? cmd : d
        setExtraDecks([pool[1 % pool.length].id, pool[2 % pool.length].id])
      }
    })
  }, [game, playDeckId])

  const begin = async () => {
    if (!mine) return
    setLoading(true)
    try {
      const a = await loadDeck(game, mine)
      const b = theirs ? await loadDeck(game, theirs) : null
      if (!a || a.deck.length < 20) throw new Error(t('Seu deck tem poucas cartas para jogar.'))
      if (mode === 'bot' && !b) throw new Error(t('Escolha o deck que o bot vai jogar.'))
      const commander = game === 'mtg' && isCommanderFormat(a.format)
      const nBots = mode === 'bot' && commander ? botCount : 1
      const extras: NonNullable<Awaited<ReturnType<typeof loadDeck>>>[] = []
      for (let i = 0; i < nBots - 1; i++) {
        const d = extraDecks[i] ? await loadDeck(game, extraDecks[i]) : null
        if (!d) throw new Error(t('Escolha o deck do Bot {n}.', { n: i + 2 }))
        extras.push(d)
      }
      const botName = (i: number) => (nBots > 1 ? t('Bot {n} (IA)', { n: i + 1 }) : t('Bot (IA)'))
      const setup: SSetup = {
        game,
        format: game === 'mtg' ? t(getFormat(a.format).name) : a.format,
        startingLife: game === 'mtg' ? (commander ? 40 : 20) : 0,
        freeMulligan: commander,
        players: [
          { name: t('Você'), color: myColor, isBot: false, deck: a.deck, commanders: a.commanders },
          { name: mode === 'bot' ? botName(0) : t('Oponente'), color: oppColor, isBot: mode === 'bot', deck: b?.deck ?? [], commanders: b?.commanders ?? [] },
          ...extras.map((d, i) => ({ name: botName(i + 1), color: extraColors[i], isBot: true, deck: d.deck, commanders: d.commanders }))
        ]
      }
      const bots = mode === 'bot' ? setup.players.map((_, i) => i).filter((i) => i > 0) : []
      useSandbox.getState().start(setup, { game, format: setup.format, mySeat: 0, bots, deckNames: [a.name, b?.name ?? '', ...extras.map((d) => d.name)] })
      setInGame(true)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const myDeck = decks.find((d) => d.id === mine)
  const multi = game === 'mtg' && mode === 'bot' && !!myDeck && isCommanderFormat(myDeck.format)
  const shownBots = multi ? botCount : 1
  const allColors = [myColor, oppColor, ...extraColors.slice(0, shownBots - 1)]
  const takenBy = (own: string) => allColors.filter((c) => c !== own)
  // decks de Commander primeiro na lista dos bots
  const botDeckList = multi ? [...decks].sort((x, y) => Number(isCommanderFormat(y.format)) - Number(isCommanderFormat(x.format))) : decks
  const fmtName = (d: AnySummary) => (game === 'pokemon' ? t(getPkmFormat(d.format).name) : t(getFormat(d.format).name))
  void user
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>{t('Teste de deck')}</h1>
      <div className="sub">
        {t('Mesa livre: todas as jogadas são feitas por você (e pelo oponente). Os brilhos só indicam o que dá para jogar. Chame o Juiz IA no histórico se tiver dúvida sobre uma jogada.')}
      </div>
      {decks.length === 0 ? (
        <div className="panel muted">
          {t('Você ainda não tem decks.')}{' '}
          <button className="btn sm primary" onClick={() => go('decks')}>
            {t('Criar deck')}
          </button>
        </div>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <div className="panel">
            <h3>{t('Você')}</h3>
            <label className="field">
              {t('Seu deck')}
              <select value={mine} onChange={(e) => setMine(e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {fmtName(d)} ({d.cardCount})
                  </option>
                ))}
              </select>
            </label>
            <div className="field" style={{ marginTop: 10 }}>
              {t('Sua cor no histórico')}
              <ColorPicker value={myColor} onChange={setMyColor} taken={takenBy(myColor)} />
            </div>
          </div>
          <div className="panel">
            <h3>{shownBots > 1 ? t('Oponentes') : t('Oponente')}</h3>
            <div className="row" style={{ gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
              <label className="check">
                <input type="radio" checked={mode === 'bot'} onChange={() => setMode('bot')} /> 🤖 {t('Bot (IA) — treinar um confronto')}
              </label>
              <label className="check">
                <input type="radio" checked={mode === 'both'} onChange={() => setMode('both')} /> 👥 {t('Controlar os dois lados')}
              </label>
            </div>
            {multi && (
              <div className="field" style={{ marginBottom: 10 }}>
                {t('Commander multijogador: número de bots')}
                <div className="row" style={{ gap: 6 }}>
                  {[1, 2, 3].map((n) => (
                    <button key={n} type="button" className={`btn sm ${botCount === n ? 'primary' : ''}`} onClick={() => setBotCount(n)}>
                      {n === 1 ? t('1 bot') : t('{n} bots', { n })}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="field">
              {mode === 'bot' ? (shownBots > 1 ? t('Deck do Bot {n}', { n: 1 }) : t('Deck que o bot vai jogar')) : t('Deck do oponente')}
              <select value={theirs} onChange={(e) => setTheirs(e.target.value)}>
                {mode === 'both' && <option value="">{t('(sem deck — oponente vazio)')}</option>}
                {botDeckList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {fmtName(d)} ({d.cardCount})
                  </option>
                ))}
              </select>
            </label>
            <div className="field" style={{ marginTop: 10 }}>
              {shownBots > 1 ? t('Cor do Bot {n} no histórico', { n: 1 }) : t('Cor do oponente no histórico')}
              <ColorPicker value={oppColor} onChange={setOppColor} taken={takenBy(oppColor)} />
            </div>
            {Array.from({ length: shownBots - 1 }, (_, i) => (
              <div key={i} className="sb-extra-bot">
                <label className="field">
                  {t('Deck do Bot {n}', { n: i + 2 })}
                  <select value={extraDecks[i]} onChange={(e) => setExtraDecks(extraDecks.map((x, k) => (k === i ? e.target.value : x)))}>
                    {botDeckList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {fmtName(d)} ({d.cardCount})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field" style={{ marginTop: 10 }}>
                  {t('Cor do Bot {n} no histórico', { n: i + 2 })}
                  <ColorPicker value={extraColors[i]} onChange={(c) => setExtraColors(extraColors.map((x, k) => (k === i ? c : x)))} taken={takenBy(extraColors[i])} />
                </div>
              </div>
            ))}
            {mode === 'bot' && (
              <div className="small muted" style={{ marginTop: 8 }}>
                {t('O bot é uma IA: no turno dele, ela lê a mesa e faz as jogadas (pode errar regras — chame o juiz!). Precisa de internet e da sua conta logada.')}
              </div>
            )}
          </div>
          <div>
            <button className="btn primary lg" disabled={!mine || loading} onClick={() => void begin()}>
              {loading ? t('Preparando...') : `▶ ${t('Começar partida')}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
