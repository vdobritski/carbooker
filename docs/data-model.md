# Carbooker — Data Model

Postgres on Supabase. Eleven tables. All ids are `uuid default gen_random_uuid()` unless
noted; all timestamps are `timestamptz default now()`.

This document is the contract the migrations implement and `src/lib/types.ts` mirrors.

## Entities and relationships

```
auth.users 1─1 profiles
                 │ 1─n guests            (a user's +1s)
                 │ 1─n saved_cars        (owner_id — a person's garage)
                 │ 1─n cars              (driver_id)
                 │ n─m groups            (via group_members)
                 │ n─m trips             (via trip_participants)
                 │
groups n─1 profiles                (owner_id — exactly one owner, nullable if the
       │                            owner's account is deleted)
       1─n trips
       1─n group_members           (can_create_trips, can_manage_trips,
       │                            can_manage_members, travel_role)
       0─1 group_invites           (one live invite token per group)
       1─n group_join_requests

trips 1─n cars
      1─n trip_participants
      1─n bookings

cars  1─n bookings          (car_id — confirmed seat)
      1─n bookings          (preferred_car_id — requested seat)

bookings ──► exactly one occupant: profiles.id  OR  guests.id
```

**A trip belongs to exactly one group**, and everything under the trip — cars, seats,
participants — is visible only to that group's members, as are the names of the people in
it. This is the single tenancy line in the schema; there is no sharing a trip between
groups and no moving one.

A **seat is one `bookings` row.** A user booking themselves plus two `+1`s creates three
rows sharing the same `booked_by`.

## Tables

### `profiles`
Mirror of `auth.users`, created by a trigger on signup.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `references auth.users(id) on delete cascade` |
| `display_name` | text not null | name / alias |
| `photo_url` | text | optional |
| `description` | text | optional, free text |
| `role` | text not null default `'user'` | `check in ('admin','user')` |
| `created_at` | timestamptz | |

`profiles.role` is **site-wide**, and after task 17 it has two values. `admin` may do
anything anywhere — the escape hatch that keeps the rest simple. `user` is everyone else.

Everything else about a person is per group and lives on `group_members`: whether they
manage the group, and whether they drive. The old global `driver` value was migrated to
`user` in **017**, with those accounts given `travel_role = 'driver'` by the group backfill
back in 012, so nobody lost the ability to register a car.
Authority over a *specific* car still comes from `cars.driver_id = auth.uid()`.

### `guests` — the `+1`s
A guest is a record owned by a host user, **not** a login.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `host_id` | uuid not null | `references profiles(id) on delete cascade` |
| `name` | text not null | |
| `note` | text | optional |
| `created_at` | timestamptz | |

### `groups`
A group of people, like a group chat. Anyone may create one; the creator owns it.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | `check (length(trim(name)) > 0)` |
| `description` | text | |
| `owner_id` | uuid | `references profiles(id) on delete set null` — **exactly one owner, and this is it** |
| `created_at` | timestamptz | |

**Ownership is a column on the group, not a role on a membership row.** One row, one
column: "exactly one owner" is then true by the shape of the schema rather than by a
partial unique index and a last-owner guard that a transfer has to dodge. Handing the group
over is `update groups set owner_id = …` — one statement, atomic, and it demotes the
previous owner by construction. The previous owner keeps their membership and whatever
switches they had, which is normally none.

There is no `created_by`: `owner_id` starts as the creator and stays meaningful afterwards.

Two triggers:

- `groups_owner_membership`, `after insert` — gives the creator their `group_members` row.
  `security definer`, because at that instant the group has no members and the
  `group_members` insert policy would refuse.
- `groups_owner_guard`, `before update of owner_id` — the new owner must already be a
  member. Update only: on insert the membership row does not exist yet.

**If the owner's account is deleted** the group becomes *ownerless* (`owner_id` null)
rather than disappearing. Its trips and seats survive, members with switches carry on, and
nobody can grant permissions, transfer, or delete the group until a site admin sets a new
owner — which `is_group_owner()`'s `is_admin()` branch already allows. A cascade would have
taken the trips; a `restrict` would have made deleting the account fail from inside a
cascade with an incomprehensible error.

