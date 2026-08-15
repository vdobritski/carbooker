import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createGroup, listMyGroups } from '../api/groups'
import type { MyGroup } from '../api/groups'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/errors'

export default function Groups() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [groups, setGroups] = useState<MyGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function load() {
    setError(null)
    try {
      setGroups(await listMyGroups())
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const group = await createGroup({
        name: name.trim(),
        description: description.trim() || null,
      })
      // Straight to the new group: its page fetches the members, including the row the
      // after-insert trigger just made for me as owner.
      navigate(`/groups/${group.id}`)
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const currentUserId = session?.user.id ?? null

  return (
    <main>
      <h1>Groups</h1>

      {groups === null && !error && <p className="muted">Loading…</p>}

      {groups !== null && groups.length === 0 && (
        <p className="muted">
          You are not in any group yet. Create one below, or follow an invite link from
          somebody who already has one.
        </p>
      )}

      <ul className="cards">
        {groups?.map((group) => (
          <li key={group.id} className="card">
            <Link to={`/groups/${group.id}`}>
              <strong>{group.name}</strong>
            </Link>
            {group.ownerId === currentUserId && <span className="badge">owner</span>}
            {group.travelRole === 'driver' && <span className="badge">driver</span>}
            {group.description && <p>{group.description}</p>}
          </li>
        ))}
      </ul>

      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)}>
          New group
        </button>
      ) : (
        <form onSubmit={submit}>
          <h2>New group</h2>

          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
          <button type="button" className="link" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
