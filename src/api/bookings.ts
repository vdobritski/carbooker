import { supabase } from '../lib/supabase'
import { joinTrip } from './trips'
import type { Booking, BookingStatus, BookingWithOccupant } from '../lib/types'

const FLAT =
  'id, trip_id, profile_id, guest_id, booked_by, car_id, preferred_car_id, status, comment, created_at, updated_at'

// bookings points at profiles twice (profile_id, booked_by) and at cars twice, so the
// embed has to name the foreign key it means or PostgREST refuses as ambiguous.
const JOINED = `${FLAT}, profiles!bookings_profile_id_fkey (display_name), guests (name, host_id)`

interface BookingFlatRow {
  id: string
  trip_id: string
  profile_id: string | null
  guest_id: string | null
  booked_by: string
  car_id: string | null
  preferred_car_id: string | null
  status: BookingStatus
  comment: string | null
  created_at: string
  updated_at: string
}

interface BookingJoinRow extends BookingFlatRow {
  profiles: { display_name: string } | null
  guests: { name: string; host_id: string } | null
}

function toBooking(row: BookingFlatRow): Booking {
  return {
    id: row.id,
    tripId: row.trip_id,
    profileId: row.profile_id,
    guestId: row.guest_id,
    bookedBy: row.booked_by,
    carId: row.car_id,
    preferredCarId: row.preferred_car_id,
    status: row.status,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toBookingWithOccupant(row: BookingJoinRow): BookingWithOccupant {
  return {
    ...toBooking(row),
    occupantName: row.guests?.name ?? row.profiles?.display_name ?? 'Unknown',
    isGuest: row.guest_id !== null,
    guestHostId: row.guests?.host_id ?? null,
  }
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  return userId
}

export async function listTripBookings(tripId: string): Promise<BookingWithOccupant[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(JOINED)
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as BookingJoinRow[]).map(toBookingWithOccupant)
}

/**
 * Take one seat on a trip: for yourself, or for one of your +1s. The seat starts
 * 'pending' with no car - only a driver puts someone in a car (task 08).
 */
export async function bookSeat(input: {
  tripId: string
  guestId?: string | null
  comment?: string | null
  preferredCarId?: string | null
}): Promise<Booking> {
  const userId = await currentUserId()

  // Holding a seat means you are going. checks.sql asserts every occupant is a
  // participant, so joining here is what keeps that true.
  await joinTrip(input.tripId)

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      trip_id: input.tripId,
      profile_id: input.guestId ? null : userId,
      guest_id: input.guestId ?? null,
      booked_by: userId,
      comment: input.comment ?? null,
      preferred_car_id: input.preferredCarId ?? null,
    })
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/** The booker may edit the comment. Seating is the driver's job, guarded in the database. */
export async function updateMyBooking(
  id: string,
  patch: { comment: string | null },
): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ comment: patch.comment })
    .eq('id', id)
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/** Seats waiting on this car's driver: requests, and anything they turned down. */
export async function listCarRequests(carId: string): Promise<BookingWithOccupant[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(JOINED)
    .eq('preferred_car_id', carId)
    .neq('status', 'confirmed')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as BookingJoinRow[]).map(toBookingWithOccupant)
}

/** Who is actually sitting in this car. */
export async function listCarSeats(carId: string): Promise<BookingWithOccupant[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(JOINED)
    .eq('car_id', carId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as BookingJoinRow[]).map(toBookingWithOccupant)
}

/** Which car the passenger would like. Does not move a seat that is already confirmed. */
export async function setPreferredCar(bookingId: string, carId: string | null): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ preferred_car_id: carId })
    .eq('id', bookingId)
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/**
 * Seat the passenger. Status and car_id move together in a single update: the
 * bookings_car_iff_confirmed constraint rejects either half on its own, which is the
 * protection working, not something to route around.
 */
export async function confirmBooking(bookingId: string, carId: string): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'confirmed', car_id: carId })
    .eq('id', bookingId)
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/**
 * Turn the request down. preferred_car_id is kept so the passenger can see which car said
 * no, and so the driver can still change their mind and confirm afterwards.
 */
export async function denyBooking(bookingId: string): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'denied', car_id: null })
    .eq('id', bookingId)
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/**
 * Create a seat that is already in the car. One insert, not an insert then an update:
 * the check constraint rejects a confirmed row without a car, and the capacity trigger
 * applies on insert too.
 *
 * booked_by is the driver, which is right - it records who made the booking, not who
 * occupies the seat.
 */
export async function createAndAssign(input: {
  tripId: string
  carId: string
  profileId?: string | null
  guestId?: string | null
}): Promise<Booking> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      trip_id: input.tripId,
      profile_id: input.profileId ?? null,
      guest_id: input.guestId ?? null,
      booked_by: userId,
      car_id: input.carId,
      status: 'confirmed',
    })
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/** Take a passenger out of the car. The seat stays on the trip, waiting for another. */
export async function unassign(bookingId: string): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'pending', car_id: null })
    .eq('id', bookingId)
    .select(FLAT)
    .single()

  if (error) throw error
  return toBooking(data as BookingFlatRow)
}

/** Seats a +1 currently holds. Deleting the guest cascades these away. */
export async function countActiveSeatsForGuest(guestId: string): Promise<number> {
  const { count, error } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('guest_id', guestId)
    .neq('status', 'denied')

  if (error) throw error
  return count ?? 0
}

export async function cancelBooking(id: string): Promise<void> {
  const { data, error } = await supabase.from('bookings').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Seat was not cancelled - only whoever booked it, or an admin, can do that.')
  }
}
