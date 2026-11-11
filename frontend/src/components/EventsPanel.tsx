import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { useLocale } from '../lib/i18n'

type EventAudience = 'ALL' | 'PARENTS' | 'TEACHERS'
type EventRecord = {
  id: string
  title: string
  description: string | null
  date: string
  targetAudience: EventAudience
}

function localDateTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function EventsPanel({ token, canManage }: { token: string; canManage: boolean }) {
  const [events, setEvents] = useState<EventRecord[]>([])
  const [editing, setEditing] = useState<EventRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'

  const refresh = useCallback(async () => {
    try {
      setEvents(await apiRequest<EventRecord[]>('/events', token))
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load events')
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await apiRequest(editing ? `/events/${editing.id}` : '/events', token, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description') || null,
          date: data.get('date'),
          targetAudience: data.get('targetAudience'),
        }),
      })
      setShowForm(false)
      setEditing(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save event')
    } finally {
      setBusy(false)
    }
  }

  async function deleteEvent(record: EventRecord) {
    if (!window.confirm(`${t('Delete')} "${record.title}"? ${t('This action cannot be undone.')}`)) return
    setBusy(true)
    setError('')
    try {
      await apiRequest<void>(`/events/${record.id}`, token, { method: 'DELETE' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete event')
    } finally {
      setBusy(false)
    }
  }

  const [todayStart] = useState(() => new Date().setHours(0, 0, 0, 0))
  const upcoming = events.filter((event) => new Date(event.date).getTime() >= todayStart)

  return (
    <section className="workspace-panel" id="events">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t('What’s coming up')}</span>
          <h2>{t('Calendar & events')}</h2>
        </div>
        {canManage && <button type="button" className="workspace-primary-button" onClick={() => {
          setEditing(null)
          setShowForm(true)
        }}><Plus size={17} /> {t('Add event')}</button>}
      </div>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      {showForm && canManage && (
        <form className="workspace-inline-form" onSubmit={(event) => void saveEvent(event)}>
          <label>{t('Event title')}<input name="title" required maxLength={160} defaultValue={editing?.title ?? ''} /></label>
          <label>{t('Date and time')}<input name="date" type="datetime-local" required defaultValue={localDateTime(editing?.date)} /></label>
          <label>{t('Audience')}
            <select name="targetAudience" defaultValue={editing?.targetAudience ?? 'ALL'}>
              <option value="ALL">{t('Everyone')}</option>
              <option value="PARENTS">{t('Parents')}</option>
              <option value="TEACHERS">{t('Teachers')}</option>
            </select>
          </label>
          <label>{t('Description')}<input name="description" maxLength={2000} defaultValue={editing?.description ?? ''} /></label>
          <div className="workspace-form-actions">
            <button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : editing ? t('Update event') : t('Create event')}</button>
            <button type="button" className="workspace-secondary-button" onClick={() => {
              setShowForm(false)
              setEditing(null)
            }}>{t('Cancel')}</button>
          </div>
        </form>
      )}
      {upcoming.length ? (
        <div className="workspace-event-list">
          {upcoming.map((event) => (
            <article className="workspace-event-card" key={event.id}>
              <div className="workspace-event-date">
                <strong>{new Date(event.date).toLocaleDateString(locale, { day: '2-digit' })}</strong>
                <span>{new Date(event.date).toLocaleDateString(locale, { month: 'short' })}</span>
              </div>
              <div className="workspace-event-copy">
                <strong>{t(event.title)}</strong>
                <span><CalendarDays size={14} /> {new Date(event.date).toLocaleString(locale)} · {t(event.targetAudience === 'ALL' ? 'Everyone' : event.targetAudience === 'PARENTS' ? 'Parents' : 'Teachers')}</span>
                {event.description && <p>{t(event.description)}</p>}
              </div>
              {canManage && <div className="workspace-row-actions">
                <button type="button" aria-label={`${t('Edit')} ${event.title}`} onClick={() => {
                  setEditing(event)
                  setShowForm(true)
                }}><Pencil size={15} /></button>
                <button type="button" className="workspace-danger-button" disabled={busy} aria-label={`${t('Delete')} ${event.title}`} onClick={() => void deleteEvent(event)}><Trash2 size={15} /></button>
              </div>}
            </article>
          ))}
        </div>
      ) : <div className="workspace-empty">{t('No upcoming events have been scheduled.')}</div>}
    </section>
  )
}
