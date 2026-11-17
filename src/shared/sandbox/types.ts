// Mesa livre (Magic e Pokémon): sem regras automáticas. Os jogadores fazem tudo manualmente
// (jogar cartas, virar para gerar mana, ligar Energia, atacar, pegar prêmios...) e cada ação vira
// uma linha do histórico. O Juiz IA pode ser chamado para analisar qualquer linha.
// Determinístico (semente + mesmas ações = mesmo estado), como exige o modo online.
import type { GameCard } from '../engine/types.ts'
import type { PkmCard } from '../pokemon/types.ts'
import type { Step } from '../engine/types.ts'

export type { Step }

export type SGame = 'mtg' | 'pokemon'

export const MTG_ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as const
export const PKM_ZONES = ['deck', 'hand', 'active', 'bench', 'discard', 'prizes', 'lostZone', 'stadium'] as const
export type MtgZone = (typeof MTG_ZONES)[number]
export type PkmZone = (typeof PKM_ZONES)[number]
export type SZone = MtgZone | PkmZone

export type SCard = GameCard | PkmCard

export interface SObj {
  id: string
  owner: number
  card: SCard
  printingId?: string
  /** Magic: virada. */
  tapped?: boolean
  /** Virada para baixo (prêmios, cartas escondidas). */
  faceDown?: boolean
  /** Marcadores (+1/+1, lealdade, veneno...). */
  counters: Record<string, number>
  /** Pokémon: dano (múltiplos de 10). */
  damage?: number
  /** Pokémon: condições especiais. */
  conditions?: string[]
  /** Ligada a outra carta (Energia, Ferramenta, Aura, Equipamento). */
  attachedTo?: string
  /** Pokémon: cartas de evolução embaixo (da mais antiga para a mais recente). */
  under?: string[]
  /** Turno em que entrou em jogo (indicador de "enjoo de invocação"/evolução). */
  enteredTurn?: number
  /** Magic: atacando neste turno. Pokémon: atacou neste turno. */
  attacking?: boolean
  /** Magic: foi virada por ter atacado (desvira se for retirada do ataque). */
  attackTapped?: boolean
  /** Magic: quem esta criatura ataca (assento do jogador ou id de um planeswalker). */
  attackTarget?: number | string
  /** Magic: ficha (deixa de existir ao sair do campo de batalha). */
  token?: boolean
  /** Magic: é um comandante; e quantas vezes saiu da zona de comando (imposto = 2 × isso). */
  commander?: boolean
  commanderCasts?: number
  /** Magic: bloqueando esta criatura. */
  blocking?: string
  /** Pokémon: turno em que ficou Paralisado (sai na Verificação depois do próximo turno do dono). */
  paralyzedOn?: number
  /** Face mostrada (cartas dupla-face). */
  face?: number
}

export interface SPlayer {
  id: number
  name: string
  /** Cor do jogador no histórico (hex). */
  color: string
  isBot: boolean
  life: number
  zones: Record<string, string[]>
  /** Magic: mana gerada e ainda não usada (indicador). */
  pool: Record<string, number>
  /** Indicadores do turno (não são regras): terrenos baixados, Energia ligada, Apoiador jogado... */
  landsThisTurn: number
  energyThisTurn: number
  supporterThisTurn: number
  conceded?: boolean
  /** Pokémon: já recuou neste turno (indicador) e Habilidades usadas no turno ("id:índice"). */
  retreatedThisTurn?: number
  abilitiesThisTurn?: string[]
  /** Magic: marcadores de veneno e dano de comandante recebido (por comandante). */
  poison?: number
  commanderDamage?: Record<string, number>
  /** Magic: mulligans feitos na mão inicial e se já manteve. */
  mulligans?: number
  kept?: boolean
}

export interface SLog {
  id: number
  /** Índice da ação que gerou a linha (-1 = sistema). Usado pelo Juiz IA para reconstruir a mesa. */
  seq: number
  turn: number
  player?: number
  text: string
  kind: 'action' | 'turn' | 'system' | 'chat' | 'coin'
}

