-- 011_admin_booking_insert.sql
--
-- Every policy carries an is_admin() branch except this one, which was missed in 007 and
-- again in 010. The trip page offers the "add to my car" panel to anyone who can manage
-- the car - the driver or an admin - so an admin adding a passenger to a car they do not
-- drive was refused by the database while the button sat there inviting them.
--
-- Updating such a seat already worked for admins; only creating one did not.
--
-- guard_seat_assignment() lets admins through, and the capacity trigger and the check
-- constraints do not: an admin still cannot overfill a car or build a malformed seat.

drop policy bookings_insert on bookings;

create policy bookings_insert on bookings
  for insert to authenticated
  with check (
    is_admin()
    or (
      booked_by = auth.uid()
      and (
        profile_id = auth.uid()
        or exists (
          select 1 from guests g where g.id = guest_id and g.host_id = auth.uid()
        )
        or owns_car(car_id)
      )
    )
  );
