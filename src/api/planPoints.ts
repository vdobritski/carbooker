import { supabase } from '../lib/supabase'
import type { TripPlanPoint, TripPlanPointRow } from '../lib/types'

const COLUMNS = 'id, trip_id, day, at_time, title, url, sort_order, created_at'

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
    sortOrder: row.sort_order,
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
 * The whole itinerary in one query, in the order somebody put it in. created_at only breaks
 * ties between two stops that were never dragged apart.
 */
export async function listPlanPoints(tripId: string): Promise<TripPlanPoint[]> {
  const { data, error } = await supabase
    .from('trip_plan_points')
    .select(COLUMNS)
    .eq('trip_id', tripId)
    .order('day', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as TripPlanPointRow[]).map(toPoint)
}

/**
 * Added at the end of its day. `after` is the stops already on that day, so the caller does
 * not need a second query to work out where the end is - and typing an itinerary in order
 * still comes out in order, without a drag.
 */
export async function createPlanPoint(
  tripId: string,
  input: PlanPointInput,
  sameDay: TripPlanPoint[],
): Promise<TripPlanPoint> {
  const last = sameDay.reduce((n, p) => Math.max(n, p.sortOrder), 0)

  const { data, error } = await supabase
    .from('trip_plan_points')
    .insert({ trip_id: tripId, ...columns(input), sort_order: last + 1 })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toPoint(data as TripPlanPointRow)
}

/**
 * Writes a whole day's order in one request. The database returns how many rows it moved,
 * because RLS filters rows rather than raising - without the count, a passenger dragging a
 * stop would see it snap back with no explanation instead of an error.
 */
export async function reorderPlanPoints(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const { data, error } = await supabase.rpc('reorder_plan_points', { ids })
  if (error) throw error
  if (data !== ids.length) {
    throw new Error('The new order was not saved - only somebody who runs this trip can reorder stops.')
  }
}

/**
 * A stop dragged into another day: the day and the destination's order in one transaction,
 * so a drag either lands or does not. `ids` is the destination day in its new order, the
 * moved stop included.
 */
export async function movePlanPoint(id: string, toDay: number, ids: string[]): Promise<void> {
  const { data, error } = await supabase.rpc('move_plan_point', {
    point: id,
    to_day: toDay,
    ordered: ids,
  })

  if (error) throw error
  if (data !== ids.length) {
    throw new Error('The stop was not moved - only somebody who runs this trip can change the plan.')
  }
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
