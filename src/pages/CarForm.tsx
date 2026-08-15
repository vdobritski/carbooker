import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createCar, getCar, parseFeatures, updateCar } from '../api/cars'
import { createSavedCar, listMySavedCars } from '../api/savedCars'
import type { SavedCar } from '../lib/types'
import { errorMessage } from '../lib/errors'

/** Serves both /trips/:id/cars/new and /trips/:id/cars/:carId/edit. */
export default function CarForm() {
  const { id: tripId, carId } = useParams<{ id: string; carId: string }>()
  const navigate = useNavigate()
  const editing = Boolean(carId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [features, setFeatures] = useState('')
  const [seatCount, setSeatCount] = useState('4')
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [carId])

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tripId) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        features: parseFeatures(features),
        seatCount: Number(seatCount),
      }

      // Before registering, not after: only a driver in this group may register a car, and
      // if that is refused the person retries this form. Filing the copy first means the
      // retry cannot end up with two cars on the trip - and selecting the new saved car
      // means it cannot end up with two copies in the garage either.
      if (!carId && !savedCarId && remember) {
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

        <label htmlFor="seatCount">Seats available for passengers</label>
        <input
          id="seatCount"
          type="number"
          min={1}
          required
          value={seatCount}
          onChange={(e) => setSeatCount(e.target.value)}
        />
        <span className="muted">Not counting you.</span>

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

        {/* Nothing to remember when the form was already filled from the garage. */}
        {!editing && savedCarId === '' && (
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember this car on my profile
          </label>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Register car'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
