// Tipos do motor de regras do Kard (Magic: The Gathering, 2 a 4 jogadores, todos contra todos).

/** Índice do assento (0..n-1). A ordem de turno é a ordem dos assentos, começando em `firstPlayer`. */
export type PlayerId = number

export type Step =
  | 'mulligan'
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginCombat'
  | 'declareAttackers'
  | 'declareBlockers'
  | 'combatDamage'
  | 'endCombat'
  | 'main2'
  | 'end'
  | 'cleanup'

export const STEP_ORDER: Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end',
  'cleanup'
]

export const STEP_LABEL: Record<Step, string> = {
  mulligan: 'Mulligan',
  untap: 'Desvirar',
  upkeep: 'Manutenção',
  draw: 'Compra',
  main1: 'Fase principal 1',
  beginCombat: 'Início do combate',
  declareAttackers: 'Declarar atacantes',
  declareBlockers: 'Declarar bloqueadores',
  combatDamage: 'Dano de combate',
  endCombat: 'Fim do combate',
  main2: 'Fase principal 2',
  end: 'Etapa final',
  cleanup: 'Limpeza'
}

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack'

export interface CardFaceDef {
  name: string
  displayName: string
  manaCost: string
  typeLine: string
  displayType: string
  oracleText: string
  displayText: string
  power?: string
  toughness?: string
  loyalty?: string
  colors: string[]
}

/** Definição imutável de uma carta dentro da partida. */
export interface GameCard {
  oracleId: string
  name: string
  displayName: string
  manaCost: string
  cmc: number
  typeLine: string
  displayType: string
  oracleText: string
  displayText: string
  power?: string
  toughness?: string
  loyalty?: string
  colors: string[]
  colorIdentity: string[]
  keywords: string[]
  producedMana?: string[]
  layout: string
  printingId?: string
  /** Só visual: acabamento da cópia (foil/etched). */
  finish?: 'foil' | 'etched' | 'reverse'
  faces?: CardFaceDef[]
  /** Fichas: cores e tipos definidos pelo efeito que as criou. */
  token?: boolean
}

// ---------------- Alvos e efeitos ----------------

export interface TargetSpec {
  players: 'none' | 'any' | 'opponent' | 'you'
  /** Tipos aceitos (qualquer um): creature, planeswalker, artifact, enchantment, land, permanent, nonland, noncreature, battle */
  objTypes: string[]
  zone: 'battlefield' | 'stack' | 'graveyard'
  spellTypes?: 'any' | 'creature' | 'noncreature' | 'instantSorcery' | 'ability'
  controller?: 'you' | 'opponent'
  nonColors?: string[]
  colors?: string[]
  flying?: boolean
  noFlying?: boolean
  tapped?: boolean
  untapped?: boolean
  attacking?: boolean
  blocking?: boolean
  attackingOrBlocking?: boolean
  maxPower?: number
  minPower?: number
  maxToughness?: number
  maxCmc?: number
  nonbasic?: boolean
  nonLegendary?: boolean
  nonToken?: boolean
  other?: boolean
  optional?: boolean
  subtype?: string
  text: string
}

/** Quantidade: número fixo, X pago, ou "N para cada ...". */
export type Amount = number | 'X' | { per: CountExpr; mult: number }

export type Who =
  | { k: 'you' }
  /** Cada oponente (todos os oponentes vivos, em ordem de turno). */
  | { k: 'opponent' }
  /** Cada jogador (ordem APNAP). */
  | { k: 'each' }
  /** "Defending player" / "that player" sem antecedente: o jogador que a criatura-fonte ataca
   *  (ou, fora de combate, o próximo oponente na ordem de turno). */
  | { k: 'defending' }
  | { k: 'target'; index: number }
  | { k: 'controllerOf'; index: number }

export type ObjRef =
  | { ref: 'target'; indices: number[] }
  | { ref: 'self' }
  | { ref: 'all'; filter: TargetSpec }
  | { ref: 'enchanted' }
  | { ref: 'equipped' }
  /** Objetos criados/movidos antes, nesta mesma resolução ("sacrifique-a no fim do turno"). */
  | { ref: 'created' }

export type DamageTo = ObjRef | { ref: 'player'; who: Who }

