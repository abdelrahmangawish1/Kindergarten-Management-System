import { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { useLocale } from '../lib/i18n'

type StaffRole = 'TEACHER' | 'ADMIN' | 'SUPPORT'
type StaffRecord = {
  id: string
  name: string
  email: string
  phone: string | null
  role: StaffRole
  specialization: string | null
  salary: string | number | null
  hireDate: string
  classroomId: string | null
  classroom: { id: string; name: string } | null
  classroomAssignments: { classroomId: string; classroom: { id: string; name: string } }[]
}
type Classroom = { id: string; name: string }

export function StaffPanel({ token }: { token: string }) {
  const [staff, setStaff] = useState<StaffRecord[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [editing, setEditing] = useState<StaffRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { t, language } = useLocale()
  const locale = language === 'ar' ? 'ar' : 'en'

  const refresh = useCallback(async () => {
    try {
      const [staffRows, classroomRows] = await Promise.all([
        apiRequest<StaffRecord[]>('/staff', token),
        apiRequest<Classroom[]>('/classrooms', token),
      ])
      setStaff(staffRows)
      setClassrooms(classroomRows)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load staff')
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function saveStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await apiRequest(editing ? `/staff/${editing.id}` : '/staff', token, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          classroomIds: data.getAll('classroomIds'),
          phone: data.get('phone') || null,
          role: data.get('role'),
          specialization: data.get('specialization') || null,
          salary: data.get('salary') ? Number(data.get('salary')) : null,
          hireDate: data.get('hireDate'),
        }),
      })
      setShowForm(false)
      setEditing(null)
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save staff record')
    } finally {
      setBusy(false)
    }
  }

  async function importFile(file?: File) {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const result = await apiRequest<{ imported: number }>('/imports/staff', token, { method: 'POST', body: formData })
      setNotice(t('Imported') + ` ${result.imported} ` + t('staff members'))
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not import staff')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function removeStaff(record: StaffRecord) {
    if (!window.confirm(`${t('Delete')} ${record.name}?`)) return
    setBusy(true)
    setError('')
    try {
      await apiRequest<void>(`/staff/${record.id}`, token, { method: 'DELETE' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete staff record')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="workspace-panel" id="staff">
      <div className="workspace-panel-heading">
        <div><span className="workspace-kicker">{t('Staff management')}</span><h2>{t('Teachers / Staff')}</h2></div>
        <div className="workspace-panel-actions">
          <input ref={fileInput} className="workspace-visually-hidden" type="file" accept=".csv,.xlsx" onChange={(event) => void importFile(event.target.files?.[0])} />
          <button type="button" className="workspace-secondary-button" disabled={busy} onClick={() => fileInput.current?.click()}><FileUp size={16} /> {t('Import CSV / Excel')}</button>
          <button type="button" className="workspace-primary-button" onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}><Plus size={17} /> {t('Add teacher')}</button>
        </div>
      </div>
      {error && <div className="workspace-error" role="alert">{t(error)}</div>}
      {notice && <div className="workspace-success" role="status">{notice}</div>}
      {showForm && <div className="workspace-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowForm(false)
      }}>
        <form className="workspace-modal" onSubmit={(event) => void saveStaff(event)}>
          <div className="workspace-modal-heading"><div><span className="workspace-kicker">{t('Staff management')}</span><h3>{editing ? t('Edit staff member') : t('Add teacher')}</h3></div><button type="button" className="workspace-modal-close" onClick={() => setShowForm(false)} aria-label={t('Close')}>×</button></div>
          <label>{t('Name')}<input name="name" required minLength={2} maxLength={120} defaultValue={editing?.name ?? ''} /></label>
          <label>{t('Email')}<input name="email" required type="email" maxLength={254} defaultValue={editing?.email ?? ''} /></label>
          <label>{t('Phone')}<input name="phone" maxLength={40} defaultValue={editing?.phone ?? ''} /></label>
          <label>{t('Role')}<select name="role" defaultValue={editing?.role ?? 'TEACHER'}><option value="TEACHER">{t('Teacher')}</option><option value="ADMIN">{t('Admin')}</option><option value="SUPPORT">{t('Support')}</option></select></label>
          <label>{t('Assigned classrooms')}<select name="classroomIds" multiple size={Math.min(Math.max(classrooms.length, 2), 5)} defaultValue={editing?.classroomAssignments.map(({ classroom }) => classroom.id) ?? (editing?.classroomId ? [editing.classroomId] : [])}>{classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}</select></label>
          <label>{t('Specialization')}<input name="specialization" maxLength={120} defaultValue={editing?.specialization ?? ''} /></label>
          <label>{t('Salary')}<input name="salary" type="number" min="0" max="100000000" step="0.01" defaultValue={editing?.salary ?? ''} /></label>
          <label>{t('Hire date')}<input name="hireDate" type="date" required defaultValue={editing?.hireDate.slice(0, 10) ?? ''} /></label>
          <div className="workspace-form-actions"><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button><button type="button" className="workspace-secondary-button" onClick={() => setShowForm(false)}>{t('Cancel')}</button></div>
        </form>
      </div>}
      {staff.length ? <div className="workspace-table-scroll"><table className="workspace-table">
        <thead><tr><th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Phone')}</th><th>{t('Role')}</th><th>{t('Assigned classroom')}</th><th>{t('Specialization')}</th><th>{t('Salary')}</th><th>{t('Hire date')}</th><th>{t('Actions')}</th></tr></thead>
        <tbody>{staff.map((record) => <tr key={record.id}>
          <td><strong>{record.name}</strong></td><td>{record.email}</td><td>{record.phone ?? '—'}</td>
          <td><span className="workspace-status">{t(record.role)}</span></td><td>{record.classroomAssignments.map(({ classroom }) => classroom.name).join(', ') || record.classroom?.name || '—'}</td><td>{record.specialization ?? '—'}</td>
          <td>{record.salary === null ? '—' : Number(record.salary).toLocaleString(locale)}</td>
          <td>{new Date(record.hireDate).toLocaleDateString(locale)}</td>
          <td><div className="workspace-row-actions"><button type="button" aria-label={`${t('Edit')} ${record.name}`} onClick={() => {
            setEditing(record)
            setShowForm(true)
          }}><Pencil size={15} /></button><button type="button" className="workspace-danger-button" disabled={busy} aria-label={`${t('Delete')} ${record.name}`} onClick={() => void removeStaff(record)}><Trash2 size={15} /></button></div></td>
        </tr>)}</tbody>
      </table></div> : <div className="workspace-empty"><Users size={20} /> {t('No staff members yet.')}</div>}
      <p className="workspace-import-help">{t('Upload a CSV or XLSX file with name, email, phone, role, specialization, salary and hireDate columns.')}</p>
    </section>
  )
}
