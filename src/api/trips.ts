import { supabase } from '../lib/supabase'
import { listCars } from './cars'
import { listTripBookings } from './bookings'
import type {
  BookingWithOccupant,
  CarWithDriver,
  ParticipantWithProfile,
  Role,
  Trip,
  TripRow,
} from '../lib/types'

const COLUMNS = 'id, name, description, plan, starts_on, ends_on, created_by, created_at'

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    plan: row.plan,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export interface TripInput {
  name: string
  description?: string | null
  plan?: string | null
  startsOn?: string | null
  endsOn?: string | null
}

export async function listTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(COLUMNS)
    .order('starts_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as TripRow[]).map(toTrip)
}

export async function getTrip(id: string): Promise<Trip | null> {
  const { data, error } = await supabase.from('trips').select(COLUMNS).eq('id', id).maybeSingle()

  // The id comes straight from the URL, so it is not necessarily a uuid. Postgres rejects
  // a malformed one with 22P02; that is a missing trip, not an error worth showing.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return data ? toTrip(data as TripRow) : null
}

export async function createTrip(input: TripInput): Promise<Trip> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('trips')
    .insert({
      name: input.name,
      description: input.description ?? null,
      plan: input.plan ?? null,
      starts_on: input.startsOn ?? null,
      ends_on: input.endsOn ?? null,
      created_by: userId,
    })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toTrip(data as TripRow)
}

export async function updateTrip(id: string, patch: TripInput): Promise<Trip> {
  // .single() throws when nothing comes back, which is what a refusal by RLS looks like -
  // an update the policy blocks reports zero rows rather than an error.
  const { data, error } = await supabase
    .from('trips')
    .update({
      name: patch.name,
      description: patch.description ?? null,
      plan: patch.plan ?? null,
      starts_on: patch.startsOn ?? null,
      ends_on: patch.endsOn ?? null,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toTrip(data as TripRow)
}

export async function deleteTrip(id: string): Promise<void> {
  const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Trip was not deleted - only its creator or an admin can do that.')
  }
}

// --- the whole trip in one go ----------------------------------------------

export interface TripBoard {
  trip: Trip
  cars: CarWithDriver[]
  participants: ParticipantWithProfile[]
  bookings: BookingWithOccupant[]
}

/**
 * Everything the trip page draws, in four parallel queries - never one per car or per
 * seat. Seat counts, the layout and the unseated list are all derived from this one
 * result, so they cannot disagree with each other.
 *
 * The import of listTripBookings alongside bookings.ts importing joinTrip is a cycle, but
 * a harmless one: both sides are hoisted function declarations, and nothing runs at module
 * load.
 */
export async function getTripBoard(tripId: string): Promise<TripBoard | null> {
  const [trip, cars, participants, bookings] = await Promise.all([
    getTrip(tripId),
    listCars(tripId),
    listParticipants(tripId),
    listTripBookings(tripId),
  ])

  if (!trip) return null
  return { trip, cars, participants, bookings }
}

// --- participants ----------------------------------------------------------

interface ParticipantJoinRow {
  profile_id: string
  joined_at: string
  profiles: {
    display_name: string
    photo_url: string | null
    role: Role
  } | null
}

export async function listParticipants(tripId: string): Promise<ParticipantWithProfile[]> {
  // One query with the profile joined in, not one lookup per participant.
  const { data, error } = await supabase
    .from('trip_participants')
    .select('profile_id, joined_at, profiles (display_name, photo_url, role)')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true })

  if (error) throw error

  // Cast through unknown: without generated database types supabase-js infers the
  // embedded profile as an array, but PostgREST returns a single object for a
  // many-to-one relationship, which is what ParticipantJoinRow describes.
  return (data as unknown as ParticipantJoinRow[]).map((row) => ({
    profileId: row.profile_id,
    joinedAt: row.joined_at,
    displayName: row.profiles?.display_name ?? 'Unknown',
    photoUrl: row.profiles?.photo_url ?? null,
    role: row.profiles?.role ?? 'user',
  }))
}

export async function joinTrip(tripId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Not signed in')

  // Joining twice is a no-op rather than an error - the composite primary key catches it
  // and ignoreDuplicates turns the conflict into nothing.
  const { error } = await supabase
    .from('trip_participants')
    .upsert(
      { trip_id: tripId, profile_id: userId },
      { onConflict: 'trip_id,profile_id', ignoreDuplicates: true },
    )

  if (error) throw error
}

export async function leaveTrip(tripId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Not signed in')

  // Idempotent: leaving when you are not a participant removes nothing and is not an error.
  // Task 07 must block this while the user still holds a seat on the trip.
  const { error } = await supabase
    .from('trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('profile_id', userId)

  if (error) throw error
}

/** Admin-only in practice: the policy refuses everyone else, silently. */
export async function removeParticipant(tripId: string, profileId: string): Promise<void> {
  const { data, error } = await supabase
    .from('trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('profile_id', profileId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Participant was not removed - only an admin can remove someone else.')
  }
}
