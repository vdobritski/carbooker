# 10 — Trip layout view

## Goal

The trip page shows the whole picture at a glance: every car, who is sitting in it, how
many seats are left, and who is still waiting for a place.

## Dependencies

09.

## Expected changes

- `src/api/trips.ts` — `getTripBoard(tripId)`: one fetch of the trip, its cars, its
  participants and its bookings, assembled client-side into the shape the page renders
- `src/components/SeatGrid.tsx` — a car's seats: occupied ones with occupant name and
  `+1`-of-whom, empty ones as placeholders
- `src/pages/TripDetail.tsx` — the layout section, plus an "unseated" list

## Acceptance criteria

- Each car shows `confirmed / seat_count` and that number matches the seats drawn.
- A `+1` is labelled with their host, e.g. `Anna (+1 of Ivan)`.
- Passengers still `pending` appear in an "unseated" list with their preferred car, if any.
- `denied` seats appear only to the passenger who owns them and to the driver who denied
  them — not in the public layout.
- Comments are visible on the seat to the driver of that car, to the passenger, and to
  admins.
- The whole board loads in a small number of queries — four at most. If the page fires one
  query per car or per seat, that is a defect.
- Every count on the page comes from the same fetched data. No second source of truth for
  "seats left".

## Implementation notes

- Derive everything from the `bookings` rows already fetched. `seats_taken` is
  `bookings.filter(b => b.carId === car.id).length` — do not add a database view or a
  counter column for it.
- Fetch occupant names by joining in the select:
  `profiles(id, display_name, photo_url)` and `guests(id, name, host_id)`. Guest host names
  come from the profiles already loaded for participants; match them in memory.
- Empty seats are `seat_count - taken` rendered placeholders. There is no seat-position
  concept — a car has N interchangeable seats, not a seat map.
- Now wire the real count into `CarCard` from task 05, which was left as `—`.
- Keep it readable on a phone; this gets opened on phones.
