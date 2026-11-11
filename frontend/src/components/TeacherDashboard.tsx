import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookOpenCheck, ClipboardList, GraduationCap, LogOut, Users } from 'lucide-react'
import type { AuthSession } from '../App'
import { apiRequest, downloadAsset } from '../lib/api'
import { LanguageToggle, useLocale } from '../lib/i18n'
import { AIAssistant } from './AIAssistant'

type Classroom = { id: string; name: string }
type Student = { id: string; fullName: string }
type HomeworkAttachment = { label: string; url: string }
type SubmissionFile = { fileName: string; originalName: string; mimeType: string; size: number }
type Submission = {
  id: string
  child: Student
  status: 'SUBMITTED' | 'GRADED'
  submittedAt: string
  submissionText: string | null
  attachments: SubmissionFile[]
  grade: string | number | null
  feedback: string | null
}
type Homework = {
  id: string
  title: string
  description: string
  instructions: string
  dueDate: string
  classroom: Classroom
  attachments: HomeworkAttachment[]
  submissions: Submission[]
}
type TeacherData = { classrooms: Classroom[]; students: Student[]; homework: Homework[] }
type Page = 'classrooms' | 'homework' | 'grading'

function pageFromHash(): Page {
  const page = window.location.hash.slice(1)
  return page === 'homework' || page === 'grading' ? page : 'classrooms'
}

