import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createPlanPoint,
  deletePlanPoint,
  listPlanPoints,
  updatePlanPoint,
} from '../api/planPoints'
import { errorMessage } from '../lib/errors'
import type { TripPlanPoint } from '../lib/types'

/**
 * "Day 2", plus the real date when the trip has one. Date arithmetic on the UTC parts, not
 * `new Date('2026-08-17')` plus 24h: the string is a plain date, and parsing it as an
 * instant lands on the previous day in any timezone behind UTC.
 */
export function planDayLabel(day: number, startsOn: string | null): string {
  if (!startsOn) return `Day ${day}`
  const [y, m, d] = startsOn.split('-').map(Number)
  if (!y || !m || !d) return `Day ${day}`
  const at = new Date(Date.UTC(y, m - 1, d + (day - 1)))
  return `Day ${day} · ${at.toISOString().slice(0, 10)}`
}

/** Points in reading order, split into their days. The order within a day is the query's. */
export function groupByDay<T extends { day: number }>(points: T[]): { day: number; points: T[] }[] {
  const days: { day: number; points: T[] }[] = []
  for (const point of points) {
    const last = days[days.length - 1]
    if (last && last.day === point.day) last.points.push(point)
    else days.push({ day: point.day, points: [point] })
  }
  return days
}

/** One stop's time column. A stop with no time yet says so rather than showing nothing. */
function Time({ atTime }: { atTime: string | null }) {
  return atTime ? <strong>{atTime}</strong> : <span className="muted">no time yet</span>
}

interface Props {
  tripId: string
  /** Turns "Day 2" into a date. Null while the trip has no start date. */
  startsOn: string | null
  /** Whoever runs the trip. Everyone else reads it. */
  canManage: boolean
}

/**
 * The itinerary on the trip page: the stops, and — for whoever runs the trip — one form to
 * add or change them. One form rather than an editable row each: "Edit" fills this one,
 * which is a great deal less state than a form per stop and reads the same on a phone.
 */
export default function TripPlan({ tripId, startsOn, canManage }: Props) {
  const [points, setPoints] = useState<TripPlanPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [day, setDay] = useState('1')
  const [atTime, setAtTime] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const load = useCallback(async () => {
    try {
      setPoints(await listPlanPoints(tripId))
      setError(null)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }, [tripId])

  useEffect(() => {
    void load()
  }, [load])

  function closeForm() {
    setOpen(false)
    setEditingId(null)
    setAtTime('')
    setTitle('')
    setUrl('')
  }

  /** Add starts on the day the last stop is on - an itinerary is written a day at a time. */
  function openForAdd() {
    setEditingId(null)
    setDay(String(points?.[points.length - 1]?.day ?? 1))
    setAtTime('')
    setTitle('')
    setUrl('')
    setOpen(true)
  }

  function openForEdit(point: TripPlanPoint) {
    setEditingId(point.id)
    setDay(String(point.day))
    setAtTime(point.atTime ?? '')
    setTitle(point.title)
    setUrl(point.url ?? '')
    setOpen(true)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input = {
        day: Number(day) || 1,
        atTime: atTime || null,
        title: title.trim(),
        url: url.trim() || null,
      }
      if (editingId) await updatePlanPoint(editingId, input)
      else await createPlanPoint(tripId, input)
      closeForm()
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(point: TripPlanPoint) {
    if (!window.confirm(`Remove "${point.title}" from the plan?`)) return
    setBusy(true)
    setError(null)
    try {
      await deletePlanPoint(point.id)
      if (editingId === point.id) closeForm()
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (points === null && error === null) {
    return (
      <>
        <h2>Plan</h2>
        <p className="muted">Loading…</p>
      </>
    )
  }

  const days = groupByDay(points ?? [])

  return (
    <>
      <h2>Plan</h2>

      {days.length === 0 ? (
        <p className="muted">
          {canManage
            ? 'No stops yet. Add where you are going and when.'
            : 'Nothing planned yet.'}
        </p>
      ) : (
        days.map(({ day: n, points: stops }) => (
          <section key={n}>
            <h3>{planDayLabel(n, startsOn)}</h3>
            <ul className="people">
              {stops.map((point) => (
                <li key={point.id} className="person">
                  <span>
                    <Time atTime={point.atTime} /> — {point.title}
                    {point.url && (
                      <>
                        {' '}
                        {/* noreferrer as well as noopener: the target is somebody's map
                            link, and it has no business reading where it came from. */}
                        <a href={point.url} target="_blank" rel="noreferrer">
                          map
                        </a>
                      </>
                    )}
                  </span>
                  <span className="spacer" />
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => openForEdit(point)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void remove(point)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canManage &&
        (!open ? (
          <button type="button" onClick={openForAdd}>
            Add a stop
          </button>
        ) : (
          <form onSubmit={submit}>
            <h3>{editingId ? 'Edit stop' : 'Add a stop'}</h3>

            <label htmlFor="planDay">Day</label>
            <input
              id="planDay"
              type="number"
              min={1}
              required
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />

            <label htmlFor="planTime">Time</label>
            <input
              id="planTime"
              type="time"
              value={atTime}
              onChange={(e) => setAtTime(e.target.value)}
            />
            <span className="muted">Leave empty if it is not fixed yet.</span>

            <label htmlFor="planTitle">What happens</label>
            <input
              id="planTitle"
              required
              placeholder="Arrive in Hrodna"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label htmlFor="planUrl">Link</label>
            <input
              id="planUrl"
              type="url"
              placeholder="https://maps.google.com/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <span className="muted">A map link, or anything else worth opening.</span>

            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save stop' : 'Add stop'}
            </button>
            <button type="button" className="link" onClick={closeForm} disabled={busy}>
              Cancel
            </button>
          </form>
        ))}

      {error && <p className="error">{error}</p>}
    </>
  )
}
