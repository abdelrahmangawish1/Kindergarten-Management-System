import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { ApiError, apiRequest, publicAssetUrl } from '../lib/api'
import { useLocale } from '../lib/i18n'

type Props = {
  token: string
  kindergartenName: string
  logoUrl: string | null
  onLogoUpdated: (logoUrl: string | null) => void
}

const maxLogoSize = 2 * 1024 * 1024
const allowedLogoTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function WorkspaceSettingsPanel({ token, kindergartenName, logoUrl, onLogoUpdated }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useLocale()

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  async function saveLogo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = new FormData()
      body.append('logo', file)
      const result = await apiRequest<{ logoUrl: string }>('/settings/logo', token, {
        method: 'PUT',
        body,
      })
      onLogoUpdated(result.logoUrl)
      setFile(null)
      setPreviewUrl(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice(t('Workspace logo updated.'))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('Could not update the workspace logo'))
    } finally {
      setBusy(false)
    }
  }

  async function removeLogo() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ logoUrl: null }>('/settings/logo', token, { method: 'DELETE' })
      onLogoUpdated(result.logoUrl)
      setFile(null)
      setPreviewUrl(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice(t('Workspace logo removed.'))
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t('Could not remove the workspace logo'))
    } finally {
      setBusy(false)
    }
  }

  function selectLogo(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const nextFile = input.files?.[0] ?? null
    setError('')
    setNotice('')

    if (!nextFile) {
      setFile(null)
      setPreviewUrl(null)
      return
    }

    if (!allowedLogoTypes.has(nextFile.type) || nextFile.size > maxLogoSize) {
      input.value = ''
      setFile(null)
      setPreviewUrl(null)
      setError(t('Choose a PNG, JPEG, or WebP image no larger than 2 MB.'))
      return
    }

    setPreviewUrl(URL.createObjectURL(nextFile))
    setFile(nextFile)
  }

  return (
    <section className="workspace-settings-panel" aria-labelledby="workspace-settings-title">
      <header className="workspace-panel-heading">
        <div>
          <div className="workspace-kicker">{t('Workspace settings')}</div>
          <h2 id="workspace-settings-title">{t('Workspace branding')}</h2>
          <p>{t('Update the logo shown in your dashboard and sign-in page.')}</p>
        </div>
      </header>

      <form className="workspace-logo-form" onSubmit={saveLogo}>
        <div className="workspace-logo-preview" aria-label={t('Workspace logo preview')}>
          {(previewUrl ?? publicAssetUrl(logoUrl)) ? (
            <img src={previewUrl ?? publicAssetUrl(logoUrl)} alt={`${kindergartenName} ${t('logo')}`} />
          ) : (
            <ImagePlus size={30} aria-hidden="true" />
          )}
        </div>
        <div className="workspace-logo-controls">
          <strong>{kindergartenName}</strong>
          <p>{t('PNG, JPEG, or WebP. Maximum file size: 2 MB.')}</p>
          <label className="workspace-logo-file">
            {t('Choose logo')}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={selectLogo}
            />
          </label>
          <div className="workspace-logo-actions">
            <button type="submit" className="workspace-primary-button" disabled={!file || busy}>
              {t(busy ? 'Saving…' : 'Save logo')}
            </button>
            {logoUrl && (
              <button type="button" className="workspace-secondary-button" onClick={removeLogo} disabled={busy}>
                <Trash2 size={16} /> {t('Remove logo')}
              </button>
            )}
          </div>
        </div>
      </form>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {notice && <div className="workspace-success" role="status">{notice}</div>}
    </section>
  )
}
