-- 010_driver_assignment.sql
-- Lets a driver seat people in their own car directly, rather than only answering
-- requests aimed at it. Two policies have to widen, not just the insert one the task file
-- anticipated:
--
--   insert - a driver creates a seat for somebody else, already in their car.
--   update - a pending seat with no stated preference has car_id and preferred_car_id
--            both null, so no driver could reach it at all: the update matched zero rows
--            and looked like a no-op. Manual assignment is exactly that case. The same
--            branch is what lets a driver take a manually-assigned passenger back out
--            again, since the released row has no preferred car to grant access either.

-- Do you drive any car on this trip? Distinct from owns_car(), which asks about one car.
create function drives_on_trip(trip uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from cars where cars.trip_id = trip and cars.driver_id = auth.uid()
  );
$$;


drop policy bookings_insert on bookings;

create policy bookings_insert on bookings
  for insert to authenticated
  with check (
    booked_by = auth.uid()
    and (
      profile_id = auth.uid()
      or exists (
        select 1 from guests g where g.id = guest_id and g.host_id = auth.uid()
      )
      -- A driver seating someone straight into their own car. guard_seat_assignment()
      -- already refuses an insert carrying a car_id the caller does not own, so this
      -- cannot become a way to put people in other people's cars.
      or owns_car(car_id)
    )
  );


drop policy bookings_update on bookings;

create policy bookings_update on bookings
  for update to authenticated
  using (
    booked_by = auth.uid()
    or owns_car(car_id)
    or owns_car(preferred_car_id)
    or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
    or is_admin()
  )
  with check (
    booked_by = auth.uid()
    or owns_car(car_id)
    or owns_car(preferred_car_id)
    or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
    or is_admin()
  );
