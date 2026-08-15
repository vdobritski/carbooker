-- Booking consistency checks.
--
-- Paste the whole file into the Supabase SQL editor after any change that touches
-- bookings, cars or seats. It must return ZERO ROWS. Anything it returns is a real
-- inconsistency: the `problem` column says which rule broke and `offender` points at the row.
--
-- Two labels start with WARNING:. Those are states that are legitimate for a while -
-- a group whose owner deleted their account, a car whose driver was flipped back to
-- passenger - and want a human decision, not a bug report.
--
-- It is one query on purpose - the SQL editor only shows the last result set, so a file of
-- separate queries would quietly report just the last one.
--
-- See docs/tasks/12-booking-consistency-checks.md.

select * from (

  -- invariant 1: every seat has exactly one occupant
  select 'one occupant per seat' as problem, id::text as offender
    from bookings
   where num_nonnulls(profile_id, guest_id) <> 1

  union all

  -- invariant 2: a seat is in a car iff it is confirmed
  select 'car set iff confirmed', id::text
    from bookings
   where (car_id is not null) <> (status = 'confirmed')

  union all

  -- invariant 3: no car holds more confirmed seats than it has
  select 'car over capacity', c.title
    from cars c
    join bookings b on b.car_id = c.id and b.status = 'confirmed'
   group by c.id, c.title, c.seat_count
  having count(*) > c.seat_count

  union all

  -- invariant 4: one active seat per person per trip
  select 'user has two active seats', trip_id::text || ' / ' || profile_id::text
    from bookings
   where profile_id is not null and status <> 'denied'
   group by trip_id, profile_id
  having count(*) > 1

  union all

  select 'guest has two active seats', trip_id::text || ' / ' || guest_id::text
    from bookings
   where guest_id is not null and status <> 'denied'
   group by trip_id, guest_id
  having count(*) > 1

  union all

  -- a seat's car belongs to the same trip as the seat. Nothing in the schema prevents a
  -- query that forgot its trip_id filter from offering a car from another trip.
  select 'seat is in a car from another trip', b.id::text
    from bookings b
    join cars c on c.id = b.car_id
   where c.trip_id <> b.trip_id

  union all

  select 'preferred car is on another trip', b.id::text
    from bookings b
    join cars c on c.id = b.preferred_car_id
   where c.trip_id <> b.trip_id

  union all

  -- the app maintains this, the schema does not: booking a seat also joins you to the trip
  select 'occupant is not a participant', b.id::text
    from bookings b
   where b.profile_id is not null
     and not exists (
       select 1 from trip_participants p
        where p.trip_id = b.trip_id and p.profile_id = b.profile_id
     )

  union all

  -- should be impossible via the foreign keys; proves they are actually there
  select 'booking on a trip that does not exist', b.id::text
    from bookings b
   where not exists (select 1 from trips t where t.id = b.trip_id)

  union all

  select 'car on a trip that does not exist', c.id::text
    from cars c
   where not exists (select 1 from trips t where t.id = c.trip_id)

  -- ---------------------------------------------------------------------------
  -- The group boundary (task 20). Rows below mean somebody can see, or is sitting
  -- in, something outside their group.
  --
  -- Most of these are guaranteed today by guard_group_membership() refusing to
  -- remove anybody still holding a seat or a car, and by guard_group_owner().
  -- They are here to catch a future change that quietly drops one of those rules.
  -- ---------------------------------------------------------------------------

  union all

  select 'trip belongs to a group that does not exist', t.id::text
    from trips t
   where not exists (select 1 from groups g where g.id = t.group_id)

  union all

  select 'group owner is not a member of it', g.name
    from groups g
   where g.owner_id is not null
     and not exists (
       select 1 from group_members m
        where m.group_id = g.id and m.profile_id = g.owner_id
     )

  union all

  -- Legitimate right after the owner's account is deleted: the group survives so its
  -- trips do. A site admin should hand it to somebody.
  select 'WARNING: group has no owner', g.name
    from groups g
   where g.owner_id is null

  union all

  select 'seat occupant is not in the trip group', b.id::text
    from bookings b
    join trips t on t.id = b.trip_id
   where b.profile_id is not null
     and not exists (
       select 1 from group_members m
        where m.group_id = t.group_id and m.profile_id = b.profile_id
     )

  union all

  -- Catches a +1 whose host has left the group: the guest has no membership of its
  -- own, so this is the only thing that would notice.
  select 'seat was booked by somebody not in the trip group', b.id::text
    from bookings b
    join trips t on t.id = b.trip_id
   where not exists (
     select 1 from group_members m
      where m.group_id = t.group_id and m.profile_id = b.booked_by
   )

  union all

  -- Nothing stops a member manager flipping a driver back to passenger while their car
  -- is still on a trip - by decision, not by oversight. Move the car's seats, or delete
  -- the car.
  select 'WARNING: car driver no longer drives in that group', c.title
    from cars c
    join trips t on t.id = c.trip_id
   where not exists (
     select 1 from group_members m
      where m.group_id = t.group_id
        and m.profile_id = c.driver_id
        and m.travel_role = 'driver'
   )

  union all

  select 'trip participant is not in the trip group', p.trip_id::text || ' / ' || p.profile_id::text
    from trip_participants p
    join trips t on t.id = p.trip_id
   where not exists (
     select 1 from group_members m
      where m.group_id = t.group_id and m.profile_id = p.profile_id
   )

  union all

  select 'join request for a group they are already in', r.group_id::text || ' / ' || r.profile_id::text
    from group_join_requests r
   where exists (
     select 1 from group_members m
      where m.group_id = r.group_id and m.profile_id = r.profile_id
   )

) problems
order by problem, offender;
