import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { joinByInvite } from '../api/groupAccess'
import { errorMessage } from '../lib/errors'

/**
 * /join/:token — follow an invite link. Nothing to fill in: opening the page is the answer,
 * so it joins on mount and goes straight to the group.
 *
 * The route is inside RequireAuth, so somebody signed out is sent to sign-in and the token
 * is lost. That is deliberate and the sign-in page says so: keeping the link across the
 * round trip would mean a redirect-back through AuthProvider for one screen that people
 * reach from a chat message they still have open.
 */
export default function JoinGroup() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  // StrictMode runs effects twice in development. Joining twice is a no-op in the database,
  // but the second run would race the navigation away from here.
  //
  // Keyed on the token, not a bare boolean: pasting a second link into the same tab only
  // changes the fragment, so this component is re-rendered rather than remounted. A boolean
  // would still be true, the effect would return immediately, and the page would sit on the
  // old link's error with no way forward but a manual reload.
  const attempted = useRef<string | null>(null)

  useEffect(() => {
    if (!token || attempted.current === token) return
    attempted.current = token
    setError(null)

    void (async () => {
      try {
        const groupId = await joinByInvite(token)
        navigate(`/groups/${groupId}`, { replace: true })
      } catch (err: unknown) {
        setError(errorMessage(err))
      }
    })()
  }, [token, navigate])

  if (error) {
    return (
      <main>
        <h1>That link did not work</h1>
        <p className="error">{error}</p>
        <p className="muted">
          Ask whoever sent it for a new one — a revoked link stops working, and a new link
          replaces the old.
        </p>
        <p>
          <Link to="/groups">Back to groups</Link>
        </p>
      </main>
    )
  }

  return (
    <main>
      <p className="muted">Joining…</p>
    </main>
  )
}
