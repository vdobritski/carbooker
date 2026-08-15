-- 016_cascade_and_leave_fixes.sql
--
-- Three things review found after 015, two of them reproduced against the live database.
--
-- 1. A group owner who is not a site admin could not delete their own group if they held a
--    confirmed seat in somebody else's car.
--
--    015 made group deletion cascade groups -> trips -> cars -> bookings. The cars leg
--    fires first, so release_seats_on_car_delete() runs while the seat still exists. That
--    function is already `security definer` (008), but definer changes current_user, not
--    auth.uid() - auth.uid() reads the request's JWT claim and stays whoever is logged in.
--    So guard_seat_assignment() saw a real person taking a passenger out of a car they do
--    not own and raised "Only the driver of that car can confirm or deny a seat", which
--    rolled the whole delete back and made no sense to read.
--
--    The seat release is the system tidying up, not a person unseating anybody, so it says
--    so with a transaction-local flag that the guard honours. Deliberately narrow: the flag
--    is set immediately before that one update and cleared immediately after.
--
-- 2. Leaving or being removed from a group left the person's trip_participants rows behind.
--    They vanished from the group and could no longer see the trip, but were still listed
--    under "Going" and still offered in the driver's assign panel - so a driver could spend
--    a real seat on somebody who would never see it and could not cancel it, because
--    booked_by was the driver. checks.sql stayed green: nothing in it knows about groups.
--
--    Removing participation is safe in a way removing bookings would not be: no seat is
--    destroyed. The two rules above still refuse the removal outright while a seat or a car
--    exists, so by the time this runs there is nothing to lose.

create or replace function release_seats_on_car_delete() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Transaction-local (the third argument), and switched off again straight away, so it
  -- cannot leak into any other statement in the same transaction.
  perform set_config('carbooker.releasing_car', 'on', true);

  update bookings
     set car_id = null, status = 'pending', updated_at = now()
   where car_id = old.id;

  perform set_config('carbooker.releasing_car', 'off', true);
  return old;
end;
$$;


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

  if auth.uid() is null or is_admin() then
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


-- Leaving a group also stops you going on its trips. Everything else in this function is
-- 015's text unchanged.
create or replace function guard_group_membership() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    if (new.can_create_trips or new.can_manage_trips or new.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can grant permissions';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.group_id is distinct from old.group_id
       or new.profile_id is distinct from old.profile_id then
      raise exception
        'A membership cannot be moved to another group or person. Remove it and add the other instead.';
    end if;

    if (new.can_create_trips is distinct from old.can_create_trips
        or new.can_manage_trips is distinct from old.can_manage_trips
        or new.can_manage_members is distinct from old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change permissions';
    end if;

    if old.profile_id <> auth.uid()
       and (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change a member who has permissions';
    end if;

    return new;
  end if;

  -- DELETE.
  if not exists (select 1 from groups where id = old.group_id) then
    return old;
  end if;

  if exists (select 1 from groups where id = old.group_id and owner_id = old.profile_id) then
    raise exception 'Hand the group to somebody else before leaving it';
  end if;

  if old.profile_id <> auth.uid()
     and (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
     and not is_group_owner(old.group_id) then
    raise exception 'Only the group owner can remove a member who has permissions';
  end if;

  if exists (
    select 1 from bookings b join trips t on t.id = b.trip_id
     where t.group_id = old.group_id
       and b.status <> 'denied'
       and (b.profile_id = old.profile_id or b.booked_by = old.profile_id)
  ) then
    raise exception 'Cancel their seats on this group''s trips first';
  end if;

  if exists (
    select 1 from cars c join trips t on t.id = c.trip_id
     where t.group_id = old.group_id and c.driver_id = old.profile_id
  ) then
    raise exception 'Remove their car from this group''s trips first';
  end if;

  -- New in 016. Reached only once the two rules above have confirmed there is no seat and
  -- no car left, so this destroys nothing: it stops somebody who has left the group being
  -- listed as going on its trips, and being offered a seat there by a driver.
  delete from trip_participants p
   using trips t
   where p.trip_id = t.id
     and t.group_id = old.group_id
     and p.profile_id = old.profile_id;

  return old;
end;
$$;
