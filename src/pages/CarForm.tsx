import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createCar, getCar, parseFeatures, updateCar } from '../api/cars'
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

        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Register car'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