### `group_members`
Who is in a group, and what they may do in it. No role enum — capabilities are individually
switchable, so a role column would be a second way of saying the same thing and the two
would drift.

| column | type | notes |
|---|---|---|
| `group_id` | uuid | `references groups(id) on delete cascade` |
| `profile_id` | uuid | `references profiles(id) on delete cascade` |
| `can_create_trips` | boolean not null default `false` | |
| `can_manage_trips` | boolean not null default `false` | |
| `can_manage_members` | boolean not null default `false` | |
| `travel_role` | text not null default `'passenger'` | `check in ('driver','passenger')` |
| `joined_at` | timestamptz | |

Primary key `(group_id, profile_id)`. Index on `profile_id` for "my groups".

- **owner** (from `groups.owner_id`) — anything in the group. Only the owner grants and
  revokes the three switches, and only the owner transfers or deletes the group.
- **`can_create_trips`** — start a new trip in this group, and nothing else. Gates exactly
  one operation: `insert` on `trips`.
- **`can_manage_trips`** — edit and delete **anybody's** trip in this group, and manage
  what is on it: its cars, its participants, moving and cancelling its seats.
- **`can_manage_members`** — generate and revoke the invite link, accept and decline access
  requests, remove members, set anyone's travel role. **Not** granting permissions.
- **`travel_role`** — `driver` may register a car on this group's trips, `passenger` may
  not. Orthogonal to all three switches: a member who runs trips but has no car is normal.
- a member with no switch sees the group's trips, joins them, and books seats for
  themselves and their `+1`s.

**The three switches are fully independent.** `can_manage_trips` does not imply
`can_create_trips`; the roster ticks both boxes when that is what was meant. An implication
in SQL is the thing that surprises somebody two years later.

**Your own trip is yours regardless of any switch.** Authority over one trip is
`trips.created_by = auth.uid()` **or** `can_manage_trips` in its group — the helper
`manages_trip(uuid)`, which every policy under a trip uses. So a member granted only
`can_create_trips` runs the trips they start, including their cars and seats, and cannot
touch anybody else's. Without that branch the create switch would be a trap: you make a
trip and cannot fix a typo in it.

`can_manage_members` is not split into "invite" and "remove" — nobody has described wanting
one without the other. That split is a one-line migration on the day somebody does.

Four rules need a trigger, because RLS is row-level and cannot say which *columns* a member
manager may change — `guard_group_membership`:

1. Only the owner may set or change any switch, on insert or update.
2. Only the owner may edit or remove a member who has **any** switch set — one rule for all
   three, including the mild one. Anyone may remove themselves.
3. The owner may not delete their own membership: transfer or delete the group first. The
   rule steps aside during a cascade, when the group row is already gone.
4. You cannot leave, and cannot be removed, while you still hold an active seat or own a
   car on one of the group's trips. Same reasoning as `trip_participants_leave_guard`:
   the alternative is a trigger silently deleting other people's bookings.

### `group_invites`
The invite link. One row per group, or none.

| column | type | notes |
|---|---|---|
| `group_id` | uuid PK | `references groups(id) on delete cascade` |
| `token` | text not null unique | `default replace(gen_random_uuid()::text,'-','')` — 32 hex characters |
| `created_by` | uuid | `references profiles(id) on delete set null` |
| `created_at` | timestamptz | |

A separate table rather than a column on `groups` for one reason: RLS cannot hide a single
column from ordinary members, so the token would be readable — and re-shareable — by
everybody in the group. Its own row gets its own policy. Regenerating is an upsert,
revoking is a delete. No expiry, no use count: a hard-to-guess token is enough for this.

Anyone signed in who opens `/#/join/<token>` becomes a member, via the
`join_group_by_invite(text)` `security definer` function — a joiner has no rights on the
group yet, so no policy can express this.

### `group_join_requests`
Somebody who followed a plain group link and is asking to be let in.

| column | type | notes |
|---|---|---|
| `group_id` | uuid | `references groups(id) on delete cascade` |
| `profile_id` | uuid | `references profiles(id) on delete cascade` |
| `status` | text not null default `'pending'` | `check in ('pending','rejected')` |
| `note` | text | optional |
| `created_at` | timestamptz | |

