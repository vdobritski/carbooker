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

## Phase 2 — groups

00–13 are done and deployed. This phase makes a trip belong to a **group**, with per-member
switchable permissions, and gives people a garage of saved cars. Outside a group you see
nothing of it — not its trips, not its people, not their names.

| # | Task | Depends on |
|---|---|---|
| 14 | [Groups: schema, membership, per-member permissions](14-groups-schema.md) | 13 |
| 15 | [Groups in the app](15-groups-ui.md) | 14 |
| 16 | [A trip belongs to a group](16-trips-belong-to-a-group.md) | 15 |
| 17 | [Everything under a trip, and everyone's name, follows the group](17-group-scoped-reads.md) | 16 |
| 18 | [Invite links and access requests](18-invites-and-join-requests.md) | 17 |
| 19 | [Saved cars: a person's garage](19-saved-cars.md) | 17 |
| 20 | [Group consistency checks](20-group-consistency-checks.md) | 17 |

Migration numbers are **not** pinned per task: take the next free integer when you
implement, because review keeps adding fix migrations between planned ones. The last
migration before this phase was `011_admin_booking_insert.sql`. Applied so far:

| migration | task | what |
|---|---|---|
| 012 | 14 | groups, memberships, helpers, backfill |
| 013 | 14 | two guard holes review found (membership identity, null owner) |
| 014 | 14 | a switch-holder could not set their own travel role |
| 015 | 16 | `trips.group_id`, trips policies, leave guards |
| 016 | 16 | group delete blocked for its own owner; leaving left participation behind |
| 017 | 17 | group-scoped reads, names scoped, global `driver` role retired |
| 018 | 17 | a seat's car must be on its trip; cars identity guard |
| 019 | 18 | invites, join requests, `group_preview`, widened `profiles_select` |
| 020 | 18 | join-request identity guard |
| 021 | 19 | `saved_cars` |
| 022 | — | public trips: `trips.is_public`, `public_trip()`, visibility guard |
| 023 | — | a car's driver can be another member, or a name with no account |

Half of those are fixes review found after the planned migration landed. That ratio is the
argument for running `/review` on every task in this phase, not a sign something went wrong.

The order matters because the app is live. 14 and 15 add tables and pages without touching
anything that already works; **16 and 17 are the only two tasks where existing reads
change** — 16 flips trips, 17 flips everything under a trip plus every name, and retires
the global `driver` role. 18 and 19 are independent of each other and can be swapped. 20 is
a file of SQL queries, like 12 — run both after every change in this phase.

The permission model, in one line so it is not re-invented per task: **one owner per group
(`groups.owner_id`), three independent switchable booleans per member (`can_create_trips`,
`can_manage_trips`, `can_manage_members`), one travel role (`driver`/`passenger`), and no
role enum.** Authority over a single trip is "I created it, or I may manage anyone's in
this group" — the `manages_trip(uuid)` helper.
