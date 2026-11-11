import { useCallback, useEffect, useState } from 'react'
import { CircleDollarSign, FileDown, Pencil, Plus, Receipt, Trash2, TrendingUp, Wallet } from 'lucide-react'
import type { AuthSession } from '../App'
import { apiRequest, downloadReport } from '../lib/api'
import { useLocale } from '../lib/i18n'

type PaymentRecord = {
  id: string
  childId: string | null
  amount: number | string
  currency: string
  paymentMethod: string
  status: 'PAID' | 'PENDING' | 'OVERDUE'
  date: string
  reference: string | null
  child: { fullName: string } | null
}
type ExpenseRecord = {
  id: string
  title: string
  amount: number | string
  category: string
  date: string
  notes: string | null
}
type FinanceSummary = {
  totalRevenue: number
  totalExpenses: number
  netBalance: number
  pendingPayments: number
}
type ChildRecord = { id: string; fullName: string }

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDate(value: string, locale: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(locale)
}

function money(value: number | string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value))
}

export function FinancePanel({ session, students }: { session: AuthSession; students: ChildRecord[] }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [expenseFilter, setExpenseFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'
  const currency = session.tenant.settings?.currency ?? 'USD'

  const refresh = useCallback(async () => {
    try {
      const [financeSummary, paymentRows, expenseRows] = await Promise.all([
        apiRequest<FinanceSummary>('/finance/summary', session.token),
        apiRequest<PaymentRecord[]>('/payments', session.token),
        apiRequest<ExpenseRecord[]>('/finance/expenses', session.token),
      ])
      setSummary(financeSummary)
      setPayments(paymentRows)
      setExpenses(expenseRows)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load financial records')
    }
  }, [session.token])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await apiRequest(editingPayment ? `/payments/${editingPayment.id}` : '/payments', session.token, {
        method: editingPayment ? 'PATCH' : 'POST',
        body: JSON.stringify({
          childId: data.get('childId') || null,
          amount: Number(data.get('amount')),
          currency: data.get('currency'),
          paymentMethod: data.get('paymentMethod'),
          status: data.get('status'),
          date: data.get('date'),
          reference: data.get('reference') || null,
        }),
      })
      setShowPaymentForm(false)
      setEditingPayment(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save payment')
    } finally {
      setBusy(false)
    }
  }

  async function saveExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await apiRequest(editingExpense ? `/finance/expenses/${editingExpense.id}` : '/finance/expenses', session.token, {
        method: editingExpense ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: data.get('title'),
          amount: Number(data.get('amount')),
          category: data.get('category'),
          date: data.get('date'),
          notes: data.get('notes') || null,
        }),
      })
      setShowExpenseForm(false)
      setEditingExpense(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save expense')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRecord(path: string, label: string) {
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

  async function exportFinance(format: 'pdf' | 'xlsx') {
    setExporting(true)
    setError('')
    try {
      await downloadReport(`/reports/finance.${format}`, session.token, `finance-report.${format}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not export finance report')
    } finally {
      setExporting(false)
    }
  }

  const categories = [...new Set(expenses.map((expense) => expense.category))].sort()
  const visibleExpenses = expenseFilter
    ? expenses.filter((expense) => expense.category === expenseFilter)
    : expenses

  return (
    <section className="workspace-panel" id="finance">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t('Workspace accounting')}</span>
          <h2>{t('Finance & payments')}</h2>
        </div>
        <div className="workspace-panel-actions">
          <button type="button" className="workspace-secondary-button" disabled={exporting} onClick={() => void exportFinance('pdf')}><FileDown size={16} /> {t('Download PDF')}</button>
          <button type="button" className="workspace-secondary-button" disabled={exporting} onClick={() => void exportFinance('xlsx')}><FileDown size={16} /> {t('Download Excel')}</button>
        </div>
      </div>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      <div className="workspace-finance-summary">
        <FinanceCard label={t('Total revenue')} value={summary?.totalRevenue ?? 0} currency={currency} icon={<TrendingUp size={19} />} />
        <FinanceCard label={t('Total expenses')} value={summary?.totalExpenses ?? 0} currency={currency} icon={<Receipt size={19} />} />
        <FinanceCard label={t('Net profit')} value={summary?.netBalance ?? 0} currency={currency} icon={<Wallet size={19} />} />
        <FinanceCard label={t('Pending dues')} value={summary?.pendingPayments ?? 0} currency={currency} icon={<CircleDollarSign size={19} />} />
      </div>

      <div className="workspace-finance-section">
        <div className="workspace-panel-heading">
          <div><span className="workspace-kicker">{t('Tuition & fees')}</span><h3>{t('Income and payments')}</h3></div>
          <button type="button" className="workspace-primary-button" onClick={() => {
            setEditingPayment(null)
            setShowPaymentForm(true)
          }}><Plus size={17} /> {t('Record payment')}</button>
        </div>
        {payments.length ? (
          <div className="workspace-table-scroll">
            <table className="workspace-table">
              <thead><tr><th>{t('Student')}</th><th>{t('Amount')}</th><th>{t('Payment method')}</th><th>{t('Date')}</th><th>{t('Status')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>{payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.child?.fullName ?? t('General payment')}</strong></td>
                  <td>{money(payment.amount, payment.currency, locale)}</td>
                  <td>{payment.paymentMethod}</td>
                  <td>{formatDate(payment.date, locale)}</td>
                  <td><span className={`workspace-status ${payment.status.toLowerCase()}`}>{t(payment.status)}</span></td>
                  <td><div className="workspace-row-actions">
                    <button type="button" aria-label="Edit payment" onClick={() => {
                      setEditingPayment(payment)
                      setShowPaymentForm(true)
                    }}><Pencil size={15} /></button>
                    <button type="button" className="workspace-danger-button" disabled={busy} aria-label="Delete payment" onClick={() => void deleteRecord(`/payments/${payment.id}`, 'payment')}><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="workspace-empty">{t('No payments have been recorded.')}</div>}
      </div>

      <div className="workspace-finance-section">
        <div className="workspace-panel-heading">
          <div><span className="workspace-kicker">{t('Operations')}</span><h3>{t('Expenses')}</h3></div>
          <div className="workspace-finance-actions">
            <label className="workspace-category-filter">{t('Category')}
              <select value={expenseFilter} onChange={(event) => setExpenseFilter(event.target.value)}>
                <option value="">{t('All categories')}</option>
                {categories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
            </label>
            <button type="button" className="workspace-secondary-button" onClick={() => {
              setEditingExpense(null)
              setShowExpenseForm(true)
            }}><Plus size={17} /> {t('Add expense')}</button>
          </div>
        </div>
        {visibleExpenses.length ? (
          <div className="workspace-table-scroll">
            <table className="workspace-table">
              <thead><tr><th>{t('Expense')}</th><th>{t('Category')}</th><th>{t('Amount')}</th><th>{t('Date')}</th><th>{t('Notes')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>{visibleExpenses.map((expense) => (
                <tr key={expense.id}>
                  <td><strong>{expense.title}</strong></td>
                  <td>{expense.category}</td>
                  <td>{money(expense.amount, currency, locale)}</td>
                  <td>{formatDate(expense.date, locale)}</td>
                  <td>{expense.notes || '—'}</td>
                  <td><div className="workspace-row-actions">
                    <button type="button" aria-label={`Edit ${expense.title}`} onClick={() => {
                      setEditingExpense(expense)
                      setShowExpenseForm(true)
                    }}><Pencil size={15} /></button>
                    <button type="button" className="workspace-danger-button" disabled={busy} aria-label={`Delete ${expense.title}`} onClick={() => void deleteRecord(`/finance/expenses/${expense.id}`, 'expense')}><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="workspace-empty">{t('No expenses have been recorded.')}</div>}
      </div>

      {showPaymentForm && <div className="workspace-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowPaymentForm(false)
      }}>
        <form className="workspace-modal" onSubmit={(event) => void savePayment(event)}>
          <div className="workspace-modal-heading"><div><span className="workspace-kicker">{t('Tuition & fees')}</span><h3>{editingPayment ? t('Update payment') : t('Record payment')}</h3></div><button type="button" className="workspace-modal-close" onClick={() => setShowPaymentForm(false)} aria-label={t('Close')}>×</button></div>
          <label>{t('Student')}
            <select name="childId" defaultValue={editingPayment?.childId ?? ''}>
              <option value="">{t('General payment')}</option>
              {students.map((child) => <option key={child.id} value={child.id}>{child.fullName}</option>)}
            </select>
          </label>
          <label>{t('Amount')}<input name="amount" required type="number" min="0.01" max="10000000" step="0.01" defaultValue={editingPayment?.amount ?? ''} /></label>
          <label>{t('Currency')}<input name="currency" required minLength={3} maxLength={3} defaultValue={editingPayment?.currency ?? currency} /></label>
          <label>{t('Payment method')}<input name="paymentMethod" required maxLength={40} defaultValue={editingPayment?.paymentMethod ?? ''} placeholder={t('Cash, bank transfer, card…')} /></label>
          <label>{t('Status')}<select name="status" defaultValue={editingPayment?.status ?? 'PAID'}><option value="PAID">{t('PAID')}</option><option value="PENDING">{t('PENDING')}</option><option value="OVERDUE">{t('OVERDUE')}</option></select></label>
          <label>{t('Payment date')}<input name="date" type="date" required defaultValue={editingPayment?.date.slice(0, 10) ?? today()} /></label>
          <label>{t('Reference')}<input name="reference" maxLength={120} defaultValue={editingPayment?.reference ?? ''} /></label>
          <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : t('Save payment')}</button><button type="button" className="workspace-secondary-button" onClick={() => setShowPaymentForm(false)}>{t('Cancel')}</button></div>
        </form>
      </div>}

      {showExpenseForm && <div className="workspace-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowExpenseForm(false)
      }}>
        <form className="workspace-modal" onSubmit={(event) => void saveExpense(event)}>
          <div className="workspace-modal-heading"><div><span className="workspace-kicker">{t('Operations')}</span><h3>{editingExpense ? t('Update expense') : t('Add expense')}</h3></div><button type="button" className="workspace-modal-close" onClick={() => setShowExpenseForm(false)} aria-label={t('Close')}>×</button></div>
          <label>{t('Expense title')}<input name="title" required maxLength={160} defaultValue={editingExpense?.title ?? ''} /></label>
          <label>{t('Amount')}<input name="amount" required type="number" min="0.01" max="100000000" step="0.01" defaultValue={editingExpense?.amount ?? ''} /></label>
          <label>{t('Category')}<input name="category" required maxLength={80} defaultValue={editingExpense?.category ?? ''} placeholder={t('Supplies, rent, meals…')} /></label>
          <label>{t('Date')}<input name="date" type="date" required defaultValue={editingExpense?.date.slice(0, 10) ?? today()} /></label>
          <label>{t('Notes')}<input name="notes" maxLength={1000} defaultValue={editingExpense?.notes ?? ''} /></label>
          <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : t('Save expense')}</button><button type="button" className="workspace-secondary-button" onClick={() => setShowExpenseForm(false)}>{t('Cancel')}</button></div>
        </form>
      </div>}
    </section>
  )
}

function FinanceCard({ label, value, currency, icon }: { label: string; value: number; currency: string; icon: React.ReactNode }) {
  const { language } = useLocale()
  return <article className="workspace-finance-card"><div className="workspace-stat-icon">{icon}</div><span>{label}</span><strong>{money(value, currency, language === 'ar' ? 'ar' : 'en')}</strong></article>
}