Primary key `(group_id, profile_id)`. Accepting deletes the row and inserts a membership;
rejecting sets `status = 'rejected'` so the requester learns the answer instead of watching
their request vanish.

Somebody who follows a group link sees the group's **name** before deciding to ask, through
`group_preview(uuid)` — a `security definer` function returning one column for one id. It
is not a policy branch, and must not become one: RLS is row-level, so any `groups` select
branch that lets a non-member read a row by id equally lets them list *every* group. The
function cannot be enumerated and does not return the description, so a group description
stays as private as its trips.

The reverse direction is a policy branch: a member manager can read the *profile* of
somebody who has asked to join their group, because otherwise accepting and declining is
blind. Asking to join is volunteering your name to that group's managers, and to nobody
else.

### `trips`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `group_id` | uuid not null | `references groups(id) on delete cascade` — immutable, trigger `trips_group_guard` |
| `name` | text not null | |
| `description` | text | |
| `plan` | text | free-form itinerary |
| `starts_on` | date | optional |
| `ends_on` | date | optional |
| `created_by` | uuid | `references profiles(id) on delete set null` |
| `created_at` | timestamptz | |

Two check constraints keep obviously-broken rows out: `name` must not be blank after
trimming, and `ends_on` must not precede `starts_on` when both are set.

### `trip_participants`
Who is going. Separate from bookings, because a driver assigns seats *from the participant
list* — a person can be a participant before they hold a seat.

| column | type | notes |
|---|---|---|
| `trip_id` | uuid | `references trips(id) on delete cascade` |
| `profile_id` | uuid | `references profiles(id) on delete cascade` |
| `joined_at` | timestamptz | |

Primary key `(trip_id, profile_id)`.

### `cars`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `trip_id` | uuid not null | `references trips(id) on delete cascade` |
| `driver_id` | uuid | `references profiles(id) on delete cascade` — null when the driver has no account (**023**) |
| `driver_name` | text | the driver's name when there is no account (**023**) |
| `title` | text not null | e.g. "Ivan's blue Passat" |
| `description` | text | |
| `features` | text[] not null default `'{}'` | `{fridge, grill, opening roof}` |
| `seat_count` | int not null | `check (seat_count > 0)` — passenger seats, excluding the driver |
| `created_at` | timestamptz | |

`features` is a plain `text[]`. No feature table, no join table — it is a list of words
shown as chips.

`check (cars_driver_one_of)`: exactly one of `driver_id` / `driver_name` is set. **023**
split the driver from whoever registered the car, so one person can run a trip whose cars
are not all theirs. Two consequences worth stating:

- naming another member hands them the driver's powers over that car (`owns_car`), because
  `owns_car` is `driver_id = auth.uid()` and nothing else;
- a `driver_name` car is owned by nobody — `owns_car` is false for everyone — so it is
  managed entirely through `manages_trip`. That is why only somebody who runs the trip may
  create one: a plain driver who registered a car under a name would lose control of it.

A car belongs to exactly one trip, and `trip_id` stays `not null`. Reusing one `cars` row
across trips would make `seat_count` — the number invariant 3 is stated against — shared
between two sets of bookings, so lowering it on one trip could over-fill another. Cars are
copied onto a trip from the garage below, never linked.

### `saved_cars` — a person's garage

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid not null | `references profiles(id) on delete cascade` |
| `title` | text not null | `check (length(trim(title)) > 0)` |
| `description` | text | |
| `features` | text[] not null default `'{}'` | |
| `seat_count` | int not null | `check (seat_count > 0)` |
| `created_at` | timestamptz | |

A template, not a trip car. Registering a saved car on a trip **copies** its fields into a
new `cars` row; afterwards the two are unrelated — editing either does not change the
other. There is deliberately no `cars.saved_car_id`: a back-reference would only earn its
keep if something wanted to sync them, and nothing does.

Only the owner (and a site admin) can read a garage. What other people see is the car once
it is registered on a trip.

