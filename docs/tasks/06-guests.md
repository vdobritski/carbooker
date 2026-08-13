# 06 — Guests (+1s)

## Goal

A user manages their own list of `+1`s — name and an optional note — so they can later
book seats for them.

## Dependencies

02. (Independent of trips and cars; can be done any time after auth.)

## Expected changes

- `supabase/migrations/006_guests.sql`
- `src/lib/types.ts` — `Guest`
- `src/api/guests.ts` — `listMyGuests()`, `createGuest(input)`, `updateGuest(id, patch)`,
  `deleteGuest(id)`
- `src/pages/Profile.tsx` — a "My +1s" section: list, add, edit, remove

## Acceptance criteria

- Adding a `+1` stores `host_id = auth.uid()` and it appears in the list immediately.
- The list contains only the current user's guests, never anyone else's.
- Editing and deleting work; deleting asks for confirmation.
- A user cannot create a guest under someone else's `host_id` — verify the insert is
  rejected.
- An empty name is rejected.

## Implementation notes

- Schema in [../data-model.md](../data-model.md#guests--the-1s).
- Guests are **not** logins. No invite, no email, no auth row. A guest is a name owned by
  its host.
- Select policy is "any authenticated user can read all guests" — a driver needs to see
  the name of the `+1` sitting in their car. The *list* on the profile page filters to
  `host_id = auth.uid()`; the policy is not what scopes the UI.
- Deleting a guest cascades to their bookings (`on delete cascade`). Warn in the
  confirmation dialog when the guest currently holds a seat, since that seat disappears.
  Reading the count is enough — do not build a reassignment flow.
