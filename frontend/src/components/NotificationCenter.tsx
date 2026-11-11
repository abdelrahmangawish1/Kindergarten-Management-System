import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { useLocale } from '../lib/i18n'

type NotificationRecord = { id: string; title: string; message: string; isRead: boolean; date: string }

export function NotificationCenter({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const { t, language } = useLocale()
  const unreadCount = notifications.filter((notification) => !notification.isRead).length

  const refresh = useCallback(async () => {
    try {
      setNotifications(await apiRequest<NotificationRecord[]>('/notifications', token))
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load notifications')
    }
  }, [token])

  useEffect(() => {
    queueMicrotask(() => { void refresh() })
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function markRead(id: string) {
    try {
      await apiRequest(`/notifications/${id}/read`, token, { method: 'PATCH' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update notification')
    }
  }

  async function markAllRead() {
    try {
      await apiRequest('/notifications/read-all', token, { method: 'POST' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update notifications')
    }
  }

  return (
    <div className="workspace-notification-wrap">
      <button type="button" className="workspace-notification" aria-label={`${t('Notifications')} (${unreadCount})`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Bell size={18} />
        {unreadCount > 0 && <span className="workspace-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <div className="workspace-notification-menu" role="dialog" aria-label={t('Notifications')}>
        <div className="workspace-notification-heading"><strong>{t('Notifications')}</strong><button type="button" onClick={() => void markAllRead()} disabled={!unreadCount}><CheckCheck size={15} /> {t('Mark all as read')}</button></div>
        {error && <div className="workspace-error" role="alert">{t(error)}</div>}
        {notifications.length ? <div className="workspace-notification-list">{notifications.map((notification) => (
          <button type="button" className={`workspace-notification-item${notification.isRead ? '' : ' unread'}`} key={notification.id} onClick={() => !notification.isRead && void markRead(notification.id)}>
            <strong>{t(notification.title)}</strong><span>{t(notification.message)}</span><small>{new Date(notification.date).toLocaleString(language === 'ar' ? 'ar' : 'en')}</small>
          </button>
        ))}</div> : <div className="workspace-empty">{t('No notifications yet.')}</div>}
      </div>}
    </div>
  )
}
