import { supabase } from '../lib/supabase'
import type { CarWithDriver } from '../lib/types'

const COLUMNS =
  'id, trip_id, driver_id, title, description, features, seat_count, created_at, profiles (display_name, photo_url)'

interface CarJoinRow {
  id: string
  trip_id: string
  driver_id: string
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
    driverName: row.profiles?.display_name ?? 'Unknown',
    driverPhotoUrl: row.profiles?.photo_url ?? null,
  }
}

export interface CarInput {
  title: string
  description?: string | null
  features: string[]
  seatCount: number
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

export async function createCar(tripId: string, input: CarInput): Promise<CarWithDriver> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('cars')
    .insert({
      trip_id: tripId,
      driver_id: userId,
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
  // .single() throws on zero rows, which is how an RLS refusal arrives.
  const { data, error } = await supabase
    .from('cars')
    .update({
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
    throw new Error('Car was not deleted - only its driver or an admin can do that.')
  }
}
