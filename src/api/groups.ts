import { supabase } from '../lib/supabase'
import type { Group, GroupMemberWithProfile, GroupRow, TravelRole } from '../lib/types'

const COLUMNS = 'id, name, description, owner_id, created_at'

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  }
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  return userId
}

export interface GroupInput {
  name: string
  description?: string | null
}

/** A group I am in, together with my own switches in it. */
export interface MyGroup extends Group {
  canCreateTrips: boolean
  canManageTrips: boolean
  canManageMembers: boolean
  travelRole: TravelRole
}

interface MyGroupRow extends GroupRow {
  group_members: {
    can_create_trips: boolean
    can_manage_trips: boolean
    can_manage_members: boolean
    travel_role: TravelRole
  }[]
}

/**
 * The groups I am in. No `where` on groups: the groups_select policy is the filter.
 *
 * The inner join on my own membership row does two things - it brings my switches back in
 * the same query instead of one lookup per group, and it keeps a site admin (who may read
 * every group) from seeing all of them under "my groups".
 */
export async function listMyGroups(): Promise<MyGroup[]> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('groups')
    .select(
      `${COLUMNS}, group_members!inner ` +
        '(can_create_trips, can_manage_trips, can_manage_members, travel_role)',
    )
    .eq('group_members.profile_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error

  // Cast through unknown: group_members is one-to-many from groups, so PostgREST returns
  // an array, and the filter above leaves exactly my own row in it.
  return (data as unknown as MyGroupRow[]).map((row) => {
    const mine = row.group_members[0]
    return {
      ...toGroup(row),
      canCreateTrips: mine?.can_create_trips ?? false,
      canManageTrips: mine?.can_manage_trips ?? false,
      canManageMembers: mine?.can_manage_members ?? false,
      travelRole: mine?.travel_role ?? 'passenger',
    }
  })
}

/** What I may do in one group: my own switches, plus whether the group is mine. */
export interface GroupRights {
  /** The owner may do anything in their group with no switch ticked. */
  isOwner: boolean
  canCreateTrips: boolean
  canManageTrips: boolean
  canManageMembers: boolean
  travelRole: TravelRole
}

interface GroupRightsRow {
  owner_id: string | null
  group_members: {
    can_create_trips: boolean
    can_manage_trips: boolean
    can_manage_members: boolean
    travel_role: TravelRole
  }[]
}

/**
 * My rights in one group, for a page that already knows the group id. One query: the
 * embedded filter narrows group_members to my own row without narrowing the group itself,
 * so a site admin - who may read any group but is a member of none - still gets an answer.
 *
 * Null only when the group is unreadable, which on a trip page cannot happen: the trip and
 * the group are behind the same is_group_member() check.
 */
export async function getMyGroupRights(groupId: string): Promise<GroupRights | null> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('groups')
    .select(
      'owner_id, group_members ' +
        '(can_create_trips, can_manage_trips, can_manage_members, travel_role)',
    )
    .eq('id', groupId)
    .eq('group_members.profile_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  // Cast through unknown: group_members is one-to-many from groups, so PostgREST returns
  // an array, and the filter above leaves at most my own row in it.
  const row = data as unknown as GroupRightsRow
  const mine = row.group_members[0]
  return {
    isOwner: row.owner_id === userId,
    canCreateTrips: mine?.can_create_trips ?? false,
    canManageTrips: mine?.can_manage_trips ?? false,
    canManageMembers: mine?.can_manage_members ?? false,
    travelRole: mine?.travel_role ?? 'passenger',
  }
}

/** Null when there is no such group *or* I am not in it - both are "not found" on screen. */
export async function getGroup(id: string): Promise<Group | null> {
  const { data, error } = await supabase.from('groups').select(COLUMNS).eq('id', id).maybeSingle()

  // The id comes straight from the URL, so it is not necessarily a uuid. Postgres rejects
  // a malformed one with 22P02; that is a missing group, not an error worth showing.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return data ? toGroup(data as GroupRow) : null
}

export async function createGroup(input: GroupInput): Promise<Group> {
  const userId = await currentUserId()

  // The id is generated here rather than by the database because the insert below cannot
  // ask for the row back, and the group still has to be found afterwards.
  const id = crypto.randomUUID()

  // No .select() on purpose - the only write in the app where the usual pattern is wrong.
  // PostgREST checks the returned row against groups_select (is_group_member(id)), and at
  // that moment the after-insert trigger that creates the owner's membership row has not
  // taken effect, so the read fails with 42501 and rolls the insert back. Insert first,
  // read second.
  const { error } = await supabase.from('groups').insert({
    id,
    name: input.name,
    description: input.description ?? null,
    owner_id: userId,
  })

  if (error) throw error

  const { data, error: readError } = await supabase
    .from('groups')
    .select(COLUMNS)
    .eq('id', id)
    .single()

  if (readError) throw readError
  return toGroup(data as GroupRow)
}