export interface TokenDef {
  name: string
  power?: number
  toughness?: number
  colors: string[]
  types: string
  keywords: string[]
  /** Fichas predefinidas: treasure, food, clue, blood */
  kind?: 'creature' | 'treasure' | 'food' | 'clue' | 'blood' | 'other'
}

export type Effect =
  | { k: 'damage'; amount: Amount; to: DamageTo }
  | { k: 'draw'; amount: Amount; who: Who }
  | { k: 'discard'; amount: Amount; who: Who; random?: boolean }
  | { k: 'gainLife'; amount: Amount; who: Who }
  | { k: 'loseLife'; amount: Amount; who: Who }
  | { k: 'mill'; amount: Amount; who: Who }
  | { k: 'destroy'; what: ObjRef }
  | { k: 'exile'; what: ObjRef }
  | { k: 'bounce'; what: ObjRef }
  | { k: 'tap'; what: ObjRef }
  | { k: 'untap'; what: ObjRef }
  | { k: 'pump'; what: ObjRef; power: Amount; toughness: Amount; keywords: string[]; negative?: boolean }
  | { k: 'counters'; what: ObjRef; n: Amount; counter: '+1/+1' | '-1/-1' }
  | { k: 'token'; n: Amount; token: TokenDef; who: Who }
  | { k: 'counterSpell'; index: number; unlessPay?: number }
  | { k: 'scry'; n: Amount; surveil?: boolean }
  | { k: 'search'; basic: boolean; landTypes?: string[]; cardTypes?: string[]; n: number; dest: 'battlefield' | 'hand' | 'top'; tapped: boolean }
  | { k: 'addMana'; mana: string[]; anyColor?: number; oneOf?: string[] }
  | { k: 'graveyardReturn'; index: number; dest: 'hand' | 'battlefield' }
  | { k: 'sacrifice'; who: Who; filter: TargetSpec }
  | { k: 'sacrificeSelf' }
  | { k: 'fight'; a: ObjRef; b: ObjRef; oneSided?: boolean }
  | { k: 'discardChosen'; who: Who; filter: 'any' | 'nonland' | 'noncreatureNonland' | 'creature' | 'instantSorcery' }
  | { k: 'gainControl'; what: ObjRef; untilEOT: boolean }
  | { k: 'proliferate' }
  | { k: 'returnOwn'; filter: TargetSpec }
  | { k: 'fog' }
  | { k: 'extraTurn' }
  | { k: 'regenerate'; what: ObjRef }
  | { k: 'flicker'; what: ObjRef; yourControl: boolean }
  | { k: 'transform'; what: ObjRef }
  | { k: 'monarch' }
  | { k: 'copyStack'; index: number }
  | { k: 'copyToken'; what: ObjRef }
  | { k: 'grant'; what: ObjRef; keywords: string[] }
  | { k: 'delayed'; what: ObjRef; action: 'sacrifice' | 'exile' | 'bounce' }
  | { k: 'impulse'; n: Amount; until: 'thisTurn' | 'nextTurn' }
  | { k: 'dig'; n: Amount; take: number; cardTypes: string[] | null; dest: 'hand' | 'battlefield'; rest: 'bottom' | 'graveyard' }
  | { k: 'putLandFromHand' }

export interface Cost {
  mana: string
  tap: boolean
  sacrificeSelf: boolean
  payLife: number
  discard: number
  loyalty?: number
  exileSelf?: boolean
}

export interface EffectBlock {
  effects: Effect[]
  targets: TargetSpec[]
  unsupported: string[]
  text: string
}

export type TriggerEvent =
  | 'etb'
  | 'dies'
  | 'ltb'
  | 'attacks'
  | 'blocks'
  | 'combatDamagePlayer'
  | 'upkeep'
  | 'eachUpkeep'
  | 'endStep'
  | 'eachEndStep'
  | 'beginCombat'
  | 'castSpell'
  | 'otherCreatureEtb'
  | 'landfall'
  | 'lifeGain'
  | 'allyCombatDamage'

export interface TriggeredAbility extends EffectBlock {
  event: TriggerEvent
  spellFilter?: 'any' | 'noncreature' | 'instantSorcery' | 'creature'
  creatureFilter?: 'you' | 'any'
  /** Gatilho modal ("choose one —"). */
  modes?: EffectBlock[]
}

