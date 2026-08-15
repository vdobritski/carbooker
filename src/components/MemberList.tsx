import type { PermissionPatch } from '../api/groups'
import type { GroupMemberWithProfile, TravelRole } from '../lib/types'

const TRAVEL_ROLES: TravelRole[] = ['passenger', 'driver']

interface Props {
  members: GroupMemberWithProfile[]
  ownerId: string | null
  currentUserId: string | null
  /** The owner (or a site admin): the only one who may tick the three switches. */
  canGrantPermissions: boolean
  /** The owner, a site admin, or a member with can_manage_members. */
  canManageMembers: boolean
  busy: boolean
  onSetPermission: (profileId: string, patch: PermissionPatch) => void
  onSetTravelRole: (profileId: string, travelRole: TravelRole) => void
  onRemove: (profileId: string) => void
}

/**
 * The roster. It holds no state of its own - the page owns the members and refetches after
 * every write, so a tick that the database refused cannot stay ticked here.
 */
export default function MemberList({
  members,
  ownerId,
  currentUserId,
  canGrantPermissions,
  canManageMembers,
  busy,
  onSetPermission,
  onSetTravelRole,
  onRemove,
}: Props) {
  if (members.length === 0) return <p className="muted">Nobody is in this group.</p>

  return (
    <ul className="cards">
      {members.map((m) => {
        const isOwner = m.profileId === ownerId
        return (
          <li key={m.profileId} className="card">
            <div className="person">
              {m.photoUrl ? (
                <img className="avatar-sm" src={m.photoUrl} alt="" />
              ) : (
                <span className="avatar-sm placeholder" aria-hidden="true" />
              )}

              <span>
                {m.displayName}
                {m.profileId === currentUserId && <span className="muted"> (you)</span>}
                {isOwner && <span className="badge">owner</span>}
                {m.travelRole === 'driver' && <span className="badge">driver</span>}
              </span>

              <span className="spacer" />

              {canManageMembers && (
                <select
                  aria-label={`Travel role for ${m.displayName}`}
                  value={m.travelRole}
                  disabled={busy}
                  onChange={(e) => onSetTravelRole(m.profileId, e.target.value as TravelRole)}
                >
                  {TRAVEL_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              )}

              {canManageMembers && !isOwner && m.profileId !== currentUserId && (
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => onRemove(m.profileId)}
                >
                  Remove
                </button>
              )}
            </div>

            {/* The owner needs no switches: ownership already covers everything. */}
            {canManageMembers && !isOwner && (
              <div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={m.canCreateTrips}
                    disabled={busy || !canGrantPermissions}
                    onChange={(e) =>
                      onSetPermission(m.profileId, { canCreateTrips: e.target.checked })
                    }
                  />
                  can start trips
                </label>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={m.canManageTrips}
                    disabled={busy || !canGrantPermissions}
                    onChange={(e) =>
                      onSetPermission(m.profileId, { canManageTrips: e.target.checked })
                    }
                  />
                  can manage anyone&apos;s trip
                </label>
                <p className="muted">
                  Covers editing and deleting other people&apos;s trips, and moving their seats.
                </p>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={m.canManageMembers}
                    disabled={busy || !canGrantPermissions}
                    onChange={(e) =>
                      onSetPermission(m.profileId, { canManageMembers: e.target.checked })
                    }
                  />
                  can manage people
                </label>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
