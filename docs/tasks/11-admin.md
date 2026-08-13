# 11 — Admin: roles and overrides

## Goal

An admin can change people's roles and fix anything on a trip — the escape hatch that
keeps the rest of the app simple.

## Dependencies

10.

## Expected changes

- `src/api/profiles.ts` — `listProfiles()`, `setRole(profileId, role)`
- `src/pages/Admin.tsx` — `/admin`: user list with a role selector
- `src/routes.tsx` — `/admin`, visible and reachable only for admins
- `src/components/NavBar.tsx` — admin link for admins
- existing pages — allow the admin branch on the edit/delete controls that already check
  ownership

No migration is expected: the RLS policies written in tasks 01–09 already carry the
`is_admin()` branch. If a policy turns out to be missing it, that is a bug in the earlier
task — report it, then fix it in a new migration rather than editing the old one.

## Acceptance criteria

- An admin sees `/admin` and can promote a user to `driver` or `admin`, and demote back.
- A non-admin navigating to `/#/admin` directly gets bounced, **and** a direct `setRole`
  call from a non-admin session is rejected by the role-change guard from task 01. Verify
  the second one.
- A promoted user can register a car without signing out and back in — confirm the profile
  in context refreshes, or that a reload is enough and the UI says so.
- An admin can edit and delete any trip, any car, and any booking, including confirming
  someone into a car they do not drive.
- An admin cannot break the invariants: over-filling a car fails for an admin too.
- Demoting a driver who owns cars does not delete the cars. Decide and state what happens —
  the simplest correct behaviour is that the cars remain and the person keeps control of
  their own cars via `owns_car()`.

## Implementation notes

- Role is a `<select>` of the three values. No permission matrix, no per-trip roles.
- Guard the route with the profile from `useAuth()`, and remember the guard is convenience
  only — the database is the real check.
- Do not add an "impersonate user" feature or an audit log.
