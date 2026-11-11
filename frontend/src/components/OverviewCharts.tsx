import { useState } from 'react'
import { useLocale } from '../lib/i18n'

type PaymentRecord = {
  amount: number | string
  status: string
  date: string
}

type EnrollmentRecord = {
  status: string
}

type ClassroomRecord = {
  id: string
  name: string
  capacity: number
  _count?: { children: number }
}

type Props = {
  payments: PaymentRecord[]
  enrollments: EnrollmentRecord[]
  classrooms: ClassroomRecord[]
  currency: string
  canViewFinance: boolean
}

const enrollmentStatuses = ['ACTIVE', 'INACTIVE', 'COMPLETED'] as const

export function OverviewCharts({ payments, enrollments, classrooms, currency, canViewFinance }: Props) {
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'
  const [today] = useState(() => new Date())
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1)
    return {
      date,
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      total: 0,
    }
  })

  for (const payment of payments) {
    if (payment.status !== 'PAID') continue
    const monthKey = payment.date.slice(0, 7)
    const month = months.find((item) => item.key === monthKey)
    if (month) month.total += Number(payment.amount)
  }

  const maximumRevenue = Math.max(...months.map(({ total }) => total), 1)
  const statusCounts = enrollmentStatuses.map((status) => ({
    status,
    count: enrollments.filter((enrollment) => enrollment.status === status).length,
  }))
  const maximumEnrollments = Math.max(...statusCounts.map(({ count }) => count), 1)

  return (
    <section className="overview-charts" aria-label={t('Workspace charts')}>
      {canViewFinance && (
        <article className="overview-chart-card">
          <div className="overview-chart-heading">
            <div>
              <span className="workspace-kicker">{t('Financial performance')}</span>
              <h2>{t('Revenue trend')}</h2>
            </div>
            <span className="overview-chart-total">
              {new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
                .format(months.reduce((sum, month) => sum + month.total, 0))}
            </span>
          </div>
          {payments.length ? (
            <div className="overview-revenue-chart" role="img" aria-label={t('Paid revenue by month for the last six months')}>
              {months.map((month) => (
                <div className="overview-revenue-column" key={month.key}>
                  <span className="overview-chart-value">
                    {new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(month.total)}
                  </span>
                  <div className="overview-revenue-track">
                    <span style={{ height: `${Math.max((month.total / maximumRevenue) * 100, month.total ? 8 : 3)}%` }} />
                  </div>
                  <span className="overview-chart-label">
                    {month.date.toLocaleDateString(locale, { month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">{t('No revenue data is available for this period.')}</div>
          )}
        </article>
      )}

      <article className="overview-chart-card">
        <div className="overview-chart-heading">
          <div>
            <span className="workspace-kicker">{t('Student records')}</span>
            <h2>{t('Enrollment status')}</h2>
          </div>
          <span className="overview-chart-total">{enrollments.length}</span>
        </div>
        {enrollments.length ? (
          <div className="overview-enrollment-chart" role="img" aria-label={t('Enrollment status distribution')}>
            {statusCounts.map(({ status, count }) => (
              <div className="overview-enrollment-row" key={status}>
                <div className="overview-enrollment-label">
                  <span>{t(status)}</span>
                  <strong>{count}</strong>
                </div>
                <div className="overview-enrollment-track">
                  <span className={`overview-enrollment-bar ${status.toLowerCase()}`} style={{ width: `${(count / maximumEnrollments) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="workspace-empty">{t('No enrollment data is available yet.')}</div>
        )}
      </article>

      <article className="overview-chart-card">
        <div className="overview-chart-heading">
          <div>
            <span className="workspace-kicker">{t('Learning spaces')}</span>
            <h2>{t('Classroom capacity')}</h2>
          </div>
        </div>
        {classrooms.length ? (
          <div className="overview-capacity-chart" role="img" aria-label={t('Children enrolled per classroom')}>
            {classrooms.map((classroom) => {
              const children = classroom._count?.children ?? 0
              const percentage = classroom.capacity > 0 ? Math.min((children / classroom.capacity) * 100, 100) : 0
              return (
                <div className="overview-capacity-row" key={classroom.id}>
                  <div className="overview-enrollment-label">
                    <span>{classroom.name}</span>
                    <strong>{children} / {classroom.capacity}</strong>
                  </div>
                  <div className="overview-enrollment-track">
                    <span className="overview-capacity-bar" style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="workspace-empty">{t('No classrooms have been created yet.')}</div>
        )}
      </article>
    </section>
  )
}
