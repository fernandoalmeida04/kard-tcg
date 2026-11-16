// Tabelas de nomes do Yu-Gi-Oh! (inglês da fonte → rótulo em português, que é a chave do t()).
// Módulo só de dados (sem imports) para ser usado tanto pelo def quanto pelo dicionário en/ygo.ts.

/** Tipos de carta (humanReadableCardType do YGOPRODeck). */
export const YGO_SUBTYPES: Record<string, string> = {
  'Normal Monster': 'Monstro Normal',
  'Effect Monster': 'Monstro de Efeito',
  Monster: 'Monstro',
  'Flip Effect Monster': 'Monstro Reverso de Efeito',
  'Flip Tuner Effect Monster': 'Monstro Reverso Regulador de Efeito',
  'Union Effect Monster': 'Monstro de União de Efeito',
  'Gemini Effect Monster': 'Monstro Gêmeo de Efeito',
  'Spirit Effect Monster': 'Monstro Espírito de Efeito',
  'Toon Effect Monster': 'Monstro Toon de Efeito',
  'Tuner Effect Monster': 'Monstro Regulador de Efeito',
  'Tuner Normal Monster': 'Monstro Regulador Normal',
  'Ritual Monster': 'Monstro de Ritual',
  'Ritual Effect Monster': 'Monstro de Ritual de Efeito',
  'Ritual Flip Effect Monster': 'Monstro de Ritual Reverso de Efeito',
  'Ritual Tuner Effect Monster': 'Monstro de Ritual Regulador de Efeito',
  'Ritual Pendulum Effect Monster': 'Monstro de Ritual de Pêndulo de Efeito',
  'Pendulum Normal Monster': 'Monstro de Pêndulo Normal',
  'Pendulum Effect Monster': 'Monstro de Pêndulo de Efeito',
  'Pendulum Flip Effect Monster': 'Monstro de Pêndulo Reverso de Efeito',
  'Pendulum Tuner Effect Monster': 'Monstro de Pêndulo Regulador de Efeito',
  'Pendulum Tuner Normal Monster': 'Monstro de Pêndulo Regulador Normal',
  'Pendulum Spirit Effect Monster': 'Monstro de Pêndulo Espírito de Efeito',
  'Fusion Monster': 'Monstro de Fusão',
  'Fusion Effect Monster': 'Monstro de Fusão de Efeito',
  'Fusion Tuner Monster': 'Monstro de Fusão Regulador',
  'Fusion Tuner Effect Monster': 'Monstro de Fusão Regulador de Efeito',
  'Fusion Toon Effect Monster': 'Monstro de Fusão Toon de Efeito',
  'Fusion Pendulum Effect Monster': 'Monstro de Fusão de Pêndulo de Efeito',
  'Synchro Monster': 'Monstro Sincro',
  'Synchro Effect Monster': 'Monstro Sincro de Efeito',
  'Synchro Tuner Effect Monster': 'Monstro Sincro Regulador de Efeito',
  'Synchro Pendulum Effect Monster': 'Monstro Sincro de Pêndulo de Efeito',
  'Xyz Monster': 'Monstro Xyz',
  'Xyz Effect Monster': 'Monstro Xyz de Efeito',
  'Xyz Pendulum Effect Monster': 'Monstro Xyz de Pêndulo de Efeito',
  'Link Monster': 'Monstro Link',
  'Link Effect Monster': 'Monstro Link de Efeito',
  'Normal Spell': 'Magia Normal',
  'Continuous Spell': 'Magia Contínua',
  'Quick-Play Spell': 'Magia Rápida',
  'Equip Spell': 'Magia de Equipamento',
  'Field Spell': 'Magia de Campo',
  'Ritual Spell': 'Magia de Ritual',
  'Normal Trap': 'Armadilha Normal',
  'Continuous Trap': 'Armadilha Contínua',
  'Counter Trap': 'Armadilha de Resposta'
}

/** Tipos de monstro (race). */
export const YGO_RACES: Record<string, string> = {
  Aqua: 'Aqua',
  Beast: 'Besta',
  'Beast-Warrior': 'Besta-Guerreira',
  'Creator God': 'Deus Criador',
  Cyberse: 'Ciberso',
  Dinosaur: 'Dinossauro',
  'Divine-Beast': 'Besta Divina',
  Dragon: 'Dragão',
  Fairy: 'Fada',
  Fiend: 'Demônio',
  Fish: 'Peixe',
  Illusion: 'Ilusão',
  Insect: 'Inseto',
  Machine: 'Máquina',
  Plant: 'Vegetal',
  Psychic: 'Psíquico',
  Pyro: 'Piro',
  Reptile: 'Réptil',
  Rock: 'Rocha',
  'Sea Serpent': 'Serpente Marinha',
  Spellcaster: 'Mago',
  Thunder: 'Trovão',
  Warrior: 'Guerreiro',
  'Winged Beast': 'Besta Alada',
  Wyrm: 'Wyrm',
  Zombie: 'Zumbi'
}

/** Habilidades/tipos de monstro do typeline (exceto o tipo do monstro). */
export const YGO_ABILITIES: Record<string, string> = {
  Normal: 'Sem efeito (Normal)',
  Effect: 'Efeito',
  Flip: 'Reverso',
  Union: 'União',
  Gemini: 'Gêmeo',
  Spirit: 'Espírito',
  Toon: 'Toon',
  Tuner: 'Regulador',
  Pendulum: 'Pêndulo',
  Ritual: 'Ritual',
  Fusion: 'Fusão',
  Synchro: 'Sincro',
  Xyz: 'Xyz',
  Link: 'Link'
}

/** Atributos e "cores" de Magia/Armadilha: id → [rótulo em português, rótulo em inglês, cor CSS]. */
export const YGO_COLORS: [string, string, string, string][] = [
  ['DARK', 'TREVAS', 'DARK', '#6b3fa0'],
  ['LIGHT', 'LUZ', 'LIGHT', '#e8c547'],
  ['EARTH', 'TERRA', 'EARTH', '#8b6a3e'],
  ['WATER', 'ÁGUA', 'WATER', '#2f7fd8'],
  ['FIRE', 'FOGO', 'FIRE', '#e0482f'],
  ['WIND', 'VENTO', 'WIND', '#3fae5a'],
  ['DIVINE', 'DIVINO', 'DIVINE', '#c9a227'],
  ['SPELL', 'Magia', 'Spell', '#1d9e8c'],
  ['TRAP', 'Armadilha', 'Trap', '#b0407e']
]
