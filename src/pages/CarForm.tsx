import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createCar, getCar, parseFeatures, updateCar } from '../api/cars'
import type { CarDriver } from '../api/cars'
import { createSavedCar, listMySavedCars } from '../api/savedCars'
import { listMembers } from '../api/groups'
import { getTripAuthority } from '../api/trips'
import { useAuth } from '../auth/AuthProvider'
import { managesTrip } from '../lib/authority'
import type { GroupMemberWithProfile, SavedCar } from '../lib/types'
import { errorMessage } from '../lib/errors'

/**
 * The driver, as one select box. 'me' and 'name' are not profile ids and cannot collide
 * with one - anything else in this field is the id of a member of the trip's group.
 */
const ME = 'me'
const BY_NAME = 'name'

/** Serves both /trips/:id/cars/new and /trips/:id/cars/:carId/edit. */
export default function CarForm() {
  const { id: tripId, carId } = useParams<{ id: string; carId: string }>()
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const myId = session?.user.id ?? null
  const editing = Boolean(carId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [features, setFeatures] = useState('')
  const [seatCount, setSeatCount] = useState('4')
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Who drives. Only somebody who runs the trip may set this to anything but themselves,
  // so for everyone else the picker is not rendered at all and driverChoice stays 'me'.
  const [driverChoice, setDriverChoice] = useState<string>(ME)
  const [driverName, setDriverName] = useState('')
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([])
  const [canAssign, setCanAssign] = useState(false)

  // The garage, and which of it this form was filled from. '' means "a new car", which is
  // also what decides whether "remember this car" is offered.
  const [savedCars, setSavedCars] = useState<SavedCar[]>([])
  const [savedCarId, setSavedCarId] = useState('')
  const [remember, setRemember] = useState(true)

  // Registering only. Editing a trip's car has nothing to do with the garage: the two are
  // separate rows from the moment the car was registered.
  useEffect(() => {
    if (editing) return
    let cancelled = false
    listMySavedCars()
      .then((cars) => {
        if (!cancelled) setSavedCars(cars)
      })
      .catch((err: unknown) => {
        // Not being able to read the garage is no reason to block typing a car in.
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [editing])

  // Who may hand a car to somebody else, and who there is to hand it to. Both come from the
  // trip rather than the car, so this runs when registering as well as when editing.
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    getTripAuthority(tripId)
      .then(async (found) => {
        if (cancelled || !found) return
        if (!managesTrip(found.trip, found.rights, myId, profile?.role === 'admin')) return
        const roster = await listMembers(found.trip.groupId)
        if (!cancelled) {
          setMembers(roster)
          setCanAssign(true)
        }
      })
      .catch((err: unknown) => {
        // The picker is an extra: without it the form still registers a car for yourself.
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [tripId, myId, profile?.role])

  useEffect(() => {
    if (!carId) return
    let cancelled = false
    getCar(carId)
      .then((car) => {
        if (cancelled) return
        if (car) {
          setTitle(car.title)
          setDescription(car.description ?? '')
          setFeatures(car.features.join(', '))
          setSeatCount(String(car.seatCount))
          // Saving must not quietly reassign the car, so the picker starts where the car is.
          if (car.driverId === null) {
            setDriverChoice(BY_NAME)
            setDriverName(car.driverName)
          } else {
            setDriverChoice(car.driverId === myId ? ME : car.driverId)
          }
        } else {
          setError('That car does not exist.')
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [carId, myId])

  /** Copies a saved car into the form. Everything stays editable before saving. */
  function pickSavedCar(id: string) {
    setSavedCarId(id)
    const saved = savedCars.find((car) => car.id === id)
    if (!saved) return // "Enter a new car" - leave whatever is typed alone.
    setTitle(saved.title)
    setDescription(saved.description ?? '')
    setFeatures(saved.features.join(', '))
    setSeatCount(String(saved.seatCount))
  }

  /** The one field the database wants, from the select box plus the name input. */
  function chosenDriver(): CarDriver | null {
    if (driverChoice === BY_NAME) {
      const name = driverName.trim()
      return name ? { kind: 'name', name } : null
    }
    const profileId = driverChoice === ME ? myId : driverChoice
    return profileId ? { kind: 'member', profileId } : null
  }

  // The garage is mine, so it is only offered for a car I am going to drive.
  const drivingMyself = driverChoice === ME

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tripId) return

    const driver = chosenDriver()
    if (!driver) {
      setError("Type the driver's name, or pick who drives.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        features: parseFeatures(features),
        seatCount: Number(seatCount),
        driver,
      }

      // Before registering, not after: only a driver in this group may register a car, and
      // if that is refused the person retries this form. Filing the copy first means the
      // retry cannot end up with two cars on the trip - and selecting the new saved car
      // means it cannot end up with two copies in the garage either.
      if (!carId && !savedCarId && remember && drivingMyself) {
        const saved = await createSavedCar(input)
        setSavedCars((cars) => [...cars, saved])
        setSavedCarId(saved.id)
      }

      const car = carId ? await updateCar(carId, input) : await createCar(tripId, input)
      navigate(`/trips/${tripId}/cars/${car.id}`, { replace: true })
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  return (
    <main>
      <p className="muted">
        <Link to={`/trips/${tripId}`}>← Trip</Link>
      </p>

      <h1>{editing ? 'Edit car' : 'Register a car'}</h1>

      <form onSubmit={submit}>
        {!editing && savedCars.length > 0 && (
          <>
            <label htmlFor="savedCar">Use one of my cars</label>
            <select
              id="savedCar"
              value={savedCarId}
              onChange={(e) => pickSavedCar(e.target.value)}
            >
              <option value="">Enter a new car</option>
              {savedCars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.title} — {car.seatCount} {car.seatCount === 1 ? 'seat' : 'seats'}
                </option>
              ))}
            </select>
            <span className="muted">
              Picking one copies it onto this trip. Changing the car here later does not
              change the saved one, and changing the saved one does not change this car.
            </span>
          </>
        )}

        <label htmlFor="title">Car</label>
        <input
          id="title"
          required
          placeholder="Blue Passat"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {canAssign && (
          <>
            <label htmlFor="driver">Driver</label>
            <select
              id="driver"
              value={driverChoice}
              onChange={(e) => setDriverChoice(e.target.value)}
            >
              <option value={ME}>Me</option>
              {members
                .filter((m) => m.profileId !== myId)
                .map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {m.displayName}
                    {m.travelRole === 'passenger' ? ' (not marked as a driver)' : ''}
                  </option>
                ))}
              <option value={BY_NAME}>Somebody without an account…</option>
            </select>

            {driverChoice === BY_NAME ? (
              <>
                <input
                  aria-label="Driver's name"
                  placeholder="Uncle Bob"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                />
                <span className="muted">
                  A name only. Nobody signs in as them, so this car stays yours to manage -
                  you confirm and seat its passengers.
                </span>
              </>
            ) : (
              !drivingMyself && (
                <span className="muted">
                  They get to run this car: confirming, declining and taking passengers out.
                  You keep those too, because you run the trip.
                </span>
              )
            )}
          </>
        )}

        <label htmlFor="seatCount">Seats available for passengers</label>
        <input
          id="seatCount"
          type="number"
          min={1}
          required
          value={seatCount}
          onChange={(e) => setSeatCount(e.target.value)}
        />
        <span className="muted">{drivingMyself ? 'Not counting you.' : 'Not counting the driver.'}</span>

        <label htmlFor="features">Features</label>
        <input
          id="features"
          placeholder="fridge, grill, opening roof"
          value={features}
          onChange={(e) => setFeatures(e.target.value)}
        />
        <span className="muted">Comma separated.</span>

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Nothing to remember when the form was already filled from the garage, and the
            garage is mine - somebody else's car has no business in it. */}
        {!editing && savedCarId === '' && drivingMyself && (
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember this car on my profile
          </label>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Register car'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
