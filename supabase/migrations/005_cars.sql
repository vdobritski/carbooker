-- 005_cars.sql
-- Cars registered on a trip, plus owns_car() - the second shared policy helper, deferred
-- from 001 because it needs this table. Schema reference: docs/data-model.md

create table cars (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips (id) on delete cascade,
  driver_id   uuid not null references profiles (id) on delete cascade,
  title       text not null,
  description text,
  features    text[] not null default '{}',
  seat_count  int not null,
  created_at  timestamptz not null default now(),

  constraint cars_title_not_blank check (length(trim(title)) > 0),
  -- Passenger seats, not counting the driver.
  constraint cars_seat_count_positive check (seat_count > 0)
);

create index cars_trip_id_idx on cars (trip_id);

alter table cars enable row level security;

-- Authority over a specific car comes from owning it, not from the driver role.
create function owns_car(car uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from cars where id = car and driver_id = auth.uid()
  );
$$;

create policy cars_select on cars
  for select to authenticated
  using (true);

-- Both halves matter. Without the role check any user could register a car and so make
-- themselves a driver; without the driver_id check they could register one for someone else.
create policy cars_insert on cars
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('driver', 'admin')
    )
  );

create policy cars_update on cars
  for update to authenticated
  using (driver_id = auth.uid() or is_admin())
  with check (driver_id = auth.uid() or is_admin());

create policy cars_delete on cars
  for delete to authenticated
  using (driver_id = auth.uid() or is_admin());
