import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, GraduationCap, ShieldCheck } from 'lucide-react'
import type { AuthSession } from '../App'
import { ApiError, apiRequest, publicAssetUrl } from '../lib/api'
import { LanguageToggle, useLocale } from '../lib/i18n'

type Props = {
  onAuthenticated: (session: AuthSession) => void
  onParentAuthenticated: (token: string) => void
  notice?: string
}

type AuthResponse = AuthSession
type WorkspaceBranding = {
  name: string
  slug: string
  settings: { kindergartenName: string; logoUrl: string | null } | null
}

export function AuthPage({ onAuthenticated, onParentAuthenticated, notice }: Props) {
  const [mode, setMode] = useState<'login' | 'register' | 'parent'>('login')
  const [tenantSlug, setTenantSlug] = useState('')
  const [kindergartenName, setKindergartenName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [workspaceBranding, setWorkspaceBranding] = useState<WorkspaceBranding | null>(null)
  const [workspaceBrandError, setWorkspaceBrandError] = useState('')
  const { t } = useLocale()

  useEffect(() => {
    if (mode !== 'login' || tenantSlug.trim().length < 2) return

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      apiRequest<{ tenant: WorkspaceBranding }>(
        `/auth/workspace?slug=${encodeURIComponent(tenantSlug.trim())}`,
        undefined,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setWorkspaceBranding(result.tenant)
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return
          if (requestError instanceof ApiError && requestError.status === 404) return
          setWorkspaceBrandError(t('Could not load workspace branding'))
        })
    }, 350)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [mode, tenantSlug, t])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (mode === 'parent') {
        const result = await apiRequest<{ token: string }>('/parent/login', undefined, {
          method: 'POST',
          body: JSON.stringify({ email, password, accessCode }),
        })
        onParentAuthenticated(result.token)
        return
      }
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const payload = mode === 'login' ? { tenantSlug, email, password } : { kindergartenName, fullName, email, password }
      const result = await apiRequest<AuthResponse>(path, undefined, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      onAuthenticated(result)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in')
    } finally {
      setSubmitting(false)
    }
  }

  function changeMode(nextMode: 'login' | 'register' | 'parent') {
    setMode(nextMode)
    setError('')
    setWorkspaceBranding(null)
    setWorkspaceBrandError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-lockup">
          {workspaceBranding?.settings?.logoUrl ? (
            <img
              className="auth-brand-logo"
              src={publicAssetUrl(workspaceBranding.settings.logoUrl)}
              alt={`${workspaceBranding.settings.kindergartenName || workspaceBranding.name} ${t('logo')}`}
            />
          ) : (
            <div className="auth-brand-icon"><GraduationCap size={24} /></div>
          )}
          <span>{workspaceBranding?.settings?.kindergartenName || workspaceBranding?.name || 'Kindergarten OS'}</span>
        </div>
        {workspaceBrandError && <p className="auth-brand-message" role="status">{t(workspaceBrandError)}</p>}
        <div className="auth-brand-copy">
          <div className="auth-overline">{t('A calmer way to run your school')}</div>
          <h1>{t('More time for what matters most.')}</h1>
          <p>{t('Bring your classrooms, families, and daily operations together in one secure workspace.')}</p>
        </div>
        <div className="auth-assurance">
          <ShieldCheck size={18} />
          {t('Your kindergarten workspace is private to your organization.')}
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-overline">{t(mode === 'parent' ? 'Parent Portal' : mode === 'login' ? 'Welcome back' : 'Get started')}</div>
          <h2>{t(mode === 'parent' ? 'Sign in to parent portal' : mode === 'login' ? 'Sign in to your workspace' : 'Create your kindergarten workspace')}</h2>
          <p className="auth-intro">
            {t(mode === 'parent'
              ? 'Enter your parent email, password, and student access code.'
              : mode === 'login'
              ? 'Enter your workspace and account details to continue.'
              : 'Your account starts with a private workspace and administrator login.')}
          </p>
          {notice && <div className="auth-error" role="status">{notice}</div>}

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => changeMode('login')}>{t('Sign in')}</button>
            <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => changeMode('register')}>{t('Create workspace')}</button>
            <button type="button" className={mode === 'parent' ? 'selected' : ''} onClick={() => changeMode('parent')}>{t('Parent Portal')}</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'parent' ? (
              <>
                <label>
                  {t('Email address')}
                  <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@kindergarten.com" />
                </label>
                <label>
                  {t('Password')}
                  <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('Your password')} />
                </label>
                <label>
                  {t('Student access code')}
                  <input required minLength={8} maxLength={40} autoCapitalize="characters" autoComplete="one-time-code" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="e.g. KG-2026-001" />
                </label>
              </>
            ) : mode === 'register' ? (
              <>
                <label>
                  {t('Kindergarten name')}
                  <input required minLength={2} maxLength={120} value={kindergartenName} onChange={(event) => setKindergartenName(event.target.value)} placeholder="e.g. Little Acorns" />
                </label>
                <label>
                  {t('Your name')}
                  <input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" />
                </label>
              </>
            ) : (
              <label>
                {t('Workspace slug')}
                <input required minLength={2} value={tenantSlug} onChange={(event) => {
                setTenantSlug(event.target.value)
                setWorkspaceBranding(null)
                setWorkspaceBrandError('')
                }} placeholder="e.g. little-acorns-abc123" autoCapitalize="none" />
              </label>
            )}
            {mode !== 'parent' && <>
              <label>
                {t('Email address')}
                <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@kindergarten.com" />
              </label>
              <label>
                {t('Password')}
                <input required type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : 1} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} />
              </label>
            </>}

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {t(submitting ? 'Please wait…' : mode === 'parent' ? 'Sign in to parent portal' : mode === 'login' ? 'Sign in securely' : 'Create workspace')}
              <ArrowRight size={17} />
            </button>
          </form>

          <p className="auth-footnote">
            {t(mode === 'register'
              ? 'Registration creates the first administrator for a new kindergarten.'
              : mode === 'parent'
                ? 'Your parent account and access code must both be linked to the child.'
                : 'Your session is securely scoped to the selected kindergarten.')}
          </p>
        </div>
      </section>
      <div className="workspace-auth-language"><LanguageToggle /></div>
    </main>
  )
}