### `bookings` — one row per seat

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `trip_id` | uuid not null | `references trips(id) on delete cascade` |
| `profile_id` | uuid | occupant is a registered user; `on delete cascade` |
| `guest_id` | uuid | occupant is a `+1`; `on delete cascade` |
| `booked_by` | uuid not null | who created the seat (host for a `+1`); `on delete cascade` |
| `car_id` | uuid | the confirmed car; **null unless confirmed** |
| `preferred_car_id` | uuid | what the passenger asked for; `on delete set null` |
| `status` | text not null default `'pending'` | `check in ('pending','confirmed','denied')` |
| `comment` | text | health, special requirements, what they can bring |
| `created_at` / `updated_at` | timestamptz | |

**Status meaning**

- `pending` — "under review". The person holds a place on the trip but is not in a car
  yet, either because they stated no preference or because the requested driver has not
  answered.
- `confirmed` — seated in `car_id`. Only that car's driver or an admin sets this.
- `denied` — the driver rejected the request. The seat is inactive and counts against
  nothing. The passenger may request again.

## Invariants

These four rules must hold at all times. Each is enforced **in the database**, not only in
the UI. **Groups changed none of them**: no invariant mentions a group, `cars` still has a
`not null trip_id`, and a saved car is a copied template rather than a shared row. The only
thing group scoping added is who may *reach* a seat, which is policy, not invariant.

1. **One occupant per seat.**
   `check (num_nonnulls(profile_id, guest_id) = 1)`

2. **A seat is in a car iff it is confirmed.**
   `check ((car_id is not null) = (status = 'confirmed'))`
   This makes "confirmed but carless" and "sitting in a car while pending/denied" both
   unrepresentable.

3. **A car never holds more confirmed seats than it has.**
   Trigger `trg_bookings_capacity`, `before insert or update on bookings`: when
   `new.car_id is not null`, `select seat_count from cars where id = new.car_id for update`
   (the `for update` is what makes two drivers confirming the last seat at the same moment
   safe), count confirmed seats in that car excluding `new.id`, and `raise exception` if
   the seat would be the one too many.
   The same function guards `cars`: `before update on cars`, reject lowering `seat_count`
   below the number of seats already confirmed in it.

4. **One active seat per person per trip.**
   ```sql
   create unique index bookings_one_active_user on bookings (trip_id, profile_id)
     where profile_id is not null and status <> 'denied';
   create unique index bookings_one_active_guest on bookings (trip_id, guest_id)
     where guest_id is not null and status <> 'denied';
   ```
   Denied rows are excluded so a rejected passenger can request again.

**Leaving a group also removes you from its trips' participant lists** — the last step of
`guard_group_membership`'s delete branch. It runs only after the seat and car rules have
confirmed there is nothing to destroy. Without it somebody who has left is still listed as
going and is still offered a seat by a driver, on a trip they can no longer see.

**A car being deleted releases its seats without a person's permission.** The release runs
under a transaction-local `carbooker.releasing_car` flag that `guard_seat_assignment`
honours. `security definer` is not enough on its own: it changes `current_user` but not
`auth.uid()`, so without the flag the guard sees whoever is signed in and refuses to let
them take a passenger out of a car they do not own — which made deleting a group fail for
its own owner.

**A seat's car is on the seat's own trip** — enforced in `check_car_capacity` since 018,
with no exemption for anybody. `checks.sql` has asserted this since task 12 with nothing
behind it; before 018 a trip manager could confirm a passenger into a car on a different
trip in the same group, which turned that check red and put a stranger in another trip's
car.

**A car never moves trip, and never changes driver** — trigger `cars_identity_guard`. The
trip half has no exemption at all, for the same reason a trip cannot change group: the
car's confirmed seats carry the old `trip_id` and would be stranded. Handing a car to
another person is not a feature; it silently takes confirm, deny and delete away from
whoever actually drives it.

**A seat's identity is immutable.** `trip_id`, `profile_id`, `guest_id` and `booked_by`
cannot be changed after the row exists — trigger `bookings_identity_guard`. Only the
comment, the preferred car and the seating move. Without this the booker could put someone
else in a seat they never booked, or drag a confirmed seat onto a trip its car is not on.

**Only the driver of the affected car may seat or unseat anyone**, on insert as well as
update — trigger `bookings_assignment_guard`. Ownership is required of the car the seat
*ends up in*, not merely of some car mentioned on the row. Exempt: site admins, and whoever
runs the trip — `manages_trip(trip_id)` — which is what "they can move bookings" means.
They are *not* exempt from `bookings_identity_guard`, so such a member still cannot move a
seat to another trip or another occupant.

