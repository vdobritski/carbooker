import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteCar, getCar } from '../api/cars'
import {
  confirmBooking,
  denyBooking,
  listCarRequests,
  listCarSeats,
  unassign,
} from '../api/bookings'
import { getTripAuthority } from '../api/trips'
import type { GroupRights } from '../api/groups'
import { useAuth } from '../auth/AuthProvider'
import AssignPanel from '../components/AssignPanel'
import type { BookingWithOccupant, CarWithDriver, Trip } from '../lib/types'
import { managesTrip } from '../lib/authority'
import { errorMessage } from '../lib/errors'

export default function CarDetail() {
  const { id: tripId, carId } = useParams<{ id: string; carId: string }>()
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  // undefined = loading, null = no such car
  const [car, setCar] = useState<CarWithDriver | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Who runs the trip decides who may manage its cars and seats, not just who drives.
  const [trip, setTrip] = useState<Trip | null>(null)
  const [rights, setRights] = useState<GroupRights | null>(null)

  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    getTripAuthority(tripId)
      .then((found) => {
        if (cancelled || !found) return
        setTrip(found.trip)
        setRights(found.rights)
      })
      .catch((err: unknown) => {
        // Not fatal: the page still renders, with the driver's own controls only.
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [tripId])

  useEffect(() => {
    if (!carId) return
    let cancelled = false
    getCar(carId)
      .then((c) => {
        if (!cancelled) setCar(c)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCar(null)
        setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [carId])

  const [requests, setRequests] = useState<BookingWithOccupant[]>([])
  const [seats, setSeats] = useState<BookingWithOccupant[]>([])
  const [version, setVersion] = useState(0)

  const loadSeatsAndRequests = useCallback(async () => {
    if (!carId) return
    try {
      const [r, s] = await Promise.all([listCarRequests(carId), listCarSeats(carId)])
      setRequests(r)
      setSeats(s)
      setVersion((v) => v + 1)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }, [carId])

  useEffect(() => {
    void loadSeatsAndRequests()
  }, [loadSeatsAndRequests])

  async function takeOut(bookingId: string) {
    setBusy(true)
    setError(null)
    try {
      await unassign(bookingId)
      await loadSeatsAndRequests()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function answer(bookingId: string, accept: boolean) {
    if (!carId) return
    setBusy(true)
    setError(null)
    try {
      if (accept) await confirmBooking(bookingId, carId)
      else await denyBooking(bookingId)
      await loadSeatsAndRequests()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (car === undefined) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (car === null) {
    return (
      <main>
        <h1>Car not found</h1>
        {error && <p className="error">{error}</p>}
        <p>
          <Link to={`/trips/${tripId}`}>Back to the trip</Link>
        </p>
      </main>
    )
  }

  // The branches of cars_update / cars_delete / bookings_update, in the same order:
  // I drive this car, or I run the trip it is on.
  const currentUserId = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'
  const canManage =
    car.driverId === currentUserId ||
    (trip !== null && managesTrip(trip, rights, currentUserId, isAdmin)) ||
    isAdmin

  async function remove() {
    if (!carId) return
    if (!window.confirm('Delete this car?')) return
    setBusy(true)
    setError(null)
    try {
      await deleteCar(carId)
      navigate(`/trips/${tripId}`, { replace: true })
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main>
      <p className="muted">
        <Link to={`/trips/${tripId}`}>← Trip</Link>
      </p>

      <h1>{car.title}</h1>
      <p className="muted">
        Driven by {car.driverName} · {car.seatCount} passenger seats
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

      <h2>
        Seats ({seats.length} / {car.seatCount})
      </h2>

      {seats.length === 0 ? (
        <p className="muted">Nobody is in this car yet.</p>
      ) : (
        <ul className="people">
          {seats.map((s) => (
            <li key={s.id} className="person">
              <span>
                {s.occupantName}
                {s.isGuest && <span className="muted"> (+1)</span>}
                {(canManage || s.bookedBy === session?.user.id) && s.comment && (
                  <span className="muted"> — {s.comment}</span>
                )}
              </span>
              <span className="spacer" />
              {canManage && (
                <button
                  type="button"
                  className="link"
                  onClick={() => takeOut(s.id)}
                  disabled={busy}
                >
                  Take out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <h2>Requests ({requests.length})</h2>

          {requests.length === 0 ? (
            <p className="muted">No one is asking for a seat in this car.</p>
          ) : (
            <ul className="people">
              {requests.map((r) => (
                <li key={r.id} className="person">
                  <span>
                    {r.occupantName}
                    {r.isGuest && <span className="muted"> (+1)</span>}
                    {r.status === 'denied' && <span className="badge">you declined</span>}
                    {r.comment && <span className="muted"> — {r.comment}</span>}
                  </span>
                  <span className="spacer" />
                  {r.status !== 'confirmed' && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => answer(r.id, true)}
                      disabled={busy}
                    >
                      {r.status === 'denied' ? 'Take them after all' : 'Confirm'}
                    </button>
                  )}
                  {r.status === 'pending' && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => answer(r.id, false)}
                      disabled={busy}
                    >
                      Decline
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {tripId && (
            <AssignPanel
              tripId={tripId}
              carId={car.id}
              seatsTaken={seats.length}
              seatCount={car.seatCount}
              reloadKey={version}
              onChanged={loadSeatsAndRequests}
            />
          )}
        </>
      )}

      {canManage && (
        <div className="row">
          <Link to={`/trips/${tripId}/cars/${car.id}/edit`}>Edit</Link>
          <button type="button" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
