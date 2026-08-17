import { supabase } from '../lib/supabase'
import { listCars } from './cars'
import { listTripBookings } from './bookings'
import { getMyGroupRights } from './groups'
import type { GroupRights } from './groups'
import type {
  BookingWithOccupant,
  CarWithDriver,
  ParticipantWithProfile,
  Trip,
  TripRow,
  TripWithGroup,
} from '../lib/types'

const COLUMNS =
  'id, group_id, is_public, name, description, plan, starts_on, ends_on, created_by, created_at'

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    groupId: row.group_id,
    isPublic: row.is_public,
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

interface TripJoinRow extends TripRow {
  groups: { name: string } | null
}

/**
 * The trips I can see - which is exactly the trips of the groups I am in. No
 * `.eq('group_id', ...)`: the trips_select policy is the filter, and a client-side one as
 * well would be a second source of truth.
 */
export async function listTrips(): Promise<TripWithGroup[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(`${COLUMNS}, groups (name)`)
    .order('starts_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw error

  // Cast through unknown: without generated database types supabase-js infers the embedded
  // group as an array, but PostgREST returns a single object for a many-to-one.
  return (data as unknown as TripJoinRow[]).map((row) => ({
    ...toTrip(row),
    groupName: row.groups?.name ?? 'Unknown group',
  }))
}

/** The trips of one group, for that group's page. */
export async function listGroupTrips(groupId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(COLUMNS)
    .eq('group_id', groupId)
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

/**
 * The group is a separate argument, not part of TripInput: it is fixed when the trip is
 * made and updateTrip must never send it - the database refuses a move anyway.
 *
 * Unlike createGroup this keeps .select().single(): trips_select only asks whether I am a
 * member of the group, which was true before the insert.
 */
export async function createTrip(groupId: string, input: TripInput): Promise<Trip> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('trips')
    .insert({
      group_id: groupId,
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

/**
 * Publish or unpublish. Owner-only, enforced by trips_visibility_guard - the update policy
 * lets anybody who manages the trip reach the row, and RLS cannot say "every column but
 * this one", so a refusal here arrives as the trigger's message rather than zero rows.
 */
export async function setTripVisibility(id: string, isPublic: boolean): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ is_public: isPublic })
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
    throw new Error(
      'Trip was not deleted - that needs to be your own trip, or "can manage anyone\'s trip" in the group.',
    )
  }
}

// --- the whole trip in one go ----------------------------------------------

export interface TripBoard {
  trip: Trip
  cars: CarWithDriver[]
  participants: ParticipantWithProfile[]
  bookings: BookingWithOccupant[]
  /** My switches in the trip's group. Null when I am not a member - a site admin reading. */
  myGroupRights: GroupRights | null
}

/**
 * Everything the trip page draws, in four parallel queries - never one per car or per
 * seat. Seat counts, the layout and the unseated list are all derived from this one
 * result, so they cannot disagree with each other.
 *
 * The fifth query has to wait for the first: which group to ask about is on the trip.
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

  const myGroupRights = await getMyGroupRights(trip.groupId)
  return { trip, cars, participants, bookings, myGroupRights }
}

// --- participants ----------------------------------------------------------

interface ParticipantJoinRow {
  profile_id: string
  joined_at: string
  profiles: {
    display_name: string
    photo_url: string | null
  } | null
}

export async function listParticipants(tripId: string): Promise<ParticipantWithProfile[]> {
  // One query with the profile joined in, not one lookup per participant. The profile is
  // readable because a participant is a member of the trip's group, and so is the viewer.
  const { data, error } = await supabase
    .from('trip_participants')
    .select('profile_id, joined_at, profiles (display_name, photo_url)')
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
