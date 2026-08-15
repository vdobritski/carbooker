import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'

/**
 * Set or change the password on the signed-in account.
 *
 * Accounts made before passwords existed - or by an invite, or from the Supabase
 * dashboard - have none, and can only get in with an email code. This is how they stop
 * needing their inbox every time.
 */
export default function PasswordSection() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDone(false)
    setError(null)

    // Checked here rather than left to the server: Supabase compares nothing, it would
    // simply set whichever value was typed second.
    if (password !== confirm) {
      setError('The two passwords are not the same.')
      return
    }

    setBusy(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Password</h2>
      <p className="muted">
        Set one and you can sign in without waiting for a code. An email code keeps working
        either way.
      </p>

      <form onSubmit={save}>
        <label htmlFor="pw">New password</label>
        <input
          id="pw"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="muted">At least 8 characters.</span>

        <label htmlFor="pw2">Repeat it</label>
        <input
          id="pw2"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>

      {done && <p className="notice">Password saved. You can sign in with it next time.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
