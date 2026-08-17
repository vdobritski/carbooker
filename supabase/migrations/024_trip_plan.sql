-- 024_trip_plan.sql
--
-- The itinerary: a trip's stops, in order, each with a time and usually a map link.
--
--   Day 1
--     11:00  leave                  maps.google.com/...
--     13:00  arrive in Hrodna       maps.google.com/...
--     14:00  parking by the castle  maps.google.com/...
--
-- `trips.plan` stays exactly as it is. It is free text and now reads as the trip's notes -
-- the things an itinerary has no column for. Nothing is migrated out of it, so a trip
-- written before this still shows everything it did.
--
-- No sort column. Points are ordered by day, then time, then when they were added, which
-- is the order somebody typing an itinerary already has in their head - the example above
-- sorts itself. A point with no time yet sits at the end of its day rather than the start,
-- where it reads as "still to be placed" instead of "first thing in the morning".
--
-- `day` is a number, not a date: a trip can be planned before its dates are set, and the
-- screen shows the real date beside "Day 2" whenever starts_on is known.

create table trip_plan_points (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips (id) on delete cascade,
  day        int not null default 1,
  at_time    time,
  title      text not null,
  url        text,
  created_at timestamptz not null default now(),

  constraint trip_plan_points_day_positive check (day > 0),
  constraint trip_plan_points_title_not_blank check (length(trim(title)) > 0),
  -- Rendered as a link, so it has to be one. Without this a stored 'javascript:...' would
  -- become an href on the trip page, and the public one.
  constraint trip_plan_points_url_is_link check (url is null or url ~* '^https?://')
);

create index trip_plan_points_trip_idx on trip_plan_points (trip_id, day, at_time);

alter table trip_plan_points enable row level security;

-- Reading is the same question as reading the trip's cars: am I in the group?
create policy trip_plan_points_select on trip_plan_points
  for select to authenticated
  using (is_group_member(trip_group(trip_id)));

-- Writing is whoever runs the trip. Not the drivers: a car is somebody's to manage, the
-- route is not - and manages_trip() already folds in the trip's creator, anybody with
-- can_manage_trips in the group, the owner, and site admins.
create policy trip_plan_points_insert on trip_plan_points
  for insert to authenticated
  with check (manages_trip(trip_id));

create policy trip_plan_points_update on trip_plan_points
  for update to authenticated
  using (manages_trip(trip_id))
  with check (manages_trip(trip_id));

create policy trip_plan_points_delete on trip_plan_points
  for delete to authenticated
  using (manages_trip(trip_id));


-- 022's function, plus the itinerary. Everything here was already public for a published
-- trip - `plan` is free text that could say anything, including exactly this - and an
-- itinerary is the part of a trip worth sharing by link. Still no names, no ids, no seats.
--
-- Unpublishing remains the single switch that turns all of it off: the function returns
-- null for a trip that is not published, before any of this is built.
create or replace function public_trip(trip_id uuid) returns jsonb
  language sql
  security definer
  stable
  set search_path = public
as $$
  select case
    when t.is_public then jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'description', t.description,
      'plan', t.plan,
      'starts_on', t.starts_on,
      'ends_on', t.ends_on,
      'people_going', (
        select count(*) from trip_participants p where p.trip_id = t.id
      ),
      'plan_points', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'day', pp.day,
                   'at_time', pp.at_time,
                   'title', pp.title,
                   'url', pp.url
                 )
                 order by pp.day, pp.at_time nulls last, pp.created_at
               )
          from trip_plan_points pp where pp.trip_id = t.id
      ), '[]'::jsonb),
      'cars', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'title', c.title,
                   'description', c.description,
                   'features', c.features,
                   'seat_count', c.seat_count,
                   'seats_taken', (
                     select count(*) from bookings b
                      where b.car_id = c.id and b.status = 'confirmed'
                   )
                 )
                 order by c.created_at
               )
          from cars c where c.trip_id = t.id
      ), '[]'::jsonb)
    )
  end
  from trips t
  where t.id = trip_id;
$$;
