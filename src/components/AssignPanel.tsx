import { useCallback, useEffect, useState } from 'react'
import { confirmBooking, createAndAssign, listTripBookings } from '../api/bookings'
import { listGuestsByHosts } from '../api/guests'
import { listParticipants } from '../api/trips'
import { errorMessage } from '../lib/errors'
import type { BookingWithOccupant, Guest, ParticipantWithProfile } from '../lib/types'

interface Props {
  tripId: string
  carId: string
  seatsTaken: number
  seatCount: number
  /** Bumped by the page whenever it reloads seats, so this panel refetches too. */
  reloadKey: number
  onChanged: () => void
}

/** "Add to my car": anyone going on the trip who has no seat yet, plus loose seats. */
export default function AssignPanel({
  tripId,
  carId,
  seatsTaken,
  seatCount,
  reloadKey,
  onChanged,
}: Props) {
  const [participants, setParticipants] = useState<ParticipantWithProfile[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [bookings, setBookings] = useState<BookingWithOccupant[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [people, seats] = await Promise.all([listParticipants(tripId), listTripBookings(tripId)])
      setParticipants(people)
      setBookings(seats)
      setGuests(await listGuestsByHosts(people.map((p) => p.profileId)))
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }, [tripId])

  // reloadKey is in the deps on purpose: taking a passenger out happens on the page, not
  // in here, and this list would otherwise keep showing them as seated.
  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const full = seatsTaken >= seatCount

  const active = bookings.filter((b) => b.status !== 'denied')
  const seatedProfiles = new Set(active.map((b) => b.profileId).filter(Boolean))
  const seatedGuests = new Set(active.map((b) => b.guestId).filter(Boolean))

  const freePeople = participants.filter((p) => !seatedProfiles.has(p.profileId))
  const freeGuests = guests.filter((g) => !seatedGuests.has(g.id))
  const hostName = (hostId: string) =>
    participants.find((p) => p.profileId === hostId)?.displayName ?? 'someone'

  // Seats on this trip that nobody has put in a car yet.
  const loose = bookings.filter((b) => b.status === 'pending' && b.carId === null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged()
    } catch (err: unknown) {
      setError(errorMessage(err))
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Add to my car</h2>

      {full && <p className="muted">This car is full. Take someone out to make room.</p>}

      {loose.length > 0 && (
        <>
          <p className="muted">Waiting for a car</p>
          <ul className="people">
            {loose.map((b) => (
              <li key={b.id} className="person">
                <span>
                  {b.occupantName}
                  {b.isGuest && <span className="muted"> (+1)</span>}
                  {b.comment && <span className="muted"> — {b.comment}</span>}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="link"
                  disabled={busy || full}
                  onClick={() => run(() => confirmBooking(b.id, carId))}
                >
                  Seat them
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {freePeople.length + freeGuests.length === 0 ? (
        <p className="muted">Everyone going already has a seat.</p>
      ) : (
        <>
          <p className="muted">No seat yet</p>
          <ul className="people">
            {freePeople.map((p) => (
              <li key={p.profileId} className="person">
                <span>{p.displayName}</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="link"
                  disabled={busy || full}
                  onClick={() => run(() => createAndAssign({ tripId, carId, profileId: p.profileId }))}
                >
                  Add
                </button>
              </li>
            ))}
            {freeGuests.map((g) => (
              <li key={g.id} className="person">
                <span>
                  {g.name}
                  <span className="muted"> (+1 of {hostName(g.hostId)})</span>
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="link"
                  disabled={busy || full}
                  onClick={() => run(() => createAndAssign({ tripId, carId, guestId: g.id }))}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  )
}
