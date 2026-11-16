// Janela de login e cadastro: e-mail + senha (com código de confirmação por e-mail) ou Google.
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Modal } from '../components/common'
import { useApp } from '../store'
import { EMAIL_RE, USERNAME_RE, passwordChecks, useAuth } from './authStore'

type Step = 'login' | 'signup' | 'code' | 'username'

export default function AuthModal() {
  const modal = useAuth((s) => s.modal)
  const close = useAuth((s) => s.close)
  const configured = useAuth((s) => s.configured)
  const setUser = useAuth((s) => s.setUser)
  const toast = useApp((s) => s.toast)
  const [step, setStep] = useState<Step>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nameFree, setNameFree] = useState<boolean | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (modal) {
      setStep(modal)
      setError('')
    }
  }, [modal])

  // disponibilidade do nome de usuário (com pequena espera enquanto digita)
  useEffect(() => {
    setNameFree(null)
    if ((step !== 'signup' && step !== 'username') || !USERNAME_RE.test(username)) return
    const timer = setTimeout(() => {
      window.kard.auth.usernameAvailable(username).then(setNameFree).catch(() => setNameFree(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [username, step])

  // contagem para reenviar o código
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (!modal) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finish = (name?: string | null) => {
    close()
    setPassword('')
    setPassword2('')
    setCode('')
    toast(name ? t('Bem-vindo, {name}!', { name }) : t('Você entrou na sua conta.'), 'success')
  }

  const checks = passwordChecks(password)
  const strong = checks.every((c) => c.ok)
  const signupOk = USERNAME_RE.test(username) && nameFree !== false && EMAIL_RE.test(email) && strong && password === password2

  const doLogin = () =>
    run(async () => {
      const r = await window.kard.auth.signIn(email.trim(), password)
      if (r.needsCode) {
        setStep('code')
        setCooldown(60)
        setError(r.error ?? '')
        return
      }
      if (!r.ok) throw new Error(r.error)
      setUser(r.user ?? null)
      if (r.user && !r.user.username) setStep('username')
      else finish(r.user?.username)
    })

  const doSignup = () =>
    run(async () => {
      const r = await window.kard.auth.signUp(username.trim(), email.trim(), password)
      if (!r.ok) throw new Error(r.error)
      setStep('code')
      setCooldown(60)
    })

  const doVerify = () =>
    run(async () => {
      const r = await window.kard.auth.verifyCode(email.trim(), code)
      if (!r.ok) throw new Error(r.error)
      setUser(r.user ?? null)
      if (r.user && !r.user.username) setStep('username')
      else finish(r.user?.username)
    })

  const doResend = () =>
    run(async () => {
      const r = await window.kard.auth.resendCode(email.trim())
      if (!r.ok) throw new Error(r.error)
      setCooldown(60)
      toast(t('Enviamos um novo código para {email}.', { email }), 'success')
    })

  const doGoogle = () =>
    run(async () => {
      const r = await window.kard.auth.signInWithGoogle()
      if (!r.ok) throw new Error(r.error)
      setUser(r.user ?? null)
      if (r.user && !r.user.username) setStep('username')
      else finish(r.user?.username)
    })

  const doUsername = () =>
    run(async () => {
      const r = await window.kard.auth.setUsername(username.trim())
      if (!r.ok) throw new Error(r.error)
      setUser(r.user ?? null)
      finish(r.user?.username)
    })

  const title = step === 'login' ? t('Entrar') : step === 'signup' ? t('Criar conta') : step === 'code' ? t('Confirme seu e-mail') : t('Escolha seu nome de usuário')

  const nameHint =
    username && !USERNAME_RE.test(username)
      ? { cls: 'err', text: t('Use de 3 a 20 letras, números ou _ (sem espaços).') }
      : nameFree === false
        ? { cls: 'err', text: t('Este nome de usuário já está em uso.') }
        : nameFree === true
          ? { cls: 'ok', text: t('Disponível!') }
          : null

  return (
    <Modal title={title} onClose={step === 'username' ? () => undefined : close} width={440}>
      {!configured ? (
        <div className="muted">{t('O login ainda não foi configurado neste computador. Siga o passo a passo do arquivo SUPABASE.md e reinicie o app.')}</div>
      ) : (
        <form
          className="col auth-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy) return
            if (step === 'login') void doLogin()
            else if (step === 'signup' && signupOk) void doSignup()
            else if (step === 'code' && code.trim().length >= 6) void doVerify()
            else if (step === 'username' && USERNAME_RE.test(username) && nameFree !== false) void doUsername()
          }}
        >
          {(step === 'login' || step === 'signup') && (
            <>
              <button type="button" className="btn auth-google" disabled={busy} onClick={doGoogle}>
                <span className="g-logo">G</span> {t('Entrar com Google')}
              </button>
              <div className="auth-sep">
                <span>{t('ou')}</span>
              </div>
            </>
          )}

          {step === 'signup' && (
            <label className="field">
              {t('Nome de usuário')}
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus maxLength={20} placeholder={t('ex.: mago_azul')} />
              {nameHint && <span className={`small auth-hint ${nameHint.cls}`}>{nameHint.text}</span>}
            </label>
          )}

          {(step === 'login' || step === 'signup') && (
            <label className="field">
              {t('E-mail')}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={step === 'login'} autoComplete="email" />
            </label>
          )}

          {(step === 'login' || step === 'signup') && (
            <label className="field">
              {t('Senha')}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={step === 'login' ? 'current-password' : 'new-password'} />
            </label>
          )}

          {step === 'signup' && (
            <>
              <ul className="auth-checks small">
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'ok' : ''}>
                    {c.ok ? '✓' : '○'} {t(c.label)}
                  </li>
                ))}
              </ul>
              <label className="field">
                {t('Repetir senha')}
                <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
                {password2 && password !== password2 && <span className="small auth-hint err">{t('As senhas não são iguais.')}</span>}
              </label>
            </>
          )}

          {step === 'code' && (
            <>
              <div className="small muted">{t('Enviamos um código de confirmação para {email}. Digite-o abaixo para ativar sua conta.', { email })}</div>
              <input
                className="auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                autoFocus
                placeholder="000000"
              />
              <div className="row small" style={{ gap: 8 }}>
                <button type="button" className="btn sm" disabled={busy || cooldown > 0} onClick={doResend}>
                  {cooldown > 0 ? t('Reenviar código ({n}s)', { n: cooldown }) : t('Reenviar código')}
                </button>
                <span className="muted">{t('Não chegou? Veja a caixa de spam.')}</span>
              </div>
            </>
          )}

          {step === 'username' && (
            <>
              <div className="small muted">{t('Falta só escolher como você vai aparecer para os outros jogadores.')}</div>
              <label className="field">
                {t('Nome de usuário')}
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus maxLength={20} />
                {nameHint && <span className={`small auth-hint ${nameHint.cls}`}>{nameHint.text}</span>}
              </label>
            </>
          )}

          {error && <div className="auth-error small">{error}</div>}

          <button
            type="submit"
            className="btn primary"
            disabled={
              busy ||
              (step === 'login' && (!EMAIL_RE.test(email) || !password)) ||
              (step === 'signup' && !signupOk) ||
              (step === 'code' && code.trim().length < 6) ||
              (step === 'username' && (!USERNAME_RE.test(username) || nameFree === false))
            }
          >
            {busy ? t('Aguarde...') : step === 'login' ? t('Entrar') : step === 'signup' ? t('Criar conta') : step === 'code' ? t('Confirmar') : t('Salvar')}
          </button>

          {step === 'login' && (
            <div className="small muted auth-switch">
              {t('Não tem conta?')}{' '}
              <a onClick={() => (setStep('signup'), setError(''))}>{t('Cadastre-se')}</a>
            </div>
          )}
          {step === 'signup' && (
            <div className="small muted auth-switch">
              {t('Já tem conta?')}{' '}
              <a onClick={() => (setStep('login'), setError(''))}>{t('Entrar')}</a>
            </div>
          )}
          {step === 'code' && (
            <div className="small muted auth-switch">
              <a onClick={() => (setStep('signup'), setError(''))}>{t('← Voltar')}</a>
            </div>
          )}
        </form>
      )}
    </Modal>
  )
}
