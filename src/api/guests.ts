import { supabase } from '../lib/supabase'
import type { Guest, GuestRow } from '../lib/types'

const COLUMNS = 'id, host_id, name, note, created_at'

function toGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    hostId: row.host_id,
    name: row.name,
    note: row.note,
    createdAt: row.created_at,
  }
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  return userId
}

/**
 * Only my own +1s. Everyone can *read* every guest - a driver needs the name of the +1 in
 * their car - so this filter is what scopes the profile page, not the policy.
 */
export async function listMyGuests(): Promise<Guest[]> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('guests')
    .select(COLUMNS)
    .eq('host_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as GuestRow[]).map(toGuest)
}

/**
 * Everyone's +1s for a given set of hosts - what a driver needs to seat somebody else's
 * guest. The select policy is open precisely so this works.
 */
export async function listGuestsByHosts(hostIds: string[]): Promise<Guest[]> {
  if (hostIds.length === 0) return []

  const { data, error } = await supabase
    .from('guests')
    .select(COLUMNS)
    .in('host_id', hostIds)
    .order('name', { ascending: true })

  if (error) throw error
  return (data as GuestRow[]).map(toGuest)
}

export async function createGuest(input: { name: string; note?: string | null }): Promise<Guest> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('guests')
    .insert({ host_id: userId, name: input.name, note: input.note ?? null })
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toGuest(data as GuestRow)
}

export async function updateGuest(
  id: string,
  patch: { name: string; note?: string | null },
): Promise<Guest> {
  // .single() throws on zero rows, which is how an RLS refusal arrives.
  const { data, error } = await supabase
    .from('guests')
    .update({ name: patch.name, note: patch.note ?? null })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toGuest(data as GuestRow)
}

export async function deleteGuest(id: string): Promise<void> {
  // Task 07: a guest's bookings cascade away with them. Warn in the UI when the guest
  // currently holds a seat.
  const { data, error } = await supabase.from('guests').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Guest was not removed - only their host or an admin can do that.')
  }
}
