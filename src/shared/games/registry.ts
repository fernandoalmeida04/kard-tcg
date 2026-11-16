// Registro dos jogos genéricos (hoje: Yu-Gi-Oh!). Para um jogo novo: def.ts + download.ts + entrada aqui.
import type { GameDef, GameId } from './types.ts'
import { def as ygo } from './ygo/def.ts'

export const GAMES: Record<GameId, GameDef> = { ygo }

export const GAME_IDS: GameId[] = ['ygo']

export function isGameId(x: string): x is GameId {
  return (GAME_IDS as string[]).includes(x)
}

export function getGame(id: string): GameDef | undefined {
  return (GAMES as Record<string, GameDef>)[id]
}
