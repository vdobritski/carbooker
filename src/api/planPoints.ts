import { supabase } from '../lib/supabase'
import type { TripPlanPoint, TripPlanPointRow } from '../lib/types'

const COLUMNS = 'id, trip_id, day, at_time, title, url, created_at'

/**
 * Postgres returns a `time` as 'HH:MM:SS'; an <input type="time"> wants 'HH:MM' and shows
 * nothing at all for the longer form. Exported because the public page reads the same
 * values out of public_trip()'s json rather than through this module.
 */
export function shortTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5)
}

function toPoint(row: TripPlanPointRow): TripPlanPoint {
  return {
    id: row.id,
    tripId: row.trip_id,
    day: row.day,
    atTime: shortTime(row.at_time),
    title: row.title,
    url: row.url,
    createdAt: row.created_at,
  }
}

export interface PlanPointInput {
  day: number
  /** 'HH:MM' from an <input type="time">, or null for a stop with no time yet. */
  atTime: string | null
  title: string
  url: string | null
}

function columns(input: PlanPointInput) {
  return {
    day: input.day,
    at_time: input.atTime,
    title: input.title,
    url: input.url,
  }
}

/**
 * The whole itinerary in one query, in reading order. `nullsFirst: false` puts a stop with
 * no time at the end of its day, where it reads as "not placed yet" rather than as the
 * first thing that morning.
 */
export async function listPlanPoints(tripId: string): Promise<TripPlanPoint[]> {
  const { data, error } = await supabase
    .from('trip_plan_points')
    .select(COLUMNS)
    .eq('trip_id', tripId)
    .order('day', { ascending: true })
    .order('at_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as TripPlanPointRow[]).map(toPoint)
}

export async function createPlanPoint(
  tripId: string,
  input: PlanPointInput,
): Promise<TripPlanPoint> {
  const { data, error } = await supabase
    .from('trip_plan_points')
    .insert({ trip_id: tripId, ...columns(input) })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toPoint(data as TripPlanPointRow)
}

export async function updatePlanPoint(
  id: string,
  patch: PlanPointInput,
): Promise<TripPlanPoint> {
  // .single() throws on zero rows, which is how a refusal by RLS arrives - here, somebody
  // who does not run the trip.
  const { data, error } = await supabase
    .from('trip_plan_points')
    .update(columns(patch))
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toPoint(data as TripPlanPointRow)
}

export async function deletePlanPoint(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('trip_plan_points')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('That stop was not removed - only somebody who runs this trip can.')
  }
}
