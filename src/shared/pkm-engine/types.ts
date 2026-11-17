// Motor de regras do Pokémon TCG: tipos.
// Puro TS, determinístico (semente + mesma sequência de ações = mesmo estado), como o motor de Magic:
// o modo online depende disso. Imports com extensão .ts para rodar nos scripts de teste do Node.
import type { PkmCard, PkmType } from '../pokemon/types.ts'
import type { EngineIssueEvent } from '../engine/types.ts'

export type PSeat = number

/** Carta do deck como entra na partida. */
export interface PGameCard {
  card: PkmCard
  printingId?: string
}

/** Um objeto (carta física) da partida. */
export interface PObj {
  id: string
  owner: PSeat
  card: PkmCard
  printingId?: string
}

export type SpecialCondition = 'asleep' | 'confused' | 'paralyzed'

/** Pokémon em jogo (Ativo ou no Banco): pilha de evolução + cartas ligadas. */
export interface InPlay {
  /** id da carta do topo (o Pokémon atual). */
  id: string
  /** Cartas da evolução, de baixo (Básico) para cima (inclui o topo). */
  stack: string[]
  energy: string[]
  tool?: string
  /** Dano acumulado (múltiplos de 10). */
  damage: number
  condition?: SpecialCondition
  poisoned?: boolean
  burned?: boolean
  /** Turno em que entrou em jogo / evoluiu pela última vez (regras de evolução). */
  playedTurn: number
  evolvedTurn?: number
  /** Turno em que ficou Paralisado (sai na verificação depois do próximo turno do dono). */
  paralyzedTurn?: number
  /** Efeitos com duração (número do turno até o qual valem). */
  cantAttackUntil?: number
  cantRetreatUntil?: number
  reduceDamage?: { n: number; until: number }
  preventAllUntil?: number
}

export interface PPlayer {
  id: PSeat
  name: string
  isBot: boolean
  deck: string[]
  hand: string[]
  discard: string[]
  prizes: string[]
  lostZone: string[]
  active: InPlay | null
  bench: InPlay[]
  mulligans: number
  energyAttached: boolean
  supporterPlayed: boolean
  stadiumPlayed: boolean
  retreated: boolean
  /** Habilidades "uma vez por turno" já usadas (id do Pokémon + índice). */
  abilitiesUsed: string[]
  lost: boolean
  /** Perdeu por não conseguir comprar no início do turno. */
  deckedOut?: boolean
}

export type PStep = 'setup' | 'main' | 'over'

export interface PLogEntry {
  id: number
  turn: number
  kind: 'info' | 'action' | 'judge' | 'combat' | 'turn' | 'manual' | 'coin'
  text: string
  player?: PSeat
}

/** Filtro de cartas para buscas e escolhas. */
export interface CardFilter {
  category?: 'Pokemon' | 'Trainer' | 'Energy'
  basicPokemon?: boolean
  basicEnergy?: boolean
  trainerType?: string
  /** Tipo de energia básica / Pokémon. */
  type?: PkmType
  /** Pokémon sem Regra (não ex, V, GX...). */
  noRuleBox?: boolean
}

/** Escolhas pendentes. A da preparação é simultânea; as outras, uma por vez (fila). */
export type PChoice =
  | { kind: 'setup'; player: PSeat }
  | { kind: 'extraDraw'; player: PSeat; max: number }
  | { kind: 'promote'; player: PSeat }
  /** Cartas de uma zona (mão, deck, descarte, topo do deck...). */
  | { kind: 'cards'; player: PSeat; zone: 'hand' | 'deck' | 'discard' | 'reveal'; owner: PSeat; candidates: string[]; shown: string[]; min: number; max: number; prompt: string }
  /** Um Pokémon em jogo (meu/do oponente, Ativo/Banco). */
  | { kind: 'inPlay'; player: PSeat; candidates: string[]; optional: boolean; prompt: string }
  /** Energias ligadas a um Pokémon. */
  | { kind: 'energy'; player: PSeat; pokemon: string; candidates: string[]; count: number; prompt: string }
  | { kind: 'yesNo'; player: PSeat; prompt: string }

