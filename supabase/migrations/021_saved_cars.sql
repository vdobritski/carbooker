-- 021_saved_cars.sql
-- A person's garage: the cars they keep, so registering one on a trip is a pick from a
-- list rather than retyping the title, the seats and the features every time.
-- Schema reference: docs/data-model.md
--
-- A saved car is a TEMPLATE THAT GETS COPIED, not a row a trip points at. cars.trip_id
-- stays not null and there is deliberately no cars.saved_car_id.
--
-- Making cars.trip_id nullable and sharing one row across trips would make seat_count -
-- the number invariant 3 is stated against - shared between two sets of bookings, so
-- lowering it for one trip could over-fill another. bookings.car_id, check_car_capacity(),
-- owns_car() and drives_on_trip() all assume a car belongs to exactly one trip. Copying
-- keeps every one of those true and touches none of the four invariants: this migration
-- adds a table and changes nothing about bookings, cars, or any existing policy.
--
-- The copy is one-way and one-time. Editing a trip's car does not change the saved car,
-- and editing the saved car does not change any trip. Registering the same saved car on
-- two trips gives two independent cars rows, which is exactly what makes a per-trip seat
-- count safe.

create table saved_cars (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade,
  title       text not null,
  description text,
  features    text[] not null default '{}',
  seat_count  int not null,
  created_at  timestamptz not null default now(),

  constraint saved_cars_title_not_blank check (length(trim(title)) > 0),
  -- Passenger seats, not counting the driver - the same meaning as cars.seat_count.
  constraint saved_cars_seat_count_positive check (seat_count > 0)
);

create index saved_cars_owner_id_idx on saved_cars (owner_id);

alter table saved_cars enable row level security;

-- Your garage is yours. Nothing here uses shares_group_with(): a garage is narrower than a
-- name. People in your group see your car once you register it on one of their trips, and
-- not before. anon gets no policy, here as everywhere.
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

-- Keeping a garage is not gated on driving anywhere: can_drive_in_group() decides who may
-- register a car on a trip (017), and that is the gate that matters. A passenger who
-- becomes a driver next month should not have to retype their car.

-- Everything already registered on a trip becomes a saved car, once per driver and title.
-- Run the select half on its own first and read the rows: distinct on keeps the most
-- recently created car of each (driver, title), so a driver who registered "Blue Passat"
-- on three trips gets one saved car with the newest seat count.
insert into saved_cars (owner_id, title, description, features, seat_count)
select distinct on (driver_id, lower(title))
       driver_id, title, description, features, seat_count
  from cars
 order by driver_id, lower(title), created_at desc;
