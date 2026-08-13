# 08 — Car preference and driver confirm/deny

## Goal

A passenger can say which car they would prefer; the driver of that car confirms or denies
it. Confirming seats the passenger; denying releases the request.

## Dependencies

07.

## Expected changes

- `src/api/bookings.ts` — `setPreferredCar(bookingId, carId | null)`,
  `confirmBooking(bookingId, carId)`, `denyBooking(bookingId)`
- `src/components/BookingForm.tsx` — optional "preferred car" select
- `src/pages/CarDetail.tsx` — the driver's request queue: pending bookings whose
  `preferred_car_id` is this car, each with confirm / deny
- `src/pages/TripDetail.tsx` — show each of my seats' status: pending / confirmed in car X
  / denied

No migration is expected. If one turns out to be needed, stop and report why rather than
adding columns on the fly.

## Acceptance criteria

- A passenger sets a preferred car; the request appears in that car's driver's queue.
- Confirm sets `status = 'confirmed'` and `car_id` to that car in a single update — never
  two separate updates, which would transiently violate invariant 2 and be rejected.
- Deny sets `status = 'denied'` and leaves `car_id` null. `preferred_car_id` is kept so the
  passenger can see which car said no.
- After a deny the passenger can request a different car: a new `pending` seat is accepted
  even though the denied row still exists.
- A driver cannot confirm a booking into someone else's car — verify the RLS rejection.
- Confirming into a full car fails with the trigger's message, shown to the driver.
- Changing a preference on an already-confirmed seat does not silently move the passenger:
  the seat stays confirmed in its current car until the driver acts.
- A passenger with no preference stays `pending` and is available for manual assignment
  (task 09).

## Implementation notes

- **Confirm is one `update`**: `{ status: 'confirmed', car_id: carId }` together. The check
  constraint `((car_id is not null) = (status = 'confirmed'))` rejects each half on its own,
  which is exactly the protection intended — work with it, do not add a workaround.
- The `bookings` update policy allows a driver through when `owns_car(car_id)` **or**
  `owns_car(preferred_car_id)`. The second is what lets a driver confirm a request that is
  not yet in their car. Confirm this is present from task 07; if it is missing, that is a
  bug in 07 — report it rather than loosening the policy.
- The driver's queue is one query:
  `bookings` where `preferred_car_id = carId and status = 'pending'`, joined to `profiles`
  and `guests` for the occupant name.
- Show the passenger's `comment` in the queue — it is the whole reason the field exists
  (health conditions, what they can bring).
- Denying should be reversible by the driver confirming afterwards; do not make `denied`
  terminal in the UI.
