-- 025_plan_point_order.sql
--
-- Stops get an explicit order. 024 sorted them by time and said reordering meant changing
-- a time; dragging is the thing that was actually wanted, and it needs somewhere to put
-- the answer.
--
-- What changes for somebody using it:
--
--   - a new stop is added at the end of its day, not slotted in by time. Typing an
--     itinerary in order still comes out in order; a stop remembered late is dragged into
--     place instead of sorting itself there.
--   - editing a time no longer moves anything. Once the order is yours, an edit that
--     silently re-sorted the day would undo a drag.
--
-- at_time stays exactly what it was - a label on the stop - and stops with no time are no
-- longer special: they sit wherever they were put.

alter table trip_plan_points add column sort_order int not null default 0;

-- Existing itineraries keep the order they are being read in today, so nothing appears to
-- shuffle when this lands. row_number() per day, matching 024's ordering exactly.
with ordered as (
  select id,
         row_number() over (
           partition by trip_id, day
           order by at_time nulls last, created_at
         ) as n
    from trip_plan_points
)
update trip_plan_points p
   set sort_order = ordered.n
  from ordered
 where ordered.id = p.id;

create index trip_plan_points_order_idx on trip_plan_points (trip_id, day, sort_order);
drop index trip_plan_points_trip_idx;


-- One request per drag instead of one per stop. Deliberately NOT security definer: the
-- update policy from 024 (manages_trip) is what decides, and an invoker-rights function
-- leaves it in charge.
--
-- Returns the row count so a refusal is loud. RLS filters rows rather than raising, so
-- without this a passenger dragging a stop would get a cheerful no-op - the same trap this
-- project has walked into three times with a refused write returning zero rows.
create function reorder_plan_points(ids uuid[]) returns int
  language plpgsql
  set search_path = public
as $$
declare
  moved int;
begin
  update trip_plan_points p
     set sort_order = x.n
    from unnest(ids) with ordinality as x(id, n)
   where p.id = x.id;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke execute on function reorder_plan_points(uuid[]) from public, anon, authenticated;
grant execute on function reorder_plan_points(uuid[]) to authenticated;


-- 024's function with the new ordering. Nothing else about it changes.
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
                 order by pp.day, pp.sort_order, pp.created_at
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
