// Getting into a group: the invite link, and the request queue. See 019_group_access.sql.
//
// Two of these are RPCs, and they are the only two in the codebase - docs/architecture.md
// says why each exists. Both are cases where the caller has no rights on the group at the
// moment they call, so no row-level policy can express what is needed. A third RPC needs
// the same argument made in writing, or it is a policy written badly.

import { supabase } from '../lib/supabase'
import type {
  GroupInvite,
  GroupInviteRow,
  GroupJoinRequest,
  GroupJoinRequestRow,
  JoinRequestWithProfile,
} from '../lib/types'

const INVITE_COLUMNS = 'group_id, token, created_by, created_at'
const REQUEST_COLUMNS = 'group_id, profile_id, status, note, created_at'

function toInvite(row: GroupInviteRow): GroupInvite {
  return {
    groupId: row.group_id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function toRequest(row: GroupJoinRequestRow): GroupJoinRequest {
  return {
    groupId: row.group_id,
    profileId: row.profile_id,
    status: row.status,
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

// --- the invite link -------------------------------------------------------

/**
 * Null when there is no link, and also when I am not allowed to see it: group_invites_all
 * only lets a member manager reach the row, and a refused select is zero rows, not an
 * error. A plain member therefore gets null and never learns the token.
 */
export async function getInvite(groupId: string): Promise<GroupInvite | null> {
  const { data, error } = await supabase
    .from('group_invites')
    .select(INVITE_COLUMNS)
    .eq('group_id', groupId)
    .maybeSingle()

  // The id comes from the URL, so it is not necessarily a uuid - same 22P02 handling as
  // getGroup(). A malformed id has no invite; that is not an error worth showing.
  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return data ? toInvite(data as GroupInviteRow) : null
}

/**
 * Create the link, or replace it with a new one - the group id is the primary key, so
 * regenerating is a delete plus an insert. The token itself comes from the column default.
 *
 * Unlike createGroup this keeps .select(): group_invites_all's using clause is
 * can_manage_members_in(group_id), which was already true before the insert, so reading
 * the row back cannot fail the way the groups one did.
 */
export async function createInvite(groupId: string): Promise<GroupInvite> {
  const userId = await currentUserId()

  const { error: deleteError } = await supabase
    .from('group_invites')
    .delete()
    .eq('group_id', groupId)

  if (deleteError) throw deleteError

  const { data, error } = await supabase
    .from('group_invites')
    .insert({ group_id: groupId, created_by: userId })
    .select(INVITE_COLUMNS)
    .single()

  if (error) throw error
  return toInvite(data as GroupInviteRow)
}

export async function revokeInvite(groupId: string): Promise<void> {
  const { data, error } = await supabase
    .from('group_invites')
    .delete()
    .eq('group_id', groupId)
    .select('group_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The link was not revoked - only the owner or someone who manages people can.')
  }
}

/**
 * Follow a link. Returns the group id, which is where the page goes next.
 *
 * Everything that can go wrong comes back as a message from the function: an unknown token
 * is "That invite link is not valid any more". Joining twice is a no-op, not an error, and
 * does not reset anything granted since the first visit.
 */
export async function joinByInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group_by_invite', { invite_token: token })
  if (error) throw error
  return data as string
}

// --- asking to be let in ---------------------------------------------------

/**
 * The name of a group I am not in, from its id. Null when there is no such group - or when
 * the id in the link is not a uuid at all, which reads the same way on screen.
 *
 * The name is all this returns. Not the description, not the roster, not the trips: those
 * are behind is_group_member() like everything else in the group.
 */
export async function previewGroup(groupId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('group_preview', { group_id: groupId })

  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return (data as string | null) ?? null
}

/**
 * Ask to be let in. The old row goes first: after a refusal the requester's row is still
 * there with status 'rejected', and asking again means replacing it - an upsert would need
 * the update policy, which is a manager's.
 */
export async function requestAccess(groupId: string): Promise<void> {
  const userId = await currentUserId()

  const { error: deleteError } = await supabase
    .from('group_join_requests')
    .delete()
    .eq('group_id', groupId)
    .eq('profile_id', userId)

  if (deleteError) throw deleteError

  // No .select(): the insert policy lets anybody signed in ask, for any group id, so a
  // refusal here would be an error rather than zero rows anyway.
  const { error } = await supabase
    .from('group_join_requests')
    .insert({ group_id: groupId, profile_id: userId })

  if (error) {
    // 23503: the group id in the link points at nothing. The raw message names a
    // constraint and helps nobody.
    if (error.code === '23503') throw new Error('There is no group at that link.')
    throw error
  }
}

/** My own request for one group, or null if I have not asked. */
export async function myRequest(groupId: string): Promise<GroupJoinRequest | null> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('group_join_requests')
    .select(REQUEST_COLUMNS)
    .eq('group_id', groupId)
    .eq('profile_id', userId)
    .maybeSingle()

  if (error) {
    if (error.code === '22P02') return null
    throw error
  }
  return data ? toRequest(data as GroupJoinRequestRow) : null
}

export async function withdrawRequest(groupId: string): Promise<void> {
  const userId = await currentUserId()

  const { data, error } = await supabase
    .from('group_join_requests')
    .delete()
    .eq('group_id', groupId)
    .eq('profile_id', userId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) throw new Error('There was no request to withdraw.')
}

// --- the queue -------------------------------------------------------------

interface RequestJoinRow extends GroupJoinRequestRow {
  profiles: {
    display_name: string
    photo_url: string | null
  } | null
}

/**
 * The queue, with names. Empty for anybody who does not manage people in this group - the
 * select policy is the filter.
 *
 * The name comes back because of the branch 019 added to profiles_select: a manager may
 * read the profile of somebody who has asked to join their group. If one ever renders as
 * 'Unknown', that policy is what to look at.
 */
export async function listJoinRequests(groupId: string): Promise<JoinRequestWithProfile[]> {
  const { data, error } = await supabase
    .from('group_join_requests')
    .select(`${REQUEST_COLUMNS}, profiles (display_name, photo_url)`)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  if (error) {
    if (error.code === '22P02') return []
    throw error
  }

  // Cast through unknown: without generated database types supabase-js infers the embedded
  // profile as an array, but PostgREST returns a single object for a many-to-one.
  return (data as unknown as RequestJoinRow[]).map((row) => ({
    ...toRequest(row),
    displayName: row.profiles?.display_name ?? 'Unknown',
    photoUrl: row.profiles?.photo_url ?? null,
  }))
}

/**
 * Two writes, on purpose: add the membership, then drop the request. If the second fails
 * the queue keeps a stale entry and nothing worse, which is why the page filters the queue
 * against the roster. An RPC wrapping both would buy atomicity nobody needs.
 *
 * Accepting somebody who is already a member is harmless: on conflict do nothing.
 */
export async function acceptRequest(groupId: string, profileId: string): Promise<void> {
  // Not zero rows if refused - an insert the policy blocks is a 42501 error, which the
  // caller shows. ignoreDuplicates is what makes the already-a-member case a no-op.
  const { error } = await supabase
    .from('group_members')
    .upsert(
      { group_id: groupId, profile_id: profileId },
      { onConflict: 'group_id,profile_id', ignoreDuplicates: true },
    )

  if (error) throw error

  const { error: deleteError } = await supabase
    .from('group_join_requests')
    .delete()
    .eq('group_id', groupId)
    .eq('profile_id', profileId)

  if (deleteError) throw deleteError
}

/** The row stays, with the answer on it, so the person can see they were turned down. */
export async function rejectRequest(groupId: string, profileId: string): Promise<void> {
  const { data, error } = await supabase
    .from('group_join_requests')
    .update({ status: 'rejected' })
    .eq('group_id', groupId)
    .eq('profile_id', profileId)
    .select('profile_id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The request was not declined - only the owner or someone who manages people can.')
  }
}