// ---------------- Efeitos ----------------

export type Gate = 'heads' | 'tails'

/** Alvo de efeitos sobre Pokémon. */
export type PokeRef = 'self' | 'oppActive' | 'chooseOwn' | 'chooseOwnBench' | 'chooseOpp' | 'chooseOppBench' | 'eachOppBench' | 'eachOwnBench' | 'eachOpp' | 'eachOwn'

export type PEffect =
  // modificadores de dano do ataque (aplicados antes de causar o dano)
  | { k: 'coinMore'; coins: number; amount: number; untilTails?: boolean }
  | { k: 'coinTimes'; coins: number; amount: number; untilTails?: boolean }
  | { k: 'coinFail' }
  | { k: 'moreIfDamaged'; amount: number }
  | { k: 'morePerEnergy'; who: 'self' | 'opp'; amount: number }
  | { k: 'morePerDamageCounterOpp'; amount: number }
  | { k: 'morePerBench'; who: 'self' | 'opp' | 'both'; amount: number }
  | { k: 'moreIfOppDamaged'; amount: number }
  | { k: 'perCounterSelf'; amount: number; replace: boolean }
  | { k: 'moreIfStadium'; amount: number }
  | { k: 'moreIfOppCondition'; cond: 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned' | 'any'; amount: number }
  | { k: 'moreIfOppEvolved'; amount: number }
  | { k: 'ignoreResistance' }
  | { k: 'ignoreWeaknessResistance' }
  // efeitos (depois do dano, na ordem do texto)
  /** Joga uma moeda; os efeitos seguintes com `gate` dependem dela. */
  | { k: 'flip' }
  | { k: 'damage'; target: PokeRef; amount: number; count?: number; gate?: Gate }
  | { k: 'selfDamage'; amount: number; gate?: Gate }
  | { k: 'heal'; target: PokeRef; amount: number; gate?: Gate }
  | { k: 'condition'; target: 'oppActive' | 'self'; cond: SpecialCondition | 'poisoned' | 'burned'; gate?: Gate }
  | { k: 'draw'; n: number; gate?: Gate }
  | { k: 'drawUntil'; n: number }
  | { k: 'discardHandDraw'; n: number }
  | { k: 'shuffleHandDraw'; n: number }
  | { k: 'discardEnergy'; from: 'self' | 'oppActive'; count: number | 'all'; type?: PkmType; gate?: Gate }
  | { k: 'cantAttackNext' }
  | { k: 'oppCantRetreat'; gate?: Gate }
  | { k: 'reduceDamageNext'; amount: number; gate?: Gate }
  | { k: 'preventAllNext'; gate?: Gate }
  | { k: 'switchSelf'; optional: boolean }
  | { k: 'switchOwnActive' }
  | { k: 'gust' }
  | { k: 'oppSwitches' }
  | { k: 'millOpp'; n: number; gate?: Gate }
  | { k: 'millSelf'; n: number }
  | { k: 'discardRandomOpp'; gate?: Gate }
  | { k: 'search'; filter: CardFilter; max: number; dest: 'hand' | 'bench'; gate?: Gate }
  | { k: 'fromDiscard'; filter: CardFilter; max: number; dest: 'hand' | 'deck' }
  | { k: 'discardFromHand'; n: number; cost?: boolean }
  | { k: 'rareCandy' }
  | { k: 'attachFromDiscard'; filter: CardFilter; target: PokeRef }
  | { k: 'shuffleIntoDeckSelf' }

export interface ParsedText {
  effects: PEffect[]
  /** Trechos que o motor não entende (viram ajuste manual). */
  unsupported: string[]
}

export interface ParsedCardRules {
  attacks: ParsedText[]
  abilities: ParsedText[]
  /** Treinador / texto de Energia. */
  trainer?: ParsedText
  /** Energia especial: quantas unidades e de que tipos ela fornece ('any' = qualquer tipo). */
  energyProvides?: (PkmType | 'any')[]
  /** Ferramenta: +HP. */
  toolHp?: number
  /** Ferramenta: +dano no Pokémon Ativo do oponente (antes de Fraqueza/Resistência). */
  toolDamage?: number
}

/** Resolução em andamento (efeitos de ataque ou de Treinador que podem pedir escolhas). */
export interface Resolving {
  source: string
  sourceName: string
  controller: PSeat
  kind: 'attack' | 'trainer' | 'ability'
  effects: PEffect[]
  next: number
  /** Ataque: dano base já calculado (0 se não causa dano). */
  baseDamage?: number
  attackName?: string
  /** Moedas já jogadas para o portão atual (cara = true). */
  lastCoin?: boolean
  /** Resultado de "Se você fizer isso" (custo pago). */
  costPaid?: boolean
  /** Efeito pausado esperando uma escolha. */
  waiting?: boolean
  /** Pokémon escolhido (para efeitos com alvo). */
  picked?: string
  /** Treinador a descartar no fim (Item/Apoiador). */
  trainerId?: string
  /** Ataque: o turno termina quando a resolução acabar. */
  endsTurn?: boolean
  /** Efeitos com vários alvos: quantos já foram escolhidos. */
  sub?: number
}

export interface PGameState {
  game: 'pokemon'
  format: string
  turn: number
  firstPlayer: PSeat
  activePlayer: PSeat
  step: PStep
  players: PPlayer[]
  objects: Record<string, PObj>
  stadium: string | null
  choices: PChoice[]
  resolving: Resolving | null
  log: PLogEntry[]
  winner: PSeat | 'draw' | null
  nextId: number
  rng: number
  /** Cadeia de evolução conhecida: Estágio 1 → Básico (para Doce Raro). */
  evolutions: Record<string, string>
  /** Turno em que alguém atacou (evita dois ataques). */
  attackedTurn?: number
  /** O turno acabou: o próximo começa assim que as escolhas pendentes (ex.: novo Ativo) forem feitas. */
  pendingNext?: boolean
  /** A compra extra pelos mulligans já foi oferecida. */
  extraOffered?: boolean
  issues?: EngineIssueEvent[]
  issueSeq?: number
}

export interface PGameSetup {
  format: string
  players: { name: string; isBot: boolean; deck: PGameCard[] }[]
  seed?: number
  firstPlayer?: number
  /** Estágio 1 → Básico (nomes em inglês), para o Doce Raro saber a cadeia de evolução. */
  evolutions?: Record<string, string>
}

export type PManualOp =
  | { op: 'damage'; id: string; delta: number }
  | { op: 'condition'; id: string; cond: SpecialCondition | 'poisoned' | 'burned' | 'clear' }
  | { op: 'move'; id: string; to: 'hand' | 'discard' | 'deckTop' | 'deckBottom' | 'lostZone' }
  | { op: 'takePrize'; player: PSeat }
  | { op: 'draw'; player: PSeat }
  | { op: 'shuffle'; player: PSeat }

export type PAction =
  | { t: 'setup'; active: string; bench: string[] }
  | { t: 'extraDraw'; n: number }
  | { t: 'playBasic'; id: string }
  | { t: 'evolve'; id: string; target: string }
  | { t: 'attachEnergy'; id: string; target: string }
  | { t: 'playTrainer'; id: string; target?: string }
  | { t: 'retreat'; to: string; energy?: string[] }
  | { t: 'useAbility'; id: string; index: number }
  | { t: 'attack'; index: number }
  | { t: 'endTurn' }
  | { t: 'chooseCards'; ids: string[] }
  | { t: 'chooseInPlay'; id: string | null }
  | { t: 'chooseYesNo'; yes: boolean }
  | { t: 'manual'; op: PManualOp }
  | { t: 'concede' }

export interface PActionResult {
  state: PGameState
  error?: string
  crash?: string
}
