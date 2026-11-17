// IA do app (Juiz e bot). Em produção os pedidos vão para a Edge Function "ai" do Supabase, que
// guarda a chave do provedor no servidor. Só em desenvolvimento dá para chamar o provedor direto
// com MAIN_VITE_AI_API_KEY no .env (NUNCA gere um instalador com essa variável: a chave iria junto).
import { t } from '../shared/i18n/index.ts'
import { authConfigured, currentUser, supabaseClient } from './auth'

export interface AiRequest {
  system: string
  user: string
  json?: boolean
  maxTokens?: number
}

export interface AiResponse {
  ok: boolean
  text?: string
  error?: string
}

const DEV_KEY = import.meta.env.MAIN_VITE_AI_API_KEY?.trim()
const DEV_URL = (import.meta.env.MAIN_VITE_AI_BASE_URL?.trim() || 'https://api.groq.com/openai/v1').replace(/\/$/, '')
const DEV_MODEL = import.meta.env.MAIN_VITE_AI_MODEL?.trim() || 'openai/gpt-oss-120b'

async function direct(req: AiRequest): Promise<AiResponse> {
  // mesma lógica da Edge Function: limite folgado, raciocínio "low" no gpt-oss e nova tentativa
  // sem o modo JSON quando o provedor recusa ("Failed to generate JSON")
  const reasoning = /gpt-oss/i.test(DEV_MODEL) ? { reasoning_effort: 'low' } : {}
  const call = async (jsonMode: boolean) => {
    const res = await fetch(`${DEV_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEV_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEV_MODEL,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ],
        temperature: 0.2,
        max_tokens: Math.min(8000, Math.max(2000, req.maxTokens ?? 2000)),
        ...reasoning,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      })
    })
    const data = (await res.json().catch(() => null)) as { error?: { message?: string; failed_generation?: string }; choices?: { message?: { content?: string } }[] } | null
    return { res, data }
  }
  let { res, data } = await call(Boolean(req.json))
  if (!res.ok && req.json && /json|failed_generation/i.test(data?.error?.message ?? '')) {
    const partial = data?.error?.failed_generation
    if (typeof partial === 'string' && partial.includes('{')) return { ok: true, text: partial }
    ;({ res, data } = await call(false))
  }
  if (!res.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` }
  const text = data?.choices?.[0]?.message?.content ?? ''
  return text.trim() ? { ok: true, text } : { ok: false, error: t('A IA não devolveu resposta. Tente de novo.') }
}

export async function aiComplete(req: AiRequest): Promise<AiResponse> {
  try {
    if (DEV_KEY) return await direct(req)
    if (!authConfigured()) return { ok: false, error: t('A IA usa o servidor do Kard: configure o Supabase (SUPABASE.md).') }
    if (!(await currentUser())) return { ok: false, error: t('Entre na sua conta para usar o Juiz IA e o bot.') }
    const { data, error } = await supabaseClient().functions.invoke('ai', { body: req })
    if (error) {
      // a função devolve { error } no corpo; o supabase-js põe a resposta em error.context
      let msg = error.message
      try {
        const body = (await (error as { context?: Response }).context?.json()) as { error?: string } | undefined
        if (body?.error) msg = body.error
      } catch {
        /* corpo não é JSON */
      }
      if (/not found|404/i.test(msg)) msg = t('A Edge Function "ai" ainda não foi publicada no Supabase (veja SUPABASE.md).')
      return { ok: false, error: msg }
    }
    return { ok: true, text: (data as { text?: string })?.text ?? '' }
  } catch (err) {
    const msg = (err as Error).message
    return { ok: false, error: /fetch failed|network|ENOTFOUND/i.test(msg) ? t('Sem conexão com a internet.') : msg }
  }
}