export interface SState {
  game: SGame
  format: string
  turn: number
  activePlayer: number
  players: SPlayer[]
  objects: Record<string, SObj>
  log: SLog[]
  rng: number
  nextId: number
  /** Ações aplicadas até agora. */
  seq: number
  /** Quem venceu (só por concessão; o resto os jogadores decidem). */
  winner: number | null
  /** Magic: etapa atual do turno (desvirar, manutenção, compra, fase principal 1, combate...). */
  step?: Step
  /** Pokémon: a compra do turno 1 já foi feita (acontece quando todos terminam a preparação). */
  firstDrawDone?: boolean
  /** Magic: primeiro mulligan grátis (Commander). */
  freeMulligan?: boolean
}

export interface SSetup {
  game: SGame
  format: string
  seed?: number
  firstPlayer?: number
  startingLife?: number
  /** Magic: o primeiro mulligan é grátis (Commander). */
  freeMulligan?: boolean
  players: { name: string; color: string; isBot: boolean; deck: { card: SCard; printingId?: string }[]; commanders?: { card: SCard; printingId?: string }[] }[]
}

export type SAction =
  /** Move uma carta para uma zona (de qualquer lugar). */
  /** `cast`: Magic — a carta foi conjurada (instantâneo/feitiço indo para o cemitério), não descartada. */
  | { t: 'move'; id: string; to: SZone; pos?: 'top' | 'bottom'; faceDown?: boolean; cast?: boolean }
  /** Liga uma carta a outra (Energia, Ferramenta, Aura, Equipamento). */
  | { t: 'attach'; id: string; target: string }
  /** Pokémon: coloca a evolução em cima do Pokémon. */
  | { t: 'evolve'; id: string; target: string }
  | { t: 'tap'; id: string }
  /** Vira para mana. `mana`: símbolos gerados (ex.: ['C','C']); sem ele, usa a habilidade da carta que gera `color`. */
  | { t: 'tapForMana'; id: string; color: string; n?: number; mana?: string[] }
  | { t: 'untapAll' }
  | { t: 'mana'; color: string; delta: number }
  | { t: 'manaClear' }
  | { t: 'counter'; id: string; key: string; delta: number }
  | { t: 'damage'; id: string; delta: number }
  | { t: 'condition'; id: string; cond: string }
  | { t: 'life'; player: number; delta: number }
  | { t: 'draw'; n: number }
  | { t: 'shuffle'; zone: SZone }
  | { t: 'mulligan' }
  /** Magic: mantém a mão inicial, pondo no fundo do grimório 1 carta por mulligan (mulligan de Londres). */
  | { t: 'keep'; bottom: string[] }
  | { t: 'setupPrizes' }
  | { t: 'takePrize'; id: string }
  | { t: 'flip'; id: string }
  /** Magic: marca/desmarca atacante. Pokémon: ataque — com `damage`/`target` aplica o dano; `endTurn` encerra o turno. */
  | { t: 'attack'; id: string; index?: number; damage?: number; target?: string; endTurn?: boolean; attackTarget?: number | string }
  /** Magic: cria fichas (ou uma cópia de `copyOf` como ficha). */
  | { t: 'token'; name?: string; power?: string; toughness?: string; types?: string; text?: string; colors?: string[]; count?: number; copyOf?: string }
  | { t: 'poison'; player: number; delta: number }
  | { t: 'commanderDamage'; player: number; source: string; delta: number }
  /** Magic: olha as N cartas do topo do grimório (só registra; as cartas vão para onde o jogador mover). */
  | { t: 'lookTop'; n: number }
  /** Pokémon: usa uma Habilidade (o efeito é feito à mão). */
  | { t: 'ability'; id: string; index: number }
  | { t: 'block'; id: string; attacker: string | null }
  /** Pokémon: troca o Ativo. `retreat`: é um recuo (paga o custo descartando `discard`); sem ele, troca por efeito de carta. */
  | { t: 'switchActive'; id: string; retreat?: boolean; discard?: string[] }
  | { t: 'coin' }
  | { t: 'dice'; sides: number }
  /** Magic: vai para outra etapa do turno (para a frente). */
  | { t: 'step'; to: Step }
  | { t: 'passTurn' }
  | { t: 'note'; text: string }
  | { t: 'concede' }

export interface SResult {
  state: SState
  error?: string
}
