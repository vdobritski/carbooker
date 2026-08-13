# 12 — Booking consistency checks

## Goal

A short SQL script that proves the booking state is sound. Not a test suite — one query
that must return **zero rows**. Run it after any change that touches bookings, cars or
seats.

> Written as a single `union all` rather than the ten separate queries first sketched
> below: the Supabase SQL editor only shows the last result set, so a file of separate
> queries silently reports just the last one and looks like a pass. Each branch is labelled
> in a `problem` column. Note `check` is a reserved word in Postgres and cannot be used as
> the column name.

## Dependencies

07. Write it right after the bookings migration; keep it current as later tasks land.

## Expected changes

- `supabase/checks.sql` — the queries below, each with a comment naming the invariant
- `README.md` — one line: paste this into the Supabase SQL editor after booking changes

## Acceptance criteria

- Every query returns zero rows against a database that has been exercised by hand:
  several trips, several cars, confirmed and pending and denied seats, `+1`s, at least one
  deleted car and one deleted guest.
- Deliberately breaking one invariant with a direct SQL write (temporarily disabling the
  relevant trigger) makes the corresponding query return the bad row. A check that never
  fails is not a check — confirm each one can.

## The checks

```sql
-- 1. every seat has exactly one occupant
select id from bookings where num_nonnulls(profile_id, guest_id) <> 1;

-- 2. a seat is in a car iff it is confirmed
select id, status, car_id from bookings
where (car_id is not null) <> (status = 'confirmed');

-- 3. no car holds more confirmed seats than it has
select c.id, c.title, c.seat_count, count(b.id) as taken
from cars c join bookings b on b.car_id = c.id
group by c.id, c.title, c.seat_count
having count(b.id) > c.seat_count;

-- 4a. one active seat per user per trip
select trip_id, profile_id, count(*) from bookings
where profile_id is not null and status <> 'denied'
group by trip_id, profile_id having count(*) > 1;

-- 4b. one active seat per guest per trip
select trip_id, guest_id, count(*) from bookings
where guest_id is not null and status <> 'denied'
group by trip_id, guest_id having count(*) > 1;

-- 5. a seat's car belongs to the same trip as the seat
select b.id from bookings b join cars c on c.id = b.car_id
where c.trip_id <> b.trip_id;

-- 6. a preferred car belongs to the same trip as the seat
select b.id from bookings b join cars c on c.id = b.preferred_car_id
where c.trip_id <> b.trip_id;

-- 7. the occupant of a seat is a participant of the trip
select b.id from bookings b
where b.profile_id is not null
  and not exists (select 1 from trip_participants p
                  where p.trip_id = b.trip_id and p.profile_id = b.profile_id);

-- 8. no orphaned rows (should be impossible via FKs — proves the FKs are actually there)
select id from bookings b where not exists (select 1 from trips t where t.id = b.trip_id);
select id from cars c where not exists (select 1 from trips t where t.id = c.trip_id);
```

## Implementation notes

- Checks 5 and 6 catch a cross-trip mix-up: a query that forgot its `trip_id` filter can
  offer a car from another trip. Nothing in the schema prevents it, which is exactly why it
  is checked here. If it ever fires in practice, add a composite foreign key
  `(car_id, trip_id) references cars (id, trip_id)` — but do not add it pre-emptively.
- Check 7 encodes a rule the app maintains but the schema does not: booking a seat should
  also make you a participant. Make sure task 07's `bookSeat` upserts the participant row.
- Keep the file flat SQL that can be pasted into the SQL editor whole. No pgTAP, no test
  runner, no npm script.
