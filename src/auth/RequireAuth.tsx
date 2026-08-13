import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import NavBar from '../components/NavBar'

/**
 * Layout route for everything that needs a session: redirects to sign-in, and renders the
 * nav bar above the page so each page does not have to.
 */
export default function RequireAuth() {
  const { session, loading } = useAuth()

  // Redirecting while the session is still resolving would bounce a signed-in user out on
  // every refresh.
  if (loading) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!session) return <Navigate to="/" replace />

  return (
    <>
      <NavBar />
      <Outlet />
    </>
  )
}
