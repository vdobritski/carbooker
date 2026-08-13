-- 009_booking_write_guards.sql
--
-- Closes four holes found reviewing 007/008. Each was reachable from a normal user's
-- session with the public anon key, and each was confirmed against the live database.
--
-- 1. guard_seat_assignment() was `before update` only, and the insert policy says nothing
--    about status or car_id. A passenger could INSERT a row already confirmed into any
--    car and seat themselves with no driver involved.
-- 2. The update policy only re-checks booked_by, so the booker could rewrite profile_id,
--    guest_id or trip_id on their own seat - putting another person in a seat they never
--    booked, or moving a confirmed seat to a trip its car does not belong to.
-- 3. Nothing stopped a participant leaving a trip while still holding a seat, which left
--    a confirmed booking whose occupant is not a participant (checks.sql #7).
-- 4. The seating guard accepted the caller owning *any* of the cars involved, so a driver
--    holding a request for their own car could confirm the passenger into someone else's
--    car and spend that driver's seat.

-- Seating authority. Now covers insert as well as update, and requires ownership of the
-- car actually affected rather than any car in the row.
create or replace function guard_seat_assignment() returns trigger
  language plpgsql
as $$
declare
  allowed boolean;
begin
  -- A direct database session already bypasses RLS; admins may do anything.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A seat may only be created already-seated by the driver of that very car.
    -- Task 09 relies on this branch for assigning someone straight into your own car.
    if new.car_id is not null and not owns_car(new.car_id) then
      raise exception 'Only the driver of that car can seat someone in it';
    end if;
    return new;
  end if;

  -- Nothing about the seating changed: the booker is editing their comment or preference.
  if new.status is not distinct from old.status
     and new.car_id is not distinct from old.car_id then
    return new;
  end if;

  if new.car_id is not null then
    -- Putting someone in a car: it has to be your car, whatever they asked for.
    allowed := owns_car(new.car_id);
  elsif old.car_id is not null then
    -- Taking someone out of a car: it has to be the car they were in.
    allowed := owns_car(old.car_id);
  else
    -- Answering a request that is not in any car yet, i.e. denying it.
    allowed := owns_car(old.preferred_car_id);
  end if;

  if not allowed then
    raise exception 'Only the driver of that car can confirm or deny a seat';
  end if;

  return new;
end;
$$;

drop trigger bookings_assignment_guard on bookings;

create trigger bookings_assignment_guard
  before insert or update on bookings
  for each row execute function guard_seat_assignment();


-- What a seat *is* cannot change: which trip, who is sitting in it, who booked it. Only
-- the comment, the preferred car, and the seating may move. Cancel and rebook otherwise.
create function guard_booking_identity() returns trigger
  language plpgsql
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.trip_id is distinct from old.trip_id
     or new.profile_id is distinct from old.profile_id
     or new.guest_id is distinct from old.guest_id
     or new.booked_by is distinct from old.booked_by
  then
    raise exception
      'A seat cannot be moved to another trip, occupant or owner. Cancel it and book again.';
  end if;

  return new;
end;
$$;

create trigger bookings_identity_guard
  before update on bookings
  for each row execute function guard_booking_identity();


-- You cannot stop being a participant while you still hold a seat: that is what makes
-- checks.sql #7 (every occupant is a participant) true rather than merely usually true.
-- No admin exemption - this protects the data, not anyone's privileges.
create function guard_participant_leave() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  held int;
begin
  if auth.uid() is null then
    return old;
  end if;

  -- Deleting a trip, or a profile, cascades to trip_participants and to bookings. The
  -- parent row is already gone by the time the cascade reaches us, so if it has vanished
  -- this is a cascade tidying up and the seats are going with it.
  if not exists (select 1 from trips where id = old.trip_id)
     or not exists (select 1 from profiles where id = old.profile_id)
  then
    return old;
  end if;

  select count(*) into held
    from bookings
   where trip_id = old.trip_id
     and profile_id = old.profile_id
     and status <> 'denied';

  if held > 0 then
    raise exception 'Cancel your seat on this trip before leaving it';
  end if;

  return old;
end;
$$;

create trigger trip_participants_leave_guard
  before delete on trip_participants
  for each row execute function guard_participant_leave();
