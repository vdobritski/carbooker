import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPublicTrip } from '../api/publicTrips'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import type { PublicTrip as PublicTripData } from '../lib/types'
import { DateRange } from './Trips'

/**
 * /t/:id — a published trip, readable by anybody with the link.
 *
 * The only route outside RequireAuth apart from sign-in. Read-only by construction rather
 * than by hiding buttons: everything on this page comes from public_trip(), which returns
 * no ids to act on and nothing about the people.
 */
export default function PublicTrip() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()

  // undefined = loading, null = no such trip, or not published
  const [trip, setTrip] = useState<PublicTripData | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getPublicTrip(id)
      .then((t) => {
        if (!cancelled) setTrip(t)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTrip(null)
        setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (trip === undefined) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (trip === null) {
    return (
      <main>
        <h1>Trip not found</h1>
        <p className="muted">
          This link does not point at a shared trip. It may have been unshared, or the
          address may be wrong.
        </p>
        {error && <p className="error">{error}</p>}
        <p>
          <Link to="/">Go to Carbooker</Link>
        </p>
      </main>
    )
  }

  const seatsTotal = trip.cars.reduce((n, c) => n + c.seatCount, 0)
  const seatsTaken = trip.cars.reduce((n, c) => n + c.seatsTaken, 0)

  return (
    <main>
      <p className="muted">Shared trip · read only</p>

      <h1>{trip.name}</h1>
      <DateRange startsOn={trip.startsOn} endsOn={trip.endsOn} />

      {trip.description && <p>{trip.description}</p>}

      <p className="muted">
        {trip.peopleGoing} {trip.peopleGoing === 1 ? 'person' : 'people'} going ·{' '}
        {seatsTaken} of {seatsTotal} {seatsTotal === 1 ? 'seat' : 'seats'} taken
      </p>

      {/* No itinerary here. 027 took the stops back out of public_trip(): where a group of
          people will be and when is a different thing to publish than how full the cars
          are, and whoever holds the link is not necessarily coming. */}
      {trip.plan && (
        <>
          <h2>Notes</h2>
          <p className="prewrap">{trip.plan}</p>
        </>
      )}

      <h2>Cars ({trip.cars.length})</h2>

      {trip.cars.length === 0 ? (
        <p className="muted">No cars yet.</p>
      ) : (
        <ul className="cards">
          {trip.cars.map((car) => (
            <li key={car.title} className="card">
              <strong>{car.title}</strong>
              <p className="muted">
                {car.seatsTaken} / {car.seatCount} seats taken
              </p>
              {car.description && <p>{car.description}</p>}
              {car.features.length > 0 && (
                <p className="chips">
                  {car.features.map((f) => (
                    <span key={f} className="badge">
                      {f}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        Who is going, and who is in which car, is only visible to the group.
      </p>

      <p>
        <Link className="action" to={session ? '/trips' : '/'}>
          {session ? 'Go to Carbooker' : 'Sign in to Carbooker'}
        </Link>
      </p>
    </main>
  )
}
