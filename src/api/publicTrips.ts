import { supabase } from '../lib/supabase'
import type { PublicTrip } from '../lib/types'

/** The raw shape public_trip() returns. snake_case, like every other row in this codebase. */
interface PublicTripPayload {
  id: string
  name: string
  description: string | null
  plan: string | null
  starts_on: string | null
  ends_on: string | null
  people_going: number
  cars: {
    title: string
    description: string | null
    features: string[] | null
    seat_count: number
    seats_taken: number
  }[]
}

/**
 * A published trip, for somebody who may not be signed in.
 *
 * The only call in the app that works without a session, and the only thing `anon` may do
 * at all - it has no policy on any table. What comes back is fixed by the function's
 * return shape rather than by a policy, so no column added to `trips` or `cars` later can
 * leak into it.
 *
 * Null means "no such trip, or it is not published". Deliberately the same answer for
 * both: a stranger should not be able to probe which ids exist.
 */
export async function getPublicTrip(id: string): Promise<PublicTrip | null> {
  const { data, error } = await supabase.rpc('public_trip', { trip_id: id })

  // The id comes from the URL, so it is not necessarily a uuid. Postgres rejects a
  // malformed one with 22P02, which is a missing trip, not an error worth showing.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  if (!data) return null

  const payload = data as PublicTripPayload
  return {
    id: payload.id,
    name: payload.name,
    description: payload.description,
    plan: payload.plan,
    startsOn: payload.starts_on,
    endsOn: payload.ends_on,
    peopleGoing: payload.people_going,
    cars: (payload.cars ?? []).map((car) => ({
      title: car.title,
      description: car.description,
      features: car.features ?? [],
      seatCount: car.seat_count,
      seatsTaken: car.seats_taken,
    })),
  }
}
