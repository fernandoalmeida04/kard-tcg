// Protocolo das mesas online (Supabase Realtime, canal "kard-room-<CÓDIGO>").
//
// Modelo "anfitrião sequenciador": todos os computadores rodam o MESMO motor de regras, que é
// determinístico (mesma semente + mesma sequência de ações = mesmo estado). Só ações trafegam:
//   1. o jogador manda `intent` (a jogada que quer fazer);
//   2. o anfitrião valida no motor; se for válida, publica `act` com um número de sequência;
//   3. todos (inclusive o anfitrião) aplicam os `act` em ordem.
// Quem entra/reconecta pede `sync` e recebe o `start` + todas as ações já feitas.
import type { Action } from '../engine/types.ts'
import type { CardFinish, FormatId } from '../types.ts'

export type RoomMode = 'duel' | 'commander'

export interface RoomConfig {
  code: string
  mode: RoomMode
  format: FormatId
  maxPlayers: number
  hostId: string
}

/** Deck enviado pela rede: só ids (cada computador monta as cartas pelo próprio banco local). */
export interface CompactCard {
  /** oracleId */
  o: string
  /** printingId */
  p?: string
  f?: CardFinish
  q: number
}

export interface CompactDeck {
  name: string
  commanders: CompactCard[]
  main: CompactCard[]
}

export interface LobbyPlayer {
  userId: string
  username: string
  deck?: CompactDeck
  ready: boolean
}

export interface OnlinePresence {
  userId: string
  username: string
}

export interface OnlineSetup {
  seed: number
  firstPlayer: number
  format: string
  startingLife: number
  /** Juiz IA ligado (só o anfitrião consulta o Claude; o resultado entra como ação). */
  aiEnabled?: boolean
  /** Em ordem de assento (0..n-1). */
  players: { userId: string; username: string; deck: CompactDeck }[]
}

export interface OnlineAct {
  seq: number
  seat: number
  action: Action
}

export type RoomMessage =
  /** Alguém entrou na mesa e quer o estado do lobby. */
  | { type: 'hello'; userId: string; username: string }
  /** Estado do lobby (só o anfitrião envia). */
  | { type: 'lobby'; config: RoomConfig; players: LobbyPlayer[]; started: boolean }
  | { type: 'deck'; userId: string; deck: CompactDeck }
  | { type: 'ready'; userId: string; ready: boolean }
  | { type: 'leave'; userId: string }
  | { type: 'kick'; userId: string }
  /** Início da partida (anfitrião). */
  | { type: 'start'; setup: OnlineSetup }
  /** Jogada pretendida (qualquer jogador → anfitrião). */
  | { type: 'intent'; seat: number; nonce: string; action: Action }
  /** Jogada aceita e numerada (anfitrião → todos). */
  | ({ type: 'act' } & OnlineAct)
  /** Jogada recusada (anfitrião → quem tentou). */
  | { type: 'reject'; seat: number; nonce: string; error: string }
  /** Pedido de ressincronização (quem entrou atrasado / reconectou). */
  | { type: 'sync-req'; userId: string; fromSeq: number }
  /** Resposta: setup + ações a partir de fromSeq (pode vir em vários pedaços). */
  | { type: 'sync'; to: string; setup: OnlineSetup; acts: OnlineAct[]; final: boolean }
  | { type: 'chat'; userId: string; username: string; text: string }

/** Código de mesa: 6 caracteres sem letras/números confundíveis. */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

export function normalizeRoomCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}