export async function updateGroup(id: string, patch: GroupInput): Promise<Group> {
  // .single() throws when nothing comes back, which is what a refusal by RLS looks like -
  // an update the policy blocks reports zero rows rather than an error.
  const { data, error } = await supabase
    .from('groups')
    .update({ name: patch.name, description: patch.description ?? null })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toGroup(data as GroupRow)
}

export async function deleteGroup(id: string): Promise<void> {
  const { data, error } = await supabase.from('groups').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Group was not deleted - only its owner or an admin can do that.')
  }
}

/**
 * Handing the group over is one statement: ownership is one column. The previous owner
 * keeps their membership and drops to a plain member by construction. The database refuses
 * a new owner who is not already a member, and refuses a null.
 */
export async function transferOwnership(groupId: string, profileId: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .update({ owner_id: profileId })
    .eq('id', groupId)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return toGroup(data as GroupRow)
}

// --- members ---------------------------------------------------------------

interface MemberJoinRow {
  group_id: string
  profile_id: string
  can_create_trips: boolean
  can_manage_trips: boolean
  can_manage_members: boolean
  travel_role: TravelRole
  joined_at: string
  profiles: {
    display_name: string
    photo_url: string | null
  } | null
}

export async function listMembers(groupId: string): Promise<GroupMemberWithProfile[]> {
  // One query with the profile joined in, not one lookup per member.
  const { data, error } = await supabase
    .from('group_members')
    .select(
      'group_id, profile_id, can_create_trips, can_manage_trips, can_manage_members, ' +
        'travel_role, joined_at, profiles (display_name, photo_url)',
    )
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })

  if (error) throw error

  // Cast through unknown: without generated database types supabase-js infers the embedded
  // profile as an array, but PostgREST returns a single object for a many-to-one.
  return (data as unknown as MemberJoinRow[]).map((row) => ({
    groupId: row.group_id,
    profileId: row.profile_id,
    canCreateTrips: row.can_create_trips,
    canManageTrips: row.can_manage_trips,
    canManageMembers: row.can_manage_members,
    travelRole: row.travel_role,
    joinedAt: row.joined_at,
    displayName: row.profiles?.display_name ?? 'Unknown',
    photoUrl: row.profiles?.photo_url ?? null,
  }))
}

/** One column at a time, which is how the roster ticks them. */
export interface PermissionPatch {
  canCreateTrips?: boolean
  canManageTrips?: boolean
  canManageMembers?: boolean
}

/**
 * Owner only. A member manager reaches the row through the update policy but is stopped by
 * guard_group_membership(), which raises a message worth showing.
 */
export async function setMemberPermissions(
  groupId: string,
  profileId: string,
  patch: PermissionPatch,
): Promise<void> {
  const row: Record<string, boolean> = {}
  if (patch.canCreateTrips !== undefined) row.can_create_trips = patch.canCreateTrips
  if (patch.canManageTrips !== undefined) row.can_manage_trips = patch.canManageTrips
  if (patch.canManageMembers !== undefined) row.can_manage_members = patch.canManageMembers

  // Not .single(): a refusal here is zero rows, and .single() reports that as "JSON object
  // requested, multiple (or no) rows returned", which tells the person nothing. The guard
  // trigger's own messages still come through as errors.
  const { data, error } = await supabase
    .from('group_members')
    .update(row)
    .eq('group_id', groupId)
    .eq('profile_id', profileId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Permissions were not changed - only the group owner can do that.')
  }
}

/** The owner or a member manager - except on somebody who holds a switch, who is the owner's. */
export async function setMemberTravelRole(
  groupId: string,
  profileId: string,
  travelRole: TravelRole,
): Promise<void> {
  const { data, error } = await supabase
    .from('group_members')
    .update({ travel_role: travelRole })
    .eq('group_id', groupId)
    .eq('profile_id', profileId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      'The travel role was not changed - they may have left the group, or you may no longer manage it.',
    )
  }
}

export async function removeMember(groupId: string, profileId: string): Promise<void> {
  const { data, error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('profile_id', profileId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Member was not removed - only the owner or someone who manages people can.')
  }
}

/** The owner cannot: the database raises "Hand the group to somebody else before leaving it". */
export async function leaveGroup(groupId: string): Promise<void> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('profile_id', userId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) throw new Error('You are not a member of this group.')
}
