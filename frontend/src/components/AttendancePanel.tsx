import { useCallback, useEffect, useState } from 'react'
import { Check, ClipboardCheck, FileDown } from 'lucide-react'
import { apiRequest, downloadReport } from '../lib/api'
import { useLocale } from '../lib/i18n'

type Classroom = { id: string; name: string }
type AttendanceRow = { id: string; fullName: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | null }

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function AttendancePanel({ token, classrooms }: { token: string; classrooms: Classroom[] }) {
  const [classroomId, setClassroomId] = useState('')
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { t } = useLocale()

  const selectedClassroomId = classroomId || classrooms[0]?.id || ''

  const loadAttendance = useCallback(async () => {
    if (!selectedClassroomId || !date) return
    try {
      const data = await apiRequest<AttendanceRow[]>(
        `/attendance?classroomId=${encodeURIComponent(selectedClassroomId)}&date=${encodeURIComponent(date)}`,
        token,
      )
      setRows(data)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load attendance')
    }
  }, [selectedClassroomId, date, token])

  useEffect(() => {
    queueMicrotask(() => { void loadAttendance() })
  }, [loadAttendance])

  function setStatus(childId: string, status: NonNullable<AttendanceRow['status']>) {
    setRows((current) => current.map((row) => row.id === childId ? { ...row, status } : row))
  }

  async function saveAttendance() {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/attendance', token, {
        method: 'PUT',
        body: JSON.stringify({
          classroomId: selectedClassroomId,
          date,
          records: rows.map((row) => ({ childId: row.id, status: row.status ?? 'PRESENT' })),
        }),
      })
      await loadAttendance()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save attendance')
    } finally {
      setBusy(false)
    }
  }

  async function exportReport(format: 'pdf' | 'xlsx') {
    setExporting(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: date, to: date })
      await downloadReport(`/reports/attendance.${format}?${params}`, token, `attendance-${date}.${format}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not export attendance')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="workspace-panel" id="attendance">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t('Daily check-in')}</span>
          <h2>{t('Attendance')}</h2>
        </div>
        <div className="workspace-panel-actions">
          <button type="button" className="workspace-secondary-button" disabled={exporting} onClick={() => void exportReport('pdf')}><FileDown size={16} /> {t('Download PDF')}</button>
          <button type="button" className="workspace-secondary-button" disabled={exporting} onClick={() => void exportReport('xlsx')}><FileDown size={16} /> {t('Download Excel')}</button>
          <button type="button" className="workspace-primary-button" disabled={busy || !rows.length} onClick={() => void saveAttendance()}>
            <Check size={17} /> {busy ? t('Saving…') : t('Save attendance')}
          </button>
        </div>
      </div>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      <div className="workspace-toolbar">
        <label>{t('Classroom')}
          <select value={selectedClassroomId} onChange={(event) => setClassroomId(event.target.value)}>
            {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
          </select>
        </label>
        <label>{t('Date')}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <span className="workspace-module-count"><ClipboardCheck size={16} /> {rows.length} {t('children')}</span>
      </div>
      {!classrooms.length ? <div className="workspace-empty">{t('Create a classroom before recording attendance.')}</div> : rows.length ? (
        <div className="workspace-table-scroll">
          <table className="workspace-table">
            <thead><tr><th>{t('Child')}</th><th>{t('Attendance status')}</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.fullName}</strong></td>
                <td>
                  <select
                    className={`workspace-attendance-select ${(row.status ?? 'PRESENT').toLowerCase()}`}
                    value={row.status ?? 'PRESENT'}
                    onChange={(event) => setStatus(row.id, event.target.value as NonNullable<AttendanceRow['status']>)}
                  >
                    <option value="PRESENT">{t('Present')}</option>
                    <option value="ABSENT">{t('Absent')}</option>
                    <option value="LATE">{t('Late')}</option>
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="workspace-empty">{t('No children are assigned to this classroom.')}</div>}
    </section>
  )
}
