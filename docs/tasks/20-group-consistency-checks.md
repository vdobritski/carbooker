# 20 — Group consistency checks

## Goal

Extend `supabase/checks.sql` so it also proves the group boundary holds. Same rule as task
12: one query, zero rows, pasted into the SQL editor after anything that touches groups,
trips or seats.

## Dependencies

17. Run it again after 18 and 19. No migration.

## Expected changes

- `supabase/checks.sql` — the branches below appended to the existing `union all`, each
  with its own label in the `problem` column
- `CLAUDE.md` — the Verification section already points at task 12; add that group changes
  are covered by the same file

## The new checks

```sql
-- 9. every trip belongs to a group that exists
select t.id from trips t
 where not exists (select 1 from groups g where g.id = t.group_id);

-- 10. a group's owner is a member of it
select g.id, g.name from groups g
 where g.owner_id is not null
   and not exists (
     select 1 from group_members m
      where m.group_id = g.id and m.profile_id = g.owner_id
   );

-- 10b. WARNING, not a breakage: an ownerless group. Legitimate right after the owner's
--      account is deleted; a site admin should hand it to somebody.
select g.id, g.name from groups g where g.owner_id is null;

-- 11. the occupant of a seat is a member of the trip's group
select b.id from bookings b
  join trips t on t.id = b.trip_id
 where b.profile_id is not null
   and not exists (
     select 1 from group_members m
      where m.group_id = t.group_id and m.profile_id = b.profile_id
   );

-- 12. whoever booked a seat is a member of the trip's group
--     (catches a +1 whose host has left)
select b.id from bookings b
  join trips t on t.id = b.trip_id
 where not exists (
   select 1 from group_members m
    where m.group_id = t.group_id and m.profile_id = b.booked_by
 );

-- 13. WARNING, not a breakage: a car whose driver is no longer a driver in that group,
--     or has left it. Nothing blocks a manager flipping somebody back to passenger while
--     their car is still on a trip - by decision, not by oversight. Move the car's seats
--     or delete the car.
select c.id, c.title from cars c
  join trips t on t.id = c.trip_id
 where not exists (
   select 1 from group_members m
    where m.group_id = t.group_id
      and m.profile_id = c.driver_id
      and m.travel_role = 'driver'
 );

-- 14. every trip participant is a member of the trip's group
select p.trip_id, p.profile_id from trip_participants p
  join trips t on t.id = p.trip_id
 where not exists (
   select 1 from group_members m
    where m.group_id = t.group_id and m.profile_id = p.profile_id
 );

-- 15. nobody has a join request for a group they are already in
select r.group_id, r.profile_id from group_join_requests r
 where exists (
   select 1 from group_members m
    where m.group_id = r.group_id and m.profile_id = r.profile_id
 );
```

## Acceptance criteria

- Every branch except the two labelled WARNING returns zero rows against the live database
  after task 17, and again after 18 and 19.
- Each new branch can fail: delete a group's owner account and check 10b fires; flip a
  driver who owns a car to passenger and check 13 fires; put a booking on a trip whose
  group the occupant left (with the membership guard temporarily disabled) and check 11
  fires. A check that never fires is not a check.
- The `problem` label makes it obvious which branch produced a row, including which of the
  two are warnings. Prefix those two with `WARNING:`.

## Implementation notes

- Checks 11, 12 and 14 are guaranteed today by `guard_group_membership()` refusing to
  remove someone who still holds a seat or a car. They exist to catch a future change that
  quietly drops that rule.
- Check 10 is guaranteed by `guard_group_owner()`. Same reasoning.
- There is no "every group has exactly one owner" check, and there cannot be one to get
  wrong: ownership is a single column on a single row. That is the point of putting it
  there instead of on the membership rows.
- Keep it one pasteable file. Still no pgTAP, still no runner.

## Risk

**What could break:** nothing — this task writes no code that runs in the app.

**How you know it works:** the file returns zero rows apart from warnings that have been
read and understood, and each new branch has been made to return a row once, on purpose,
and then put back.
