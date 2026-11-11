import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  DoorOpen,
  FileUp,
  GraduationCap,
  LayoutDashboard,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react'
import type { AuthSession } from '../App'
import { apiRequest, publicAssetUrl } from '../lib/api'
import { AttendancePanel } from './AttendancePanel'
import { EventsPanel } from './EventsPanel'
import { FinancePanel } from './FinancePanel'
import { NotificationCenter } from './NotificationCenter'
import { OverviewCharts } from './OverviewCharts'
import { StaffPanel } from './StaffPanel'
import { LanguageToggle, useLocale } from '../lib/i18n'
import { WorkspaceSettingsPanel } from './WorkspaceSettingsPanel'
import { AIAssistant } from './AIAssistant'

type DashboardPage = 'overview' | 'children' | 'classrooms' | 'enrollments' | 'attendance' | 'events' | 'finance' | 'staff' | 'users' | 'payments' | 'settings' | 'account'
const dashboardPages: DashboardPage[] = ['overview', 'children', 'classrooms', 'enrollments', 'attendance', 'events', 'finance', 'staff', 'users', 'payments', 'settings', 'account']

function pageFromHash(): DashboardPage {
  const page = window.location.hash.slice(1)
  return dashboardPages.find((item) => item === page) ?? 'overview'
}

type Props = {
  session: AuthSession
  onLogout: () => void
}

type Summary = {
  totalChildren: number
  activeEnrollments: number
  classrooms: number
  teachers: number
  monthlyRevenue: number
}

type ChildRecord = {
  id: string
  fullName: string
  dateOfBirth: string
  gender: string | null
  accessCode?: string
  classroom: { id: string; name: string } | null
}

type UserRecord = {
  id: string
  fullName: string
  email: string
  role: 'ADMIN' | 'TEACHER' | 'PARENT'
  status: 'ACTIVE' | 'INACTIVE'
}

type ClassroomRecord = {
  id: string
  name: string
  ageGroup: string | null
  capacity: number
  _count?: { children: number }
}

type EnrollmentRecord = {
  id: string
  childId: string
  status: string
  startDate: string
  endDate: string | null
  monthlyFee: string | number
  child: { id: string; fullName: string }
}

type PaymentRecord = {
  id: string
  childId: string | null
  amount: string | number
  currency: string
  paymentMethod: string
  status: string
  reference: string | null
  createdAt: string
  date: string
  paidAt: string | null
  child: { fullName: string } | null
}

type DashboardData = {
  summary: Summary
  tenant: { name: string; settings: AuthSession['tenant']['settings'] } | null
}

const emptySummary: Summary = {
  totalChildren: 0,
  activeEnrollments: 0,
  classrooms: 0,
  teachers: 0,
  monthlyRevenue: 0,
}

