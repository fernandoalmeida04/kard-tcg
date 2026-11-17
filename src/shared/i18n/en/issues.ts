// Relatório de problemas do motor, verificação de deck, poder/resistência manual.
const en: Record<string, string> = {
  // motor
  'O poder/resistência de {name} depende de uma regra que o motor ainda não entende. Defina os valores com o botão direito → Definir poder/resistência.':
    "{name}'s power/toughness depends on a rule the engine doesn't understand yet. Set the values with right-click → Set power/toughness.",
  'Ajuste manual: poder/resistência base de {name} definidos como {p}/{t}.': 'Manual adjustment: base power/toughness of {name} set to {p}/{t}.',
  'Valores inválidos.': 'Invalid values.',
  'Erro interno do motor ao processar a jogada; ela foi desfeita. O problema foi registrado no relatório do motor.':
    'Internal engine error while processing the play; it was undone. The problem was saved to the engine report.',
  'Salvar relatório do motor': 'Save engine report',
  // tipos de problema
  'Erro interno do motor': 'Internal engine error',
  'Poder/resistência desconhecidos': 'Unknown power/toughness',
  'Juiz IA falhou': 'AI Judge failed',
  'Ajuste manual': 'Manual adjustment',
  'Relato do jogador': 'Player report',
  'Jogada do bot recusada': 'Bot play rejected',
  'Texto não automatizado': 'Text not automated',
  'Precisou do Juiz IA': 'Needed the AI Judge',
  // mesa
  'Definir poder/resistência…': 'Set power/toughness…',
  'Relatar problema': 'Report problem',
  'Algo saiu errado? Registre para corrigir o motor depois.': 'Something went wrong? Save it so the engine can be fixed later.',
  'Poder/resistência base de {name}': 'Base power/toughness of {name}',
  'Valor base da carta (o que o texto dela define). Marcadores, auras e efeitos continuam somando por cima.':
    "The card's base value (what its text defines). Counters, auras and effects still add on top.",
  Definir: 'Set',
  'Relatar problema do motor': 'Report engine problem',
  'Descreva o que aconteceu de errado. As últimas jogadas da partida são guardadas junto, e tudo fica em Configurações → Problemas do motor.':
    'Describe what went wrong. The latest plays of the game are saved with it, and everything goes to Settings → Engine problems.',
  '(nenhuma carta específica)': '(no specific card)',
  'Ex.: a criatura morreu mesmo eu tendo devoção suficiente': 'E.g.: the creature died even though I had enough devotion',
  Registrar: 'Save',
  'Problema registrado no relatório do motor. Obrigado!': 'Problem saved to the engine report. Thanks!',
  // configurações
  'Problemas do motor': 'Engine problems',
  'Durante as partidas, o motor anota o que não conseguiu automatizar: textos de carta que ele não entende, efeitos que precisaram do Juiz IA, ajustes manuais, erros internos e os problemas que você relatar. Copie ou salve o relatório para corrigir o motor depois. Quando uma versão nova passa a entender uma carta, ela aparece como corrigida.':
    "During games the engine notes what it couldn't automate: card text it doesn't understand, effects that needed the AI Judge, manual adjustments, internal errors and problems you report. Copy or save the report to fix the engine later. When a new version understands a card, it shows as fixed.",
  'O app precisa ser reiniciado para usar o relatório do motor (feche e abra o Kard de novo).': 'The app must be restarted to use the engine report (close and reopen Kard).',
  'Relatório copiado. Cole na conversa com quem vai corrigir o motor.': 'Report copied. Paste it in the conversation with whoever will fix the engine.',
  'Relatório salvo em {path}': 'Report saved to {path}',
  'Apagar todo o relatório do motor?': 'Delete the whole engine report?',
  '{n} pendente(s)': '{n} pending',
  '{n} já corrigido(s) nesta versão': '{n} already fixed in this version',
  Atualizar: 'Refresh',
  'Copiar relatório': 'Copy report',
  'Salvar .md…': 'Save .md…',
  'Remover corrigidos': 'Remove fixed',
  'Limpar tudo': 'Clear all',
  'Nenhum problema registrado ainda. Eles aparecem aqui depois das partidas.': 'No problems recorded yet. They show up here after games.',
  '(sem carta)': '(no card)',
  corrigido: 'fixed',
  'Contexto (turno {n}):': 'Context (turn {n}):',
  'Primeira vez: {a} · última: {b} · versão {v}': 'First seen: {a} · last: {b} · version {v}',
  // verificação do deck
  '(mágica sem efeito reconhecido)': '(spell with no recognized effect)',
  '(efeito sem texto reconhecido)': '(effect with no recognized text)',
  'poder/resistência "*" (defina à mão na partida)': 'power/toughness "*" (set it by hand during the game)',
  'Motor: 100% automatizado': 'Engine: 100% automated',
  'Motor: {n} carta(s) ({c} cópias) com partes não automatizadas': 'Engine: {n} card(s) ({c} copies) with non-automated parts',
  'Nessas partes o Juiz IA (se ligado) ou um ajuste manual resolve. Tudo que acontecer fica registrado em Configurações → Problemas do motor.':
    'For those parts the AI Judge (if enabled) or a manual adjustment handles it. Everything that happens is saved in Settings → Engine problems.',
  'Aguardando a mão inicial de {names}...': 'Waiting for the opening hand of {names}...',
  // relatório da comunidade (Supabase)
  'Este computador': 'This computer',
  'Todos os jogadores': 'All players',
  'Não foi possível ler o relatório do Supabase: {error}': 'Could not read the Supabase report: {error}',
  'Apagar o relatório de TODOS os jogadores no Supabase?': 'Delete the report of ALL players on Supabase?',
  'Jogadores diferentes que viram o problema': 'Different players who saw the problem',
  'Enviar os problemas para o desenvolvedor (com sua conta logada; os nomes dos jogadores são trocados por "Jogador 1", "Jogador 2"...)':
    'Send problems to the developer (while signed in; player names are replaced with "Player 1", "Player 2"...)'
}

export default en
