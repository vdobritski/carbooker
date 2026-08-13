# 04 — Trip participants

## Goal

A user can join or leave a trip, and the trip page lists who is going. Drivers later
assign seats from this list, so it must exist before cars and bookings.

## Dependencies

03.

## Expected changes

- `supabase/migrations/004_trip_participants.sql`
- `src/lib/types.ts` — `TripParticipant`, and a `ParticipantWithProfile` shape for the
  joined read
- `src/api/trips.ts` — `listParticipants(tripId)`, `joinTrip(tripId)`, `leaveTrip(tripId)`,
  `removeParticipant(tripId, profileId)` (admin)
- `src/components/ParticipantList.tsx`
- `src/pages/TripDetail.tsx` — participant section, join/leave button

## Acceptance criteria

- Joining a trip adds the current user to the list; the button flips to "leave".
- Joining twice does not create a duplicate row and does not show an error to the user —
  the composite primary key makes the second insert a no-op via `upsert`.
- Leaving removes the user from the list.
- A user cannot add someone *else* as a participant — verify the insert fails when
  `profile_id <> auth.uid()` and the caller is not an admin.
- An admin can remove any participant.
- The list shows display name and photo, and marks the trip creator.

## Implementation notes

- Schema and policies in [../data-model.md](../data-model.md#trip_participants). Primary
  key is `(trip_id, profile_id)` — that is the duplicate protection; no extra check needed.
- Use `.upsert(..., { onConflict: 'trip_id,profile_id', ignoreDuplicates: true })` for join.
- Read participants with a single joined select:
  `select('joined_at, profiles(id, display_name, photo_url, role)').eq('trip_id', tripId)`.
  One query, not N.
- **Leaving a trip while holding seats** is out of scope for this task: for now, block the
  leave button when the user has any non-denied booking on the trip and say why. Task 07
  adds bookings; revisit only if it turns out to be annoying in use.