export function DashboardLayout({ session, onLogout }: Props) {
  const isParent = session.user.role === 'PARENT'
  const isAdmin = session.user.role === 'ADMIN'
  const [activePage, setActivePage] = useState<DashboardPage>(pageFromHash)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [children, setChildren] = useState<ChildRecord[]>([])
  const [classrooms, setClassrooms] = useState<ClassroomRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [logoOverride, setLogoOverride] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showChildForm, setShowChildForm] = useState(false)
  const [showClassroomForm, setShowClassroomForm] = useState(false)
  const [showUserForm, setShowUserForm] = useState(false)
  const [showEnrollmentForm, setShowEnrollmentForm] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [editingChild, setEditingChild] = useState<ChildRecord | null>(null)
  const [editingClassroom, setEditingClassroom] = useState<ClassroomRecord | null>(null)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentRecord | null>(null)
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null)
  const [importingChildren, setImportingChildren] = useState(false)
  const childImportRef = useRef<HTMLInputElement>(null)
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'

  const refresh = useCallback(async () => {
    try {
      if (isParent) {
        const [ownChildren, ownPayments] = await Promise.all([
          apiRequest<ChildRecord[]>('/parent/children', session.token),
          apiRequest<PaymentRecord[]>('/parent/payments', session.token),
        ])
        setError('')
        setChildren(ownChildren)
        setEnrollments([])
        setUsers([])
        setPayments(ownPayments)
      } else {
        const [stats, childRows, classroomRows, enrollmentRows, paymentRows, userRows] = await Promise.all([
          apiRequest<DashboardData>('/dashboard', session.token),
          apiRequest<ChildRecord[]>('/children', session.token),
          apiRequest<ClassroomRecord[]>('/classrooms', session.token),
          apiRequest<EnrollmentRecord[]>('/enrollments', session.token),
          isAdmin ? apiRequest<PaymentRecord[]>('/payments', session.token) : Promise.resolve([]),
          isAdmin ? apiRequest<UserRecord[]>('/users', session.token) : Promise.resolve([]),
        ])
        setError('')
        setDashboard(stats)
        setChildren(childRows)
        setClassrooms(classroomRows)
        setEnrollments(enrollmentRows)
        setPayments(paymentRows)
        setUsers(userRows)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load workspace data')
    }
  }, [isAdmin, isParent, session.token])

  useEffect(() => {
    queueMicrotask(() => { void refresh() })
  }, [refresh])

  useEffect(() => {
    const handleHistoryNavigation = () => setActivePage(pageFromHash())
    window.addEventListener('popstate', handleHistoryNavigation)
    window.addEventListener('hashchange', handleHistoryNavigation)
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation)
      window.removeEventListener('hashchange', handleHistoryNavigation)
    }
  }, [])

  function navigateTo(page: DashboardPage, event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    setActivePage(page)
    if (window.location.hash !== `#${page}`) window.history.pushState(null, '', `#${page}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function removeRecord(path: string, label: string) {
    if (!window.confirm(`Delete this ${label}? This action cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await apiRequest<void>(path, session.token, { method: 'DELETE' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Could not delete ${label}`)
    } finally {
      setBusy(false)
    }
  }

  async function createChild(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const id = formData.get('id')
    setBusy(true)
    setError('')
    try {
      await apiRequest(id ? `/children/${id}` : '/children', session.token, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          fullName: formData.get('fullName'),
          dateOfBirth: formData.get('dateOfBirth'),
          ...(id
            ? { gender: formData.get('gender') || null }
            : formData.get('gender')
              ? { gender: formData.get('gender') }
              : {}),
          classId: formData.get('classId') || null,
        }),
      })
      form.reset()
      setShowChildForm(false)
      setEditingChild(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create child')
    } finally {
      setBusy(false)
    }
  }

  async function createClassroom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const id = formData.get('id')
    setBusy(true)
    setError('')
    try {
      await apiRequest(id ? `/classrooms/${id}` : '/classrooms', session.token, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          ageGroup: formData.get('ageGroup') || null,
          capacity: Number(formData.get('capacity')),
        }),
      })
      form.reset()
      setShowClassroomForm(false)
      setEditingClassroom(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create classroom')
    } finally {
      setBusy(false)
    }
  }

  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const id = data.get('id')
    const password = data.get('password')
    setBusy(true)
    setError('')
    try {
      await apiRequest(id ? `/users/${id}` : '/users', session.token, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          fullName: data.get('fullName'),
          email: data.get('email'),
          role: data.get('role'),
          ...(password ? { password } : {}),
          ...(id ? { status: data.get('status') } : {}),
        }),
      })
      form.reset()
      setShowUserForm(false)
      setEditingUser(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save user')
    } finally {
      setBusy(false)
    }
  }

  async function saveEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const id = data.get('id')
    setBusy(true)
    setError('')
    try {
      await apiRequest(id ? `/enrollments/${id}` : '/enrollments', session.token, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(!id ? { childId: data.get('childId') } : {}),
          status: data.get('status'),
          startDate: data.get('startDate'),
          ...(id
            ? { endDate: data.get('endDate') || null }
            : data.get('endDate')
              ? { endDate: data.get('endDate') }
              : {}),
          monthlyFee: Number(data.get('monthlyFee')),
        }),
      })
      form.reset()
      setShowEnrollmentForm(false)
      setEditingEnrollment(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save enrollment')
    } finally {
      setBusy(false)
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const id = data.get('id')
    setBusy(true)
    setError('')
    try {
      await apiRequest(id ? `/payments/${id}` : '/payments', session.token, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          childId: data.get('childId') || null,
          amount: Number(data.get('amount')),
          currency: data.get('currency'),
          paymentMethod: data.get('paymentMethod'),
          status: data.get('status'),
          date: data.get('date'),
          reference: data.get('reference') || null,
          ...(id
            ? { paidAt: data.get('paidAt') || null }
            : data.get('paidAt')
              ? { paidAt: data.get('paidAt') }
              : {}),
        }),
      })
      form.reset()
      setShowPaymentForm(false)
      setEditingPayment(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save payment')
    } finally {
      setBusy(false)
    }
  }

  async function importChildren(file?: File) {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    setImportingChildren(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ imported: number }>('/imports/children', session.token, {
        method: 'POST',
        body,
      })
      setNotice(`${t('Imported')} ${result.imported} ${t('children')}`)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not import children')
    } finally {
      setImportingChildren(false)
      if (childImportRef.current) childImportRef.current.value = ''
    }
  }

  const tenantName = dashboard?.tenant?.settings?.kindergartenName ?? session.tenant.name
  const logoUrl = logoOverride !== undefined
    ? logoOverride
    : dashboard?.tenant?.settings?.logoUrl ?? session.tenant.settings?.logoUrl ?? null
  const logoSource = publicAssetUrl(logoUrl)
  const summary = dashboard?.summary ?? emptySummary
  const visibleChildren = children

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="workspace-brand-mark">
            {logoSource ? <img src={logoSource} alt={`${tenantName} ${t('logo')}`} /> : <GraduationCap size={22} />}
          </div>
          <div>
            <span className="workspace-brand-caption">{t('Workspace')}</span>
            <strong title={tenantName}>{tenantName}</strong>
          </div>
        </div>
        <nav className="workspace-nav" aria-label={t('Workspace navigation')}>
          <a className={`workspace-nav-item${activePage === 'overview' ? ' active' : ''}`} href="#overview" onClick={(event) => navigateTo('overview', event)} aria-current={activePage === 'overview' ? 'page' : undefined}><LayoutDashboard size={18} /> {t('Overview')}</a>
          <a className={`workspace-nav-item${activePage === 'children' ? ' active' : ''}`} href="#children" onClick={(event) => navigateTo('children', event)} aria-current={activePage === 'children' ? 'page' : undefined}><Users size={18} /> {t(isParent ? 'My children' : 'Children')}</a>
          {!isParent && <a className={`workspace-nav-item${activePage === 'classrooms' ? ' active' : ''}`} href="#classrooms" onClick={(event) => navigateTo('classrooms', event)} aria-current={activePage === 'classrooms' ? 'page' : undefined}><DoorOpen size={18} /> {t('Classrooms')}</a>}
          {!isParent && <a className={`workspace-nav-item${activePage === 'enrollments' ? ' active' : ''}`} href="#enrollments" onClick={(event) => navigateTo('enrollments', event)} aria-current={activePage === 'enrollments' ? 'page' : undefined}><GraduationCap size={18} /> {t('Enrollments')}</a>}
          {!isParent && <a className={`workspace-nav-item${activePage === 'attendance' ? ' active' : ''}`} href="#attendance" onClick={(event) => navigateTo('attendance', event)} aria-current={activePage === 'attendance' ? 'page' : undefined}><ClipboardCheck size={18} /> {t('Attendance')}</a>}
          <a className={`workspace-nav-item${activePage === 'events' ? ' active' : ''}`} href="#events" onClick={(event) => navigateTo('events', event)} aria-current={activePage === 'events' ? 'page' : undefined}><CalendarRange size={18} /> {t('Calendar / Events')}</a>
          {isAdmin && <a className={`workspace-nav-item${activePage === 'finance' ? ' active' : ''}`} href="#finance" onClick={(event) => navigateTo('finance', event)} aria-current={activePage === 'finance' ? 'page' : undefined}><WalletCards size={18} /> {t('Finance')}</a>}
          {isAdmin && <a className={`workspace-nav-item${activePage === 'staff' ? ' active' : ''}`} href="#staff" onClick={(event) => navigateTo('staff', event)} aria-current={activePage === 'staff' ? 'page' : undefined}><Users size={18} /> {t('Teachers / Staff')}</a>}
          {isAdmin && <a className={`workspace-nav-item${activePage === 'users' ? ' active' : ''}`} href="#users" onClick={(event) => navigateTo('users', event)} aria-current={activePage === 'users' ? 'page' : undefined}><Users size={18} /> {t('Users')}</a>}
          {isAdmin && <a className={`workspace-nav-item${activePage === 'settings' ? ' active' : ''}`} href="#settings" onClick={(event) => navigateTo('settings', event)} aria-current={activePage === 'settings' ? 'page' : undefined}><Settings size={18} /> {t('Workspace settings')}</a>}
          {isParent && <a className={`workspace-nav-item${activePage === 'payments' ? ' active' : ''}`} href="#payments" onClick={(event) => navigateTo('payments', event)} aria-current={activePage === 'payments' ? 'page' : undefined}><WalletCards size={18} /> {t('Payment history')}</a>}
          <a className={`workspace-nav-item${activePage === 'account' ? ' active' : ''}`} href="#account" onClick={(event) => navigateTo('account', event)} aria-current={activePage === 'account' ? 'page' : undefined}><Settings size={18} /> {t('Account')}</a>
        </nav>
        <div className="workspace-sidebar-bottom">
          <div className="workspace-user">
            <div className="workspace-avatar">{session.user.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div className="workspace-user-details">
              <strong>{session.user.fullName}</strong>
              <span>{session.user.role.toLowerCase()}</span>
            </div>
          </div>
          <button type="button" className="workspace-logout" onClick={onLogout}>{t('Sign out')}</button>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-identity">
            {logoSource && <img className="workspace-topbar-logo" src={logoSource} alt="" />}
            <div>
              <div className="workspace-kicker">{t(isParent ? 'Family portal' : 'School management')}</div>
              <h1>{t('Good morning,')} {session.user.fullName.split(' ')[0]}</h1>
              <p>{tenantName} <span aria-hidden="true">·</span> {session.tenant.slug}</p>
            </div>
          </div>
          <div className="workspace-header-controls"><LanguageToggle /><NotificationCenter token={session.token} /></div>
        </header>

        {error && <div className="workspace-error" role="alert">{error}</div>}
        {notice && <div className="workspace-success" role="status">{notice}</div>}

        {activePage === 'overview' && (
          <div className="workspace-overview" id="overview">
            {!isParent && (
              <section className="workspace-stats" aria-label={t('Workspace statistics')}>
                <StatCard label={t('Children')} value={summary.totalChildren} icon={<Users size={18} />} />
                <StatCard label={t('Active enrollments')} value={summary.activeEnrollments} icon={<GraduationCap size={18} />} />
                <StatCard label={t('Classrooms')} value={summary.classrooms} icon={<DoorOpen size={18} />} />
                <StatCard label={t('Teachers')} value={summary.teachers} icon={<Users size={18} />} />
                {isAdmin && (
                  <StatCard
                    label={t('Revenue this month')}
                    value={new Intl.NumberFormat(locale, {
                      style: 'currency',
                      currency: session.tenant.settings?.currency ?? 'USD',
                      maximumFractionDigits: 0,
                    }).format(summary.monthlyRevenue)}
                    icon={<CalendarDays size={18} />}
                  />
                )}
              </section>
            )}

            {isParent ? (
              <section className="workspace-stats" aria-label={t('Family portal summary')}>
                <StatCard label={t('My children')} value={children.length} icon={<Users size={18} />} />
                <StatCard label={t('Payment records')} value={payments.length} icon={<CalendarDays size={18} />} />
              </section>
            ) : (
              <OverviewCharts
                payments={payments}
                enrollments={enrollments}
                classrooms={classrooms}
                currency={session.tenant.settings?.currency ?? 'USD'}
                canViewFinance={isAdmin}
              />
            )}
          </div>
        )}

        {activePage === 'children' && (
        <section className="workspace-panel" id="children">
          <div className="workspace-panel-heading">
            <div>
              <span className="workspace-kicker">{t(isParent ? 'Family' : 'Student records')}</span>
              <h2>{t(isParent ? 'My children' : 'Children')}</h2>
            </div>
            {isAdmin && (
              <div className="workspace-panel-actions">
                <input ref={childImportRef} className="workspace-visually-hidden" type="file" accept=".csv,.xlsx" onChange={(event) => void importChildren(event.target.files?.[0])} />
                <button type="button" className="workspace-secondary-button" disabled={importingChildren} onClick={() => childImportRef.current?.click()}><FileUp size={16} /> {t('Import CSV / Excel')}</button>
                <button type="button" className="workspace-primary-button" onClick={() => {
                  setEditingChild(null)
                  setShowChildForm((current) => !current)
                }}>
                  <Plus size={17} /> {t('Add child')}
                </button>
              </div>
            )}
          </div>

          {showChildForm && isAdmin && (
            <form className="workspace-inline-form" onSubmit={createChild}>
              {editingChild && <input type="hidden" name="id" value={editingChild.id} />}
              <label>{t('Full name')}<input required name="fullName" minLength={2} defaultValue={editingChild?.fullName ?? ''} /></label>
              <label>{t('Date of birth')}<input required name="dateOfBirth" type="date" defaultValue={editingChild?.dateOfBirth.slice(0, 10) ?? ''} /></label>
              <label>{t('Gender')}<input name="gender" maxLength={40} defaultValue={editingChild?.gender ?? ''} /></label>
              <label>{t('Classroom')}
                <select name="classId" defaultValue={editingChild?.classroom?.id ?? ''}>
                  <option value="">{t('Unassigned')}</option>
                  {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
                </select>
              </label>
              <div className="workspace-form-actions">
                <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editingChild ? t('Update child') : t('Save child')}</button>
                <button type="button" className="workspace-secondary-button" onClick={() => {
                  setShowChildForm(false)
                  setEditingChild(null)
                }}>{t('Cancel')}</button>
              </div>
            </form>
          )}

          {visibleChildren.length ? (
            <div className="workspace-table-scroll">
              <table className="workspace-table">
                <thead><tr><th>{t('Name')}</th><th>{t('Date of birth')}</th><th>{t('Classroom')}</th><th>{t('Gender')}</th>{isAdmin && <th>{t('Access code')}</th>}{isAdmin && <th>{t('Actions')}</th>}</tr></thead>
                <tbody>
                  {visibleChildren.map((child) => (
                    <tr key={child.id}>
                      <td><strong>{child.fullName}</strong></td>
                      <td>{new Date(child.dateOfBirth).toLocaleDateString(locale)}</td>
                      <td>{child.classroom?.name ?? t('Not assigned')}</td>
                      <td>{child.gender ?? '—'}</td>
                      {isAdmin && <td><code className="workspace-access-code">{child.accessCode}</code></td>}
                      {isAdmin && <td><div className="workspace-row-actions">
                        <button type="button" aria-label={`Edit ${child.fullName}`} onClick={() => {
                          setEditingChild(child)
                          setShowChildForm(true)
                        }}><Pencil size={15} /></button>
                        <button type="button" className="workspace-danger-button" aria-label={`Delete ${child.fullName}`} disabled={busy} onClick={() => void removeRecord(`/children/${child.id}`, 'child')}><Trash2 size={15} /></button>
                      </div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="workspace-empty">{t(isParent ? 'No children are linked to your account yet.' : 'No children have been registered in this workspace.')}</div>
          )}
          {isAdmin && <p className="workspace-import-help">{t('Upload a CSV or XLSX file with fullName, dateOfBirth, gender and classroom columns.')}</p>}
        </section>
        )}

        {!isParent && activePage === 'classrooms' && (
          <section className="workspace-panel" id="classrooms">
            <div className="workspace-panel-heading">
              <div>
                <span className="workspace-kicker">{t('Learning spaces')}</span>
                <h2>{t('Classrooms')}</h2>
              </div>
              {isAdmin && (
                <button type="button" className="workspace-secondary-button" onClick={() => {
                  setEditingClassroom(null)
                  setShowClassroomForm((current) => !current)
                }}>
                  <Plus size={17} /> {t('Add classroom')}
                </button>
              )}
            </div>
            {showClassroomForm && isAdmin && (
              <form className="workspace-inline-form" onSubmit={createClassroom}>
                {editingClassroom && <input type="hidden" name="id" value={editingClassroom.id} />}
                <label>{t('Classroom name')}<input required name="name" maxLength={100} defaultValue={editingClassroom?.name ?? ''} /></label>
                <label>{t('Age group')}<input name="ageGroup" maxLength={500} defaultValue={editingClassroom?.ageGroup ?? ''} /></label>
                <label>{t('Capacity')}<input required name="capacity" type="number" min="1" max="500" defaultValue={editingClassroom?.capacity ?? 20} /></label>
                <div className="workspace-form-actions">
                  <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editingClassroom ? t('Update classroom') : t('Save classroom')}</button>
                  <button type="button" className="workspace-secondary-button" onClick={() => {
                    setShowClassroomForm(false)
                    setEditingClassroom(null)
                  }}>{t('Cancel')}</button>
                </div>
              </form>
            )}
            {classrooms.length ? (
              <div className="workspace-classroom-grid">
                {classrooms.map((classroom) => (
                  <article className="workspace-classroom-card" key={classroom.id}>
                    <div className="workspace-classroom-icon"><DoorOpen size={19} /></div>
                    <strong>{classroom.name}</strong>
                    <span>{classroom.ageGroup ?? 'Age group not set'}</span>
                    <small>{classroom._count?.children ?? 0} / {classroom.capacity} children</small>
                    {isAdmin && <div className="workspace-row-actions">
                      <button type="button" aria-label={`Edit ${classroom.name}`} onClick={() => {
                        setEditingClassroom(classroom)
                        setShowClassroomForm(true)
                      }}><Pencil size={15} /></button>
                      <button type="button" className="workspace-danger-button" aria-label={`Delete ${classroom.name}`} disabled={busy} onClick={() => void removeRecord(`/classrooms/${classroom.id}`, 'classroom')}><Trash2 size={15} /></button>
                    </div>}
                  </article>
                ))}
              </div>
            ) : <div className="workspace-empty">{t('No classrooms have been created yet.')}</div>}
          </section>
        )}

        {!isParent && activePage === 'enrollments' && (
          <section className="workspace-panel" id="enrollments">
            <div className="workspace-panel-heading">
              <div>
                <span className="workspace-kicker">{t('Student records')}</span>
                <h2>{t('Enrollments')}</h2>
              </div>
              {isAdmin && (
                <button type="button" className="workspace-primary-button" onClick={() => {
                  setEditingEnrollment(null)
                  setShowEnrollmentForm((current) => !current)
                }}>
                  <Plus size={17} /> {t('Add enrollment')}
                </button>
              )}
            </div>
            {showEnrollmentForm && isAdmin && (
              <form className="workspace-inline-form" onSubmit={saveEnrollment}>
                {editingEnrollment && <input type="hidden" name="id" value={editingEnrollment.id} />}
                {editingEnrollment ? (
                  <label>{t('Child')}<input value={editingEnrollment.child.fullName} disabled /></label>
                ) : (
                  <label>{t('Child')}
                    <select required name="childId" defaultValue="">
                      <option value="" disabled>{t('Select a child')}</option>
                      {children.map((child) => <option key={child.id} value={child.id}>{child.fullName}</option>)}
                    </select>
                  </label>
                )}
                <label>{t('Status')}
                  <select name="status" defaultValue={editingEnrollment?.status ?? 'ACTIVE'}>
                    <option value="ACTIVE">{t('Active')}</option>
                    <option value="INACTIVE">{t('Inactive')}</option>
                    <option value="COMPLETED">{t('Completed')}</option>
                  </select>
                </label>
                <label>{t('Start date')}<input required name="startDate" type="date" defaultValue={editingEnrollment?.startDate.slice(0, 10) ?? ''} /></label>
                <label>{t('End date')}<input name="endDate" type="date" defaultValue={editingEnrollment?.endDate?.slice(0, 10) ?? ''} /></label>
                <label>{t('Monthly fee')}<input required name="monthlyFee" type="number" min="0" step="0.01" defaultValue={editingEnrollment?.monthlyFee ?? 0} /></label>
                <div className="workspace-form-actions">
                  <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editingEnrollment ? t('Update enrollment') : t('Save enrollment')}</button>
                  <button type="button" className="workspace-secondary-button" onClick={() => {
                    setShowEnrollmentForm(false)
                    setEditingEnrollment(null)
                  }}>{t('Cancel')}</button>
                </div>
              </form>
            )}
            {enrollments.length ? (
              <div className="workspace-table-scroll">
                <table className="workspace-table">
                  <thead><tr><th>{t('Child')}</th><th>{t('Status')}</th><th>{t('Start date')}</th><th>{t('End date')}</th><th>{t('Monthly fee')}</th>{isAdmin && <th>{t('Actions')}</th>}</tr></thead>
                  <tbody>
                    {enrollments.map((enrollment) => (
                      <tr key={enrollment.id}>
                        <td><strong>{enrollment.child.fullName}</strong></td>
                        <td><span className={`workspace-status ${enrollment.status.toLowerCase()}`}>{t(enrollment.status)}</span></td>
                        <td>{new Date(enrollment.startDate).toLocaleDateString(locale)}</td>
                        <td>{enrollment.endDate ? new Date(enrollment.endDate).toLocaleDateString(locale) : '—'}</td>
                        <td>{new Intl.NumberFormat(locale, { style: 'currency', currency: session.tenant.settings?.currency ?? 'USD' }).format(Number(enrollment.monthlyFee))}</td>
                        {isAdmin && <td><div className="workspace-row-actions">
                          <button type="button" aria-label={`Edit enrollment for ${enrollment.child.fullName}`} onClick={() => {
                            setEditingEnrollment(enrollment)
                            setShowEnrollmentForm(true)
                          }}><Pencil size={15} /></button>
                          <button type="button" className="workspace-danger-button" aria-label={`Delete enrollment for ${enrollment.child.fullName}`} disabled={busy} onClick={() => void removeRecord(`/enrollments/${enrollment.id}`, 'enrollment')}><Trash2 size={15} /></button>
                        </div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="workspace-empty">{t('No enrollments have been recorded yet.')}</div>}
          </section>
        )}

        {!isParent && activePage === 'attendance' && <AttendancePanel token={session.token} classrooms={classrooms} />}
        {activePage === 'events' && <EventsPanel token={session.token} canManage={!isParent} />}

        {isAdmin && activePage === 'users' && (
          <section className="workspace-panel" id="users">
            <div className="workspace-panel-heading">
              <div>
                <span className="workspace-kicker">{t('Workspace access')}</span>
                <h2>{t('Users')}</h2>
              </div>
              <button type="button" className="workspace-primary-button" onClick={() => {
                setEditingUser(null)
                setShowUserForm((current) => !current)
              }}>
                <Plus size={17} /> {t('Add user')}
              </button>
            </div>
            {showUserForm && (
              <form className="workspace-inline-form" onSubmit={saveUser}>
                {editingUser && <input type="hidden" name="id" value={editingUser.id} />}
                <label>{t('Full name')}<input required name="fullName" minLength={2} defaultValue={editingUser?.fullName ?? ''} /></label>
                <label>{t('Email address')}<input required name="email" type="email" defaultValue={editingUser?.email ?? ''} /></label>
                <label>{editingUser ? t('New password (optional)') : t('Password')}
                  <input name="password" type="password" minLength={10} required={!editingUser} autoComplete="new-password" />
                </label>
                <label>{t('Role')}
                  <select name="role" defaultValue={editingUser?.role ?? 'TEACHER'}>
                    <option value="ADMIN">{t('Admin')}</option>
                    <option value="TEACHER">{t('Teacher')}</option>
                    <option value="PARENT">{t('Parent')}</option>
                  </select>
                </label>
                {editingUser && (
                  <label>{t('Status')}
                    <select name="status" defaultValue={editingUser.status}>
                      <option value="ACTIVE">{t('Active')}</option>
                      <option value="INACTIVE">{t('Inactive')}</option>
                    </select>
                  </label>
                )}
                <div className="workspace-form-actions">
                  <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editingUser ? t('Update user') : t('Create user')}</button>
                  <button type="button" className="workspace-secondary-button" onClick={() => {
                    setShowUserForm(false)
                    setEditingUser(null)
                  }}>{t('Cancel')}</button>
                </div>
              </form>
            )}
            {users.length ? (
              <div className="workspace-table-scroll">
                <table className="workspace-table">
                  <thead><tr><th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Role')}</th><th>{t('Status')}</th><th>{t('Actions')}</th></tr></thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td><strong>{user.fullName}</strong></td>
                        <td>{user.email}</td>
                        <td>{t(user.role)}</td>
                        <td><span className={`workspace-status ${user.status.toLowerCase()}`}>{t(user.status)}</span></td>
                        <td><div className="workspace-row-actions">
                          <button type="button" aria-label={`Edit ${user.fullName}`} onClick={() => {
                            setEditingUser(user)
                            setShowUserForm(true)
                          }}><Pencil size={15} /></button>
                          <button type="button" className="workspace-danger-button" aria-label={`Delete ${user.fullName}`} disabled={busy} onClick={() => void removeRecord(`/users/${user.id}`, 'user')}><Trash2 size={15} /></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="workspace-empty">{t('No users have been added to this workspace yet.')}</div>}
          </section>
        )}

        {isAdmin && activePage === 'finance' && <FinancePanel session={session} students={children.map(({ id, fullName }) => ({ id, fullName }))} />}
        {isAdmin && activePage === 'staff' && <StaffPanel token={session.token} />}

        {isParent && activePage === 'payments' && (
          <section className="workspace-panel" id="payments">
            <div className="workspace-panel-heading">
              <div>
                <span className="workspace-kicker">{isParent ? t('Family account') : t('Finance')}</span>
                <h2>{isParent ? t('My payment records') : t('Recent payments')}</h2>
              </div>
              {isAdmin && <button type="button" className="workspace-primary-button" onClick={() => {
                setEditingPayment(null)
                setShowPaymentForm((current) => !current)
              }}><Plus size={17} /> {t('Add payment')}</button>}
            </div>
            {showPaymentForm && isAdmin && (
              <form className="workspace-inline-form" onSubmit={savePayment}>
                {editingPayment && <input type="hidden" name="id" value={editingPayment.id} />}
                <label>{t('Child')}
                  <select name="childId" defaultValue={editingPayment?.childId ?? ''}>
                    <option value="">{t('General payment')}</option>
                    {children.map((child) => <option key={child.id} value={child.id}>{child.fullName}</option>)}
                  </select>
                </label>
                <label>{t('Amount')}<input required name="amount" type="number" min="0.01" max="10000000" step="0.01" defaultValue={editingPayment?.amount ?? ''} /></label>
                <label>{t('Currency')}<input required name="currency" minLength={3} maxLength={3} defaultValue={editingPayment?.currency ?? session.tenant.settings?.currency ?? 'USD'} /></label>
                <label>{t('Method')}<input required name="paymentMethod" minLength={2} maxLength={40} defaultValue={editingPayment?.paymentMethod ?? ''} /></label>
                <label>{t('Status')}
                  <select name="status" defaultValue={editingPayment?.status ?? 'PAID'}>
                    <option value="PAID">{t('PAID')}</option>
                    <option value="PENDING">{t('PENDING')}</option>
                    <option value="OVERDUE">{t('OVERDUE')}</option>
                  </select>
                </label>
                <label>{t('Reference')}<input name="reference" maxLength={120} defaultValue={editingPayment?.reference ?? ''} /></label>
                <label>{t('Payment date')}<input name="date" type="date" defaultValue={editingPayment?.date.slice(0, 10) ?? ''} /></label>
                <div className="workspace-form-actions">
                  <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editingPayment ? t('Update payment') : t('Save payment')}</button>
                  <button type="button" className="workspace-secondary-button" onClick={() => {
                    setShowPaymentForm(false)
                    setEditingPayment(null)
                  }}>{t('Cancel')}</button>
                </div>
              </form>
            )}
            {payments.length ? (
              <div className="workspace-table-scroll">
                <table className="workspace-table">
                  <thead><tr><th>{t('Child')}</th><th>{t('Amount')}</th><th>{t('Date')}</th><th>{t('Status')}</th>{isAdmin && <th>{t('Actions')}</th>}</tr></thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.child?.fullName ?? t('General payment')}</td>
                        <td>{new Intl.NumberFormat(locale, { style: 'currency', currency: payment.currency }).format(Number(payment.amount))}</td>
                        <td>{new Date(`${payment.date.slice(0, 10)}T12:00:00`).toLocaleDateString(locale)}</td>
                        <td><span className={`workspace-status ${payment.status.toLowerCase()}`}>{t(payment.status)}</span></td>
                        {isAdmin && <td><div className="workspace-row-actions">
                          <button type="button" aria-label={`Edit payment for ${payment.child?.fullName ?? 'general payment'}`} onClick={() => {
                            setEditingPayment(payment)
                            setShowPaymentForm(true)
                          }}><Pencil size={15} /></button>
                          <button type="button" className="workspace-danger-button" aria-label="Delete payment" disabled={busy} onClick={() => void removeRecord(`/payments/${payment.id}`, 'payment')}><Trash2 size={15} /></button>
                        </div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="workspace-empty">{t('No payment records to show.')}</div>}
          </section>
        )}

        {activePage === 'account' && <footer className="workspace-footer" id="account">
          {t('Signed in as')} {session.user.email} · {t(session.user.role)}
        </footer>}

        {isAdmin && activePage === 'settings' && (
          <WorkspaceSettingsPanel
            token={session.token}
            kindergartenName={tenantName}
            logoUrl={logoUrl}
            onLogoUpdated={setLogoOverride}
          />
        )}
        {isAdmin && <AIAssistant token={session.token} role="ADMIN" />}
      </main>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <article className="workspace-stat-card">
      <div className="workspace-stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