export interface ActivatedAbility extends EffectBlock {
  cost: Cost
  sorcerySpeed: boolean
  isEquip?: boolean
  isLoyalty?: boolean
  fromHand?: 'cycling'
  label: string
}

export interface ManaAbility {
  cost: Cost
  /** Cada unidade lista as cores possíveis (W U B R G C). */
  units: string[][]
  text: string
}

export type StaticAbility =
  | { k: 'anthem'; filter: TargetSpec; power: number; toughness: number; keywords: string[] }
  | { k: 'attachedBuff'; power: number; toughness: number; keywords: string[] }
  | { k: 'attachedLock'; cantAttack: boolean; cantBlock: boolean; noUntap: boolean; noActivate: boolean }
  | { k: 'attachedControl' }
  | { k: 'extraLand' }
  | { k: 'costReduction'; types: string[]; amount: number }
  | { k: 'noMaxHandSize' }

/** Contagens usadas por P/R variáveis: "igual ao número de terrenos que você controla" etc. */
export type CountExpr =
  | 'lands' | 'creatures' | 'otherCreatures' | 'artifacts' | 'enchantments' | 'hand' | 'graveyard' | 'creatureCardsGraveyard'
  | 'forests' | 'swamps' | 'islands' | 'mountains' | 'plains'
  /** devoção às cores indicadas (ex.: 'devotion:W', 'devotion:WU') */
  | `devotion:${string}`

export interface ParsedCard {
  spell?: EffectBlock & { modes?: EffectBlock[]; chooseCount?: number }
  triggers: TriggeredAbility[]
  activated: ActivatedAbility[]
  mana: ManaAbility[]
  statics: StaticAbility[]
  entersTapped: boolean
  aura?: TargetSpec
  cantBlock: boolean
  cantAttack: boolean
  unblockable: boolean
  mustAttack?: boolean
  noUntapSelf?: boolean
  entersWithCounters?: Amount
  entersTappedUnless?:
    | { kind: 'controlType'; types: string[] }
    | { kind: 'fewLands'; max: number }
    | { kind: 'manyLands'; min: number }
    | { kind: 'manyBasics'; min: number }
    | { kind: 'legendaryCreature' }
    | { kind: 'lowLife'; max: number }
    | { kind: 'multiplayer' }
  /** "As ~ enters, you may pay N life. If you don't, it enters tapped." */
  shockLife?: number
  ptFrom?: CountExpr
  selfBuffPer?: { count: CountExpr; power: number; toughness: number }
  additionalCost?: { kind: 'sacrifice'; filter: TargetSpec; text: string } | { kind: 'discard'; n: number; text: string }
  chooseCreatureType?: boolean
  keywords: string[]
  /** Linhas de texto que o motor não automatiza. */
  unsupported: string[]
}

// ---------------- Estado do jogo ----------------

export interface Mod {
  power: number
  toughness: number
  keywords: string[]
}

export interface GameObject {
  id: string
  owner: PlayerId
  controller: PlayerId
  zone: ZoneName
  card: GameCard
  face: number
  parsed: ParsedCard
  tapped: boolean
  sick: boolean
  damage: number
  deathtouched: boolean
  counters: Record<string, number>
  mods: Mod[]
  attachedTo?: string
  originalController?: PlayerId
  /** Controle temporário (até o fim do turno): controlador original a restaurar. */
  eotController?: PlayerId
  isCommander: boolean
  isToken: boolean
  /** Escudos de regeneração (até o fim do turno). */
  regen?: number
  /** Palavras-chave concedidas permanentemente (somem ao trocar de zona). */
  grants?: string[]
  /** Carta exilada que pode ser jogada ("impulse draw"). */
  playableBy?: PlayerId
  playableUntil?: number
  chosenType?: string
  loyaltyUsedTurn?: number
  timestamp: number
  /** Para cartas na mão do oponente: revelada ao jogador? */
  revealed?: boolean
  /** Poder/resistência base definidos à mão (cartas com "*" impresso e regra que o motor não entende). */
  ptOverride?: { power: number; toughness: number }
  /** Já avisou que o poder/resistência desta carta é desconhecido? */
  ptWarned?: boolean
}

