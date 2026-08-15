import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { updateMyProfile } from '../api/profiles'
import GuestSection from '../components/GuestSection'
import SavedCarSection from '../components/SavedCarSection'
import { errorMessage } from '../lib/errors'

export default function Profile() {
  const { profile, refreshProfile } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Keyed on the profile id, not the object: refreshProfile() after a save produces a new
  // object, and re-running this on every change would overwrite what is being typed.
  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.displayName)
    setPhotoUrl(profile.photoUrl ?? '')
    setDescription(profile.description ?? '')
  }, [profile?.id])

  if (!profile) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await updateMyProfile({
        displayName: displayName.trim(),
        photoUrl: photoUrl.trim() || null,
        description: description.trim() || null,
      })
      await refreshProfile()
      setSaved(true)
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>My profile</h1>

      <form onSubmit={save}>
        <label htmlFor="displayName">Name or alias</label>
        <input
          id="displayName"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <label htmlFor="photoUrl">Photo URL</label>
        <input
          id="photoUrl"
          type="url"
          placeholder="https://…"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
        />

        <label htmlFor="description">About me</label>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <p className="muted">
          Role: <strong>{profile.role}</strong> — only an admin can change this.
        </p>

        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>

      {photoUrl.trim() && (
        <img className="avatar" src={photoUrl.trim()} alt="" />
      )}

      {saved && <p className="muted">Saved.</p>}
      {error && <p className="error">{error}</p>}

      <GuestSection />

      <SavedCarSection />
    </main>
  )
}
