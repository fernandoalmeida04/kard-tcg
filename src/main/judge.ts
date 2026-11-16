import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { getApiKey, getSettings } from './settings'
import type { JudgeAnswer, JudgeEffectRequest, JudgeEffectResponse, JudgeQuestionRequest } from '../shared/types'
import { getUiLang, t } from '../shared/i18n/index.ts'

/**
 * Juiz IA baseado no Claude. O motor de regras local valida todas as jogadas;
 * o Claude entra para interpretar textos de cartas que o motor não reconhece
 * e para responder dúvidas de regras durante a partida.
 */

const OP_KINDS = [
  'damage', 'destroy', 'exile', 'bounce', 'draw', 'discard', 'gain_life', 'lose_life', 'pump', 'add_counters',
  'create_token', 'tap', 'untap', 'mill', 'sacrifice', 'graveyard_to_hand', 'graveyard_to_battlefield', 'add_mana', 'none'
] as const

const OperationSchema = z.object({
  op: z.enum(OP_KINDS),
  target_object_ids: z.array(z.string()),
  target_players: z.array(z.enum(['controller', 'opponent'])),
  amount: z.number().int(),
  power: z.number().int(),
  toughness: z.number().int(),
  token_name: z.string(),
  token_types: z.string(),
  colors: z.array(z.string()),
  keywords: z.array(z.string()),
  mana: z.string()
})

const EffectSchema = z.object({
  explanation: z.string(),
  operations: z.array(OperationSchema)
})

const EFFECT_SYSTEM = `Você é o juiz de regras de um simulador de Magic: The Gathering (1 contra 1).
O motor do jogo já validou custos, alvos e o momento da jogada. Sua tarefa é traduzir o texto de efeito
de uma mágica ou habilidade que está resolvendo em uma lista de operações estruturadas que o motor executa.

Regras:
- Resolva SOMENTE o texto de efeito informado, seguindo as Comprehensive Rules do Magic.
- Use apenas ids de objetos que aparecem no estado do jogo ou nos alvos escolhidos. Nunca invente ids.
- "controller" é quem controla a mágica/habilidade; "opponent" é o outro jogador.
- Para operações sobre jogadores, preencha target_players; para objetos, target_object_ids.
- pump: power/toughness são os modificadores até o fim do turno (ex.: +2/+0 => power 2, toughness 0); keywords concedidas vão em keywords.
- add_counters: amount = quantidade de marcadores +1/+1 (negativo para -1/-1).
- create_token: amount = número de fichas; preencha token_name, token_types (ex.: "Creature — Soldier"), power, toughness, colors (W,U,B,R,G) e keywords.
- add_mana: mana no formato de símbolos, ex.: "{R}{R}".
- Se o efeito exigir uma escolha do controlador, escolha a opção mais razoável para ele e explique.
- Campos que não se aplicam: use 0, "" ou [].
- Se nada puder ser feito (ex.: alvo ilegal), retorne uma única operação "none" e explique.
- explanation: uma frase curta explicando o que aconteceu, no idioma indicado abaixo.`

const QUESTION_SYSTEM = `Você é um juiz certificado de Magic: The Gathering ajudando jogadores dentro do simulador Kard.
Responda de forma objetiva, citando a regra relevante das Comprehensive Rules quando útil.
Use o estado da partida e o histórico recente fornecidos para dar respostas específicas à situação.`

/** Instrução de idioma: o texto mostrado ao usuário vem no idioma da interface. */
function languageInstruction(): string {
  return getUiLang() === 'en'
    ? 'IMPORTANT: Write all user-facing text (answers, explanations and any log text you return) in English, using the official English Magic: The Gathering terminology and card names.'
    : 'IMPORTANTE: Escreva todo o texto destinado ao usuário (respostas, explicações e qualquer texto de log que você retornar) em português do Brasil.'
}

function client(): Anthropic {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error(t('Configure a chave da API da Anthropic em Configurações para usar o Juiz IA.'))
  return new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 })
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return t('Chave de API inválida. Verifique em Configurações.')
  if (err instanceof Anthropic.PermissionDeniedError) return t('A chave de API não tem permissão para este modelo.')
  if (err instanceof Anthropic.RateLimitError) return t('Limite de requisições atingido. Tente novamente em instantes.')
  if (err instanceof Anthropic.BadRequestError) return t('Requisição recusada pela API: {message}', { message: err.message })
  if (err instanceof Anthropic.APIConnectionError) return t('Sem conexão com a API da Anthropic.')
  if (err instanceof Anthropic.APIError) return t('Erro da API ({status}): {message}', { status: String(err.status), message: err.message })
  return (err as Error)?.message ?? String(err)
}

export async function resolveEffect(req: JudgeEffectRequest): Promise<JudgeEffectResponse> {
  try {
    const settings = getSettings()
    const msg = await client().beta.messages.parse({
      model: settings.aiModel,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(EffectSchema) },
      system: `${EFFECT_SYSTEM}

${languageInstruction()}`,
      messages: [
        {
          role: 'user',
          content: [
            `Carta: ${req.cardName}`,
            `Texto completo da carta:\n${req.cardText}`,
            `Efeito a resolver agora:\n${req.effectText}`,
            `Controlador: ${req.controller === 'human' ? 'jogador humano' : 'bot'}`,
            `Alvos escolhidos: ${req.chosenTargets || 'nenhum'}`,
            `Estado do jogo:\n${req.stateSummary}`
          ].join('\n\n')
        }
      ]
    })
    if (msg.stop_reason === 'refusal') {
      return { ok: false, error: t('O modelo recusou a solicitação.'), explanation: '', operations: [] }
    }
    const parsed = msg.parsed_output
    if (!parsed) return { ok: false, error: t('Resposta do Juiz IA em formato inesperado.'), explanation: '', operations: [] }
    return { ok: true, explanation: parsed.explanation, operations: parsed.operations }
  } catch (err) {
    return { ok: false, error: friendlyError(err), explanation: '', operations: [] }
  }
}

export async function askJudge(req: JudgeQuestionRequest): Promise<JudgeAnswer> {
  try {
    const settings = getSettings()
    const msg = await client().beta.messages.create({
      model: settings.aiModel,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: `${QUESTION_SYSTEM}

${languageInstruction()}`,
      messages: [
        {
          role: 'user',
          content: `Estado atual da partida:\n${req.stateSummary}\n\nHistórico recente:\n${req.recentLog}\n\nPergunta do jogador: ${req.question}`
        }
      ]
    })
    if (msg.stop_reason === 'refusal') return { ok: false, error: t('O modelo recusou a pergunta.'), answer: '' }
    const answer = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    return { ok: true, answer: answer || t('(sem resposta)') }
  } catch (err) {
    return { ok: false, error: friendlyError(err), answer: '' }
  }
}

export async function testJudge(): Promise<JudgeAnswer> {
  try {
    const settings = getSettings()
    const msg = await client().messages.create({
      model: settings.aiModel,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: t('Responda apenas com: Juiz IA conectado.') }]
    })
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
    return { ok: true, answer: text || t('Conectado.') }
  } catch (err) {
    return { ok: false, error: friendlyError(err), answer: '' }
  }
}
