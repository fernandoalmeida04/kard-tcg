import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/api'
import type { KardApi } from '../shared/api'
import type { AuthUser, DownloadProgress, UpdateStatus } from '../shared/types'
import type { GameId } from '../shared/games/types'
import type { OnlinePresence, RoomMessage } from '../shared/online/protocol'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: KardApi = {
  app: {
    version: () => invoke(IPC.appVersion),
    updateStatus: () => invoke(IPC.updateStatus),
    onUpdate: (cb) => {
      const listener = (_e: unknown, s: UpdateStatus) => cb(s)
      ipcRenderer.on(IPC.updateEvent, listener)
      return () => ipcRenderer.removeListener(IPC.updateEvent, listener)
    },
    installUpdate: () => invoke(IPC.updateInstall),
    openDatabaseFolder: () => invoke(IPC.openDbFolder),
    openExternal: (url) => invoke(IPC.openExternal, url)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (update) => invoke(IPC.settingsSet, update),
    choosePlaymat: () => invoke(IPC.playmatChoose),
    clearPlaymat: () => invoke(IPC.playmatClear)
  },
  db: {
    status: () => invoke(IPC.dbStatus),
    download: (lang) => invoke(IPC.dbDownload, lang),
    cancel: () => invoke(IPC.dbCancel),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: DownloadProgress) => cb(p)
      ipcRenderer.on(IPC.dbProgress, listener)
      return () => ipcRenderer.removeListener(IPC.dbProgress, listener)
    },
    search: (q) => invoke(IPC.dbSearch, q),
    sets: () => invoke(IPC.dbSets),
    details: (id) => invoke(IPC.dbDetails, id),
    cards: (ids) => invoke(IPC.dbCards, ids),
    printings: (ids) => invoke(IPC.dbPrintings, ids),
    resolveNames: (lines) => invoke(IPC.dbResolve, lines),
    candidates: (q) => invoke(IPC.dbCandidates, q),
    basicLands: () => invoke(IPC.dbBasics),
    prefetchImages: (ids) => invoke(IPC.dbPrefetch, ids),
    clearImages: () => invoke(IPC.dbClearImages)
  },
  decks: {
    list: () => invoke(IPC.decksList),
    get: (id) => invoke(IPC.decksGet, id),
    save: (deck) => invoke(IPC.decksSave, deck),
    remove: (id) => invoke(IPC.decksRemove, id)
  },
  pkm: {
    status: () => invoke(IPC.pkmStatus),
    download: (lang) => invoke(IPC.pkmDownload, lang),
    cancel: () => invoke(IPC.pkmCancel),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: DownloadProgress) => cb(p)
      ipcRenderer.on(IPC.pkmProgress, listener)
      return () => ipcRenderer.removeListener(IPC.pkmProgress, listener)
    },
    search: (q) => invoke(IPC.pkmSearch, q),
    sets: () => invoke(IPC.pkmSets),
    details: (id) => invoke(IPC.pkmDetails, id),
    cards: (ids) => invoke(IPC.pkmCards, ids),
    printings: (ids) => invoke(IPC.pkmPrintings, ids),
    resolveNames: (lines) => invoke(IPC.pkmResolve, lines),
    decks: {
      list: () => invoke(IPC.pkmDecksList),
      get: (id) => invoke(IPC.pkmDecksGet, id),
      save: (deck) => invoke(IPC.pkmDecksSave, deck),
      remove: (id) => invoke(IPC.pkmDecksRemove, id)
    }
  },
  games: {
    status: (game) => invoke(IPC.gStatus, game),
    download: (game, lang) => invoke(IPC.gDownload, game, lang),
    cancel: (game) => invoke(IPC.gCancel, game),
    onProgress: (cb) => {
      const listener = (_e: unknown, game: GameId, p: DownloadProgress) => cb(game, p)
      ipcRenderer.on(IPC.gProgress, listener)
      return () => ipcRenderer.removeListener(IPC.gProgress, listener)
    },
    search: (game, q) => invoke(IPC.gSearch, game, q),
    sets: (game) => invoke(IPC.gSets, game),
    facet: (game, key) => invoke(IPC.gFacet, game, key),
    details: (game, id) => invoke(IPC.gDetails, game, id),
    cards: (game, ids) => invoke(IPC.gCards, game, ids),
    printings: (game, ids) => invoke(IPC.gPrintings, game, ids),
    resolveNames: (game, lines) => invoke(IPC.gResolve, game, lines),
    decks: {
      list: (game) => invoke(IPC.gDecksList, game),
      get: (game, id) => invoke(IPC.gDecksGet, game, id),
      save: (deck) => invoke(IPC.gDecksSave, deck),
      remove: (game, id) => invoke(IPC.gDecksRemove, game, id)
    }
  },
  online: {
    join: (code) => invoke(IPC.onlineJoin, code),
    send: (msg) => invoke(IPC.onlineSend, msg),
    leave: () => invoke(IPC.onlineLeave),
    onMessage: (cb) => {
      const listener = (_e: unknown, m: RoomMessage) => cb(m)
      ipcRenderer.on(IPC.onlineMsg, listener)
      return () => ipcRenderer.removeListener(IPC.onlineMsg, listener)
    },
    onPresence: (cb) => {
      const listener = (_e: unknown, p: OnlinePresence[]) => cb(p)
      ipcRenderer.on(IPC.onlinePresence, listener)
      return () => ipcRenderer.removeListener(IPC.onlinePresence, listener)
    },
    onStatus: (cb) => {
      const listener = (_e: unknown, s: 'connected' | 'error' | 'closed') => cb(s)
      ipcRenderer.on(IPC.onlineStatus, listener)
      return () => ipcRenderer.removeListener(IPC.onlineStatus, listener)
    }
  },
  auth: {
    configured: () => invoke(IPC.authConfigured),
    current: () => invoke(IPC.authCurrent),
    onChange: (cb) => {
      const listener = (_e: unknown, u: AuthUser | null) => cb(u)
      ipcRenderer.on(IPC.authChanged, listener)
      return () => ipcRenderer.removeListener(IPC.authChanged, listener)
    },
    usernameAvailable: (name) => invoke(IPC.authUsernameAvailable, name),
    signUp: (username, email, password) => invoke(IPC.authSignUp, username, email, password),
    verifyCode: (email, code) => invoke(IPC.authVerify, email, code),
    resendCode: (email) => invoke(IPC.authResend, email),
    signIn: (email, password) => invoke(IPC.authSignIn, email, password),
    signInWithGoogle: () => invoke(IPC.authGoogle),
    setUsername: (username) => invoke(IPC.authSetUsername, username),
    signOut: () => invoke(IPC.authSignOut)
  },
  judge: {
    resolveEffect: (req) => invoke(IPC.judgeEffect, req),
    ask: (req) => invoke(IPC.judgeAsk, req),
    test: () => invoke(IPC.judgeTest)
  }
}

contextBridge.exposeInMainWorld('kard', api)
