import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { parseFeatures } from '../api/cars'
import { createSavedCar, deleteSavedCar, listMySavedCars, updateSavedCar } from '../api/savedCars'
import type { SavedCar } from '../lib/types'
import { errorMessage } from '../lib/errors'

/** The "My cars" block on the profile page. Owns its own loading and error state. */
export default function SavedCarSection() {
  const [cars, setCars] = useState<SavedCar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [seatCount, setSeatCount] = useState('4')
  const [features, setFeatures] = useState('')
  const [description, setDescription] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editSeatCount, setEditSeatCount] = useState('4')
  const [editFeatures, setEditFeatures] = useState('')
  const [editDescription, setEditDescription] = useState('')

  async function load() {
    try {
      setCars(await listMySavedCars())
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createSavedCar({
        title: title.trim(),
        description: description.trim() || null,
        features: parseFeatures(features),
        seatCount: Number(seatCount),
      })
      setTitle('')
      setSeatCount('4')
      setFeatures('')
      setDescription('')
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(car: SavedCar) {
    setEditingId(car.id)
    setEditTitle(car.title)
    setEditSeatCount(String(car.seatCount))
    setEditFeatures(car.features.join(', '))
    setEditDescription(car.description ?? '')
    setError(null)
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingId) return
    setBusy(true)
    setError(null)
    try {
      await updateSavedCar(editingId, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        features: parseFeatures(editFeatures),
        seatCount: Number(editSeatCount),
      })
      setEditingId(null)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(car: SavedCar) {
    // Nothing points at this row, so no seat and no trip goes with it - unlike a +1.
    if (!window.confirm(`Remove ${car.title} from your cars?`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteSavedCar(car.id)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>My cars</h2>
      <p className="muted">
        Cars you can pick when you register on a trip. Picking one copies it — editing it
        here never changes a car already on a trip, and editing that car never changes this
        one.
      </p>

      {cars === null && !error && <p className="muted">Loading…</p>}
      {cars !== null && cars.length === 0 && <p className="muted">No cars yet.</p>}

      <ul className="people">
        {cars?.map((car) =>
          editingId === car.id ? (
            <li key={car.id}>
              <form onSubmit={saveEdit} className="inline-form">
                <input
                  aria-label="Car"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
                <input
                  aria-label="Seats"
                  type="number"
                  min={1}
                  required
                  value={editSeatCount}
                  onChange={(e) => setEditSeatCount(e.target.value)}
                />
                <input
                  aria-label="Features"
                  placeholder="fridge, grill"
                  value={editFeatures}
                  onChange={(e) => setEditFeatures(e.target.value)}
                />
                <input
                  aria-label="Description"
                  placeholder="Description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <button type="submit" disabled={busy}>
                  Save
                </button>
                <button type="button" className="link" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </form>
            </li>
          ) : (
            <li key={car.id} className="person">
              <span>
                {car.title}
                <span className="muted">
                  {' '}
                  — {car.seatCount} {car.seatCount === 1 ? 'seat' : 'seats'}
                  {car.features.length > 0 && ` · ${car.features.join(', ')}`}
                </span>
              </span>
              <span className="spacer" />
              <button type="button" className="link" onClick={() => startEdit(car)}>
                Edit
              </button>
              <button type="button" className="link" onClick={() => remove(car)} disabled={busy}>
                Remove
              </button>
            </li>
          ),
        )}
      </ul>

      <form onSubmit={add}>
        <label htmlFor="savedCarTitle">Add a car</label>
        <input
          id="savedCarTitle"
          required
          placeholder="Blue Passat"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label htmlFor="savedCarSeats">Seats available for passengers</label>
        <input
          id="savedCarSeats"
          type="number"
          min={1}
          required
          value={seatCount}
          onChange={(e) => setSeatCount(e.target.value)}
        />
        <span className="muted">Not counting you.</span>

        <label htmlFor="savedCarFeatures">Features</label>
        <input
          id="savedCarFeatures"
          placeholder="fridge, grill, opening roof"
          value={features}
          onChange={(e) => setFeatures(e.target.value)}
        />
        <span className="muted">Comma separated.</span>

        <label htmlFor="savedCarDescription">Description</label>
        <input
          id="savedCarDescription"
          placeholder="Anything worth knowing"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </section>
  )
}
