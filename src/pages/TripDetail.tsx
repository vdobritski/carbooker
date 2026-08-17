import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteTrip,
  getTripBoard,
  joinTrip,
  leaveTrip,
  removeParticipant,
  setTripVisibility,
  updateTrip,
} from '../api/trips'
import type { TripBoard } from '../api/trips'
import { cancelBooking, setPreferredCar } from '../api/bookings'
import { useAuth } from '../auth/AuthProvider'
import BookingForm from '../components/BookingForm'
import CarCard from '../components/CarCard'
import ParticipantList from '../components/ParticipantList'
import SeatGrid from '../components/SeatGrid'
import TripPlan from '../components/TripPlan'
import type { BookingWithOccupant } from '../lib/types'
import { managesTrip } from '../lib/authority'
import { errorMessage } from '../lib/errors'
import { DateRange } from './Trips'

export default function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  // undefined = still loading, null = no such trip
  const [board, setBoard] = useState<TripBoard | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [peopleBusy, setPeopleBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  /** A read that failed, as opposed to a trip that is not there. Kept apart on purpose. */
  const [loadFailure, setLoadFailure] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState('')

  // One fetch for the whole page. Every count below is derived from this, so the seat
  // totals, the layout and the unseated list cannot drift apart.
  const loadBoard = useCallback(async () => {
    if (!id) return
    try {
      setBoard(await getTripBoard(id))
      setLoadFailure(null)
    } catch (err: unknown) {
      // Not setBoard(null): null is what this page renders as "Trip not found", so a
      // dropped request after a successful write used to tell a member the trip was gone.
      // A failed read keeps whatever is on screen and says so.
      setLoadFailure(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  // Keyed on the trip id so a reload after some other change does not overwrite what is
  // being typed into the edit form.
  const tripId = board?.trip.id
  useEffect(() => {
    if (!board?.trip) return
    setName(board.trip.name)
    setStartsOn(board.trip.startsOn ?? '')
    setEndsOn(board.trip.endsOn ?? '')
    setDescription(board.trip.description ?? '')
    setPlan(board.trip.plan ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  // Nothing loaded and the read failed - distinct from a trip that is not there.
  if (board === undefined && loadFailure !== null) {
    return (
      <main>
        <h1>Could not load this trip</h1>
        <p className="muted">
          Something went wrong reading it. This does not mean the trip is gone.
        </p>
        <p className="error">{loadFailure}</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void loadBoard()}>
            Try again
          </button>
          <Link to="/trips">Back to trips</Link>
        </div>
      </main>
    )
  }

  if (board === undefined) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (board === null) {
    return (
      <main>
        <h1>Trip not found</h1>
        <p className="muted">It may have been deleted, or the link is wrong.</p>
        {error && <p className="error">{error}</p>}
        <p>
          <Link to="/trips">Back to trips</Link>
        </p>
      </main>
    )
  }

  const { trip, cars, participants, bookings, myGroupRights } = board

  const currentUserId = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'
  // The same question the database asks in manages_trip(), asked once - see lib/authority.
  const canManage = managesTrip(trip, myGroupRights, currentUserId, isAdmin)
  // Publishing exposes the group to the open internet, so it is the owner's call rather
  // than any trip manager's - trips_visibility_guard enforces the same rule.
  const canPublish = myGroupRights?.isOwner === true || isAdmin
  // Same shape as the invite link: window.location.pathname is the Vite base.
  const publicUrl = `${window.location.origin}${window.location.pathname}#/t/${trip.id}`
  // Driving is a property of my membership of this trip's group, not of my site role -
  // the cars_insert policy asks can_drive_in_group(), which folds in site admins.
  const canRegisterCar = myGroupRights?.travelRole === 'driver' || isAdmin
  const isParticipant = participants.some((p) => p.profileId === currentUserId)
  const iHoldSeat = bookings.some(
    (b) => b.profileId === currentUserId && b.status !== 'denied',
  )

  const myBookings = bookings.filter((b) => b.bookedBy === currentUserId)
  const seatsIn = (carId: string) =>
    bookings.filter((b) => b.carId === carId && b.status === 'confirmed')
  // Denied seats stay out of the public layout: the passenger sees theirs under "My
  // seats", and the driver who turned it down sees it in that car's request queue.
  const unseated = bookings.filter((b) => b.status === 'pending' && b.carId === null)

  const hostName = (hostId: string) =>
    participants.find((p) => p.profileId === hostId)?.displayName ?? 'someone'

  function carTitle(carId: string | null): string | null {
    if (!carId) return null
    return cars.find((c) => c.id === carId)?.title ?? null
  }

  function seatStatus(booking: BookingWithOccupant): string {
    if (booking.status === 'confirmed') return `in ${carTitle(booking.carId) ?? 'a car'}`
    if (booking.status === 'denied') {
      const asked = carTitle(booking.preferredCarId)
      return asked ? `${asked} declined` : 'declined'
    }
    const asked = carTitle(booking.preferredCarId)
    return asked ? `asked for ${asked}` : 'waiting for a car'
  }

  async function withBusy(action: () => Promise<unknown>) {
    setPeopleBusy(true)
    setError(null)
    try {
      await action()
      await loadBoard()
    } catch (err: unknown) {
      setError(errorMessage(err))
      await loadBoard()
    } finally {
      setPeopleBusy(false)
    }
  }

  async function toggleParticipation() {
    if (!id) return
    // Leaving while holding a seat is refused by the database too - the disabled button
    // is only so it explains itself rather than failing.
    await withBusy(() => (isParticipant ? leaveTrip(id) : joinTrip(id)))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await updateTrip(id, {
        name: name.trim(),
        description: description.trim() || null,
        plan: plan.trim() || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
      })
      await loadBoard()
      setEditing(false)
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!id) return
    if (!window.confirm('Delete this trip? Its cars and bookings go with it.')) return
    setBusy(true)
    setError(null)
    try {
      await deleteTrip(id)
      navigate('/trips', { replace: true })
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <main>
        <h1>Edit trip</h1>
        <form onSubmit={save}>
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

          <label htmlFor="plan">Notes</label>
          <textarea id="plan" rows={6} value={plan} onChange={(e) => setPlan(e.target.value)} />
          <span className="muted">
            Anything that is not a stop on the plan. The stops themselves are on the trip
            page.
          </span>

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  return (
    <main>
      <p className="muted">
        <Link to="/trips">← Trips</Link>
      </p>

      <h1>{trip.name}</h1>
      <DateRange startsOn={trip.startsOn} endsOn={trip.endsOn} />

      {trip.description && <p>{trip.description}</p>}

      <TripPlan tripId={trip.id} startsOn={trip.startsOn} canManage={canManage} />

      {/* `trips.plan` is free text and predates the itinerary above. It reads as the notes
          the stops have no column for, so it keeps its content and loses its old name. */}
      {trip.plan && (
        <>
          <h2>Notes</h2>
          <p className="prewrap">{trip.plan}</p>
        </>
      )}

      <h2>Going ({participants.length})</h2>

      <ParticipantList
        participants={participants}
        creatorId={trip.createdBy}
        currentUserId={currentUserId}
        canRemove={canManage}
        onRemove={(profileId) => withBusy(() => removeParticipant(trip.id, profileId))}
      />

      <button
        type="button"
        onClick={toggleParticipation}
        disabled={peopleBusy || (isParticipant && iHoldSeat)}
      >
        {isParticipant ? 'Leave trip' : 'Join trip'}
      </button>

      {isParticipant && iHoldSeat && (
        <p className="muted">Cancel your seat below before leaving the trip.</p>
      )}

      <h2>Cars ({cars.length})</h2>

      {cars.length === 0 ? (
        <p className="muted">No cars registered yet.</p>
      ) : (
        <ul className="cards">
          {cars.map((car) => (
            <CarCard key={car.id} car={car} seatsTaken={seatsIn(car.id).length}>
              <SeatGrid
                car={car}
                seats={seatsIn(car.id)}
                hostName={hostName}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
              />
            </CarCard>
          ))}
        </ul>
      )}

      {canRegisterCar && (
        <Link className="action" to={`/trips/${trip.id}/cars/new`}>
          Register my car
        </Link>
      )}

      <h2>Not in a car yet ({unseated.length})</h2>

      {unseated.length === 0 ? (
        <p className="muted">Everyone with a seat has a car.</p>
      ) : (
        <ul className="people">
          {unseated.map((b) => (
            <li key={b.id} className="person">
              <span>
                {b.occupantName}
                {b.isGuest && b.guestHostId && (
                  <span className="muted"> (+1 of {hostName(b.guestHostId)})</span>
                )}
                <span className="badge">
                  {carTitle(b.preferredCarId)
                    ? `asked for ${carTitle(b.preferredCarId)}`
                    : 'no preference'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>My seats</h2>

      {myBookings.length === 0 ? (
        <p className="muted">You have not booked a seat yet.</p>
      ) : (
        <ul className="people">
          {myBookings.map((b) => (
            <li key={b.id} className="person">
              <span>
                {b.occupantName}
                {b.isGuest && <span className="muted"> (+1)</span>}
                <span className="badge">{seatStatus(b)}</span>
                {b.comment && <span className="muted"> — {b.comment}</span>}
              </span>
              <span className="spacer" />

              {cars.length > 0 && (
                <select
                  aria-label={`Preferred car for ${b.occupantName}`}
                  value={b.preferredCarId ?? ''}
                  disabled={peopleBusy}
                  onChange={(e) => withBusy(() => setPreferredCar(b.id, e.target.value || null))}
                >
                  <option value="">No preference</option>
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.title}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                className="link"
                onClick={() => {
                  if (window.confirm('Give up this seat?')) void withBusy(() => cancelBooking(b.id))
                }}
                disabled={peopleBusy}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {currentUserId && (
        <BookingForm
          tripId={trip.id}
          currentUserId={currentUserId}
          bookings={bookings}
          cars={cars}
          onBooked={loadBoard}
        />
      )}

      {canPublish && (
        <section>
          <h2>Share outside the group</h2>

          <label className="check">
            <input
              type="checkbox"
              checked={trip.isPublic}
              disabled={peopleBusy}
              onChange={(e) => withBusy(() => setTripVisibility(trip.id, e.target.checked))}
            />
            Anyone with the link can see this trip
          </label>

          <p className="muted">
            They see the trip, its cars and how many seats are taken — never who is going,
            who drives, or anything written in a seat comment.
          </p>

          {trip.isPublic && (
            <>
              <p className="invite-link">{publicUrl}</p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(publicUrl)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </>
          )}
        </section>
      )}

      {canManage && (
        <div className="row">
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      )}

      {/* Still showing the last successful load - say it may be stale rather than claiming
          the trip is gone. */}
      {loadFailure && (
        <p className="error">
          Could not refresh this page, so what you see may be out of date. {loadFailure}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
