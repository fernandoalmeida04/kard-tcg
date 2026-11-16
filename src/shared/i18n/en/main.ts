// Traduções para inglês (chave = texto em português). Grupo: main
const en: Record<string, string> = {
  // scryfall.ts
  'Scryfall respondeu {status} em {url}': 'Scryfall responded {status} at {url}',
  'Um download já está em andamento.': 'A download is already in progress.',
  'Consultando o Scryfall...': 'Querying Scryfall...',
  'Arquivo "default_cards" não encontrado no Scryfall.': '"default_cards" file not found on Scryfall.',
  'URL de download do Scryfall não encontrada.': 'Scryfall download URL not found.',
  'Falha ao baixar cartas ({status}).': 'Failed to download cards ({status}).',
  'Baixando cartas em inglês (dados de regras)... {mb} MB — {count} cartas': 'Downloading English cards (rules data)... {mb} MB — {count} cards',
  'Salvando banco de dados local...': 'Saving local database...',
  'Pronto! {cards} cartas e {printings} impressões salvas.': 'Done! {cards} cards and {printings} printings saved.',
  'Download cancelado.': 'Download cancelled.',
  'Erro: {message}': 'Error: {message}',
  'Buscando cartas no idioma "{lang}"...': 'Fetching cards in language "{lang}"...',
  'Baixando traduções ({lang}): {done} de {total}': 'Downloading translations ({lang}): {done} of {total}',

  // images.ts
  'Baixando imagens: {done} de {total}': 'Downloading images: {done} of {total}',
  '1 imagem nova salva no cache.': '1 new image saved to the cache.',
  '{n} imagens novas salvas no cache.': '{n} new images saved to the cache.',

  // playmat.ts
  'Escolher imagem do playmat': 'Choose playmat image',
  Imagens: 'Images',

  // judge.ts
  'Configure a chave da API da Anthropic em Configurações para usar o Juiz IA.': 'Set your Anthropic API key in Settings to use the AI Judge.',
  'Chave de API inválida. Verifique em Configurações.': 'Invalid API key. Check it in Settings.',
  'A chave de API não tem permissão para este modelo.': 'The API key does not have permission for this model.',
  'Limite de requisições atingido. Tente novamente em instantes.': 'Rate limit reached. Try again in a moment.',
  'Requisição recusada pela API: {message}': 'Request rejected by the API: {message}',
  'Sem conexão com a API da Anthropic.': 'No connection to the Anthropic API.',
  'Erro da API ({status}): {message}': 'API error ({status}): {message}',
  'O modelo recusou a solicitação.': 'The model refused the request.',
  'Resposta do Juiz IA em formato inesperado.': 'AI Judge response in an unexpected format.',
  'O modelo recusou a pergunta.': 'The model refused the question.',
  '(sem resposta)': '(no answer)',
  'Responda apenas com: Juiz IA conectado.': 'Reply only with: AI Judge connected.',
  'Conectado.': 'Connected.'
}

export default en
