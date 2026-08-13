# 05 — Cars: driver registers a car on a trip

## Goal

A driver (or admin) registers a car on a specific trip with a description, a feature list
and a seat count. Everyone on the trip can see the cars.

## Dependencies

04.

## Expected changes

- `supabase/migrations/005_cars.sql` — table, RLS, and the `owns_car(uuid)` helper
  deferred from task 01
- `src/lib/types.ts` — `Car`
- `src/api/cars.ts` — `listCars(tripId)`, `getCar(id)`, `createCar(input)`,
  `updateCar(id, patch)`, `deleteCar(id)`
- `src/components/CarCard.tsx` — title, driver, features as chips, `x / y seats`
- `src/pages/CarForm.tsx` — `/trips/:id/cars/new` and edit
- `src/pages/CarDetail.tsx` — `/trips/:id/cars/:carId`
- `src/pages/TripDetail.tsx` — cars section, "register my car" for drivers and admins

## Acceptance criteria

- A user with role `driver` can register a car on a trip; `driver_id` is their own id.
- A user with role `user` sees no register button, **and** a direct insert attempt is
  rejected by RLS. Verify the rejection, not just the hidden button.
- A driver can edit and delete only their own car. Editing someone else's fails.
- Features round-trip correctly: entering `fridge, grill, opening roof` stores three array
  elements and renders three chips. An empty input stores `{}`, not `{""}`.
- `seat_count` must be a positive integer; `0` and `-1` are rejected by the database, not
  only by the form.
- Every car on the trip is visible to every signed-in user.

## Implementation notes

- Schema in [../data-model.md](../data-model.md#cars).
- Define `owns_car(uuid)` here — task 01 deliberately skipped it because `cars` did not
  exist yet. `security definer stable`, `search_path = public`.
- Insert policy needs both conditions: `driver_id = auth.uid()` **and** the caller's role
  is `driver` or `admin`. Checking only the first lets any user become a driver.
- `features` is `text[]`. Parse a comma-separated input: split, trim, drop empties. Do not
  add a tag-input library.
- `seat_count` excludes the driver. Label the field so this is unambiguous, e.g. "seats
  available for passengers".
- The seat counter on `CarCard` reads confirmed bookings, which do not exist until task 07
  — show `— / seat_count` for now and wire it up in task 10 rather than inventing a
  placeholder count.
