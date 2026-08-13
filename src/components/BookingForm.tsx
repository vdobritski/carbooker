import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { listMyGuests } from '../api/guests'
import { bookSeat } from '../api/bookings'
import type { BookingWithOccupant, CarWithDriver, Guest } from '../lib/types'
import { errorMessage } from '../lib/errors'

interface Props {
  tripId: string
  currentUserId: string
  /** Every seat on the trip, used to hide people who already have one. */
  bookings: BookingWithOccupant[]
  cars: CarWithDriver[]
  onBooked: () => void
}

/** Take a seat for yourself and/or bring some of your +1s. */
export default function BookingForm({
  tripId,
  currentUserId,
  bookings,
  cars,
  onBooked,
}: Props) {
  const [guests, setGuests] = useState<Guest[]>([])
  const [forMe, setForMe] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [preferredCarId, setPreferredCarId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMyGuests()
      .then(setGuests)
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [])

  const active = bookings.filter((b) => b.status !== 'denied')
  const iHaveSeat = active.some((b) => b.profileId === currentUserId)
  const seatedGuestIds = new Set(active.map((b) => b.guestId).filter(Boolean))
  const freeGuests = guests.filter((g) => !seatedGuestIds.has(g.id))

  // Drop selections for anyone who turns out to be seated already - after a partial
  // failure, or because another tab booked them. Without this the next submit retries a
  // seat that already exists, fails on the unique index, and never reaches the rest.
  useEffect(() => {
    if (iHaveSeat) setForMe(false)
    setChosen((prev) => prev.filter((id) => !seatedGuestIds.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings])

  // Nothing left to book. Still render an error if the last submit produced one, or it
  // would disappear with the form and the user would never learn why a seat failed.
  if (iHaveSeat && freeGuests.length === 0) {
    return error ? <p className="error">{error}</p> : null
  }

  function toggleGuest(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!forMe && chosen.length === 0) {
      setError('Pick at least one seat to book.')
      return
    }
    setBusy(true)
    setError(null)

    const note = comment.trim() || null
    const wants = preferredCarId || null
    const problems: string[] = []
    const stillWanted: string[] = []
    let mineFailed = false

    // One row per seat, booked one at a time. Each is independent: if one fails the others
    // still stand, so keep going and report what did not make it. Making the whole set
    // atomic would mean a stored procedure, which this does not warrant.
    if (forMe) {
      try {
        await bookSeat({ tripId, comment: note, preferredCarId: wants })
      } catch (err: unknown) {
        mineFailed = true
        problems.push(`Your seat: ${errorMessage(err)}`)
      }
    }

    for (const guestId of chosen) {
      try {
        await bookSeat({ tripId, guestId, comment: note, preferredCarId: wants })
      } catch (err: unknown) {
        stillWanted.push(guestId)
        const who = guests.find((g) => g.id === guestId)?.name ?? 'A +1'
        problems.push(`${who}: ${errorMessage(err)}`)
      }
    }

    // Keep only what failed selected, so pressing Book again retries exactly that.
    setForMe(mineFailed)
    setChosen(stillWanted)
    if (problems.length === 0) {
      setComment('')
      setPreferredCarId('')
    }
    setError(problems.length > 0 ? problems.join(' · ') : null)
    setBusy(false)
    onBooked()
  }

  return (
    <form onSubmit={submit}>
      <h3>Book a seat</h3>

      {!iHaveSeat && (
        <label className="check">
          <input type="checkbox" checked={forMe} onChange={(e) => setForMe(e.target.checked)} />A
          seat for me
        </label>
      )}

      {freeGuests.length > 0 && (
        <>
          <span className="muted">Bring a +1</span>
          {freeGuests.map((guest) => (
            <label key={guest.id} className="check">
              <input
                type="checkbox"
                checked={chosen.includes(guest.id)}
                onChange={() => toggleGuest(guest.id)}
              />
              {guest.name}
            </label>
          ))}
        </>
      )}

      {cars.length > 0 && (
        <>
          <label htmlFor="preferredCar">Preferred car</label>
          <select
            id="preferredCar"
            value={preferredCarId}
            onChange={(e) => setPreferredCarId(e.target.value)}
          >
            <option value="">No preference</option>
            {cars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.title} — {car.driverName}
              </option>
            ))}
          </select>
          <span className="muted">The driver still has to confirm.</span>
        </>
      )}

      <label htmlFor="comment">Anything the driver should know</label>
      <textarea
        id="comment"
        rows={2}
        placeholder="Health, special requirements, what you can bring"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <button type="submit" disabled={busy}>
        {busy ? 'Booking…' : 'Book'}
      </button>

      {error && <p className="error">{error}</p>}
    </form>
  )
}
