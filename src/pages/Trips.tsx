import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createTrip, listTrips } from '../api/trips'
import { listMyGroups } from '../api/groups'
import type { MyGroup } from '../api/groups'
import { useAuth } from '../auth/AuthProvider'
import type { TripWithGroup } from '../lib/types'
import { errorMessage } from '../lib/errors'

export default function Trips() {
  const { session, profile } = useAuth()
  const [trips, setTrips] = useState<TripWithGroup[] | null>(null)
  const [groups, setGroups] = useState<MyGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const [groupId, setGroupId] = useState('')
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState('')

  async function load() {
    setError(null)
    try {
      // The trips list is filtered by the policy, not here; the groups are for the picker.
      const [nextTrips, nextGroups] = await Promise.all([listTrips(), listMyGroups()])
      setTrips(nextTrips)
      setGroups(nextGroups)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!groupId) return
    setBusy(true)
    setError(null)
    try {
      await createTrip(groupId, {
        name: name.trim(),
        description: description.trim() || null,
        plan: plan.trim() || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
      })
      setName('')
      setStartsOn('')
      setEndsOn('')
      setDescription('')
      setPlan('')
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const currentUserId = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'

  // The same three branches as can_create_trips_in(): the switch, the owner, a site admin.
  // The database decides; this only keeps the form from offering a group it would refuse.
  const creatable =
    groups?.filter((g) => g.canCreateTrips || g.ownerId === currentUserId || isAdmin) ?? []

  return (
    <main>
      <h1>Trips</h1>

      {(trips === null || groups === null) && !error && <p className="muted">Loading…</p>}

      {trips !== null && groups !== null && trips.length === 0 && (
        <p className="muted">
          {groups.length === 0 ? (
            <>
              No trips yet — trips belong to a group, and you are not in one. Start or join
              one on <Link to="/groups">Groups</Link>.
            </>
          ) : (
            'No trips yet in your groups.'
          )}
        </p>
      )}

      <ul className="cards">
        {trips?.map((trip) => (
          <li key={trip.id} className="card">
            <Link to={`/trips/${trip.id}`}>
              <strong>{trip.name}</strong>
            </Link>
            <span className="badge">{trip.groupName}</span>
            <DateRange startsOn={trip.startsOn} endsOn={trip.endsOn} />
            {trip.description && <p>{trip.description}</p>}
          </li>
        ))}
      </ul>

      {creatable.length === 0 && groups !== null && groups.length > 0 && (
        <p className="muted">
          Only members who may start trips can create one. Ask the owner of your group.
        </p>
      )}

      {creatable.length > 0 &&
        (!showForm ? (
          <button
            type="button"
            onClick={() => {
              // One group is the normal case; the picker still shows which one.
              setGroupId(creatable.length === 1 ? creatable[0].id : '')
              setShowForm(true)
            }}
          >
            New trip
          </button>
        ) : (
          <form onSubmit={submit}>
            <h2>New trip</h2>

            <label htmlFor="group">Group</label>
            <select id="group" required value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Choose a group…</option>
              {creatable.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            <label htmlFor="name">Name</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

            <label htmlFor="startsOn">Starts on</label>
            <input
              id="startsOn"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />

            <label htmlFor="endsOn">Ends on</label>
            <input
              id="endsOn"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />

            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <label htmlFor="plan">Plan</label>
            <textarea id="plan" rows={5} value={plan} onChange={(e) => setPlan(e.target.value)} />

            <button type="submit" className="primary" disabled={busy || !groupId}>
              {busy ? 'Creating…' : 'Create trip'}
            </button>
            <button type="button" className="link" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </form>
        ))}

      {error && <p className="error">{error}</p>}
    </main>
  )
}

/** Dates are rendered as stored ('YYYY-MM-DD'); parsing them would shift the day. */
export function DateRange({ startsOn, endsOn }: { startsOn: string | null; endsOn: string | null }) {
  if (!startsOn && !endsOn) return null
  return (
    <p className="muted">
      {startsOn ?? '?'}
      {endsOn && endsOn !== startsOn ? ` → ${endsOn}` : ''}
    </p>
  )
}
