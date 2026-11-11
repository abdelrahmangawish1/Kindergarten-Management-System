import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, GraduationCap, LogOut, Upload } from 'lucide-react'
import { apiRequest, downloadAsset } from '../lib/api'
import { LanguageToggle, useLocale } from '../lib/i18n'

type ParentPortalData = {
  child: {
    fullName: string
    dateOfBirth: string
    classroom: { name: string } | null
    tenant: { name: string; settings: { currency: string } | null }
  }
  attendance: { date: string; status: string }[]
  payments: { amount: number | string; currency: string; status: string; date: string; paymentMethod: string }[]
  events: { title: string; description: string | null; date: string }[]
  homework: Homework[]
}
type HomeworkFile = { fileName: string; originalName: string; mimeType: string; size: number }
type Homework = {
  id: string
  title: string
  description: string
  instructions: string
  dueDate: string
  attachments: { label: string; url: string }[]
  submissions: {
    id: string
    status: 'SUBMITTED' | 'GRADED'
    submittedAt: string
    submissionText: string | null
    attachments: HomeworkFile[]
    grade: string | number | null
    feedback: string | null
  }[]
}

export function ParentPortalPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [portal, setPortal] = useState<ParentPortalData | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyHomeworkId, setBusyHomeworkId] = useState<string | null>(null)
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'

  const refresh = useCallback(async () => {
    try {
      setPortal(await apiRequest<ParentPortalData>('/parent/portal', token))
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load child information')
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function submitHomework(event: React.FormEvent<HTMLFormElement>, homeworkId: string) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const selectedFile = formData.get('file')
    if (selectedFile instanceof File && selectedFile.size > 10 * 1024 * 1024) {
      setError(t('Homework files must be 10 MB or smaller.'))
      return
    }
    setBusyHomeworkId(homeworkId)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/parent/homework/${homeworkId}/submission`, token, { method: 'POST', body: formData })
      setNotice(t('Homework submitted successfully.'))
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('Could not submit homework'))
    } finally {
      setBusyHomeworkId(null)
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="workspace-brand-mark"><GraduationCap size={22} /></div>
          <div><span className="workspace-brand-caption">{t('Family portal')}</span><strong>{portal?.child.tenant.name ?? t('Parent Portal')}</strong></div>
        </div>
        <div className="workspace-sidebar-bottom">
          <div className="workspace-user-details"><strong>{portal?.child.fullName}</strong><span>{t('Read-only family view')}</span></div>
          <button type="button" className="workspace-logout" onClick={onLogout}><LogOut size={15} /> {t('Sign out')}</button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-topbar">
          <div><div className="workspace-kicker">{t('Family portal')}</div><h1>{portal?.child.fullName ?? t('My child')}</h1><p>{portal?.child.tenant.name}</p></div>
          <div className="workspace-header-controls"><LanguageToggle /><button type="button" className="workspace-notification" onClick={onLogout} aria-label={t('Sign out')}><LogOut size={18} /></button></div>
        </header>
        {error && <div className="workspace-error" role="alert">{t(error)}</div>}
        {notice && <div className="workspace-success" role="status">{t(notice)}</div>}
        {portal && <>
          <section className="workspace-stats" aria-label={t('Child summary')}>
            <article className="workspace-stat-card"><div className="workspace-stat-icon"><GraduationCap size={18} /></div><span>{t('Classroom')}</span><strong>{portal.child.classroom?.name ?? '—'}</strong></article>
            <article className="workspace-stat-card"><div className="workspace-stat-icon"><CalendarDays size={18} /></div><span>{t('Attendance records')}</span><strong>{portal.attendance.length}</strong></article>
            <article className="workspace-stat-card"><div className="workspace-stat-icon"><CalendarDays size={18} /></div><span>{t('Payment records')}</span><strong>{portal.payments.length}</strong></article>
          </section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Daily check-in')}</span><h2>{t('Attendance history')}</h2></div></div>
            {portal.attendance.length ? <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>{t('Date')}</th><th>{t('Status')}</th></tr></thead><tbody>
              {portal.attendance.map((row, index) => <tr key={`${row.date}-${index}`}><td>{new Date(row.date).toLocaleDateString(locale)}</td><td><span className={`workspace-status ${row.status.toLowerCase()}`}>{t(row.status)}</span></td></tr>)}
            </tbody></table></div> : <div className="workspace-empty">{t('No attendance records yet.')}</div>}
          </section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Family account')}</span><h2>{t('Payment history')}</h2></div></div>
            {portal.payments.length ? <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>{t('Amount')}</th><th>{t('Payment method')}</th><th>{t('Date')}</th><th>{t('Status')}</th></tr></thead><tbody>
              {portal.payments.map((row, index) => <tr key={`${row.date}-${index}`}><td>{new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency }).format(Number(row.amount))}</td><td>{t(row.paymentMethod)}</td><td>{new Date(row.date).toLocaleDateString(locale)}</td><td><span className={`workspace-status ${row.status.toLowerCase()}`}>{t(row.status)}</span></td></tr>)}
            </tbody></table></div> : <div className="workspace-empty">{t('No payment records yet.')}</div>}
          </section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('School calendar')}</span><h2>{t('Upcoming events')}</h2></div></div>
            {portal.events.length ? <div className="workspace-event-list">{portal.events.map((event) => <article className="workspace-event-card" key={`${event.title}-${event.date}`}>
              <div className="workspace-event-date"><strong>{new Date(event.date).toLocaleDateString(locale, { day: '2-digit' })}</strong><span>{new Date(event.date).toLocaleDateString(locale, { month: 'short' })}</span></div>
              <div className="workspace-event-copy"><strong>{t(event.title)}</strong><span>{new Date(event.date).toLocaleString(locale)}</span>{event.description && <p>{t(event.description)}</p>}</div>
            </article>)}</div> : <div className="workspace-empty">{t('No upcoming events have been scheduled.')}</div>}
          </section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Learning')}</span><h2>{t('Homework')}</h2></div></div>
            {portal.homework.length ? <div className="workspace-homework-list">{portal.homework.map((item) => {
              const submission = item.submissions[0]
              const isGraded = submission?.status === 'GRADED'
              return <article className="workspace-homework-card" key={item.id}>
                <div className="workspace-panel-heading">
                  <div><span className="workspace-kicker">{t('Due')} {new Date(item.dueDate).toLocaleString(locale)}</span><h3>{item.title}</h3></div>
                  {submission && <span className={`workspace-status ${submission.status.toLowerCase()}`}>{t(submission.status)}</span>}
                </div>
                {item.description && <p>{item.description}</p>}
                {item.instructions && <div className="workspace-homework-instructions"><strong>{t('Instructions')}</strong><p>{item.instructions}</p></div>}
                {item.attachments.map((attachment) => <p key={attachment.url}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.label}</a></p>)}
                {submission && <>
                  <p className="workspace-homework-response"><strong>{t('Your response')}</strong>{submission.submissionText ? ` ${submission.submissionText}` : ` ${t('File submitted')}`}</p>
                  {submission.attachments.map((file) => <button type="button" className="workspace-secondary-button" key={file.fileName} onClick={() => void downloadAsset(`/parent/homework/submissions/${submission.id}/files/${encodeURIComponent(file.fileName)}`, token, file.originalName).catch((downloadError: unknown) => setError(downloadError instanceof Error ? downloadError.message : t('Could not download file')))}>{t('Download')} {file.originalName}</button>)}
                  {isGraded && <div className="workspace-grade-feedback"><strong>{t('Score')}: {submission.grade}</strong>{submission.feedback && <p>{submission.feedback}</p>}</div>}
                </>}
                {!isGraded && <form className="workspace-inline-form workspace-grade-form" onSubmit={(event) => void submitHomework(event, item.id)}>
                  <label className="workspace-form-wide">{t('Written response')}<textarea name="text" rows={3} maxLength={8000} defaultValue={submission?.submissionText ?? ''} /></label>
                  <label className="workspace-form-wide">{t('Attach your completed work')}<input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
                  <small>{t('PNG, JPEG, WebP, or PDF. Maximum file size: 10 MB.')}</small>
                  <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busyHomeworkId === item.id}><Upload size={16} /> {busyHomeworkId === item.id ? t('Submitting…') : submission ? t('Update submission') : t('Submit homework')}</button></div>
                </form>}
              </article>
            })}</div> : <div className="workspace-empty">{t('No homework has been assigned to your child yet.')}</div>}
          </section>
        </>}
        <footer className="workspace-footer">{t('Read-only family view')}</footer>
      </main>
    </div>
  )
}
