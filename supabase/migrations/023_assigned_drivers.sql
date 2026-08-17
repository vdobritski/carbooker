-- 023_assigned_drivers.sql
--
-- A car's driver stops being "whoever registered it". Two new shapes, both for the case
-- where one person organises the trip and the cars are not all theirs:
--
--   1. a car driven by another member of the group - they get the driver's powers over it
--      (owns_car: confirm, deny, take out, edit, delete);
--   2. a car driven by somebody with no account at all, held as a plain name. Nobody gains
--      driver powers over that car, so it is managed entirely by whoever runs the trip.
--
-- Exactly one of driver_id / driver_name is set. Everything that asks "is this my car?"
-- goes through owns_car(), which compares driver_id to auth.uid(), so a name-only car
-- answers "no" to everybody without any of those call sites changing.
--
-- Who may create the second kind is deliberately narrow. If a plain driver could register
-- a car under someone else's name they would immediately lose control of it - owns_car()
-- would be false for them too - so a car whose driver is not the person registering it
-- requires manages_trip(), and a trip manager keeps authority over it either way.

alter table cars alter column driver_id drop not null;
alter table cars add column driver_name text;

alter table cars add constraint cars_driver_one_of check (
  (driver_id is not null and driver_name is null)
  or (driver_id is null and driver_name is not null and length(trim(driver_name)) > 0)
);


-- is_group_member() asks about the caller. This asks about somebody else, which is what
-- "may I hand this car to that person?" needs. Definer for the usual reason: a car trigger
-- must not depend on whether the caller can read group_members.
create function group_has_member(g uuid, p uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members where group_id = g and profile_id = p
  );
$$;


-- Was `driver_id = auth.uid() and can_drive_in_group(...)`. That first half is now one of
-- two ways in: registering your own car still only needs the group's driver switch, and
-- naming anybody else - a member or a bare name - needs the trip.
drop policy cars_insert on cars;
create policy cars_insert on cars
  for insert to authenticated
  with check (
    (driver_id = auth.uid() and can_drive_in_group(trip_group(trip_id)))
    or manages_trip(trip_id)
  );


-- The group boundary for driver_id, as a trigger rather than a policy branch: a policy
-- refusal arrives as "new row violates row-level security policy", and this rule is worth
-- a sentence the organiser can act on. On update as well as insert, because the identity
-- guard below now lets the driver change and the rule has to hold for that change too.
create function guard_car_driver() returns trigger
  language plpgsql
as $$
begin
  -- Only when the driver is actually being set. Checking it on every update would make an
  -- unrelated edit - a seat count, a title - fail for a car whose driver had somehow left
  -- the group, which is a state to repair rather than a reason to freeze the row.
  -- guard_group_membership() (016) refuses to let a member leave while their car is still
  -- on one of the group's trips, so that state should not arise in the first place.
  if new.driver_id is not null
     and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id)
     and not group_has_member(trip_group(new.trip_id), new.driver_id)
     and not is_admin() then
    raise exception 'That person is not in this group. Add them to it first, or type the driver''s name instead.';
  end if;

  return new;
end;
$$;

create trigger cars_driver_guard
  before insert or update on cars
  for each row execute function guard_car_driver();


-- 018 refused every driver_id change for anyone but a site admin, on the grounds that
-- handing a car over silently strips the real driver of confirm, deny and delete. That is
-- still true, and still the reason a driver cannot do it to their own car - but for
-- somebody who runs the trip it is now the point rather than an accident.
create or replace function guard_car_identity() returns trigger
  language plpgsql
as $$
begin
  -- Unchanged from 018, and still with no exemption: a car's confirmed seats carry the old
  -- trip_id, so moving the car strands them.
  if new.trip_id is distinct from old.trip_id then
    raise exception 'A car cannot be moved to another trip';
  end if;

  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if (new.driver_id is distinct from old.driver_id
      or new.driver_name is distinct from old.driver_name)
     and not manages_trip(new.trip_id) then
    raise exception 'Only somebody who runs this trip can change who drives a car.';
  end if;

  return new;
end;
$$;
