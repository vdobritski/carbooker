import { supabase } from '../lib/supabase'
import type { SavedCar, SavedCarRow } from '../lib/types'

const COLUMNS = 'id, owner_id, title, description, features, seat_count, created_at'

function toSavedCar(row: SavedCarRow): SavedCar {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    features: row.features ?? [],
    seatCount: row.seat_count,
    createdAt: row.created_at,
  }
}

/** Same fields as CarInput in api/cars.ts - registering a saved car copies them across. */
export interface SavedCarInput {
  title: string
  description?: string | null
  features: string[]
  seatCount: number
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  return userId
}

/**
 * My garage. The policy already limits this to owner_id = auth.uid() (plus admins, who
 * would otherwise read everybody's), so the filter is what keeps an admin's list their own.
 */
export async function listMySavedCars(): Promise<SavedCar[]> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('saved_cars')
    .select(COLUMNS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as SavedCarRow[]).map(toSavedCar)
}

export async function createSavedCar(input: SavedCarInput): Promise<SavedCar> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('saved_cars')
    .insert({
      owner_id: userId,
      title: input.title,
      description: input.description ?? null,
      features: input.features,
      seat_count: input.seatCount,
    })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toSavedCar(data as SavedCarRow)
}

/** Changes the template only. Cars already registered on a trip from it are untouched. */
export async function updateSavedCar(id: string, patch: SavedCarInput): Promise<SavedCar> {
  const { data, error } = await supabase
    .from('saved_cars')
    .update({
      title: patch.title,
      description: patch.description ?? null,
      features: patch.features,
      seat_count: patch.seatCount,
    })
    .eq('id', id)
    .select(COLUMNS)

  if (error) throw error
  // A refused write returns zero rows rather than an error.
  if (!data || data.length === 0) {
    throw new Error('Car was not saved - only its owner or an admin can change it.')
  }
  return toSavedCar(data[0] as SavedCarRow)
}

/** Removes the template. No trip's car goes with it - nothing points at this row. */
export async function deleteSavedCar(id: string): Promise<void> {
  const { data, error } = await supabase.from('saved_cars').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Car was not removed - only its owner or an admin can do that.')
  }
}
