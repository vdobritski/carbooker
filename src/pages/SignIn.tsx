import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

/**
 * Email + 6-digit code. Deliberately not a magic link: the redirect would land tokens in
 * the URL fragment, which collides with hash routing on GitHub Pages.
 */
export default function SignIn() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }
  if (session) return <Navigate to="/trips" replace />

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: sendError } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setBusy(false)
    if (sendError) {
      setError(sendError.message)
      return
    }
    setSent(true)
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (verifyError) {
      setError(verifyError.message)
      return
    }
    // On success AuthProvider picks up the session and the <Navigate> above takes over.
  }

  return (
    <main>
      <h1>Carbooker</h1>

      {!sent ? (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Your email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p className="muted">We sent a 6-digit code to {email}.</p>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSent(false)
              setCode('')
              setError(null)
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
