# 09 — Driver manual seat assignment

## Goal

A driver can seat people in their own car directly, choosing from the trip's participants
and their `+1`s, without waiting for a request.

## Dependencies

08.

## Expected changes

- `src/api/bookings.ts` — `assignToCar(bookingId, carId)`,
  `createAndAssign({ tripId, carId, profileId? , guestId? })`, `unassign(bookingId)`
- `src/components/AssignPanel.tsx` — "add to my car": a picker of trip participants and
  their guests who have no active seat, plus the trip's unassigned `pending` seats
- `src/pages/CarDetail.tsx` — the panel, and a remove button on each seated passenger

## Acceptance criteria

- The picker lists trip participants and their `+1`s, excluding anyone who already holds a
  non-denied seat on this trip.
- Assigning an existing `pending` seat sets `status = 'confirmed'` and `car_id` in one
  update.
- Assigning a participant who has no seat yet creates the row already confirmed into the
  car, in a single insert — not an insert followed by an update.
- The car cannot be filled past `seat_count`; the trigger's message is shown, and the
  picker disables assignment when the car is full.
- Removing a passenger sets `status = 'pending'` and `car_id = null` in one update; the
  seat stays on the trip rather than disappearing.
- A driver can only do this on their own car. Verify the RLS rejection on someone else's.
- A person cannot end up in two cars — assigning someone who already holds a seat is
  rejected by the unique index.

## Implementation notes

- **The update policy needs widening too, not just insert.** As written in 007 a driver
  reaches a seat only through `owns_car(car_id)` or `owns_car(preferred_car_id)`. A pending
  seat with no stated preference has both null, so no driver can touch it — the update
  matches zero rows and looks like a no-op. Manual assignment is exactly that case, so the
  same migration must add a branch letting a driver take an unassigned `pending` seat on a
  trip where they own a car. Confirmed against the live database during task 07.

- `createAndAssign` inserts with `status: 'confirmed'` and `car_id` set in the same row —
  the check constraint and the capacity trigger both apply on insert, so this is safe.
  The RLS insert policy must permit a driver to insert a booking for another person into
  their own car; if task 07's policy only allowed `booked_by = auth.uid()` with self/own
  guest as occupant, this task extends it. **That extension needs a migration** —
  `supabase/migrations/008_bookings_driver_assign.sql`, dropping and recreating the insert
  policy with the added `owns_car(car_id)` branch. Do not disable RLS to get around it.
- `booked_by` on a driver-created seat is the driver's id. That is correct — it records who
  made the booking, not who occupies it.
- Build the picker from data already fetched for the trip page (participants, guests,
  bookings) rather than adding new round trips per row.
- After any assignment, refetch the trip's bookings. Seat counts shown elsewhere on the
  page go stale otherwise.
