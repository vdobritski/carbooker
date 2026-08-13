import { supabase } from '../lib/supabase'
import type { Profile, ProfileRow, Role } from '../lib/types'

const COLUMNS = 'id, display_name, photo_url, description, role, created_at'

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    photoUrl: row.photo_url,
    description: row.description,
    role: row.role,
    createdAt: row.created_at,
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** The signed-in user's profile, or null when signed out. */
export async function getMyProfile(): Promise<Profile | null> {
  const userId = await currentUserId()
  if (!userId) return null

  const { data, error } = await supabase
    .from('profiles')
    .select(COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data ? toProfile(data as ProfileRow) : null
}

/** Everyone, for the admin page. Any signed-in user may read profiles. */
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(COLUMNS)
    .order('display_name', { ascending: true })

  if (error) throw error
  return (data as ProfileRow[]).map(toProfile)
}

/**
 * Admin only. The guard_role_change() trigger refuses everyone else, so a non-admin
 * calling this gets an error rather than a silent no-op.
 */
export async function setRole(profileId: string, role: Role): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', profileId)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toProfile(data as ProfileRow)
}

/**
 * Update your own profile. `role` is deliberately not accepted here - it is admin-only
 * and changed via setRole(). The database enforces that regardless.
 */
export async function updateMyProfile(patch: {
  displayName?: string
  photoUrl?: string | null
  description?: string | null
}): Promise<Profile> {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const row: Partial<ProfileRow> = {}
  if (patch.displayName !== undefined) row.display_name = patch.displayName
  if (patch.photoUrl !== undefined) row.photo_url = patch.photoUrl
  if (patch.description !== undefined) row.description = patch.description

  const { data, error } = await supabase
    .from('profiles')
    .update(row)
    .eq('id', userId)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toProfile(data as ProfileRow)
}
