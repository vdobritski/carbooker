import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export default function NavBar() {
  const { profile, session, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <nav className="navbar">
      <Link to="/trips">Carbooker</Link>
      <span className="spacer" />
      {profile?.role === 'admin' && <Link to="/admin">People</Link>}
      <Link to="/me">{profile?.displayName ?? session?.user.email ?? 'Me'}</Link>
      <button type="button" onClick={handleSignOut}>
        Sign out
      </button>
    </nav>
  )
}
