# 16 — A trip belongs to a group

## Goal

`trips.group_id`, not null. Only members of the group see the trip. Starting one needs
`can_create_trips`; editing or deleting **somebody else's** needs `can_manage_trips`; your
own trip is always yours. A direct link to a trip in a group you are not in says "Trip not
found".

This is the first of the two flips. After it, a trip is invisible outside its group — the
cars, seats and participants underneath it, and everybody's name, are still readable to any
signed-in user who knows an id, and task 17 closes that.

## Dependencies

15. Migration **013**.

## Expected changes

- `supabase/migrations/<next>_trips_in_groups.sql` — column, backfill, `not null`, index, the
  group-immutability trigger, the four rewritten trips policies, and the extension to
  `guard_group_membership()`
- `src/lib/types.ts` — `TripRow.group_id` / `Trip.groupId`
- `src/api/trips.ts` — `COLUMNS` gains `group_id`, `createTrip` takes a `groupId`,
  `listTrips()` also returns the group name, new `listGroupTrips(groupId)`
- `src/pages/Trips.tsx` — the create form gets a required group `<select>` listing only
  groups where I may start trips; each card shows which group it belongs to
- `src/pages/GroupDetail.tsx` — a "Trips" section linking to `/trips/:id`
- `src/pages/TripDetail.tsx` — `canManage` becomes "I created this trip, or I may manage
  anyone's trip in this group"

## The migration

```sql
alter table trips add column group_id uuid references groups (id) on delete cascade;

-- Every trip that exists today belongs to the group task 14 backfilled.
update trips set group_id = (select id from groups order by created_at limit 1)
 where group_id is null;

-- Fails loudly if the line above missed something, which is what we want.
alter table trips alter column group_id set not null;

create index trips_group_id_idx on trips (group_id);
```

**A trip cannot move between groups.** Moving one would strand its cars, seats and
participants with people who are no longer allowed to see them.

```sql
create function guard_trip_group() returns trigger
  language plpgsql as $$
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
```

Policies — drop and recreate, the pattern 010/011 already use:

```sql
drop policy trips_select on trips;
create policy trips_select on trips
  for select to authenticated using (is_group_member(group_id));

-- The checkbox, doing its work: a plain member with can_create_trips starts trips, and
-- can_create_trips_in() already folds in the owner and site admins. This is the only
-- operation that switch gates.
drop policy trips_insert on trips;
create policy trips_insert on trips
  for insert to authenticated
  with check (created_by = auth.uid() and can_create_trips_in(group_id));

-- "Creator or admin" survives, as the created_by branch - otherwise can_create_trips would
-- be a trap: you make a trip and cannot fix a typo in it. can_manage_trips is the wider
-- right, over anybody's trip in the group.
drop policy trips_update on trips;
create policy trips_update on trips
  for update to authenticated
  using (created_by = auth.uid() or can_manage_trips_in(group_id))
  with check (created_by = auth.uid() or can_manage_trips_in(group_id));

drop policy trips_delete on trips;
create policy trips_delete on trips
  for delete to authenticated
  using (created_by = auth.uid() or can_manage_trips_in(group_id));
```

And the rule task 14 could not write yet:

```sql
-- Extends guard_group_membership() from 012: you cannot leave, and cannot be kicked out
-- of, a group while you still hold a seat or a car on one of its trips. Same reasoning as
-- trip_participants_leave_guard in 009 - the alternative is a trigger silently deleting
-- other people's bookings.
create or replace function guard_group_membership() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  ... everything from 012, unchanged ...

  -- DELETE, after the owner and the permissions checks:
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
```

Both checks sit after the owner check, which already steps aside when the group itself is
being deleted — so a cascade still tidies up quietly. The `booked_by` half of the seat
condition is what catches a member whose `+1` is holding a seat.

## Acceptance criteria

- The live trip still opens, still shows its cars, participants and seats, and booking
  still works — for the four accounts, which are all in the backfilled group.
- A signed-in account that is in no group sees an empty `/trips` with a line pointing at
  `/groups`, and `/#/trips/<id>` of the live trip shows "Trip not found". Verify with a
  throwaway fifth account.
- A plain member without `can_create_trips` has no "New trip" form (their group select is
  empty), **and** a direct `createTrip` call with that group id is refused by RLS — the
  insert returns no row and the API surfaces it as an error, not a silent success.
- Ticking `can_create_trips` for that member on `/groups/<id>` lets them create a trip on
  their next page load, without any change to their site-wide role.
- That member can rename and delete **their own** trip, and cannot edit or delete anybody
  else's — the edit controls are absent and a direct `updateTrip` on someone else's trip
  returns zero rows. Verify the refusal, not just the hidden button.
- Ticking `can_manage_trips` for them lets them edit and delete any trip in the group.
  Ticking it does **not** grant them "create"; check the two switches move independently.
- The owner can edit and delete any trip in the group with no switches ticked at all.
- `update trips set group_id = <other group>` from a browser session raises *"A trip cannot
  be moved to another group"*.
- Deleting a group deletes its trips, and with them their cars and bookings.
- A member holding an active seat cannot leave the group and gets the message saying why.
- `supabase/checks.sql` still returns zero rows.

## Implementation notes

- `listTrips()` needs no `.eq('group_id', ...)`. The policy is the filter — adding a client
  filter as well would be a second source of truth. Embed the name with
  `select('..., groups (name)')` for the card label.
- The "Trip not found" behaviour is free: `getTrip` already returns `null` when the select
  finds nothing, and `TripDetail.tsx` already renders that branch. Do not add an
  "access denied" screen — a stranger should not learn that the trip exists.
- `TripDetail.tsx` currently computes `canManage = isAdmin || trip.createdBy === me`. The
  new value is `trip.createdBy === me || can_manage_trips in this group` — so keep the
  first half rather than replacing it. Fetch the caller's switches for `trip.groupId`
  alongside the board: one extra field on `TripBoard` (`myGroupRights`) filled by a fifth
  query in `getTripBoard`, rather than a new context.
- `canRegisterCar` still reads `profile.role === 'driver'` at this point. Leave it; task 17
  replaces it. Do not half-move it here.
- Trip creation lives in exactly one place — the form on `/trips` with a group picker.
  `GroupDetail` links to it; it does not grow a second form.

## Risk

**What could break:** everything trip-shaped, in one migration. The realistic failure is
the backfill leaving a trip with a null `group_id` (the `set not null` catches it) or the
policy rewrite locking out an account that was never added to the backfilled group — check
`select p.display_name from profiles p left join group_members m on m.profile_id = p.id
where m.profile_id is null` **before** applying, and add the strays.

**How you know it works:** the live trip opens for all four accounts and is invisible to a
fifth; a member with "can start trips" makes one and can edit only that one; ticking
"can manage anyone's trip" widens it and ticking it alone does not let them start one;
`supabase/checks.sql` returns zero rows, and `npm run build` is clean.