export function TeacherDashboard({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [data, setData] = useState<TeacherData>({ classrooms: [], students: [], homework: [] })
  const [page, setPage] = useState<Page>(pageFromHash)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'

  const refresh = useCallback(async () => {
    try {
      setData(await apiRequest<TeacherData>('/homework', session.token))
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('Could not load teacher workspace'))
    }
  }, [session.token, t])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])
  useEffect(() => {
    const handleNavigation = () => setPage(pageFromHash())
    window.addEventListener('hashchange', handleNavigation)
    window.addEventListener('popstate', handleNavigation)
    return () => {
      window.removeEventListener('hashchange', handleNavigation)
      window.removeEventListener('popstate', handleNavigation)
    }
  }, [])

  function navigate(nextPage: Page, event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    setPage(nextPage)
    if (window.location.hash !== `#${nextPage}`) window.history.pushState(null, '', `#${nextPage}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function createHomework(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const links = String(formData.get('links') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await apiRequest('/homework', session.token, {
        method: 'POST',
        body: JSON.stringify({
          classroomId: formData.get('classroomId'),
          title: formData.get('title'),
          description: formData.get('description'),
          instructions: formData.get('instructions'),
          dueDate: formData.get('dueDate'),
          attachments: links.map((url) => ({ label: url, url })),
        }),
      })
      form.reset()
      setNotice(t('Homework created successfully.'))
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('Could not create homework'))
    } finally {
      setBusy(false)
    }
  }

  async function gradeSubmission(event: FormEvent<HTMLFormElement>, submissionId: string) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/homework/submissions/${submissionId}`, session.token, {
        method: 'PATCH',
        body: JSON.stringify({ grade: values.get('grade'), feedback: values.get('feedback') }),
      })
      setNotice(t('Grade saved.'))
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('Could not save grade'))
    } finally {
      setBusy(false)
    }
  }

  const submissionCount = data.homework.reduce((count, item) => count + item.submissions.length, 0)
  const pendingCount = data.homework.reduce((count, item) => count + item.submissions.filter((submission) => submission.status === 'SUBMITTED').length, 0)

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="workspace-brand-mark"><GraduationCap size={22} /></div>
          <div><span className="workspace-brand-caption">{t('Teacher portal')}</span><strong title={session.tenant.name}>{session.tenant.name}</strong></div>
        </div>
        <nav className="workspace-nav" aria-label={t('Teacher navigation')}>
          <a className={`workspace-nav-item${page === 'classrooms' ? ' active' : ''}`} href="#classrooms" onClick={(event) => navigate('classrooms', event)}><Users size={18} /> {t('My classroom')}</a>
          <a className={`workspace-nav-item${page === 'homework' ? ' active' : ''}`} href="#homework" onClick={(event) => navigate('homework', event)}><BookOpenCheck size={18} /> {t('Homework')}</a>
          <a className={`workspace-nav-item${page === 'grading' ? ' active' : ''}`} href="#grading" onClick={(event) => navigate('grading', event)}><ClipboardList size={18} /> {t('Grading')}</a>
        </nav>
        <div className="workspace-sidebar-bottom">
          <div className="workspace-user">
            <div className="workspace-avatar">{session.user.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div className="workspace-user-details"><strong>{session.user.fullName}</strong><span>{t('Teacher')}</span></div>
          </div>
          <button type="button" className="workspace-logout" onClick={onLogout}><LogOut size={15} /> {t('Sign out')}</button>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <div>
            <div className="workspace-kicker">{t('Teacher portal')}</div>
            <h1>{t(page === 'classrooms' ? 'My classroom' : page === 'homework' ? 'Homework' : 'Grading')}</h1>
            <p>{session.user.fullName} <span aria-hidden="true">·</span> {session.tenant.name}</p>
          </div>
          <div className="workspace-header-controls"><LanguageToggle /><button type="button" className="workspace-notification" onClick={onLogout} aria-label={t('Sign out')}><LogOut size={18} /></button></div>
        </header>
        {error && <div className="workspace-error" role="alert">{t(error)}</div>}
        {notice && <div className="workspace-success" role="status">{t(notice)}</div>}

        {page === 'classrooms' && (
          <>
            <section className="workspace-stats" aria-label={t('Teacher summary')}>
              <article className="workspace-stat-card"><div className="workspace-stat-icon"><Users size={18} /></div><span>{t('Assigned classrooms')}</span><strong>{data.classrooms.length}</strong></article>
              <article className="workspace-stat-card"><div className="workspace-stat-icon"><GraduationCap size={18} /></div><span>{t('My students')}</span><strong>{data.students.length}</strong></article>
              <article className="workspace-stat-card"><div className="workspace-stat-icon"><BookOpenCheck size={18} /></div><span>{t('Homework assignments')}</span><strong>{data.homework.length}</strong></article>
              <article className="workspace-stat-card"><div className="workspace-stat-icon"><ClipboardList size={18} /></div><span>{t('To grade')}</span><strong>{pendingCount}</strong></article>
            </section>
            {data.classrooms.length ? data.classrooms.map((classroom) => (
              <section className="workspace-panel" key={classroom.id}>
                <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Assigned classroom')}</span><h2>{classroom.name}</h2></div></div>
                {data.students.length ? <div className="workspace-classroom-grid">{data.students.map((student) => (
                  <article className="workspace-classroom-card" key={student.id}><div className="workspace-classroom-icon"><GraduationCap size={19} /></div><strong>{student.fullName}</strong><span>{t('Student')}</span></article>
                ))}</div> : <div className="workspace-empty">{t('No students are assigned to your classroom yet.')}</div>}
              </section>
            )) : <div className="workspace-empty">{t('No classroom is assigned to your teacher account. Ask an administrator to assign your staff record to a classroom using your login email.')}</div>}
          </>
        )}

        {page === 'homework' && (
          <>
            <section className="workspace-panel">
              <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Create assignment')}</span><h2>{t('New homework')}</h2></div></div>
              {data.classrooms.length ? <form className="workspace-inline-form" onSubmit={(event) => void createHomework(event)}>
                <label>{t('Classroom')}<select name="classroomId" required defaultValue={data.classrooms[0].id}>{data.classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}</select></label>
                <label>{t('Title')}<input name="title" required minLength={2} maxLength={160} /></label>
                <label>{t('Due date')}<input name="dueDate" type="datetime-local" required /></label>
                <label className="workspace-form-wide">{t('Description')}<textarea name="description" rows={3} maxLength={4000} /></label>
                <label className="workspace-form-wide">{t('Instructions')}<textarea name="instructions" rows={4} maxLength={8000} /></label>
                <label className="workspace-form-wide">{t('Reference links')}<textarea name="links" rows={2} placeholder="https://example.com/resource (one link per line)" /></label>
                <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : t('Publish homework')}</button></div>
              </form> : <div className="workspace-empty">{t('Assign this teacher to a classroom before creating homework.')}</div>}
            </section>
            <section className="workspace-panel">
              <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Assignments')}</span><h2>{t('Published homework')}</h2></div></div>
              {data.homework.length ? <div className="workspace-homework-list">{data.homework.map((item) => (
                <article className="workspace-homework-card" key={item.id}>
                  <div className="workspace-panel-heading"><div><span className="workspace-kicker">{item.classroom.name}</span><h3>{item.title}</h3></div><span className="workspace-status">{t('Due')} {new Date(item.dueDate).toLocaleString(locale)}</span></div>
                  {item.description && <p>{item.description}</p>}
                  {item.instructions && <div className="workspace-homework-instructions"><strong>{t('Instructions')}</strong><p>{item.instructions}</p></div>}
                  {item.attachments.map((attachment) => <p key={attachment.url}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.label}</a></p>)}
                  <small>{item.submissions.length} {t('submissions')}</small>
                </article>
              ))}</div> : <div className="workspace-empty">{t('No homework has been published yet.')}</div>}
            </section>
          </>
        )}

        {page === 'grading' && (
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span className="workspace-kicker">{t('Review student work')}</span><h2>{t('Homework submissions')}</h2></div><span className="overview-chart-total">{pendingCount} {t('to grade')}</span></div>
            {submissionCount ? <div className="workspace-homework-list">{data.homework.flatMap((item) => item.submissions.map((submission) => (
              <article className="workspace-homework-card" key={submission.id}>
                <div className="workspace-panel-heading"><div><span className="workspace-kicker">{item.title} · {item.classroom.name}</span><h3>{submission.child.fullName}</h3></div><span className={`workspace-status ${submission.status.toLowerCase()}`}>{t(submission.status)}</span></div>
                <small>{t('Submitted')} {new Date(submission.submittedAt).toLocaleString(locale)}</small>
                {submission.submissionText && <p className="workspace-homework-response">{submission.submissionText}</p>}
                {submission.attachments.map((file) => <button type="button" className="workspace-secondary-button" key={file.fileName} onClick={() => void downloadAsset(`/homework/submissions/${submission.id}/files/${encodeURIComponent(file.fileName)}`, session.token, file.originalName).catch((downloadError: unknown) => setError(downloadError instanceof Error ? downloadError.message : t('Could not download file')))}>{t('Download')} {file.originalName}</button>)}
                <form className="workspace-inline-form workspace-grade-form" onSubmit={(event) => void gradeSubmission(event, submission.id)}>
                  <label>{t('Score (0-100)')}<input name="grade" type="number" min="0" max="100" step="0.1" required defaultValue={submission.grade ?? ''} /></label>
                  <label className="workspace-form-wide">{t('Feedback')}<textarea name="feedback" rows={3} maxLength={4000} defaultValue={submission.feedback ?? ''} /></label>
                  <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : t('Save grade')}</button></div>
                </form>
              </article>
            )))}</div> : <div className="workspace-empty">{t('There are no homework submissions to grade yet.')}</div>}
          </section>
        )}
        <footer className="workspace-footer">{t('Teacher workspace · assigned classrooms only')}</footer>
        <AIAssistant token={session.token} role="TEACHER" />
      </main>
    </div>
  )
}
