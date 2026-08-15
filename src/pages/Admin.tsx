import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { listProfiles, setRole } from '../api/profiles'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import type { Profile, Role } from '../lib/types'

// Two site roles since 017. Driving moved to group_members.travel_role.
const ROLES: Role[] = ['user', 'admin']

export default function Admin() {
  const { profile, loading, refreshProfile } = useAuth()
  const [people, setPeople] = useState<Profile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setPeople(await listProfiles())
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  // Convenience only. The role-change guard in the database is the real check.
  if (profile?.role !== 'admin') return <Navigate to="/trips" replace />

  async function change(person: Profile, role: Role) {
    if (role === person.role) return

    // A sole admin who demotes themselves has no way back except the SQL editor.
    if (person.id === profile?.id && role !== 'admin') {
      const admins = people?.filter((p) => p.role === 'admin').length ?? 0
      const warning =
        admins <= 1
          ? 'You are the only admin. Nobody will be able to change roles afterwards, ' +
            'including you - it would take a database query to undo.\n\n'
          : ''
      if (!window.confirm(`${warning}Give up your own admin rights?`)) return
    }

    setBusy(true)
    setError(null)
    try {
      await setRole(person.id, role)
      await load()
      if (person.id === profile?.id) await refreshProfile()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>People</h1>
      <p className="muted">
        Admins can do anything, anywhere. Everything else — who drives, who runs trips, who
        manages people — is set per group on <Link to="/groups">Groups</Link>. A change
        reaches someone the next time their page loads.
      </p>

      {people === null && !error && <p className="muted">Loading…</p>}

      <ul className="people">
        {people?.map((person) => (
          <li key={person.id} className="person">
            {person.photoUrl ? (
              <img className="avatar-sm" src={person.photoUrl} alt="" />
            ) : (
              <span className="avatar-sm placeholder" aria-hidden="true" />
            )}

            <span>
              {person.displayName}
              {person.id === profile?.id && <span className="muted"> (you)</span>}
            </span>

            <span className="spacer" />

            <select
              aria-label={`Role for ${person.displayName}`}
              value={person.role}
              disabled={busy}
              onChange={(e) => change(person, e.target.value as Role)}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
