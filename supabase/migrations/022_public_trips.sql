-- 022_public_trips.sql
--
-- A trip can be published: anybody holding its link, signed in or not, sees what the trip
-- is and how full the cars are. Nothing about the people.
--
-- Two things decided this shape.
--
-- 1. No `anon` policy on any table. RLS grants *rows*, not "the row you were linked to",
--    so `using (is_public)` for anon would let anyone read every published trip in the
--    database, and every column added to `trips` or `cars` later would become public by
--    default unless somebody remembered. Instead one security definer function takes an id
--    and returns a fixed payload: its return shape *is* the public surface, and adding a
--    column to a table cannot widen it. Same argument as group_preview() in 019.
--
-- 2. No names, and no comments. Participants, drivers and +1s never agreed to be published
--    when they joined a group, and the seat comment field is labelled "health, special
--    requirements". Counts are published; people are not.
--
-- `anon` still has no policy on any table. This function is the only thing it may call.

alter table trips add column is_public boolean not null default false;

create index trips_public_idx on trips (id) where is_public;


-- Publishing exposes a group to the open internet, so it is the owner's call - not
-- can_manage_trips, and not the trip's creator. RLS cannot say "every column but this one",
-- so the rule is a trigger, like every other column rule in this schema.
-- is_group_owner() already folds in site admins.
create function guard_trip_visibility() returns trigger
  language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Otherwise anybody with can_create_trips could publish simply by creating it that way.
    if new.is_public and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can publish a trip';
    end if;
    return new;
  end if;

  if new.is_public is distinct from old.is_public and not is_group_owner(new.group_id) then
    raise exception 'Only the group owner can publish or unpublish a trip';
  end if;

  return new;
end;
$$;

create trigger trips_visibility_guard
  before insert or update on trips
  for each row execute function guard_trip_visibility();


-- The whole public surface, in one place. Returns null for a trip that does not exist or
-- is not published - the caller cannot tell those apart, which is the point.
--
-- Deliberately absent: participant names, driver names, +1 names, seat comments, anybody's
-- id, and the group. `people_going` and `seats_taken` are counts, which say how full the
-- trip is without saying who is on it.
create function public_trip(trip_id uuid) returns jsonb
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

-- A function arrives with an execute grant to PUBLIC as well as an explicit one to anon,
-- and a revoke removes a grant rather than adding a denial - so revoke both, then grant
-- back deliberately. Established while writing 019.
revoke execute on function public_trip(uuid) from public, anon, authenticated;
grant execute on function public_trip(uuid) to anon, authenticated;
