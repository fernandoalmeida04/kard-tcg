// Traduções para inglês (chave = texto em português). Grupo: ygo
import { YGO_ABILITIES, YGO_COLORS, YGO_RACES, YGO_SUBTYPES } from '../../games/ygo/names.ts'

/** Inverte uma tabela inglês → português em português → inglês. */
function reverse(table: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([en, pt]) => [pt, en]))
}

const en: Record<string, string> = {
  ...reverse(YGO_SUBTYPES),
  ...reverse(YGO_RACES),
  ...reverse(YGO_ABILITIES),
  ...Object.fromEntries(YGO_COLORS.map(([, pt, enLabel]) => [pt, enLabel])),
  'Sem efeito (Normal)': 'Normal (no effect)',

  // Categorias e grupos
  Monstro: 'Monster',
  Monstros: 'Monsters',
  Magias: 'Spells',
  Armadilhas: 'Traps',
  Fusão: 'Fusion',
  Sincro: 'Synchro',

  // Formatos e fonte
  'Avançado TCG': 'Advanced (TCG)',
  'Lista de proibidas e limitadas do TCG (Ocidente). Só cartas já lançadas no TCG.':
    'TCG Forbidden & Limited List (West). Only cards already released in the TCG.',
  'Lista de proibidas e limitadas do OCG (Japão/Ásia). Só cartas lançadas no OCG.':
    'OCG Forbidden & Limited List (Japan/Asia). Only cards released in the OCG.',
  'Formato retrô de 2005: apenas cartas daquela época, com a lista de proibidas GOAT.':
    'Retro 2005 format: only cards from that era, with the GOAT Forbidden list.',
  Livre: 'Casual',
  'Sem lista de proibidas: qualquer carta, até 3 cópias.': 'No Forbidden list: any card, up to 3 copies.',
  'Dados e imagens das cartas: API pública do YGOPRODeck (db.ygoprodeck.com). Yu-Gi-Oh! é marca da Konami; este app não é afiliado a eles.':
    'Card data and images: YGOPRODeck public API (db.ygoprodeck.com). Yu-Gi-Oh! is a trademark of Konami; this app is not affiliated with them.',

  // Filtros, ordenação e estatísticas
  Categoria: 'Category',
  'Tipo de carta': 'Card type',
  Atributo: 'Attribute',
  'Tipo de monstro': 'Monster type',
  Habilidade: 'Ability',
  'Nível / Classe': 'Level / Rank',
  Nível: 'Level',
  Escala: 'Scale',
  Arquétipo: 'Archetype',
  'Nível {n}': 'Level {n}',
  'Classe {n}': 'Rank {n}',
  'Link-{n}': 'Link-{n}',
  'Arte alternativa': 'Alternate art',

  // Validação
  '{name} é um monstro do Extra Deck e não pode ficar no Deck Principal.': '{name} is an Extra Deck monster and cannot be in the Main Deck.',
  '{name} não é um monstro de Fusão, Sincro, Xyz ou Link e não pode ficar no Extra Deck.':
    '{name} is not a Fusion, Synchro, Xyz or Link monster and cannot be in the Extra Deck.',

  // Download
  'Falha ao baixar {url} (HTTP {status}).': 'Failed to download {url} (HTTP {status}).',
  'Baixando a lista de coleções...': 'Downloading the set list...',
  'Baixando cartas (inglês)...': 'Downloading cards (English)...',
  'Baixando cartas (inglês)... {mb} MB': 'Downloading cards (English)... {mb} MB',
  'Baixando traduções ({lang})...': 'Downloading translations ({lang})...',
  'Baixando traduções ({lang})... {mb} MB': 'Downloading translations ({lang})... {mb} MB',
  português: 'Portuguese',
  francês: 'French',
  alemão: 'German',
  italiano: 'Italian',
  'Processando cartas...': 'Processing cards...',
  '{n} cartas processadas.': '{n} cards processed.'
}

export default en
