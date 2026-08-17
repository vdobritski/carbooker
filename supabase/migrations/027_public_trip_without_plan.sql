-- 027_public_trip_without_plan.sql
--
-- The itinerary comes back out of the public trip. 024 put it in on the argument that a
-- plan is the part of a trip worth sharing by link, and that `trips.plan` was already
-- public anyway - but a list of stops with map links says where a group of people will be
-- and when, which is a different thing to publish than "there are two cars and one free
-- seat". Whoever holds the link is not necessarily coming.
--
-- `plan` - the free text notes field - stays, as it has been since 022. It is written in
-- the knowledge that publishing shows it; the stops were not.
--
-- Same function as 025 with the plan_points key dropped. Nothing else changes, and
-- create or replace keeps the grants from 022.

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
