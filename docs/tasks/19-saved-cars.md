# 19 — Saved cars: a person's garage

## Goal

A driver keeps their cars on their profile and picks one when registering on a trip,
instead of retyping the title, the seat count and the feature list every time.

## Dependencies

17 (the per-group driver role). Independent of 18. Migration **016**.

## Expected changes

- `supabase/migrations/<next>_saved_cars.sql` — the table, its policies, and a backfill from
  the cars that already exist
- `src/lib/types.ts` — `SavedCarRow` / `SavedCar`
- `src/api/savedCars.ts` — `listMySavedCars()`, `createSavedCar(input)`,
  `updateSavedCar(id, patch)`, `deleteSavedCar(id)`
- `src/pages/Profile.tsx` — a "My cars" section, same shape as the existing `+1`s section
- `src/pages/CarForm.tsx` — a "use one of my cars" picker that prefills the form, and a
  "remember this car" checkbox when nothing was picked

## A separate table, not a reshaped `cars`

`cars.trip_id` stays `not null`. A saved car is a **template that gets copied**, not a row
that a trip points at.

Making `cars.trip_id` nullable and reusing one row across trips would mean the seat count a
trip's bookings were confirmed against can change from another trip's page — invariant 3
("a car never holds more confirmed seats than it has") would then be a statement about a
row that two trips share, and lowering the count for one trip could over-fill another.
`bookings.car_id`, the capacity trigger, `owns_car()` and `drives_on_trip()` all assume a
car belongs to exactly one trip. Copying keeps every one of those true and touches none of
the four invariants.

The copy is one-way and one-time: editing a trip's car does not change the saved car, and
editing the saved car does not change any trip. The UI must say so in one line.

```sql
create table saved_cars (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade,
  title       text not null,
  description text,
  features    text[] not null default '{}',
  seat_count  int not null,
  created_at  timestamptz not null default now(),

  constraint saved_cars_title_not_blank check (length(trim(title)) > 0),
  constraint saved_cars_seat_count_positive check (seat_count > 0)
);

create index saved_cars_owner_id_idx on saved_cars (owner_id);

alter table saved_cars enable row level security;

-- Your garage is yours. Nobody else needs to read it: what other people see is the car
-- once it is registered on a trip.
create policy saved_cars_select on saved_cars
  for select to authenticated using (owner_id = auth.uid() or is_admin());

create policy saved_cars_insert on saved_cars
  for insert to authenticated with check (owner_id = auth.uid());

create policy saved_cars_update on saved_cars
  for update to authenticated
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

create policy saved_cars_delete on saved_cars
  for delete to authenticated using (owner_id = auth.uid() or is_admin());
```

Nothing here uses `shares_group_with()`: a garage is narrower than a name. People in your
group see your car once you register it on one of their trips, and not before.

```sql

-- Everything already registered on a trip becomes a saved car, once per driver and title.
insert into saved_cars (owner_id, title, description, features, seat_count)
select distinct on (driver_id, lower(title))
       driver_id, title, description, features, seat_count
  from cars
 order by driver_id, lower(title), created_at desc;
```

## Acceptance criteria

- After the migration, each existing driver sees their existing car(s) under "My cars" on
  `/me`, with the right seat count and features, and no duplicates.
- Registering a car on a trip offers the picker; choosing one fills title, description,
  features and seat count, all still editable before saving.
- Editing the seat count on the trip's car does **not** change the saved car, and vice
  versa. Check both directions.
- Deleting a saved car does not touch any car registered on a trip.
- "Remember this car" is offered only when the form was not prefilled from a saved car, and
  is on by default; unticking it registers the car without saving it.
- A passenger (no `travel_role = 'driver'` in any group) can still keep saved cars — the
  garage is not gated on being a driver anywhere. Registering one on a trip is what is
  gated, by task 17's policy.
- `supabase/checks.sql` returns zero rows; nothing about bookings changed.

## Implementation notes

- The picker is a `<select>` of `listMySavedCars()`, plus an "enter a new car" option. It
  is populated from one query when the form mounts. No modal, no autocomplete.
- Reuse `parseFeatures` from `src/api/cars.ts` for the garage form rather than writing a
  second parser.
- Do not add `cars.saved_car_id`. A back-reference only earns its keep if something wants
  to sync the two, and nothing does — that would be designing for the second use case.
- Registering the same saved car on two trips creates two independent `cars` rows. That is
  correct and is what makes a per-trip seat count safe.

## Risk

**What could break:** nothing existing — a new table plus a form. The `distinct on`
backfill is the one thing to eyeball: run the `select` half first and read the rows.

**How you know it works:** register a car from the picker on the live trip, confirm a
passenger into it, then change the saved car's seat count on `/me` and reload the trip —
the trip's car is unchanged and the confirmed seat is still there.
