# 07 — Bookings core: seats, invariants, capacity

## Goal

The `bookings` table exists with all four invariants enforced in the database, and a user
can book a place on a trip for themselves and for their `+1`s. Car assignment comes in the
next task — every seat created here is `pending` with no car.

This is the most important task in the project. The rest of the app is CRUD; this is where
correctness lives.

## Dependencies

05, 06.

## Expected changes

- `supabase/migrations/007_bookings.sql` — table, check constraints, partial unique
  indexes, capacity trigger, car-delete trigger, RLS
- `src/lib/types.ts` — `Booking`, `BookingStatus`
- `src/api/bookings.ts` — `listTripBookings(tripId)`, `bookSeat({ tripId, guestId? })`,
  `updateMyBooking(id, { comment })`, `cancelBooking(id)`
- `src/components/BookingForm.tsx` — book for myself, and/or pick which `+1`s to bring;
  optional comment
- `src/pages/TripDetail.tsx` — "my seats" section and the booking form

## Acceptance criteria

Functional:

- Booking for myself creates one `pending` row with `profile_id = auth.uid()`,
  `booked_by = auth.uid()`, `car_id = null`.
- Booking with two `+1`s selected creates three rows total, sharing `booked_by`, one per
  occupant.
- The comment is saved and visible to drivers later.
- Cancelling removes the row and frees the person to book again.
- I cannot book a seat for another registered user, nor for someone else's guest — verify
  both are rejected by RLS.

Invariants — verify each by attempting the violation directly in the SQL editor and
confirming the database refuses it:

1. `insert` with both `profile_id` and `guest_id` set → rejected. Both null → rejected.
2. `update ... set car_id = <car>` while `status = 'pending'` → rejected.
   `update ... set status = 'confirmed'` while `car_id is null` → rejected.
3. Confirming one seat more than `seat_count` in a car → rejected with a readable message.
   Lowering a car's `seat_count` below its confirmed seats → rejected.
4. Two non-denied rows for the same person on the same trip → rejected. A `denied` row
   plus a new `pending` row for the same person → allowed.

Plus: deleting a car with confirmed seats leaves those seats in place as `pending` with
`car_id = null` — the rows must still exist afterwards.

- After all of the above, the checks in [12](12-booking-consistency-checks.md) return zero
  rows.

## Implementation notes

The full specification — columns, constraints, trigger bodies, policies — is in
[../data-model.md](../data-model.md#bookings--one-row-per-seat). Implement it as written.

- The capacity trigger must take `select seat_count from cars where id = new.car_id for
  update` **before** counting. Without the row lock, two drivers confirming the last seat
  simultaneously both pass the count and the car ends up over capacity. This is a real
  scenario for this app, not a theoretical one.
- Exclude `new.id` from the count, or an `update` of an already-confirmed row counts
  itself and fails at exactly capacity.
- `raise exception` messages are shown to the user via the supabase error. Write them
  readable: `'Car is full (% of % seats taken)'`, not `'constraint violated'`.
- The UI must surface the database error rather than swallowing it. A failed booking that
  silently does nothing is worse than an error message.
- Refetch the trip's bookings after every mutation. No optimistic updates — the whole
  point of the triggers is that the client's idea of the state can be wrong.
- Do not add a "seats remaining" column to `cars`. It is derived; store it once and it
  will drift.
