-- 015_trips_in_groups.sql
-- A trip belongs to exactly one group, and only that group's members can see it.
-- Schema reference: docs/data-model.md
--
-- This is the first of the two flips: after it a trip is invisible outside its group. The
-- cars, seats and participants *underneath* a trip are still readable to any signed-in
-- account that knows an id - task 17 closes that.
--
-- Everything that exists today moves into the group 012 backfilled, so the running app
-- keeps working: every account is already a member of it.

alter table trips add column group_id uuid references groups (id) on delete cascade;

-- Every trip that exists today belongs to the group 012 backfilled - the oldest group.
update trips set group_id = (select id from groups order by created_at limit 1)
 where group_id is null;

-- Fails loudly if the line above missed something, which is what we want.
alter table trips alter column group_id set not null;

create index trips_group_id_idx on trips (group_id);


-- A trip cannot move between groups. Moving one would strand its cars, seats and
-- participants with people who are no longer allowed to see them.
create function guard_trip_group() returns trigger
  language plpgsql
as $$
begin
  -- No admin exemption: this protects the data, not anyone's privileges. A direct
  -- database session bypasses RLS already and is trusted.
  if auth.uid() is not null and new.group_id is distinct from old.group_id then
    raise exception 'A trip cannot be moved to another group';
  end if;
  return new;
end;
$$;

create trigger trips_group_guard
  before update on trips
  for each row execute function guard_trip_group();


-- Policies - drop and recreate, the pattern 010/011 already use. The four from 003 all
-- said "everyone signed in", which is what this migration is here to stop.
drop policy trips_select on trips;
create policy trips_select on trips
  for select to authenticated
  using (is_group_member(group_id));

-- The checkbox, doing its work: a plain member with can_create_trips starts trips, and
-- can_create_trips_in() already folds in the owner and site admins. This is the only
-- operation that switch gates.
drop policy trips_insert on trips;
create policy trips_insert on trips
  for insert to authenticated
  with check (created_by = auth.uid() and can_create_trips_in(group_id));

-- "Creator or admin" survives, as the created_by branch - otherwise can_create_trips would
-- be a trap: you make a trip and cannot fix a typo in it. can_manage_trips is the wider
-- right, over anybody's trip in the group, and folds in the owner and site admins.
drop policy trips_update on trips;
create policy trips_update on trips
  for update to authenticated
  using (created_by = auth.uid() or can_manage_trips_in(group_id))
  with check (created_by = auth.uid() or can_manage_trips_in(group_id));

drop policy trips_delete on trips;
create policy trips_delete on trips
  for delete to authenticated
  using (created_by = auth.uid() or can_manage_trips_in(group_id));


-- And the rule 012 could not write yet, because it needs trips.group_id: you cannot leave,
-- and cannot be kicked out of, a group while you still hold a seat or a car on one of its
-- trips. Same reasoning as guard_participant_leave() in 009 - the alternative is a trigger
-- silently deleting other people's bookings.
--
-- The body below is 014's, unchanged, plus the two new DELETE checks. 013's group_id /
-- profile_id immutability rule and 014's `old.profile_id <> auth.uid()` exemption on the
-- UPDATE "member who has permissions" rule are both still here; losing either reopens a
-- hole review already found.
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

    -- Nobody but the owner touches the switches, including on their own row.
    if (new.can_create_trips is distinct from old.can_create_trips
        or new.can_manage_trips is distinct from old.can_manage_trips
        or new.can_manage_members is distinct from old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change permissions';
    end if;

    -- Somebody else who holds a switch is the owner's to edit; your own row is your own.
    if old.profile_id <> auth.uid()
       and (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change a member who has permissions';
    end if;

    return new;
  end if;

  -- DELETE.
  -- Deleting the group cascades to its members, and by then the group row is gone. Every
  -- rule below asks about that group, so they all step aside here and a cascade tidies up
  -- quietly - including the two new ones, whose trips are being deleted by the same cascade.
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

  -- New in 015. The booked_by half is what catches a member whose +1 is holding a seat:
  -- a guest rides on their host's membership.
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

  return old;
end;
$$;