**You cannot leave a trip while holding an active seat** — trigger
`trip_participants_leave_guard`. This is what makes check 7 below true rather than usually
true. It steps aside during a cascade, when the trip or the profile is being deleted
outright.

**Deleting a car releases its seats, it does not delete them.** Trigger
`trg_cars_release_seats`, `before delete on cars`:
`update bookings set car_id = null, status = 'pending' where car_id = old.id;`
Requests pointing at it fall back to `null` via `preferred_car_id on delete set null`.

Supporting indexes: `bookings(trip_id)`, `bookings(car_id)`, `bookings(preferred_car_id)`,
`cars(trip_id)`, `trips(group_id)`, `group_members(profile_id)`, `saved_cars(owner_id)`.

## Row Level Security

RLS is enabled on every table. The anon key is public — without policies the database is
world-writable. The policy set is one shape repeated: **you reach a row if you share a
group with it, and you may change it if you own it, drive it, or hold the matching
switch.**

Every helper is `security definer stable set search_path = public`. That is not tidiness:
`is_group_member` is called by the policy *on the table it reads*, and without definer the
lookup re-enters the policy and recurses.

```sql
is_admin()                 -- profiles.role = 'admin'; site-wide
owns_car(car)              -- cars.driver_id = auth.uid(); one specific car. False for
                           -- everybody on a car driven by a name (023)
group_has_member(g, p)     -- is *that person* in g; the only helper that asks about
                           -- somebody other than the caller (023)
drives_on_trip(trip)       -- I drive some car on this trip
trip_group(trip)           -- the group a trip belongs to; lets cars/bookings/participants
                           -- policies stay one-liners
manages_trip(trip)         -- I created this trip, or I may manage anyone's in its group
is_group_member(g)         -- member of g,                        or site admin
is_group_owner(g)          -- groups.owner_id = auth.uid(),       or site admin
can_create_trips_in(g)     -- member of g with can_create_trips,  or the owner
can_manage_trips_in(g)     -- member of g with can_manage_trips,  or the owner
can_manage_members_in(g)   -- member of g with can_manage_members, or the owner
can_drive_in_group(g)      -- travel_role = 'driver' in g,        or site admin
shares_group_with(person)  -- we are both in some group; scopes names
```

`manages_trip()` is the single expression of authority over one trip. Every policy on a
table under a trip uses it, so the "I made this one" branch cannot be remembered in one
policy and forgotten in another.

`is_group_member`, `is_group_owner` and `can_drive_in_group` fold `is_admin()` in on
purpose — it keeps `or is_admin()` out of a dozen policies. A site admin therefore counts
as a member, the owner and a driver of every group. `can_drive_in_group` is deliberately
*not* owner-inclusive: driving is a fact about whether you have a car, not a privilege, so
an owner who drives ticks their own travel role like anybody else.

| table | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | self, `shares_group_with(id)`, admin, or a manager of a group you asked to join | trigger only | self, or admin. **Only an admin may change `role`.** | admin |
| `guests` | `host_id = auth.uid()`, `shares_group_with(host_id)`, or admin | `host_id = auth.uid()` | host, or admin | host, or admin |
| `saved_cars` | `owner_id = auth.uid()`, or admin | `owner_id = auth.uid()` | owner, or admin | owner, or admin |
| `groups` | `is_group_member(id)` — plus `group_preview(uuid)` for the name alone | `owner_id = auth.uid()` | `is_group_owner(id)` | `is_group_owner(id)` |
| `group_members` | `is_group_member(group_id)` | `can_manage_members_in` | `can_manage_members_in` (columns by trigger) | self, or `can_manage_members_in` |
| `group_invites` | `can_manage_members_in(group_id)` | same | same | same |
| `group_join_requests` | self, or `can_manage_members_in` | `profile_id = auth.uid()` and `status='pending'` | `can_manage_members_in` | self, or `can_manage_members_in` |
| `trips` | `is_group_member(group_id)` | `created_by = auth.uid()` and `can_create_trips_in(group_id)` | `created_by = auth.uid()`, or `can_manage_trips_in(group_id)` | same as update |
| `trip_participants` | `is_group_member(trip_group(trip_id))` | self and member, or `manages_trip(trip_id)` | — | self, or `manages_trip(trip_id)` |
| `cars` | `is_group_member(trip_group(trip_id))` | `driver_id = auth.uid()` and `can_drive_in_group(...)` — **or** `manages_trip(trip_id)`, which is what allows naming somebody else (**023**) | driver, or `manages_trip` | driver, or `manages_trip` |
| `bookings` | `is_group_member(trip_group(trip_id))` | member, and `booked_by = auth.uid()` with occupant self or own guest — or `owns_car(car_id)`, or `manages_trip` | see below | `booked_by = auth.uid()`, or `manages_trip` |

