import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from 'electron'
import { join } from 'path'
import icon from '../../resources/logo.png?asset'
import { IPC } from '../shared/api'
import type { CandidateQuery } from '../shared/api'
import type { CardSearchQuery, Deck, JudgeEffectRequest, JudgeQuestionRequest, LangCode, SettingsUpdate } from '../shared/types'
import { db } from './cardDb'
import { databaseDir } from './paths'
import { cancelDownload, downloadDatabase } from './scryfall'
import { clearImageCache, prefetchImages, registerImageProtocol } from './images'
import { getDeck, listDecks, removeDeck, saveDeck } from './decks'
import { getSettings, updateSettings } from './settings'
import { choosePlaymat, clearPlaymat, playmatShareData } from './playmat'
import { pkmDb } from './pokemon/pkmDb'
import { cancelPkmDownload, downloadPokemonDatabase } from './pokemon/tcgdex'
import { getPkmDeck, listPkmDecks, removePkmDeck, savePkmDeck } from './pokemon/pkmDecks'
import type { PkmDeck, PkmSearchQuery } from '../shared/pokemon/types'
import { gameDb } from './games/gameDb'
import { initUpdater, installUpdate, updateStatus } from './updater'
import { initOnline, joinRoomChannel, leaveRoomChannel, sendRoomMessage } from './online'
import { authConfigured, currentUser, onAuthChange, resendCode, setUsername, signIn, signInWithGoogle, signOut, signUp, usernameAvailable, verifyCode } from './auth'
import { cancelGameDownload, downloadGameDatabase, getGameDeck, listGameDecks, removeGameDeck, saveGameDeck } from './games/gameStore'
import { GAME_IDS, isGameId } from '../shared/games/registry'
import type { GameId, GDeck, GSearchQuery } from '../shared/games/types'
import { askJudge, resolveEffect, testJudge } from './judge'
import { chooseAvatar, getProfile, getPublicProfiles, removeAvatar, saveProfile } from './profile'
import { aiComplete, type AiRequest } from './ai'
import { dismissInvite, initSocial, inviteFriend, listFriends, pendingInvites, removeFriend, respondFriendRequest, searchUsers, sendFriendRequest, startSocial } from './social'
import { clearIssues, clearRemoteIssues, exportIssues, flushRemote, issuesMarkdown, listIssues, listRemoteIssues, recordIssues, remoteIsAdmin, type IssueSource } from './engineIssues'
import type { IssueInput } from '../shared/engineIssues'
import { adminBan, adminIds, adminLog, adminResetAi, adminSetAdmin, adminSetAiLimit, adminSetAnnouncement, adminStats, adminUnban, adminUsers, getAnnouncement } from './admin'
import type { Announcement } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'kard-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: 'Kard - TCG Simulator',
    icon,
    backgroundColor: '#080808',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // F12 / Ctrl+Shift+I abrem as ferramentas de desenvolvedor
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendProgress(p: unknown): void {
  mainWindow?.webContents.send(IPC.dbProgress, p)
}

