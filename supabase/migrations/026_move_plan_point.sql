-- 026_move_plan_point.sql
--
-- Dragging a stop into another day. 025 could only reorder within one day, because
-- reorder_plan_points() writes sort_order and nothing else - moving days also has to write
-- `day`, and doing it as two calls from the browser leaves a visible wrong state if the
-- second one fails: the stop lands in the new day at whatever position it used to hold.
--
-- One function, so one transaction, so a drag either happens or does not.
--
-- Same shape as 025: security invoker, so the manages_trip policy still decides, and a row
-- count comes back so a refusal is loud rather than a silent snap-back.

create function move_plan_point(point uuid, to_day int, ordered uuid[]) returns int
  language plpgsql
  set search_path = public
as $$
declare
  moved int;
begin
  update trip_plan_points set day = to_day where id = point;

  -- Nothing updated means the policy refused this row. Stop here rather than reordering
  -- the destination day around a stop that never arrived.
  if not found then
    return 0;
  end if;

  update trip_plan_points p
     set sort_order = x.n
    from unnest(ordered) with ordinality as x(id, n)
   where p.id = x.id;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke execute on function move_plan_point(uuid, int, uuid[]) from public, anon, authenticated;
grant execute on function move_plan_point(uuid, int, uuid[]) to authenticated;