export type TargetChoice = { kind: 'player'; player: PlayerId } | { kind: 'object'; id: string } | { kind: 'stack'; id: string }

export interface StackItem {
  id: string
  kind: 'spell' | 'ability' | 'trigger'
  objectId?: string
  sourceId?: string
  sourceName: string
  controller: PlayerId
  block: EffectBlock
  targets: (TargetChoice | null)[]
  x: number
  isPermanentSpell: boolean
  fromCommand?: boolean
  printingId?: string
  equip?: boolean
  modeIndex?: number
  /** Cópia de mágica/habilidade (não há carta física). */
  isCopy?: boolean
  /** Objetos movidos/criados durante a resolução (para "it"/"them" posteriores). */
  touched?: string[]
}

export type AttackTarget = { kind: 'player'; player: PlayerId } | { kind: 'planeswalker'; id: string }

export interface CombatState {
  /** `defender`: o jogador defensor daquele atacante (o jogador atacado ou o controlador do planeswalker atacado). */
  attackers: { id: string; target: AttackTarget; defender?: PlayerId }[]
  blockers: { blocker: string; attacker: string }[]
  /** Jogadores defensores que ainda vão declarar bloqueadores (em ordem de turno; o primeiro é o atual). */
  pendingDefenders?: PlayerId[]
  blockersDeclared: boolean
  damageDealt: boolean
  firstStrikeDone: boolean
}

export interface PendingTrigger {
  controller: PlayerId
  sourceId: string
  sourceName: string
  ability: TriggeredAbility
  printingId?: string
}

export type PendingChoice =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'bottom'; player: PlayerId; count: number }
  | { kind: 'discard'; player: PlayerId; count: number; reason: string }
  | { kind: 'targets'; player: PlayerId; trigger: PendingTrigger }
  | { kind: 'scry'; player: PlayerId; cards: string[]; surveil: boolean }
  | { kind: 'search'; player: PlayerId; candidates: string[]; count: number; dest: 'battlefield' | 'hand' | 'top'; tapped: boolean }
  | { kind: 'sacrifice'; player: PlayerId; candidates: string[]; count: number }
  | { kind: 'pickDiscard'; player: PlayerId; target: PlayerId; candidates: string[]; revealed: string[] }
  | { kind: 'returnOwn'; player: PlayerId; candidates: string[]; count: number }
  | { kind: 'mode'; player: PlayerId; trigger: PendingTrigger }
  | { kind: 'dig'; player: PlayerId; cards: string[]; eligible: string[]; take: number; dest: 'hand' | 'battlefield'; rest: 'bottom' | 'graveyard' }
  | { kind: 'handLand'; player: PlayerId; candidates: string[] }

export interface PendingAI {
  item: StackItem
  text: string
}

export interface ManaPool {
  W: number
  U: number
  B: number
  R: number
  G: number
  C: number
}

export interface PlayerState {
  id: PlayerId
  name: string
  isBot: boolean
  life: number
  poison: number
  library: string[]
  hand: string[]
  graveyard: string[]
  exile: string[]
  command: string[]
  pool: ManaPool
  landsPlayed: number
  commanderCasts: Record<string, number>
  commanderDamage: Record<string, number>
  drewFromEmpty: boolean
  /** Perdeu a partida (eliminado). */
  lost: boolean
  /** Turno em que o jogador foi eliminado (definido quando a derrota é processada). */
  eliminatedTurn?: number
  mulligans: number
  kept: boolean
}

export interface LogEntry {
  id: number
  turn: number
  kind: 'info' | 'action' | 'judge' | 'error' | 'combat' | 'ai' | 'turn' | 'manual'
  text: string
  player?: PlayerId
}

