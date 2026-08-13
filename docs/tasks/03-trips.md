# 03 — Trips: create, list, detail shell

## Goal

Signed-in users can create a trip, see all trips, and open one. The detail page is a shell
that later tasks fill with cars and seats.

## Dependencies

02.

## Expected changes

- `supabase/migrations/003_trips.sql`
- `src/lib/types.ts` — `Trip`
- `src/api/trips.ts` — `listTrips()`, `getTrip(id)`, `createTrip(input)`,
  `updateTrip(id, patch)`, `deleteTrip(id)`
- `src/pages/Trips.tsx` — list + "new trip" form
- `src/pages/TripDetail.tsx` — `/trips/:id`: name, description, plan, dates; edit for the
  creator or an admin
- `src/routes.tsx` — add `/trips/:id`

## Acceptance criteria

- Creating a trip stores `created_by = auth.uid()` and the trip appears in the list.
- The list is sorted by `starts_on` (nulls last), then `created_at`.
- Opening a trip shows its name, description, plan and dates.
- The creator and an admin see edit/delete; other users do not, **and** a non-creator's
  update is rejected by RLS if attempted directly — verify one such call actually fails,
  don't rely on the button being hidden.
- Deleting a trip removes it from the list.
- Opening a trip id that does not exist shows a "not found" message, not a blank page or a
  crash.

## Implementation notes

- Schema in [../data-model.md](../data-model.md#trips). RLS: select for any authenticated
  user; insert for any authenticated user; update/delete where
  `created_by = auth.uid() or is_admin()`.
- `starts_on` / `ends_on` are `date`, not `timestamptz`. Bind them to `<input type="date">`
  and send the plain `YYYY-MM-DD` string. Do not route them through `new Date()` — that
  introduces a timezone shift that moves the trip a day.
- `plan` is a `<textarea>` of free text. Render it with `white-space: pre-wrap`. No
  markdown renderer.
- Handle the `error` from every supabase call and surface it; a swallowed error here looks
  like "the button does nothing".
