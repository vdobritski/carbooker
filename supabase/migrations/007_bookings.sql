-- 007_bookings.sql
-- One row per seat. This is the part of the schema that must stay correct; the four
-- invariants in docs/data-model.md are enforced here, not in the UI.

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips (id) on delete cascade,
  profile_id       uuid references profiles (id) on delete cascade,
  guest_id         uuid references guests (id) on delete cascade,
  booked_by        uuid not null references profiles (id) on delete cascade,
  car_id           uuid references cars (id),
  preferred_car_id uuid references cars (id) on delete set null,
  status           text not null default 'pending'
                     check (status in ('pending', 'confirmed', 'denied')),
  comment          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Invariant 1: the occupant is a registered user or a +1, never both, never neither.
  constraint bookings_one_occupant check (num_nonnulls(profile_id, guest_id) = 1),

  -- Invariant 2: a seat is in a car if and only if it is confirmed. Makes "confirmed but
  -- carless" and "sitting in a car while pending or denied" both unrepresentable.
  constraint bookings_car_iff_confirmed check ((car_id is not null) = (status = 'confirmed'))
);

-- Invariant 4: one active seat per person per trip. Denied rows are excluded so a
-- rejected passenger can ask again.
create unique index bookings_one_active_user on bookings (trip_id, profile_id)
  where profile_id is not null and status <> 'denied';

create unique index bookings_one_active_guest on bookings (trip_id, guest_id)
  where guest_id is not null and status <> 'denied';

create index bookings_trip_id_idx on bookings (trip_id);
create index bookings_car_id_idx on bookings (car_id);
create index bookings_preferred_car_id_idx on bookings (preferred_car_id);

alter table bookings enable row level security;


-- Invariant 3: a car never holds more confirmed seats than it has.
create function check_car_capacity() returns trigger
  language plpgsql
as $$
declare
  seats int;
  taken int;
begin
  if new.car_id is null then
    return new;
  end if;

  -- The row lock is the point of this function. Without it two drivers confirming the
  -- last seat at the same moment both see the same free seat and the car goes over.
  select seat_count into seats from cars where id = new.car_id for update;
  if seats is null then
    raise exception 'No such car';
  end if;

  -- Excluding new.id matters on update: an already-confirmed row would otherwise count
  -- itself and fail at exactly capacity.
  select count(*) into taken
    from bookings
   where car_id = new.car_id
     and status = 'confirmed'
     and id <> new.id;

  if taken >= seats then
    raise exception 'Car is full (% of % seats taken)', taken, seats;
  end if;

  return new;
end;
$$;

create trigger bookings_capacity
  before insert or update on bookings
  for each row execute function check_car_capacity();


-- The same invariant from the other side: a driver cannot shrink a car below the number
-- of seats already confirmed in it.
create function check_car_seat_count() returns trigger
  language plpgsql
as $$
declare
  taken int;
begin
  if new.seat_count >= old.seat_count then
    return new;
  end if;

  select count(*) into taken
    from bookings
   where car_id = new.id and status = 'confirmed';

  if new.seat_count < taken then
    raise exception 'Cannot reduce to % seats: % are already confirmed', new.seat_count, taken;
  end if;

  return new;
end;
$$;

create trigger cars_seat_count_guard
  before update of seat_count on cars
  for each row execute function check_car_seat_count();


-- Deleting a car releases its seats, it does not delete them. Runs before the delete, so
-- the car_id foreign key has nothing left pointing at the car by the time it is checked.
create function release_seats_on_car_delete() returns trigger
  language plpgsql
as $$
begin
  update bookings
     set car_id = null, status = 'pending', updated_at = now()
   where car_id = old.id;
  return old;
end;
$$;

create trigger cars_release_seats
  before delete on cars
  for each row execute function release_seats_on_car_delete();


create function touch_booking() returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bookings_touch
  before update on bookings
  for each row execute function touch_booking();


-- Only a car's driver (or an admin) may seat or unseat somebody. The row-level policy
-- below lets the booker write their own row, so without this guard a passenger could
-- confirm themselves into a car and skip the driver entirely.
-- auth.uid() is null for a direct database session, which already bypasses RLS.
create function guard_seat_assignment() returns trigger
  language plpgsql
as $$
begin
  if (new.status is distinct from old.status or new.car_id is distinct from old.car_id)
     and auth.uid() is not null
     and not is_admin()
     and not owns_car(new.car_id)
     and not owns_car(old.car_id)
     and not owns_car(old.preferred_car_id)
  then
    raise exception 'Only the driver of that car can confirm or deny a seat';
  end if;
  return new;
end;
$$;

create trigger bookings_guard_assignment
  before update on bookings
  for each row execute function guard_seat_assignment();


-- Policies. Everyone signed in sees every seat - the trip layout is public to the group.
create policy bookings_select on bookings
  for select to authenticated
  using (true);

-- You book for yourself or for one of your own +1s. Task 09 extends this so a driver can
-- seat someone directly into their own car.
create policy bookings_insert on bookings
  for insert to authenticated
  with check (
    booked_by = auth.uid()
    and (
      profile_id = auth.uid()
      or exists (
        select 1 from guests g where g.id = guest_id and g.host_id = auth.uid()
      )
    )
  );

-- The booker edits their own seat; the driver of the car it is in, or of the car it is
-- requesting, acts on it. Which columns each may touch is guarded by the trigger above.
create policy bookings_update on bookings
  for update to authenticated
  using (
    booked_by = auth.uid()
    or owns_car(car_id)
    or owns_car(preferred_car_id)
    or is_admin()
  )
  with check (
    booked_by = auth.uid()
    or owns_car(car_id)
    or owns_car(preferred_car_id)
    or is_admin()
  );

create policy bookings_delete on bookings
  for delete to authenticated
  using (booked_by = auth.uid() or is_admin());