export interface GameState {
  format: string
  commanderGame: boolean
  turn: number
  firstPlayer: PlayerId
  activePlayer: PlayerId
  step: Step
  priority: PlayerId
  passes: number
  /** 2 a 4 jogadores, indexados pelo assento (`players[i].id === i`). */
  players: PlayerState[]
  objects: Record<string, GameObject>
  battlefield: string[]
  stack: StackItem[]
  combat: CombatState | null
  /** Declaração pendente. Bloqueadores: um defensor por vez, em ordem de turno (ver `combat.pendingDefenders`). */
  awaiting: { kind: 'attackers' | 'blockers'; player: PlayerId } | null
  choices: PendingChoice[]
  pendingTriggers: PendingTrigger[]
  resolving: { item: StackItem; next: number; aiDone?: boolean } | null
  pendingAI: PendingAI | null
  log: LogEntry[]
  winner: PlayerId | 'draw' | null
  nextId: number
  rng: number
  timestamp: number
  aiEnabled: boolean
  monarch?: PlayerId | null
  extraTurns?: number[]
  fogTurn?: number
  delayed?: { controller: PlayerId; ids: string[]; action: 'sacrifice' | 'exile' | 'bounce'; afterTurn: number; afterStep: string }[]
  /** Problemas do motor nesta partida (texto não entendido, Juiz IA, ajustes manuais...), para o relatório. */
  issues?: EngineIssueEvent[]
  /** Total de problemas já anotados (as anotações antigas são descartadas; este contador só cresce). */
  issueSeq?: number
}

/**
 * Tipos de problema registrados para o relatório do motor:
 * - unparsed: texto de carta que o motor não automatiza (sem Juiz IA)
 * - aiJudge: texto que precisou do Juiz IA
 * - aiFailed: o Juiz IA falhou e o efeito não foi aplicado
 * - manual: um jogador corrigiu o estado com ajuste manual (sinal de que o motor errou)
 * - unknownPT: criatura "*" cujo poder/resistência o motor não sabe calcular
 * - crash: erro interno do motor ao processar uma jogada
 * - botRejected: o bot propôs uma jogada que o motor recusou
 * - userReport: problema descrito pelo jogador
 */
export type EngineIssueKind = 'unparsed' | 'aiJudge' | 'aiFailed' | 'manual' | 'unknownPT' | 'crash' | 'botRejected' | 'userReport'

export interface EngineIssueEvent {
  kind: EngineIssueKind
  /** Nome em inglês (oracle) da carta envolvida. */
  card?: string
  text: string
  turn: number
  /** Últimas linhas do registro da partida no momento do problema. */
  context?: string[]
}

// ---------------- Ações ----------------

export type ManualOp =
  | { op: 'life'; player: PlayerId; delta: number }
  | { op: 'tap'; id: string }
  | { op: 'counter'; id: string; delta: number }
  | { op: 'move'; id: string; to: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'libraryTop' | 'libraryBottom' }
  | { op: 'draw'; player: PlayerId }
  | { op: 'damage'; id: string; delta: number }
  | { op: 'setPT'; id: string; power: number; toughness: number }

export type Action =
  | { t: 'pass' }
  | { t: 'playLand'; id: string; face?: number }
  | { t: 'cast'; id: string; targets: (TargetChoice | null)[]; x?: number; face?: number; mode?: number; modes?: number[]; extra?: string[] }
  | { t: 'chooseMode'; index: number }
  | { t: 'activate'; id: string; ability: number; targets: (TargetChoice | null)[]; x?: number }
  | { t: 'tapMana'; id: string; color?: string }
  | { t: 'attack'; attackers: { id: string; target: AttackTarget }[] }
  | { t: 'block'; blocks: { blocker: string; attacker: string }[] }
  | { t: 'keep' }
  | { t: 'mulligan' }
  | { t: 'chooseCards'; ids: string[] }
  | { t: 'chooseTargets'; targets: (TargetChoice | null)[] }
  | { t: 'aiResolve'; ops: import('../types.ts').JudgeOp[]; explanation: string }
  | { t: 'aiSkip'; reason: string }
  | { t: 'manual'; op: ManualOp }
  | { t: 'concede' }

export interface ActionResult {
  state: GameState
  error?: string
  /** Erro interno do motor (exceção): a jogada foi desfeita. Mensagem + pilha, para o relatório. */
  crash?: string
}

export interface PlayerSetup {
  name: string
  isBot: boolean
  deck: GameCard[]
  commanders: GameCard[]
}

export interface GameSetup {
  format: string
  startingLife: number
  /** 2 a 4 jogadores, na ordem dos assentos. */
  players: PlayerSetup[]
  seed?: number
  aiEnabled: boolean
  firstPlayer?: PlayerId
}
