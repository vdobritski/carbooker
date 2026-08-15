-- 017_group_scoped_reads.sql
-- Everything under a trip, and everyone's name, follows the group.
-- Schema reference: docs/data-model.md
--
-- The second and last flip. 015 made a trip invisible outside its group; the cars, seats
-- and participants *underneath* it were still readable by any signed-in account that knew
-- an id, and every profile and guest name was readable by everybody. After this migration
-- somebody outside a group learns nothing about it - not its trips, not its cars, not who
-- is in it, not their names. A brand-new account with no groups can read exactly two
-- things: its own profiles row and its own guests.
--
-- The global 'driver' role retires in the same move: driving is a property of a membership
-- (group_members.travel_role), which 012 backfilled and 014 let a member set on themselves.
--
-- Every policy below is a rewrite of a live one. Each carries its predecessor's branches:
-- an is_admin() branch that disappears has been folded into a helper that includes admins
-- (is_group_member, can_drive_in_group and - through can_manage_trips_in -> is_group_owner
-- - manages_trip). Nothing here is the *only* thing standing between a passenger and a
-- seat: the guard triggers from 007/009/016 still run underneath.

-- Two lookups, because cars, bookings and participants carry a trip_id, not a group_id.
-- Definer for the reason every helper is: a policy on cars must not depend on whether the
-- caller can read the trips row, and a lookup that re-enters a policy recurses.
create function trip_group(trip uuid) returns uuid
  language sql
  security definer
  stable
  set search_path = public
as $$
  select group_id from trips where id = trip;
$$;

-- "May I run this trip?" - I made it, or I may manage anybody's trip in its group. This is
-- the single expression of trip authority; every policy under a trip uses it, so the
-- creator branch cannot be remembered in one place and forgotten in another.
--
-- Authority over *the trip*, not over the group: a member with only can_create_trips
-- manages the cars, participants and seats on the trip they started, and nothing on
-- anyone else's. can_manage_trips_in() folds in the group owner and site admins, which is
-- where the is_admin() branch of every policy below went.
create function manages_trip(trip uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from trips t
     where t.id = trip
       and (t.created_by = auth.uid() or can_manage_trips_in(t.group_id))
  );
$$;


-- Names ---------------------------------------------------------------------
-- shares_group_with() has been waiting since 012 for exactly these two policies. Every
-- existing embed keeps working because it reads somebody in the same group as the viewer:
-- bookings -> profiles (the occupant), bookings -> guests (a +1, via its host),
-- cars -> profiles (the driver), trip_participants -> profiles. If one ever does not, the
-- symptom is a name rendering as 'Unknown' - PostgREST returns null for an embedded row
-- the caller cannot read. The fix for that is the policy, never a lookup around it.
--
-- Task 18 adds one more branch here, for a member manager reading the name of somebody who
-- has asked to join. It cannot be written yet: group_join_requests does not exist.
drop policy profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (id = auth.uid() or shares_group_with(id) or is_admin());

drop policy guests_select on guests;
create policy guests_select on guests
  for select to authenticated
  using (host_id = auth.uid() or shares_group_with(host_id) or is_admin());


-- cars ----------------------------------------------------------------------
drop policy cars_select on cars;
create policy cars_select on cars
  for select to authenticated
  using (is_group_member(trip_group(trip_id)));

-- Replaces the profiles.role in ('driver','admin') test from 005. Both halves still
-- matter: can_drive_in_group() stops a passenger registering a car, driver_id = auth.uid()
-- stops anyone registering one for somebody else. can_drive_in_group() includes admins.
drop policy cars_insert on cars;
create policy cars_insert on cars
  for insert to authenticated
  with check (driver_id = auth.uid() and can_drive_in_group(trip_group(trip_id)));

-- Was "driver or admin". Whoever runs the trip now counts too, which is what makes it
-- possible to clear a departing member's car out of a trip.
drop policy cars_update on cars;
create policy cars_update on cars
  for update to authenticated
  using (driver_id = auth.uid() or manages_trip(trip_id))
  with check (driver_id = auth.uid() or manages_trip(trip_id));

drop policy cars_delete on cars;
create policy cars_delete on cars
  for delete to authenticated
  using (driver_id = auth.uid() or manages_trip(trip_id));


-- trip_participants ---------------------------------------------------------
drop policy trip_participants_select on trip_participants;
create policy trip_participants_select on trip_participants
  for select to authenticated
  using (is_group_member(trip_group(trip_id)));

-- "You add yourself" now means "you add yourself to a trip of a group you are in": without
-- the membership half a guessed trip id would still be a way onto somebody else's trip.
drop policy trip_participants_insert on trip_participants;
create policy trip_participants_insert on trip_participants
  for insert to authenticated
  with check (
    (profile_id = auth.uid() and is_group_member(trip_group(trip_id)))
    or manages_trip(trip_id)
  );

