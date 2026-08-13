# Tasks

Ordered. Each task builds on the ones before it. Run one at a time via `/implement`.

| # | Task | Depends on |
|---|---|---|
| 00 | [Project scaffold](00-project-scaffold.md) | — |
| 01 | [Supabase setup, profiles table, RLS helpers](01-supabase-profiles.md) | 00 |
| 02 | [Auth (email OTP) and profile page](02-auth-and-profile.md) | 01 |
| 03 | [Trips: create, list, detail shell](03-trips.md) | 02 |
| 04 | [Trip participants](04-trip-participants.md) | 03 |
| 05 | [Cars: driver registers a car on a trip](05-cars.md) | 04 |
| 06 | [Guests (+1s)](06-guests.md) | 02 |
| 07 | [Bookings core: seats, invariants, capacity](07-bookings-core.md) | 05, 06 |
| 08 | [Car preference and driver confirm/deny](08-car-preference-and-confirmation.md) | 07 |
| 09 | [Driver manual seat assignment](09-driver-seat-assignment.md) | 08 |
| 10 | [Trip layout view](10-trip-layout-view.md) | 09 |
| 11 | [Admin: roles and overrides](11-admin.md) | 10 |
| 12 | [Booking consistency checks](12-booking-consistency-checks.md) | 07 |
| 13 | [Deploy to GitHub Pages](13-github-pages-deploy.md) | 10 |

Task 12 is a set of SQL queries, not a feature. Write it once after task 07 and re-run it
after every change that touches bookings.
