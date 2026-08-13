# 02 — Auth (email OTP) and profile page

## Goal

A person can sign in with their email and a 6-digit code, stays signed in across reloads,
can edit their own profile, and can sign out. Routes that need a session redirect to sign
in.

## Dependencies

01.

## Expected changes

- `src/auth/AuthProvider.tsx` — session context, `useAuth()` exposing
  `{ session, profile, loading, signOut }`
- `src/auth/RequireAuth.tsx` — small wrapper that redirects to `/` when there is no session
- `src/pages/SignIn.tsx` — real implementation: email field → "send code" → code field →
  verify
- `src/pages/Profile.tsx` — `/me`: edit `display_name`, `photo_url`, `description`
- `src/routes.tsx` — wrap the authenticated routes, add `/me`
- `src/components/NavBar.tsx` — current user, link to `/me`, sign out

## Acceptance criteria

- Entering an email sends a code; entering the code signs the user in and lands on
  `/#/trips`.
- Reloading the page keeps the session (verify by refreshing, not by trusting the code).
- A wrong or expired code shows an error message and does not sign in.
- Visiting `/#/trips` with no session redirects to `/#/`.
- Editing the profile persists — verify by reloading, and by seeing the new value in the
  Supabase table editor.
- Sign out clears the session and returns to `/#/`.
- The `role` field is displayed but not editable here.

## Implementation notes

- `supabase.auth.signInWithOtp({ email })` then
  `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
- In the Supabase dashboard, Auth → make sure "Enable email provider" is on. Magic links
  are not used; the OTP code is in the same email template.
- `AuthProvider` must both call `getSession()` once on mount **and** subscribe to
  `onAuthStateChange`, and unsubscribe on unmount. Missing the initial `getSession()` is
  the usual cause of a flash of the sign-in page on reload.
- `profile` in the context is loaded once after the session resolves. Expose a
  `refreshProfile()` so the profile page can update it after a save, rather than
  duplicating the profile state.
- Keep `loading` distinct from "no session" — rendering the redirect while the session is
  still resolving bounces a signed-in user out on every refresh.
- Photo is a URL field. No file upload, no storage bucket.
