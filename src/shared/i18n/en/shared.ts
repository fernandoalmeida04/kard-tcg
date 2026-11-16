// Traduções para inglês (chave = texto em português). Grupo: shared
const en: Record<string, string> = {
  // formats.ts — nomes de formato (nomes próprios não precisam de entrada)
  'Limitado (Draft/Selado)': 'Limited (Draft/Sealed)',
  'Casual (livre)': 'Casual (free-for-all)',

  // formats.ts — descrições dos formatos
  'Coleções recentes. Mínimo 60 cartas, até 4 cópias.': 'Recent sets. Minimum 60 cards, up to 4 copies.',
  'Return to Ravnica em diante.': 'Return to Ravnica onward.',
  'Oitava Edição em diante + Modern Horizons.': 'Eighth Edition onward + Modern Horizons.',
  'Todas as coleções, com lista de banidas.': 'All sets, with a banned list.',
  'Todas as coleções; cartas restritas limitadas a 1 cópia.': 'All sets; restricted cards limited to 1 copy.',
  'Somente cartas impressas como comuns.': 'Only cards printed at common.',
  'Formato do MTG Arena.': 'MTG Arena format.',
  'Formato eterno do MTG Arena.': 'MTG Arena eternal format.',
  'Quarta Edição até Scourge.': 'Fourth Edition through Scourge.',
  'Cartas baratas do MTGO.': 'Cheap MTGO cards.',
  '100 cartas singleton com comandante lendário; identidade de cor.': '100-card singleton with a legendary commander; color identity.',
  'Commander 1x1 com 20 de vida.': '1v1 Commander with 20 life.',
  '100 cartas singleton; comandante pode ser planeswalker.': '100-card singleton; the commander can be a planeswalker.',
  '60 cartas singleton com cartas do Standard.': '60-card singleton with Standard cards.',
  '60 cartas; planeswalker + mágica de assinatura.': '60 cards; planeswalker + signature spell.',
  'Commander só com comuns; comandante incomum.': 'Commander with commons only; uncommon commander.',
  'Commander com cartas até Modern Horizons.': 'Commander with cards up to Modern Horizons.',
  'Mínimo 40 cartas, sem limite de cópias.': 'Minimum 40 cards, no copy limit.',
  'Sem restrições de legalidade.': 'No legality restrictions.',

  // formats.ts — validação de deck
  '{card} é banida em {format}.': '{card} is banned in {format}.',
  '{card} não é legal em {format}.': '{card} is not legal in {format}.',
  '{card}: apenas 1 cópia permitida ({qty}).': '{card}: only 1 copy allowed ({qty}).',
  '{card}: no máximo {limit} cópias ({qty}).': '{card}: at most {limit} copies ({qty}).',
  '1 carta não encontrada no banco local: {names}': '1 card not found in the local database: {names}',
  '{n} cartas não encontradas no banco local: {names}': '{n} cards not found in the local database: {names}',
  'Escolha um Oathbreaker (planeswalker) e uma mágica de assinatura.': 'Choose an Oathbreaker (planeswalker) and a signature spell.',
  'Escolha um comandante.': 'Choose a commander.',
  '{card} normalmente não pode ser comandante neste formato.': '{card} normally cannot be a commander in this format.',
  'Oathbreaker exige exatamente 1 planeswalker como Oathbreaker.': 'Oathbreaker requires exactly 1 planeswalker as the Oathbreaker.',
  'Apenas 1 mágica de assinatura é permitida.': 'Only 1 signature spell is allowed.',
  'A mágica de assinatura {card} está fora da identidade de cor.': 'The signature spell {card} is outside the color identity.',
  'No máximo 2 comandantes (parceiros).': 'At most 2 commanders (partners).',
  '{a} e {b} não podem ser comandantes juntos (precisam de Parceiro ou Antecedente).':
    '{a} and {b} cannot be commanders together (they need Partner or a Background).',
  'O deck deve ter exatamente {size} cartas (incluindo comandante). Atual: {count}.':
    'The deck must have exactly {size} cards (including the commander). Current: {count}.',
  'O deck principal precisa de pelo menos {min} cartas. Atual: {count}.': 'The main deck needs at least {min} cards. Current: {count}.',
  'Este formato não usa sideboard.': 'This format does not use a sideboard.',
  'Sideboard com no máximo {max} cartas. Atual: {count}.': 'Sideboard can have at most {max} cards. Current: {count}.',
  '{card} está fora da identidade de cor do comandante.': "{card} is outside the commander's color identity.",
  'Este formato não usa comandante; a carta marcada como comandante será ignorada.':
    'This format does not use a commander; the card marked as commander will be ignored.',
  'Poucos terrenos ({lands}). Recomendado: ~{rec}.': 'Too few lands ({lands}). Recommended: ~{rec}.',
  'Muitos terrenos ({lands}).': 'Too many lands ({lands}).',
  'Novo deck': 'New deck',

  // formats.ts — COLOR_NAMES
  Branco: 'White',
  Azul: 'Blue',
  Preto: 'Black',
  Vermelho: 'Red',
  Verde: 'Green',
  Incolor: 'Colorless',

  // board.ts — ZONE_LABEL
  Comandantes: 'Commanders',
  Criaturas: 'Creatures',
  Artefatos: 'Artifacts',
  Encantamentos: 'Enchantments',
  'Outros (batalhas…)': 'Others (battles…)',
  Terrenos: 'Lands',

  // board.ts — MAT_LABEL
  'Campo de batalha': 'Battlefield',
  'Imposto do comandante': 'Commander tax',
  'Zona de comando': 'Command zone',
  Grimório: 'Library',
  Exílio: 'Exile',
  Vida: 'Life',
  Cemitério: 'Graveyard',

  // board.ts — MAT_PRESETS
  'Laterais à direita (padrão)': 'Side columns on the right (default)',
  'Laterais à esquerda': 'Side columns on the left',
  'Uma coluna de cada lado': 'One column on each side',
  'Terrenos em cima': 'Lands on top'
}

export default en
