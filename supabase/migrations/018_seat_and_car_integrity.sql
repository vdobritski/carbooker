-- 018_seat_and_car_integrity.sql
--
-- Two holes 017 opened, both found by review and both reproduced against the live
-- database. Both are data integrity rather than privilege: they let a trip manager -
-- a non-admin - create a state that supabase/checks.sql reports as broken.
--
-- 1. `manages_trip(new.trip_id)` exempted a trip manager from the WHOLE seating guard,
--    including `allowed := owns_car(new.car_id)`. That ownership test was the only thing
--    tying a seat's car to a car on the seat's own trip. guard_booking_identity() does not
--    help: it pins trip_id, and trip_id is exactly what does not change here.
--
--    Reproduced: a member with can_create_trips who created trip A confirmed a trip-A
--    passenger into a car on trip B (same group). check 5, "seat is in a car from another
--    trip", returned a row. Trip B's driver sees a stranger in their car; trip A shows the
--    seat as "in a car" with no name, because the car is not on that trip.
--
--    The fix is not to narrow who may manage seats - a trip manager placing people in the
--    cars of their own trip is the point of the switch - but to state the missing rule
--    plainly, as an invariant that holds for everybody. A seat's car is on the seat's trip.
--    No exemption: an admin has no more business creating that row than anyone else, and
--    check 5 has been asserting this since task 12 with nothing enforcing it.
--
-- 2. `cars_update` gained `manages_trip(trip_id)`, and `cars` has no identity guard - the
--    equivalent of guard_booking_identity(). So a trip manager could rewrite driver_id
--    (taking over somebody else's car, which silently strips the real driver of
--    confirm/deny/delete) or trip_id (moving the car out from under its own confirmed
--    seats, which breaks check 5 again). Both reproduced.

create or replace function check_car_capacity() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  seats int;
  taken int;
  car_trip uuid;
begin
  if new.car_id is null then
    return new;
  end if;

  -- New in 018, and deliberately here rather than in the seating guard: this is an
  -- invariant about the row, not a question about who is asking, so it belongs with the
  -- other invariant this trigger enforces and applies to admins too.
  select trip_id, seat_count into car_trip, seats from cars where id = new.car_id for update;
  if seats is null then
    raise exception 'No such car';
  end if;
  if car_trip is distinct from new.trip_id then
    raise exception 'That car is not on this trip';
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


-- What a car *is* does not change: which trip it is on, and whose it is.
create function guard_car_identity() returns trigger
  language plpgsql
as $$
begin
  -- No exemption at all, the same reasoning as trips_group_guard: a car's confirmed seats
  -- carry the old trip_id, so moving the car strands them. Delete it and add it again.
  if new.trip_id is distinct from old.trip_id then
    raise exception 'A car cannot be moved to another trip';
  end if;

  if auth.uid() is null or is_admin() then
    return new;
  end if;

  -- Handing a car to somebody else is not a feature, and it silently takes confirm, deny
  -- and delete away from whoever actually drives it.
  if new.driver_id is distinct from old.driver_id then
    raise exception 'A car cannot be handed to another driver. Delete it and let them add their own.';
  end if;

  return new;
end;
$$;

create trigger cars_identity_guard
  before update on cars
  for each row execute function guard_car_identity();
