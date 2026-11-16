// Contas de usuário com Supabase (e-mail + senha com código de confirmação, ou Google).
// Só os dados da conta ficam no Supabase; decks e cartas continuam no computador.
import { app, safeStorage, shell } from 'electron'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { createClient, type AuthError, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { AuthResult, AuthUser } from '../shared/types'
import { t } from '../shared/i18n/index.ts'

const SUPABASE_URL = import.meta.env.MAIN_VITE_SUPABASE_URL?.trim()
// chave pública do projeto: "anon" (nome antigo) ou "publishable" (nome novo do Supabase)
const SUPABASE_KEY = (import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY ?? import.meta.env.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY)?.trim()

/** Porta local que recebe o retorno do login com Google (precisa estar nas Redirect URLs do Supabase). */
export const OAUTH_PORT = 53682
const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/auth/callback`

export function authConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY)
}

// ---------------- Sessão guardada no computador (criptografada pelo Windows) ----------------

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.bin')
}

function readStore(): Record<string, string> {
  try {
    const raw = fs.readFileSync(sessionFile())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(json)
  } catch {
    return {}
  }
}

function writeStore(data: Record<string, string>): void {
  const json = JSON.stringify(data)
  fs.writeFileSync(sessionFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'))
}

const storage = {
  getItem: (key: string) => readStore()[key] ?? null,
  setItem: (key: string, value: string) => writeStore({ ...readStore(), [key]: value }),
  removeItem: (key: string) => {
    const s = readStore()
    delete s[key]
    writeStore(s)
  }
}

let client: SupabaseClient | null = null

function sb(): SupabaseClient {
  if (!authConfigured()) throw new Error(t('O login ainda não foi configurado neste computador (veja SUPABASE.md).'))
  if (!client) {
    client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
    })
    client.auth.onAuthStateChange(() => {
      void currentUser().then((u) => listeners.forEach((cb) => cb(u)))
    })
  }
  return client
}

/** Cliente do Supabase já autenticado (usado pelas mesas online). */
export function supabaseClient(): SupabaseClient {
  return sb()
}

const listeners = new Set<(u: AuthUser | null) => void>()

/** Avisa a interface quando a conta muda (login, saída, nome de usuário). */
export function onAuthChange(cb: (u: AuthUser | null) => void): void {
  listeners.add(cb)
}

// ---------------- Mensagens de erro em português ----------------

function message(err: AuthError | Error | { message?: string; code?: string } | null | undefined): string {
  const code = (err as AuthError | undefined)?.code ?? ''
  const msg = err?.message ?? ''
  const map: Record<string, string> = {
    invalid_credentials: t('E-mail ou senha incorretos.'),
    email_not_confirmed: t('Este e-mail ainda não foi confirmado. Digite o código que enviamos.'),
    user_already_exists: t('Já existe uma conta com este e-mail.'),
    email_exists: t('Já existe uma conta com este e-mail.'),
    weak_password: t('A senha é fraca demais. Use letras maiúsculas, minúsculas, números e símbolos.'),
    over_email_send_rate_limit: t('Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.'),
    over_request_rate_limit: t('Muitas tentativas. Aguarde alguns minutos e tente de novo.'),
    otp_expired: t('Código inválido ou expirado. Peça um novo código.'),
    email_address_invalid: t('Este endereço de e-mail não é válido.'),
    signup_disabled: t('Novos cadastros estão desativados no momento.'),
    validation_failed: t('Dados inválidos. Confira os campos.')
  }
  if (map[code]) return map[code]
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return t('Sem conexão com o servidor de contas. Verifique sua internet.')
  return msg || t('Algo deu errado. Tente de novo.')
}

const fail = (err: unknown): AuthResult => ({ ok: false, error: message(err as Error) })

// ---------------- Usuário atual ----------------

async function toAuthUser(u: User | null | undefined): Promise<AuthUser | null> {
  if (!u) return null
  const { data } = await sb().from('profiles').select('username').eq('id', u.id).maybeSingle()
  return {
    id: u.id,
    email: u.email ?? '',
    username: (data?.username as string | null) ?? null,
    provider: (u.app_metadata?.provider as string | undefined) ?? 'email'
  }
}

export async function currentUser(): Promise<AuthUser | null> {
  if (!authConfigured()) return null
  try {
    const { data } = await sb().auth.getSession()
    return await toAuthUser(data.session?.user)
  } catch {
    return null
  }
}

// ---------------- Ações ----------------

export async function usernameAvailable(name: string): Promise<boolean> {
  const { data, error } = await sb().rpc('username_available', { name })
  if (error) throw new Error(message(error))
  return Boolean(data)
}

/** Cadastro: o Supabase envia um e-mail com o código de confirmação; a conta só vale depois do código. */
export async function signUp(username: string, email: string, password: string): Promise<AuthResult> {
  try {
    if (!(await usernameAvailable(username))) return { ok: false, error: t('Este nome de usuário já está em uso.') }
    const { data, error } = await sb().auth.signUp({ email, password, options: { data: { username } } })
    if (error) return fail(error)
    // e-mail já cadastrado e confirmado: o Supabase devolve um usuário sem identidades (não revela a conta)
    if (data.user && data.user.identities?.length === 0) return { ok: false, error: t('Já existe uma conta com este e-mail.') }
    return { ok: true, needsCode: !data.session }
  } catch (err) {
    return fail(err)
  }
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  try {
    const { error } = await sb().auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    if (error) return fail(error)
    return { ok: true, user: await currentUser() }
  } catch (err) {
    return fail(err)
  }
}

export async function resendCode(email: string): Promise<AuthResult> {
  try {
    const { error } = await sb().auth.resend({ type: 'signup', email })
    return error ? fail(error) : { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { error } = await sb().auth.signInWithPassword({ email, password })
    if (error) {
      // conta criada mas e-mail não confirmado: reenvia o código e leva para a tela do código
      if (error.code === 'email_not_confirmed') {
        await sb().auth.resend({ type: 'signup', email })
        return { ok: false, needsCode: true, error: message(error) }
      }
      return fail(error)
    }
    return { ok: true, user: await currentUser() }
  } catch (err) {
    return fail(err)
  }
}

/** Login com Google: abre o navegador e espera o retorno no endereço local. */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const { data, error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true } })
    if (error || !data.url) return fail(error)
    const code = await waitForOAuthCode(data.url)
    const ex = await sb().auth.exchangeCodeForSession(code)
    if (ex.error) return fail(ex.error)
    return { ok: true, user: await currentUser() }
  } catch (err) {
    return fail(err)
  }

  function waitForOAuthCode(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const page = (title: string, body: string) =>
        `<!doctype html><meta charset="utf-8"><title>Kard</title><body style="font-family:Segoe UI,sans-serif;background:#080808;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#9a9a9a">${body}</p></div>`
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', OAUTH_REDIRECT)
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404).end()
          return
        }
        const code = url.searchParams.get('code')
        const err = url.searchParams.get('error_description') ?? url.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(code ? page(t('Login concluído!'), t('Pode fechar esta aba e voltar ao Kard.')) : page(t('Não foi possível entrar'), err ?? ''))
        clearTimeout(timer)
        server.close()
        if (code) resolve(code)
        else reject(new Error(err ?? t('Login com Google cancelado.')))
      })
      const timer = setTimeout(() => {
        server.close()
        reject(new Error(t('Tempo esgotado esperando o login com Google.')))
      }, 5 * 60 * 1000)
      server.on('error', (e) => reject(e))
      server.listen(OAUTH_PORT, '127.0.0.1', () => void shell.openExternal(authUrl))
    })
  }
}

/** Define o nome de usuário (contas criadas pelo Google começam sem nome). */
export async function setUsername(username: string): Promise<AuthResult> {
  try {
    const u = (await sb().auth.getUser()).data.user
    if (!u) return { ok: false, error: t('Você não está conectado.') }
    if (!(await usernameAvailable(username))) return { ok: false, error: t('Este nome de usuário já está em uso.') }
    const { error } = await sb().from('profiles').upsert({ id: u.id, username })
    if (error) return fail(error)
    const user = await currentUser()
    listeners.forEach((cb) => cb(user))
    return { ok: true, user }
  } catch (err) {
    return fail(err)
  }
}

export async function signOut(): Promise<void> {
  if (!authConfigured()) return
  await sb().auth.signOut({ scope: 'local' })
}