`groups` update is owner-only for a reason beyond taste: `owner_id` lives on that row, so
anyone who could update it could hand the group to themselves. Everything a member manager
needs is on other tables — the invite in `group_invites`, the roster in `group_members`.

`bookings` update splits by who is doing what, inside the group:

- the booker may change `comment` and `preferred_car_id` on their own rows;
- `owns_car(car_id)` **or** `owns_car(preferred_car_id)` may set `status` and `car_id` —
  this is the driver confirming, denying, or manually assigning a seat in *their* car;
- a driver on the trip may take an unassigned `pending` seat (`status = 'pending' and
  car_id is null and drives_on_trip(trip_id)`) — without this branch a seat with no stated
  preference is unreachable by every driver;
- whoever runs the trip may do any of it — its creator, anyone with `can_manage_trips` in
  the group, the owner, and site admins.

`group_members` has no "insert yourself" branch. That is deliberate: it is what stops
anybody who guesses a group id walking in. The only two ways in are a member manager adding
you and the `join_group_by_invite(text)` definer function.

`anon` has no policy on any table and therefore no access.

### What a non-member sees

Nothing. Not the group's trips, cars, seats or roster, and **not the names** of the people
in it. A brand-new account with no groups can read exactly two things: its own `profiles`
row and its own `guests`. Every other select returns zero rows.

Three reads cross a group boundary, all narrow and all deliberate:

- a site admin reads everything, which is what `/admin` runs on;
- a member manager reads the `profiles` row of somebody who has asked to join *their*
  group, so the request queue can show a name;
- anybody holding a group's id — that is, its link — can get its **name** from
  `group_preview(uuid)`, and nothing else about it. One id in, one string out: it cannot be
  used to enumerate groups, which is precisely why it is a function and not a policy.

## Notes and assumptions

- **`+1`s are not accounts.** The requirements list "+1 (guest)" among the roles, but a
  guest only needs to see the trip and their placement. Modelling them as records owned by
  their host avoids a second auth path. If guests later need their own view, the cheapest
  addition is a read-only share link per trip — no schema change to `guests`.
- **A `+1` is not a group member.** A guest rides on their host's membership: the host must
  be in the group to book them a seat, and the host leaving the group is blocked while any
  seat they booked is still active.
- **Names are scoped too.** `profiles` and `guests` are readable only to people you share a
  group with. It turned out to cost one helper and two policies, and no application change:
  every existing embed (`bookings → profiles`, `bookings → guests`, `cars → profiles`,
  `trip_participants → profiles`) reads somebody who is in the same group as the viewer, so
  all of them keep working. If one ever does not, the symptom is a name rendering as
  `'Unknown'` — PostgREST returns null for an embedded row the caller cannot read, and the
  mapping already falls back. The fix for that is the policy, never a lookup that routes
  around it.
- **There is no user directory.** With names scoped, `/admin` is the only screen that can
  list everybody, and only a site admin can open it. People get into a group by being sent
  a link, not by being searched for. Do not add a "find a user" box.
- **`seat_count` excludes the driver.** The driver is not a `bookings` row; a 5-seat car
  with the driver in it has `seat_count = 4`.
- **No soft deletes, no audit log.** A deleted trip takes its cars and seats with it; a
  deleted group takes its trips. Nothing records who let whom into a group.
- **Permissions are a fixed set of booleans, not a system.** Three columns, granted by one
  person, with no table of permissions, no bitmask, no roles composed of them and no
  implications between them. The cost of adding a fourth switch is one column and one
  checkbox; the cost of a permission framework is paid every time anybody reads the schema.
