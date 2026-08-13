-- Booking consistency checks.
--
-- Paste the whole file into the Supabase SQL editor after any change that touches
-- bookings, cars or seats. It must return ZERO ROWS. Anything it returns is a real
-- inconsistency: the `problem` column says which rule broke and `offender` points at the row.
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

) problems
order by problem, offender;
