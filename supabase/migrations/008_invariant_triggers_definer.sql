-- 008_invariant_triggers_definer.sql
--
-- Fixes three problems in 007, all with the same root cause: the invariant triggers ran
-- as the calling user, so row level security applied inside them.
--
-- 1. check_car_capacity() locks the car with `select ... for update`. Postgres applies the
--    UPDATE policy - not just SELECT - to a locking read, so for anyone who is not that
--    car's driver the row came back empty and the function raised 'No such car'. The
--    passenger was blocked, but by the wrong check and with a misleading message.
--
-- 2. release_seats_on_car_delete() updates other people's bookings. As the calling user
--    that update has to satisfy the bookings WITH CHECK clause, which it cannot: the
--    released row has car_id null and belongs to a passenger, so a driver deleting a car
--    that holds someone else's seat would have been refused.
--
-- 3. Both capacity checks count rows. A count that depends on what the caller may see is
--    not an invariant. They must see the whole table.
--
-- These three enforce invariants rather than permissions, so they run as the owner.
-- Authorization stays where it belongs: the policies, and guard_seat_assignment().

create or replace function check_car_capacity() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  seats int;
  taken int;
begin
  if new.car_id is null then
    return new;
  end if;

  select seat_count into seats from cars where id = new.car_id for update;
  if seats is null then
    raise exception 'No such car';
  end if;

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

create or replace function check_car_seat_count() returns trigger
  language plpgsql
  security definer
  set search_path = public
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

create or replace function release_seats_on_car_delete() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update bookings
     set car_id = null, status = 'pending', updated_at = now()
   where car_id = old.id;
  return old;
end;
$$;

-- Before triggers fire in name order, so the capacity check was running first and
-- reporting a full or missing car to someone who had no business touching the seat at
-- all. Rename the guard so the authorization answer comes first.
drop trigger bookings_guard_assignment on bookings;

create trigger bookings_assignment_guard
  before update on bookings
  for each row execute function guard_seat_assignment();
