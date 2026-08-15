import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createGuest, deleteGuest, listMyGuests, updateGuest } from '../api/guests'
import { countActiveSeatsForGuest } from '../api/bookings'
import type { Guest } from '../lib/types'
import { errorMessage } from '../lib/errors'

/** The "My +1s" block on the profile page. Owns its own loading and error state. */
export default function GuestSection() {
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [note, setNote] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')

  async function load() {
    try {
      setGuests(await listMyGuests())
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
      await createGuest({ name: name.trim(), note: note.trim() || null })
      setName('')
      setNote('')
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(guest: Guest) {
    setEditingId(guest.id)
    setEditName(guest.name)
    setEditNote(guest.note ?? '')
    setError(null)
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingId) return
    setBusy(true)
    setError(null)
    try {
      await updateGuest(editingId, { name: editName.trim(), note: editNote.trim() || null })
      setEditingId(null)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(guest: Guest) {
    setBusy(true)
    setError(null)
    try {
      // Their seats cascade away with them, and the driver loses a passenger without
      // being told, so say so before it happens.
      const seats = await countActiveSeatsForGuest(guest.id)
      const warning =
        seats > 0
          ? `${guest.name} currently holds ${seats === 1 ? 'a seat' : `${seats} seats`}. ` +
            'Removing them cancels it and their driver is not notified.\n\n'
          : ''

      if (!window.confirm(`${warning}Remove ${guest.name} as your +1?`)) return

      await deleteGuest(guest.id)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>My +1s</h2>
      <p className="muted">
        People you can bring. They do not sign in — you manage their seats for them.
      </p>

      {guests === null && !error && <p className="muted">Loading…</p>}
      {guests !== null && guests.length === 0 && <p className="muted">No +1s yet.</p>}

      <ul className="people">
        {guests?.map((guest) =>
          editingId === guest.id ? (
            <li key={guest.id}>
              <form onSubmit={saveEdit} className="inline-form">
                <input
                  aria-label="Name"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <input
                  aria-label="Note"
                  placeholder="Note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />
                <button type="submit" className="primary" disabled={busy}>
                  Save
                </button>
                <button type="button" className="link" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </form>
            </li>
          ) : (
            <li key={guest.id} className="person">
              <span>
                {guest.name}
                {guest.note && <span className="muted"> — {guest.note}</span>}
              </span>
              <span className="spacer" />
              <button type="button" className="link" onClick={() => startEdit(guest)}>
                Edit
              </button>
              <button type="button" className="link" onClick={() => remove(guest)} disabled={busy}>
                Remove
              </button>
            </li>
          ),
        )}
      </ul>

      <form onSubmit={add}>
        <label htmlFor="guestName">Add a +1</label>
        <input
          id="guestName"
          required
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="guestNote">Note</label>
        <input
          id="guestNote"
          placeholder="Anything worth knowing"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <button type="submit" className="primary" disabled={busy}>
          Add
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </section>
  )
}
