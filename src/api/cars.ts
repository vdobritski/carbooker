import { supabase } from '../lib/supabase'
import type { CarWithDriver } from '../lib/types'

const COLUMNS =
  'id, trip_id, driver_id, driver_name, title, description, features, seat_count, created_at, profiles (display_name, photo_url)'

interface CarJoinRow {
  id: string
  trip_id: string
  driver_id: string | null
  driver_name: string | null
  title: string
  description: string | null
  features: string[]
  seat_count: number
  created_at: string
  profiles: { display_name: string; photo_url: string | null } | null
}

function toCar(row: CarJoinRow): CarWithDriver {
  return {
    id: row.id,
    tripId: row.trip_id,
    driverId: row.driver_id,
    title: row.title,
    description: row.description,
    features: row.features ?? [],
    seatCount: row.seat_count,
    createdAt: row.created_at,
    // The embed is null when driver_id is, so the typed-in name takes over. 'Unknown' is
    // now only reachable if the profile itself is unreadable, which the group policies
    // make unlikely - a car and its driver are in the same group as the viewer.
    driverName: row.profiles?.display_name ?? row.driver_name ?? 'Unknown',
    driverPhotoUrl: row.profiles?.photo_url ?? null,
  }
}

/**
 * Who drives. Either a member of the trip's group or a plain name - the database has a
 * check constraint saying exactly one, and this shape is that constraint in TypeScript, so
 * "both set" is not a state the app can build by accident.
 */
export type CarDriver = { kind: 'member'; profileId: string } | { kind: 'name'; name: string }

/** The driver columns for an insert or update, from the one field the UI actually holds. */
function driverColumns(driver: CarDriver): { driver_id: string | null; driver_name: string | null } {
  return driver.kind === 'member'
    ? { driver_id: driver.profileId, driver_name: null }
    : { driver_id: null, driver_name: driver.name }
}

export interface CarInput {
  title: string
  description?: string | null
  features: string[]
  seatCount: number
  driver: CarDriver
}

/** Splits the comma-separated feature input. Empty input gives [], never ['']. */
export function parseFeatures(input: string): string[] {
  return input
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
}

export async function listCars(tripId: string): Promise<CarWithDriver[]> {
  const { data, error } = await supabase
    .from('cars')
    .select(COLUMNS)
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as unknown as CarJoinRow[]).map(toCar)
}

export async function getCar(id: string): Promise<CarWithDriver | null> {
  const { data, error } = await supabase.from('cars').select(COLUMNS).eq('id', id).maybeSingle()

  // A non-uuid in the URL is a missing car, not an error worth showing.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return data ? toCar(data as unknown as CarJoinRow) : null
}

/**
 * Registering my own car needs the group's driver switch; naming anybody else needs to run
 * the trip. Both are the cars_insert policy's job - sending a driver the caller may not set
 * comes back as a refusal, not as a car with the wrong driver.
 */
export async function createCar(tripId: string, input: CarInput): Promise<CarWithDriver> {
  const { data, error } = await supabase
    .from('cars')
    .insert({
      trip_id: tripId,
      ...driverColumns(input.driver),
      title: input.title,
      description: input.description ?? null,
      features: input.features,
      seat_count: input.seatCount,
    })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toCar(data as unknown as CarJoinRow)
}

export async function updateCar(id: string, patch: CarInput): Promise<CarWithDriver> {
  // .single() throws on zero rows, which is how an RLS refusal arrives. Changing the driver
  // is refused by guard_car_identity() instead, with a message, because the update policy
  // lets the car's own driver reach the row and only the trip's managers may hand it on.
  const { data, error } = await supabase
    .from('cars')
    .update({
      ...driverColumns(patch.driver),
      title: patch.title,
      description: patch.description ?? null,
      features: patch.features,
      seat_count: patch.seatCount,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toCar(data as unknown as CarJoinRow)
}

export async function deleteCar(id: string): Promise<void> {
  const { data, error } = await supabase.from('cars').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      'Car was not deleted - that needs to be your car, or "can manage anyone\'s trip" in the group.',
    )
  }
}
