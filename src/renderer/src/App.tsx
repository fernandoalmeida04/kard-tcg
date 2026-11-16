import { useEffect } from 'react'
import { useApp, type Page } from './store'
import { ContextMenu, Toasts } from './components/common'
import logo from './assets/logo.png'
import HomePage from './pages/Home'
import DatabasePage from './pages/Database'
import DecksPage from './pages/Decks'
import DeckEditor from './pages/DeckEditor'
import PlayPage from './pages/Play'
import SettingsPage from './pages/Settings'
import CollectionPage from './pages/Collection'
import OnlinePage from './online/OnlinePage'
import { clearCardCache } from './cardCache'
import { useGame } from './game/gameStore'
import TcgSelector, { ComingSoon } from './components/TcgSelector'
import AccountButton from './auth/AccountButton'
import UpdateBanner from './components/UpdateBanner'
import AuthModal from './auth/AuthModal'
import { useAuth } from './auth/authStore'
import PkmHome from './pokemon/PkmHome'
import PkmDatabase from './pokemon/PkmDatabase'
import PkmDecks from './pokemon/PkmDecks'
import PkmDeckEditor from './pokemon/PkmDeckEditor'
import GameHome from './games/GameHome'
import GameDatabase from './games/GameDatabase'
import GameDecks from './games/GameDecks'
import GameDeckEditor from './games/GameDeckEditor'
import { getGame, isGameId } from '@shared/games/registry'
import { setUiLang, uiLocale, t } from '@shared/i18n'

const NAV: { page: Page; label: string; ico: string }[] = [
  { page: 'home', label: 'Início', ico: '⌂' },
  { page: 'database', label: 'Download de cartas', ico: '⬇' },
  { page: 'collection', label: 'Coleção de cartas', ico: '❖' },
  { page: 'decks', label: 'Meus decks', ico: '▤' },
  { page: 'play', label: 'Teste de deck', ico: '🧪' },
  { page: 'online', label: 'Jogar online', ico: '🌐' }
]

export default function App() {
  const page = useApp((s) => s.page)
  const go = useApp((s) => s.go)
  const inGame = useApp((s) => s.inGame)
  const gameActive = useGame((s) => s.state !== null)
  const refreshDb = useApp((s) => s.refreshDb)
  const loadSettings = useApp((s) => s.loadSettings)
  const setProgress = useApp((s) => s.setProgress)

  useEffect(() => {
    loadSettings()
    refreshDb()
    const off = window.kard.db.onProgress((p) => {
      if (p.message === 'db-loaded') {
        refreshDb()
        return
      }
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') {
        clearCardCache()
        refreshDb()
      }
    })
    // o banco pode demorar alguns segundos para carregar na inicialização
    const timer = setInterval(() => {
      const db = useApp.getState().db
      if (!db || db.loading) refreshDb()
    }, 1500)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [loadSettings, refreshDb, setProgress])

  // conta do usuário (Supabase)
  useEffect(() => useAuth.getState().init(), [])

  const showSidebar = !((page === 'play' || page === 'online') && inGame && gameActive)

  // Idioma da interface: definido antes de renderizar os filhos; a `key` remonta a árvore ao trocar
  // (o estado da partida e dos decks fica nas stores, então nada se perde).
  const uiLang = useApp((s) => s.settings?.uiLanguage ?? 'pt')
  const tcg = useApp((s) => s.settings?.tcg ?? 'mtg')
  setUiLang(uiLang)
  useEffect(() => {
    document.documentElement.lang = uiLocale()
  }, [uiLang])

  return (
    <div key={uiLang} className={`app ${showSidebar ? '' : 'fullscreen'}`}>
      {showSidebar && (
        <aside className="sidebar">
          <div className="brand">
            <img src={logo} alt="Kard" />
            <div>
              <div className="t1">KARD</div>
              <div className="t2">TCG SIMULATOR</div>
            </div>
          </div>
          <TcgSelector />
          {NAV.map((n) => (
            <button key={n.page} className={`nav-btn ${page === n.page || (n.page === 'decks' && page === 'editor') ? 'active' : ''}`} onClick={() => go(n.page)}>
              <span className="ico">{n.ico}</span>
              {t(n.label)}
            </button>
          ))}
          <div className="spacer" />
          <UpdateBanner />
          <AccountButton />
          <div className="sidebar-bottom">
            <div className="foot">
              {tcg === 'mtg' ? (
                <>
                  Magic: The Gathering
                  <br />
                  {t('Dados e imagens: Scryfall')}
                </>
              ) : isGameId(tcg) ? (
                <>
                  {getGame(tcg)!.name}
                  <br />
                  {t('Dados e imagens: {source}', { source: getGame(tcg)!.source.name })}
                </>
              ) : (
                <>
                  Pokémon TCG
                  <br />
                  {t('Dados e imagens: TCGdex')}
                </>
              )}
            </div>
            <button className={`settings-btn ${page === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} title={t('Configurações')} aria-label={t('Configurações')}>
              ⚙
            </button>
          </div>
        </aside>
      )}
      <main style={{ minWidth: 0, minHeight: 0 }}>
        {page === 'settings' ? (
          <SettingsPage />
        ) : page === 'collection' ? (
          <CollectionPage key={tcg} />
        ) : page === 'online' ? (
          tcg === 'mtg' ? <OnlinePage /> : <ComingSoon title={t('Jogar online')} message={t('As partidas online estão disponíveis por enquanto só para Magic: The Gathering.')} />
        ) : isGameId(tcg) ? (
          <>
            {page === 'home' && <GameHome game={tcg} />}
            {page === 'database' && <GameDatabase game={tcg} />}
            {page === 'decks' && <GameDecks game={tcg} />}
            {page === 'editor' && <GameDeckEditor game={tcg} />}
            {/* partidas destes jogos ainda não existem */}
            {page === 'play' && <ComingSoon title={t('Teste de deck')} message={t('As partidas deste jogo ainda estão em desenvolvimento. Por enquanto, você já pode baixar o banco de cartas e montar seus decks.')} />}
          </>
        ) : tcg === 'pokemon' ? (
          <>
            {page === 'home' && <PkmHome />}
            {page === 'database' && <PkmDatabase />}
            {page === 'decks' && <PkmDecks />}
            {page === 'editor' && <PkmDeckEditor />}
            {/* partidas de Pokémon ainda não existem */}
            {page === 'play' && <ComingSoon title={t('Teste de deck')} message={t('As partidas de Pokémon ainda estão em desenvolvimento. Por enquanto, você já pode baixar o banco de cartas e montar seus decks.')} />}
          </>
        ) : (
          <>
            {page === 'home' && <HomePage />}
            {page === 'database' && <DatabasePage />}
            {page === 'decks' && <DecksPage />}
            {page === 'editor' && <DeckEditor />}
            {page === 'play' && <PlayPage />}
          </>
        )}
      </main>
      <Toasts />
      <ContextMenu />
      <AuthModal />
    </div>
  )
}
