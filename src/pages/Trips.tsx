import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createTrip, listTrips } from '../api/trips'
import type { Trip } from '../lib/types'
import { errorMessage } from '../lib/errors'

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState('')

  async function load() {
    setError(null)
    try {
      setTrips(await listTrips())
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
      await createTrip({
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

  return (
    <main>
      <h1>Trips</h1>

      {trips === null && !error && <p className="muted">Loading…</p>}

      {trips !== null && trips.length === 0 && (
        <p className="muted">No trips yet. Create the first one.</p>
      )}

      <ul className="cards">
        {trips?.map((trip) => (
          <li key={trip.id} className="card">
            <Link to={`/trips/${trip.id}`}>
              <strong>{trip.name}</strong>
            </Link>
            <DateRange startsOn={trip.startsOn} endsOn={trip.endsOn} />
            {trip.description && <p>{trip.description}</p>}
          </li>
        ))}
      </ul>

      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)}>
          New trip
        </button>
      ) : (
        <form onSubmit={submit}>
          <h2>New trip</h2>

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
          <input id="endsOn" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />

          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <label htmlFor="plan">Plan</label>
          <textarea id="plan" rows={5} value={plan} onChange={(e) => setPlan(e.target.value)} />

          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create trip'}
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
