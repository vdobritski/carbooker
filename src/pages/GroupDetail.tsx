import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteGroup,
  getGroup,
  leaveGroup,
  listMembers,
  removeMember,
  setMemberPermissions,
  setMemberTravelRole,
  transferOwnership,
  updateGroup,
} from '../api/groups'
import type { PermissionPatch } from '../api/groups'
import {
  acceptRequest,
  createInvite,
  getInvite,
  listJoinRequests,
  myRequest,
  previewGroup,
  rejectRequest,
  requestAccess,
  revokeInvite,
  withdrawRequest,
} from '../api/groupAccess'
import { listGroupTrips } from '../api/trips'
import { useAuth } from '../auth/AuthProvider'
import MemberList from '../components/MemberList'
import { errorMessage } from '../lib/errors'
import type {
  Group,
  GroupInvite,
  GroupJoinRequest,
  GroupMemberWithProfile,
  JoinRequestWithProfile,
  TravelRole,
  Trip,
} from '../lib/types'
import { DateRange } from './Trips'

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  // undefined = still loading, null = no such group, or one I am not in
  const [group, setGroup] = useState<Group | null | undefined>(undefined)
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [error, setError] = useState<string | null>(null)
  /** A read that failed, as opposed to a group that is not there. Kept apart on purpose. */
  const [loadFailure, setLoadFailure] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  // Members only. Both come back empty for anybody else: the policies are the filter, not
  // a `canManageMembers &&` around the fetch.
  const [invite, setInvite] = useState<GroupInvite | null>(null)
  const [requests, setRequests] = useState<JoinRequestWithProfile[]>([])
  const [copied, setCopied] = useState(false)

  // Non-members only: the group's name, and my own request for it.
  const [preview, setPreview] = useState<string | null>(null)
  const [mine, setMine] = useState<GroupJoinRequest | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [newOwnerId, setNewOwnerId] = useState('')

  // The page owns the roster: MemberList keeps no copy, so every write below refetches
  // here and the two cannot drift apart.
  //
  // setGroup comes last in both branches. It is what the render switches on, so setting it
  // first would flash "not a member" before the name arrived.
  const load = useCallback(async () => {
    if (!id) return
    try {
      const found = await getGroup(id)
      if (found) {
        const [nextMembers, nextTrips, nextInvite, nextRequests] = await Promise.all([
          listMembers(id),
          listGroupTrips(id),
          getInvite(id),
          listJoinRequests(id),
        ])
        setMembers(nextMembers)
        setTrips(nextTrips)
        setInvite(nextInvite)
        setRequests(nextRequests)
        setPreview(null)
        setMine(null)
      } else {
        // Not a member, or no such group. previewGroup() tells the two apart, and is the
        // only thing about the group that leaves it.
        const [nextPreview, nextMine] = await Promise.all([previewGroup(id), myRequest(id)])
        setMembers([])
        setTrips([])
        setInvite(null)
        setRequests([])
        setPreview(nextPreview)
        setMine(nextMine)
      }
      setGroup(found)
      setLoadFailure(null)
    } catch (err: unknown) {
      // A failed read is a failed read. setGroup(null) here would be a lie - null is what
      // this page renders as "no such group, or you are not in it", so one dropped request
      // after a successful write used to tell an owner they were not a member of their own
      // group. Leave whatever is on screen and say what actually happened.
      setLoadFailure(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Keyed on the group id so a reload after some other change does not overwrite what is
  // being typed into the edit form. That also means the fields survive closing the form,
  // so Cancel has to put them back itself - otherwise an abandoned edit reappears the next
  // time the form is opened, and saving it renames the group to text that was cancelled.
  const groupId = group?.id
  useEffect(() => {
    if (!group) return
    setName(group.name)
    setDescription(group.description ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  function cancelEdit() {
    if (group) {
      setName(group.name)
      setDescription(group.description ?? '')
    }
    setError(null)
    setEditing(false)
  }

  // Nothing loaded and the read failed - the only case where the page has nothing to show.
  if (group === undefined && loadFailure !== null) {
    return (
      <main>
        <h1>Could not load this group</h1>
        <p className="muted">
          Something went wrong reading it. This does not mean the group is gone.
        </p>
        <p className="error">{loadFailure}</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void load()}>
            Try again
          </button>
          <Link to="/groups">Back to groups</Link>
        </div>
      </main>
    )
  }

  if (group === undefined) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  // Not a member. The name is all this page can show - no description, no roster, no
  // trips, no owner - and it comes from group_preview(), not from a widened policy.
  if (group === null) {
    return (
      <main>
        <p className="muted">
          <Link to="/groups">← Groups</Link>
        </p>

        {preview === null ? (
          <>
            <h1>Group not found</h1>
            <p className="muted">
              This link does not point at a group. It may have been deleted, or the address
              may be wrong.
            </p>
          </>
        ) : (
          <>
            <h1>{preview}</h1>
            <p className="muted">
              You are not a member of this group, so you cannot see its trips or who is in
              it.
            </p>

            {mine === null && (
              <button type="button" onClick={ask} disabled={busy}>
                Request access
              </button>
            )}

            {mine?.status === 'pending' && (
              <>
                <p>Your request is waiting for a decision.</p>
                <button type="button" onClick={withdraw} disabled={busy}>
                  Withdraw request
                </button>
              </>
            )}

            {mine?.status === 'rejected' && (
              <>
                <p>Your request was declined.</p>
                <button type="button" onClick={ask} disabled={busy}>
                  Ask again
                </button>
              </>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  const currentUserId = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'
  const isOwner = group.ownerId !== null && group.ownerId === currentUserId
  const ownerless = group.ownerId === null
  const myMembership = members.find((m) => m.profileId === currentUserId)

  // Granting a switch, renaming, transferring and deleting are the owner's - and a site
  // admin's, which is the only way an ownerless group can be fixed.
  const canGrantPermissions = isOwner || isAdmin
  const canManageMembers = canGrantPermissions || myMembership?.canManageMembers === true

  // The link people paste into a chat. window.location.pathname is the Vite base ('/' in
  // dev, '/carbooker/' on Pages), and the route lives after the hash like every other one.
  const inviteUrl = invite
    ? `${window.location.origin}${window.location.pathname}#/join/${invite.token}`
    : null

  // Somebody accepted through another browser tab, or by an invite link, leaves a request
  // row behind if the delete half of acceptRequest() failed. Filtering against the roster
  // keeps them out of the queue without a repair job.
  const queue = requests.filter((r) => !members.some((m) => m.profileId === r.profileId))
  const pendingCount = queue.filter((r) => r.status === 'pending').length

  async function withBusy(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err))
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Both of these run from the non-member branch above, which is rendered before they are
  // declared - function declarations are hoisted, so that is fine.
  async function ask() {
    if (!id) return
    await withBusy(() => requestAccess(id))
  }

  async function withdraw() {
    if (!id) return
    await withBusy(() => withdrawRequest(id))
  }

  // Creating a link when one exists replaces it: the group id is the primary key, so the
  // old token is gone and the old link is dead.
  async function makeLink() {
    if (!id) return
    setCopied(false)
    await withBusy(() => createInvite(id))
  }

  async function dropLink() {
    if (!id) return
    if (!window.confirm('Revoke this link? Anybody still holding it will not get in.')) return
    setCopied(false)
    await withBusy(() => revokeInvite(id))
  }

  async function copyLink() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch (err: unknown) {
      // Clipboard access can be refused - the link is on screen either way.
      setError(errorMessage(err))
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await updateGroup(id, { name: name.trim(), description: description.trim() || null })
      await load()
      setEditing(false)
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!id) return
    if (!window.confirm('Delete this group? Its trips, and everything on them, go with it.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteGroup(id)
      navigate('/groups', { replace: true })
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function transfer() {
    if (!id || !newOwnerId) return
    const to = members.find((m) => m.profileId === newOwnerId)?.displayName ?? 'them'
    const warning = isOwner
      ? `Hand this group to ${to}? You stay a member, but you drop to a plain member with ` +
        'no permissions: only they will be able to rename the group, grant permissions, ' +
        'transfer it or delete it.'
      : `Make ${to} the owner of this group? They will be able to rename it, grant ` +
        'permissions, transfer it and delete it.'
    if (!window.confirm(warning)) return
    await withBusy(() => transferOwnership(id, newOwnerId))
    setNewOwnerId('')
  }

  async function leave() {
    if (!id) return
    if (!window.confirm('Leave this group?')) return
    setBusy(true)
    setError(null)
    try {
      await leaveGroup(id)
      navigate('/groups', { replace: true })
    } catch (err: unknown) {
      setError(errorMessage(err))
      setBusy(false)
      await load()
    }
  }

  if (editing) {
    return (
      <main>
        <h1>Edit group</h1>
        <form onSubmit={save}>
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="link" onClick={cancelEdit}>
            Cancel
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  const transferable = members.filter((m) => m.profileId !== group.ownerId)

  return (
    <main>
      <p className="muted">
        <Link to="/groups">← Groups</Link>
      </p>

      <h1>{group.name}</h1>

      {group.description && <p>{group.description}</p>}

      {ownerless && (
        <p className="muted">
          This group has no owner — the account that owned it was deleted. Until a site
          admin makes somebody the owner, nobody can rename it, grant permissions, hand it
          over or delete it.
        </p>
      )}

      <h2>Trips ({trips.length})</h2>

      {trips.length === 0 ? (
        <p className="muted">No trips in this group yet.</p>
      ) : (
        <ul className="cards">
          {trips.map((trip) => (
            <li key={trip.id} className="card">
              <Link to={`/trips/${trip.id}`}>
                <strong>{trip.name}</strong>
              </Link>
              <DateRange startsOn={trip.startsOn} endsOn={trip.endsOn} />
            </li>
          ))}
        </ul>
      )}

      {/* Trips are started in one place, the form on /trips with its group picker. */}
      <p className="muted">
        Trips are started on <Link to="/trips">Trips</Link>.
      </p>

      <h2>Members ({members.length})</h2>

      <MemberList
        members={members}
        ownerId={group.ownerId}
        currentUserId={currentUserId}
        canGrantPermissions={canGrantPermissions}
        canManageMembers={canManageMembers}
        busy={busy}
        onSetPermission={(profileId: string, patch: PermissionPatch) =>
          withBusy(() => setMemberPermissions(group.id, profileId, patch))
        }
        onSetTravelRole={(profileId: string, travelRole: TravelRole) =>
          withBusy(() => setMemberTravelRole(group.id, profileId, travelRole))
        }
        onRemove={(profileId: string) => withBusy(() => removeMember(group.id, profileId))}
      />

      {canManageMembers && !canGrantPermissions && (
        <p className="muted">
          You can set travel roles and remove people. Only the owner grants permissions.
        </p>
      )}

      {/* Both sections are for member managers. Everyone else gets zero rows from
          group_invites and group_join_requests, so there is nothing to hide here anyway -
          this only keeps two empty headings off their screen. */}
      {canManageMembers && (
        <>
          <h2>Invite link</h2>

          {inviteUrl ? (
            <>
              <p className="invite-link">{inviteUrl}</p>
              <div className="row">
                <button type="button" onClick={copyLink} disabled={busy}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" onClick={makeLink} disabled={busy}>
                  Replace with a new link
                </button>
                <button type="button" onClick={dropLink} disabled={busy}>
                  Revoke
                </button>
              </div>
              <p className="muted">
                Anybody signed in who opens this link joins as a plain member — no
                permissions, travel role passenger. Replacing or revoking it kills the old
                link.
              </p>
            </>
          ) : (
            <>
              <p className="muted">
                There is no invite link. Create one to let people in without approving each
                request.
              </p>
              <button type="button" onClick={makeLink} disabled={busy}>
                Create invite link
              </button>
            </>
          )}

          <h2>Requests to join ({pendingCount})</h2>

          {queue.length === 0 ? (
            <p className="muted">Nobody is waiting.</p>
          ) : (
            <ul className="cards">
              {queue.map((request) => (
                <li key={request.profileId} className="card">
                  <div className="person">
                    {request.photoUrl ? (
                      <img className="avatar-sm" src={request.photoUrl} alt="" />
                    ) : (
                      <span className="avatar-sm placeholder" aria-hidden="true" />
                    )}

                    <span>
                      {request.displayName}
                      {request.status === 'rejected' && <span className="muted"> (declined)</span>}
                    </span>

                    <span className="spacer" />

                    {request.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            withBusy(() => acceptRequest(group.id, request.profileId))
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="link"
                          disabled={busy}
                          onClick={() =>
                            withBusy(() => rejectRequest(group.id, request.profileId))
                          }
                        >
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {isOwner ? (
        <p className="muted">
          The owner cannot leave the group — transfer it to somebody else, or delete it.
        </p>
      ) : (
        myMembership && (
          <button type="button" onClick={leave} disabled={busy}>
            Leave group
          </button>
        )
      )}

      {canGrantPermissions && (
        <>
          <h2>The group itself</h2>

          <div className="row">
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </button>
            <button type="button" onClick={remove} disabled={busy}>
              Delete
            </button>
          </div>

          <label htmlFor="newOwner">Hand the group to</label>
          <select
            id="newOwner"
            value={newOwnerId}
            disabled={busy || transferable.length === 0}
            onChange={(e) => setNewOwnerId(e.target.value)}
          >
            <option value="">Choose a member…</option>
            {transferable.map((m) => (
              <option key={m.profileId} value={m.profileId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <button type="button" onClick={transfer} disabled={busy || !newOwnerId}>
            Transfer ownership
          </button>
        </>
      )}

      {/* The page is still showing what it last loaded successfully - say it may be stale
          rather than replacing it with a "not found" that is not true. */}
      {loadFailure && (
        <p className="error">
          Could not refresh this page, so what you see may be out of date. {loadFailure}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
