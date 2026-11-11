import { useEffect, useState } from 'react'
import { AuthPage } from './components/AuthPage'
import { DashboardLayout } from './components/DashboardLayout'
import { ParentPortalPage } from './components/ParentPortalPage'
import { TeacherDashboard } from './components/TeacherDashboard'
import { ApiError, apiRequest } from './lib/api'
import { useLocale } from './lib/i18n'

export type AuthUser = {
  id: string
  tenantId: string
  fullName: string
  email: string
  role: 'ADMIN' | 'TEACHER' | 'PARENT'
}

export type TenantInfo = {
  id: string
  name: string
  slug: string
  settings?: {
    kindergartenName: string
    logoUrl: string | null
    primaryColor: string
    secondaryColor: string
    currency: string
    language: string
    isRtl: boolean
  } | null
}

export type AuthSession = {
  token: string
  user: AuthUser
  tenant: TenantInfo
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [storedToken] = useState(() => sessionStorage.getItem('kindergarten-token'))
  const [parentPortalToken, setParentPortalToken] = useState(() => sessionStorage.getItem('parent-portal-token'))
  const [checkingSession, setCheckingSession] = useState(() => Boolean(storedToken || parentPortalToken))
  const [sessionError, setSessionError] = useState('')
  const { t } = useLocale()

  useEffect(() => {
    const token = parentPortalToken ?? storedToken
    if (!token) return
    const path = parentPortalToken ? '/parent/portal' : '/auth/me'

    apiRequest<{ user: AuthUser; tenant: TenantInfo } | unknown>(path, token)
      .then((result) => {
        if (parentPortalToken) return
        const { user, tenant } = result as { user: AuthUser; tenant: TenantInfo }
        setSession({ token: token!, user, tenant })
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          sessionStorage.removeItem(parentPortalToken ? 'parent-portal-token' : 'kindergarten-token')
          if (parentPortalToken) setParentPortalToken(null)
          return
        }
        setSessionError(t('Could not reach your workspace. Check the connection and sign in again.'))
      })
      .finally(() => setCheckingSession(false))
  }, [storedToken, parentPortalToken, t])

  function handleAuthenticated(nextSession: AuthSession) {
    sessionStorage.removeItem('parent-portal-token')
    sessionStorage.setItem('kindergarten-token', nextSession.token)
    setParentPortalToken(null)
    setSession(nextSession)
  }

  function handleParentAuthenticated(token: string) {
    sessionStorage.removeItem('kindergarten-token')
    sessionStorage.setItem('parent-portal-token', token)
    setParentPortalToken(token)
    setSession(null)
  }

  function handleLogout() {
    sessionStorage.removeItem('kindergarten-token')
    sessionStorage.removeItem('parent-portal-token')
    setParentPortalToken(null)
    setSession(null)
  }

  if (checkingSession) {
    return <div className="app-loading">{t('Loading your workspace…')}</div>
  }

  if (parentPortalToken) return <ParentPortalPage token={parentPortalToken} onLogout={handleLogout} />

  if (!session) {
    return <AuthPage onAuthenticated={handleAuthenticated} onParentAuthenticated={handleParentAuthenticated} notice={sessionError} />
  }

  if (session.user.role === 'TEACHER') return <TeacherDashboard session={session} onLogout={handleLogout} />

  return <DashboardLayout session={session} onLogout={handleLogout} />
}

export default App
