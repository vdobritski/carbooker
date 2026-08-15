import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/errors'

type Mode = 'password' | 'code' | 'register'

/**
 * Three ways in, all on one screen.
 *
 * - password: email + password, the ordinary one.
 * - code: email + a 6-digit code. Deliberately not a magic link - the redirect lands the
 *   session tokens in the URL fragment, and HashRouter rewrites the fragment before
 *   supabase-js can read them, so the session is discarded. Verified on the deployed site.
 * - register: email + password + the name other people will see.
 *
 * Registering needs "Allow new users to sign up" on in Supabase, and email confirmation
 * off - a confirmation link hits the same fragment collision as a magic link. See README.
 */
export default function SignIn() {
  const { session, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('password')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')

  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (loading) {
    return (
      <main className="auth">
        <p className="muted">Loading…</p>
      </main>
    )
  }
  if (session) return <Navigate to="/trips" replace />

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setSent(false)
    setCode('')
  }

  async function withBusy(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // On success AuthProvider picks up the session and the <Navigate> above takes over.
  const signInWithPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void withBusy(async () => {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (err) throw err
    })
  }

  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void withBusy(async () => {
      // display_name lands in raw_user_meta_data, which the signup trigger reads when it
      // creates the profile row. Without it the name defaults to the part before the @.
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      })
      if (err) throw err

      // No session means the project still has email confirmation on, so there is a link
      // waiting in their inbox - which cannot work here. Say so rather than spin.
      if (!data.session) {
        setNotice(
          'Account created, but this project is set to confirm addresses by email and that ' +
            'link does not work with this app. Ask an admin to confirm you, or turn off ' +
            'email confirmation in Supabase.',
        )
      }
    })
  }

  const sendCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void withBusy(async () => {
      const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() })
      if (err) throw err
      setSent(true)
    })
  }

  const verifyCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void withBusy(async () => {
      const { error: err } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (err) throw err
    })
  }

  const emailField = (
    <>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </>
  )

  return (
    <main className="auth">
      <h1>Carbooker</h1>
      <p className="lede">Seats in each other&rsquo;s cars, sorted before you set off.</p>

      <div className="tabs" role="tablist" aria-label="How to sign in">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          className={mode === 'password' ? 'tab is-active' : 'tab'}
          onClick={() => switchTo('password')}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'code'}
          className={mode === 'code' ? 'tab is-active' : 'tab'}
          onClick={() => switchTo('code')}
        >
          Email code
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={mode === 'register' ? 'tab is-active' : 'tab'}
          onClick={() => switchTo('register')}
        >
          Create account
        </button>
      </div>

      {mode === 'password' && (
        <form onSubmit={signInWithPassword}>
          {emailField}

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted">
            No password yet? Sign in with an email code, then set one on your profile.
          </p>
        </form>
      )}

      {mode === 'register' && (
        <form onSubmit={register}>
          <label htmlFor="displayName">Your name</label>
          <input
            id="displayName"
            required
            autoComplete="name"
            placeholder="What the group will see"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          {emailField}

          <label htmlFor="newPassword">Password</label>
          <input
            id="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted">At least 8 characters.</span>

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="muted">
            A new account is not in any group yet. Follow an invite link, or ask for access
            to one.
          </p>
        </form>
      )}

      {mode === 'code' &&
        (!sent ? (
          <form onSubmit={sendCode}>
            {emailField}
            <button type="submit" className="primary" disabled={busy}>
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
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="link" onClick={() => switchTo('code')}>
              Use a different email
            </button>
          </form>
        ))}

      {/* An invite link is behind the sign-in check, and following it while signed out
          loses the token. Say so here rather than build a redirect-back for one screen. */}
      <p className="muted">
        Following an invite link? Sign in here first, then open the link again.
      </p>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
