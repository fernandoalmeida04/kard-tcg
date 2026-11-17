// Edge Function "ai": repassa pedidos do app (Juiz IA e bot) para um provedor de IA compatível com a
// API da OpenAI (padrão: Groq, modelo gratuito openai/gpt-oss-120b). A chave fica SÓ aqui no
// servidor — nunca dentro do app instalado.
//
// Segredos (Supabase → Edge Functions → Secrets, ou `supabase secrets set`):
//   AI_API_KEY      chave do provedor (ex.: a do console.groq.com)            [obrigatório]
//   AI_BASE_URL     padrão https://api.groq.com/openai/v1
//   AI_MODEL        padrão openai/gpt-oss-120b
//   AI_DAILY_LIMIT  pedidos por jogador por dia (padrão 80; o painel administrativo do app pode trocar)
// O Supabase fornece SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY automaticamente.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })

  const apiKey = Deno.env.get('AI_API_KEY')
  if (!apiKey) return reply(500, { error: 'AI_API_KEY não configurada na Edge Function.' })
  const baseUrl = (Deno.env.get('AI_BASE_URL') ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '')
  const model = Deno.env.get('AI_MODEL') ?? 'openai/gpt-oss-120b'
  let dailyLimit = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '1000')

  // quem está pedindo (o gateway do Supabase já validou o JWT; aqui pegamos o id da conta)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: userData } = await admin.auth.getUser(token)
  const user = userData?.user
  if (!user) return reply(401, { error: 'Entre na sua conta para usar a IA.' })

  // conta suspensa pelo painel administrativo
  const { data: banned } = await admin.rpc('is_banned', { uid: user.id })
  if (banned === true) return reply(403, { error: 'Sua conta está suspensa.' })

  // limite diário por jogador (protege a cota gratuita do provedor); o painel pode trocar o padrão
  const { data: cfg } = await admin.from('app_config').select('value').eq('key', 'ai_daily_limit').maybeSingle()
  if (typeof cfg?.value === 'number') dailyLimit = cfg.value
  const { data: count, error: usageError } = await admin.rpc('ai_usage_hit', { uid: user.id })
  if (!usageError && typeof count === 'number' && count > dailyLimit) {
    return reply(429, { error: `Limite diário de ${dailyLimit} consultas à IA atingido. Tente amanhã.` })
  }

  let body: { system?: string; user?: string; json?: boolean; maxTokens?: number }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'JSON inválido.' })
  }
  const system = String(body.system ?? '').slice(0, 12000)
  const prompt = String(body.user ?? '').slice(0, 60000)
  if (!prompt) return reply(400, { error: 'Pedido vazio.' })

  // Modelos que "pensam" antes de responder (gpt-oss) gastam tokens no raciocínio: limite folgado
  // e raciocínio "low" para a resposta não ser cortada no meio do JSON.
  const reasoning = /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {}
  const maxTokens = Math.min(8000, Math.max(2000, Number(body.maxTokens) || 2000))
  const call = (jsonMode: boolean) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        ...reasoning,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      })
    })

  let res = await call(Boolean(body.json))
  let data = await res.json().catch(() => null)
  // O modo JSON do provedor às vezes recusa a resposta ("Failed to generate JSON"). O app já extrai o
  // JSON de um texto comum, então: usa o texto que o modelo gerou ou tenta de novo sem o modo JSON.
  if (!res.ok && body.json && /json|failed_generation/i.test(data?.error?.message ?? '')) {
    const partial = data?.error?.failed_generation
    if (typeof partial === 'string' && partial.includes('{')) return reply(200, { text: partial, model })
    res = await call(false)
    data = await res.json().catch(() => null)
  }
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`
    return reply(res.status === 429 ? 429 : 502, { error: res.status === 429 ? 'O provedor de IA está no limite de uso agora. Tente em alguns instantes.' : `Erro do provedor de IA: ${msg}` })
  }
  const text = data?.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) return reply(502, { error: 'A IA não devolveu resposta (limite de tokens?). Tente de novo.' })
  return reply(200, { text, model })
})