function registerIpc(): void {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.updateStatus, () => updateStatus())
  ipcMain.handle(IPC.updateInstall, () => installUpdate())
  ipcMain.handle(IPC.openDbFolder, () => shell.openPath(databaseDir()))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, update: SettingsUpdate) => updateSettings(update))
  ipcMain.handle(IPC.playmatChoose, () => choosePlaymat(mainWindow))
  ipcMain.handle(IPC.playmatClear, () => clearPlaymat())
  ipcMain.handle(IPC.playmatShare, () => playmatShareData())

  ipcMain.handle(IPC.dbStatus, () => db.status())
  ipcMain.handle(IPC.dbDownload, async (_e, lang: LangCode) => {
    try {
      updateSettings({ cardLanguage: lang })
      await downloadDatabase(lang, sendProgress)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.dbCancel, () => cancelDownload())
  ipcMain.handle(IPC.dbSearch, (_e, q: CardSearchQuery) => db.search(q))
  ipcMain.handle(IPC.dbSets, () => db.sets())
  ipcMain.handle(IPC.dbDetails, (_e, oracleId: string) => db.details(oracleId))
  ipcMain.handle(IPC.dbCards, (_e, ids: string[]) => db.cardsByIds(ids))
  ipcMain.handle(IPC.dbPrintings, (_e, ids: string[]) => db.printingsByIds(ids))
  ipcMain.handle(IPC.dbResolve, (_e, lines: { name: string; set?: string; cn?: string }[]) => db.resolveNames(lines))
  ipcMain.handle(IPC.dbCandidates, (_e, q: CandidateQuery) => db.candidates(q))
  ipcMain.handle(IPC.dbBasics, () => db.basicLands())
  ipcMain.handle(IPC.dbPrefetch, async (_e, ids: string[]) => {
    try {
      const downloaded = await prefetchImages(ids, sendProgress)
      return { ok: true, downloaded }
    } catch (err) {
      return { ok: false, downloaded: 0, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.dbClearImages, () => clearImageCache())

  ipcMain.handle(IPC.decksList, () => listDecks())
  ipcMain.handle(IPC.decksGet, (_e, id: string) => getDeck(id))
  ipcMain.handle(IPC.decksSave, (_e, deck: Deck) => saveDeck(deck))
  ipcMain.handle(IPC.decksRemove, (_e, id: string) => removeDeck(id))

  // Pokémon TCG
  ipcMain.handle(IPC.pkmStatus, () => pkmDb.status())
  ipcMain.handle(IPC.pkmDownload, async (_e, lang: string) => {
    try {
      await downloadPokemonDatabase(lang, (p) => mainWindow?.webContents.send(IPC.pkmProgress, p))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.pkmCancel, () => cancelPkmDownload())
  ipcMain.handle(IPC.pkmSearch, (_e, q: PkmSearchQuery) => pkmDb.search(q))
  ipcMain.handle(IPC.pkmSets, () => pkmDb.sets())
  ipcMain.handle(IPC.pkmDetails, (_e, id: string) => pkmDb.details(id))
  ipcMain.handle(IPC.pkmCards, (_e, ids: string[]) => pkmDb.cardsByIds(ids))
  ipcMain.handle(IPC.pkmPrintings, (_e, ids: string[]) => pkmDb.printingsByIds(ids))
  ipcMain.handle(IPC.pkmResolve, (_e, lines: { name: string; set?: string; number?: string }[]) => pkmDb.resolveNames(lines))
  ipcMain.handle(IPC.pkmDecksList, () => listPkmDecks())
  ipcMain.handle(IPC.pkmDecksGet, (_e, id: string) => getPkmDeck(id))
  ipcMain.handle(IPC.pkmDecksSave, (_e, deck: PkmDeck) => savePkmDeck(deck))
  ipcMain.handle(IPC.pkmDecksRemove, (_e, id: string) => removePkmDeck(id))

  // Jogos genéricos (Yu-Gi-Oh!)
  const g = (game: string) => {
    if (!isGameId(game)) throw new Error(`Jogo desconhecido: ${game}`)
    return gameDb(game)
  }
  ipcMain.handle(IPC.gStatus, (_e, game: GameId) => g(game).status())
  ipcMain.handle(IPC.gDownload, async (_e, game: GameId, lang: string) => {
    try {
      g(game)
      await downloadGameDatabase(game, lang, (p) => mainWindow?.webContents.send(IPC.gProgress, game, p))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.gCancel, (_e, game: GameId) => cancelGameDownload(game))
  ipcMain.handle(IPC.gSearch, (_e, game: GameId, q: GSearchQuery) => g(game).search(q))
  ipcMain.handle(IPC.gSets, (_e, game: GameId) => g(game).sets())
  ipcMain.handle(IPC.gFacet, (_e, game: GameId, key: string) => g(game).facet(key))
  ipcMain.handle(IPC.gDetails, (_e, game: GameId, id: string) => g(game).details(id))
  ipcMain.handle(IPC.gCards, (_e, game: GameId, ids: string[]) => g(game).cardsByIds(ids))
  ipcMain.handle(IPC.gPrintings, (_e, game: GameId, ids: string[]) => g(game).printingsByIds(ids))
  ipcMain.handle(IPC.gResolve, (_e, game: GameId, lines: { name?: string; code?: string }[]) => g(game).resolveNames(lines))
  ipcMain.handle(IPC.gDecksList, (_e, game: GameId) => (g(game), listGameDecks(game)))
  ipcMain.handle(IPC.gDecksGet, (_e, game: GameId, id: string) => (g(game), getGameDeck(game, id)))
  ipcMain.handle(IPC.gDecksSave, (_e, deck: GDeck) => (g(deck.game), saveGameDeck(deck)))
  ipcMain.handle(IPC.gDecksRemove, (_e, game: GameId, id: string) => (g(game), removeGameDeck(game, id)))

  // Mesas online
  ipcMain.handle(IPC.onlineJoin, (_e, code: string) => joinRoomChannel(code))
  ipcMain.handle(IPC.onlineSend, (_e, msg: unknown) => sendRoomMessage(msg))
  ipcMain.handle(IPC.onlineLeave, () => leaveRoomChannel())

  // Contas (Supabase)
  ipcMain.handle(IPC.authConfigured, () => authConfigured())
  ipcMain.handle(IPC.authCurrent, () => currentUser())
  ipcMain.handle(IPC.authUsernameAvailable, (_e, name: string) => usernameAvailable(name))
  ipcMain.handle(IPC.authSignUp, (_e, username: string, email: string, password: string) => signUp(username, email, password))
  ipcMain.handle(IPC.authVerify, (_e, email: string, code: string) => verifyCode(email, code))
  ipcMain.handle(IPC.authResend, (_e, email: string) => resendCode(email))
  ipcMain.handle(IPC.authSignIn, (_e, email: string, password: string) => signIn(email, password))
  ipcMain.handle(IPC.authGoogle, () => signInWithGoogle())
  ipcMain.handle(IPC.authSetUsername, (_e, username: string) => setUsername(username))
  ipcMain.handle(IPC.authSignOut, () => signOut())
  ipcMain.handle(IPC.profileGet, () => getProfile())
  ipcMain.handle(IPC.profileSave, (_e, info) => saveProfile(info))
  ipcMain.handle(IPC.profileAvatar, () => chooseAvatar(mainWindow))
  ipcMain.handle(IPC.profileAvatarRemove, () => removeAvatar())
  ipcMain.handle(IPC.profilePublic, (_e, ids: string[]) => getPublicProfiles(ids))
  // IA (Juiz e bot)
  ipcMain.handle(IPC.aiComplete, (_e, req: AiRequest) => aiComplete(req))
  // Amigos
  ipcMain.handle(IPC.socialList, () => listFriends())
  ipcMain.handle(IPC.socialSearch, (_e, q: string) => searchUsers(q))
  ipcMain.handle(IPC.socialRequest, (_e, id: string) => sendFriendRequest(id))
  ipcMain.handle(IPC.socialRespond, (_e, id: string, accept: boolean) => respondFriendRequest(id, accept))
  ipcMain.handle(IPC.socialRemove, (_e, id: string) => removeFriend(id))
  ipcMain.handle(IPC.socialInvite, (_e, id: string, code: string) => inviteFriend(id, code))
  ipcMain.handle(IPC.socialDismiss, (_e, id: number) => dismissInvite(id))
  ipcMain.handle(IPC.socialPending, () => pendingInvites())
  onAuthChange((u) => {
    mainWindow?.webContents.send(IPC.authChanged, u)
    // entrou na conta: envia os problemas do motor que estavam esperando
    if (u) void flushRemote()
    void startSocial(u?.id ?? null)
  })
  // problemas que ficaram na fila da última vez (sem internet ou sem login)
  setTimeout(() => void flushRemote(), 15_000)

  ipcMain.handle(IPC.judgeEffect, (_e, req: JudgeEffectRequest) => resolveEffect(req))
  ipcMain.handle(IPC.judgeAsk, (_e, req: JudgeQuestionRequest) => askJudge(req))
  ipcMain.handle(IPC.judgeTest, () => testJudge())
  // Relatório de problemas do motor
  ipcMain.handle(IPC.issuesRecord, (_e, list: IssueInput[]) => recordIssues(list))
  ipcMain.handle(IPC.issuesList, () => listIssues())
  ipcMain.handle(IPC.issuesClear, (_e, keys?: string[]) => clearIssues(keys))
  ipcMain.handle(IPC.issuesExport, (_e, fixed: string[], source?: IssueSource) => exportIssues(mainWindow, fixed ?? [], source))
  ipcMain.handle(IPC.issuesMarkdown, (_e, fixed: string[], source?: IssueSource) => issuesMarkdown(fixed ?? [], source))
  ipcMain.handle(IPC.issuesRemoteAdmin, () => remoteIsAdmin())
  ipcMain.handle(IPC.issuesRemoteList, () => listRemoteIssues())
  ipcMain.handle(IPC.adminStats, () => adminStats())
  ipcMain.handle(IPC.adminUsers, (_e, q: string, sort: 'recent' | 'active' | 'ai', offset: number) => adminUsers(q, ['recent', 'active', 'ai'].includes(sort) ? sort : 'recent', Number(offset) || 0))
  ipcMain.handle(IPC.adminSetAdmin, (_e, id: string, make: boolean) => adminSetAdmin(String(id), Boolean(make)))
  ipcMain.handle(IPC.adminBan, (_e, id: string, reason: string, days: number | null) => adminBan(String(id), String(reason ?? ''), typeof days === 'number' ? days : null))
  ipcMain.handle(IPC.adminUnban, (_e, id: string) => adminUnban(String(id)))
  ipcMain.handle(IPC.adminResetAi, (_e, id: string) => adminResetAi(String(id)))
  ipcMain.handle(IPC.adminSetAnnouncement, (_e, a: Announcement | null) => adminSetAnnouncement(a && typeof a.text === 'string' ? a : null))
  ipcMain.handle(IPC.adminSetAiLimit, (_e, limit: number | null) => adminSetAiLimit(typeof limit === 'number' && Number.isFinite(limit) ? limit : null))
  ipcMain.handle(IPC.adminLog, () => adminLog())
  ipcMain.handle(IPC.adminAnnouncement, () => getAnnouncement())
  ipcMain.handle(IPC.adminIds, () => adminIds())
  ipcMain.handle(IPC.issuesRemoteClear, (_e, keys: string[]) => clearRemoteIssues(Array.isArray(keys) ? keys : []))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.kard.tcgsimulator')
    Menu.setApplicationMenu(null)
    registerImageProtocol()
    registerIpc()
    createWindow()
    if (mainWindow) {
      initUpdater(mainWindow)
      initOnline(mainWindow)
      initSocial(mainWindow)
      // já logado ao abrir o app: liga amigos online e convites
      void currentUser().then((u) => startSocial(u?.id ?? null))
    }
    // Carrega o banco local em segundo plano (pode levar alguns segundos)
    db.loadFromDisk().then(() => mainWindow?.webContents.send(IPC.dbProgress, { phase: 'idle', current: 0, total: 0, message: 'db-loaded' }))
    pkmDb.loadFromDisk().then(() => mainWindow?.webContents.send(IPC.pkmProgress, { phase: 'idle', current: 0, total: 0, message: 'db-loaded' }))
    for (const game of GAME_IDS) {
      gameDb(game)
        .loadFromDisk()
        .then(() => mainWindow?.webContents.send(IPC.gProgress, game, { phase: 'idle', current: 0, total: 0, message: 'db-loaded' }))
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