drop policy trip_participants_delete on trip_participants;
create policy trip_participants_delete on trip_participants
  for delete to authenticated
  using (profile_id = auth.uid() or manages_trip(trip_id));

-- Still no update policy: there is nothing on this row worth changing.


-- bookings ------------------------------------------------------------------
drop policy bookings_select on bookings;
create policy bookings_select on bookings
  for select to authenticated
  using (is_group_member(trip_group(trip_id)));

-- 011's shape, with is_admin() widened to manages_trip() and the self-booking branch gated
-- on membership so a guessed trip id is not a way in. The owns_car(car_id) branch is 010's
-- driver-seats-somebody-directly case and is still here; guard_seat_assignment() refuses
-- an insert carrying a car_id the caller does not own, so it cannot become a way to put
-- people in other people's cars.
drop policy bookings_insert on bookings;
create policy bookings_insert on bookings
  for insert to authenticated
  with check (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and booked_by = auth.uid()
      and (
        profile_id = auth.uid()
        or exists (select 1 from guests g where g.id = guest_id and g.host_id = auth.uid())
        or owns_car(car_id)
      )
    )
  );

-- Four branches inside the group, all four from 010, none of them droppable:
--   booked_by            - the booker editing their own comment or preference;
--   owns_car(car_id)     - the driver of the car the seat is in;
--   owns_car(preferred_) - the driver answering a request aimed at their car;
--   pending + no car     - a driver on the trip reaching a seat that has stated no
--                          preference at all, which no other branch can see. 010 learned
--                          that a missing branch here is a silent no-op, not an error.
-- is_admin() is gone from the top only because manages_trip() already contains it.
drop policy bookings_update on bookings;
create policy bookings_update on bookings
  for update to authenticated
  using (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and (
        booked_by = auth.uid()
        or owns_car(car_id)
        or owns_car(preferred_car_id)
        or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
      )
    )
  )
  with check (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and (
        booked_by = auth.uid()
        or owns_car(car_id)
        or owns_car(preferred_car_id)
        or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
      )
    )
  );

drop policy bookings_delete on bookings;
create policy bookings_delete on bookings
  for delete to authenticated
  using (booked_by = auth.uid() or manages_trip(trip_id));


-- The seating guard ---------------------------------------------------------
-- Whoever runs the trip may move a seat between its cars, which is what "they can manage
-- its seats" means. One exemption widened and nothing else: the body below is 016's, with
-- `or manages_trip(new.trip_id)` added to the admin line.
--
-- The carbooker.releasing_car check stays exactly where it is. It is what lets a car being
-- deleted release its seats: release_seats_on_car_delete() is security definer, which
-- changes current_user but not auth.uid(), so without the flag this guard sees whoever is
-- signed in and refuses - which is what made deleting a group fail for its own non-admin
-- owner.
--
-- guard_booking_identity() is deliberately NOT widened. Moving a seat to another trip or
-- another occupant stays a site-admin-only escape hatch: "move bookings" means between the
-- cars of one trip, and checks 5 and 6 in supabase/checks.sql exist to catch the
-- cross-trip version.
create or replace function guard_seat_assignment() returns trigger
  language plpgsql
as $$
declare
  allowed boolean;
begin
  -- The car this seat is in is being deleted and the seat is being released. Not a person
  -- moving anybody, so the "only the driver may seat or unseat" rule does not apply.
  if coalesce(current_setting('carbooker.releasing_car', true), 'off') = 'on' then
    return new;
  end if;

  if auth.uid() is null
     or is_admin()
     or manages_trip(new.trip_id)
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.car_id is not null and not owns_car(new.car_id) then
      raise exception 'Only the driver of that car can seat someone in it';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status
     and new.car_id is not distinct from old.car_id then
    return new;
  end if;

  if new.car_id is not null then
    allowed := owns_car(new.car_id);
  elsif old.car_id is not null then
    allowed := owns_car(old.car_id);
  else
    allowed := owns_car(old.preferred_car_id);
  end if;

  if not allowed then
    raise exception 'Only the driver of that car can confirm or deny a seat';
  end if;

  return new;
end;
$$;


-- Retiring the global driver role -------------------------------------------
-- Nothing reads profiles.role = 'driver' any more: the cars_insert policy above was its
-- last use in the database, and TripDetail's "Register my car" link its last use in the
-- app. Whoever held it already has travel_role = 'driver' in the group 012 backfilled, so
-- nothing needs re-granting.
--
-- This runs from the SQL editor, where auth.uid() is null, so guard_role_change() lets it
-- through - the bootstrap exemption from 002. is_admin() and guard_role_change() are
-- otherwise unchanged: 'admin' still means site admin, and still only an admin may set it.
update profiles set role = 'user' where role = 'driver';

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'user'));
