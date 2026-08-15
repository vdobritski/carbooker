import type { ParticipantWithProfile } from '../lib/types'

interface Props {
  participants: ParticipantWithProfile[]
  creatorId: string | null
  currentUserId: string | null
  /** True for admins. The database refuses everyone else regardless. */
  canRemove: boolean
  onRemove: (profileId: string) => void
}

export default function ParticipantList({
  participants,
  creatorId,
  currentUserId,
  canRemove,
  onRemove,
}: Props) {
  if (participants.length === 0) {
    return <p className="muted">Nobody has joined yet.</p>
  }

  return (
    <ul className="people">
      {participants.map((p) => (
        <li key={p.profileId} className="person">
          {p.photoUrl ? (
            <img className="avatar-sm" src={p.photoUrl} alt="" />
          ) : (
            <span className="avatar-sm placeholder" aria-hidden="true" />
          )}

          <span>
            {p.displayName}
            {p.profileId === currentUserId && <span className="muted"> (you)</span>}
            {p.profileId === creatorId && <span className="badge">organiser</span>}
          </span>

          <span className="spacer" />

          {canRemove && p.profileId !== currentUserId && (
            <button type="button" className="link" onClick={() => onRemove(p.profileId)}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
