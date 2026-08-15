# Carbooker — Architecture

Scope: [requirements.md](requirements.md). Schema: [data-model.md](data-model.md).
Work items: [tasks/](tasks/).

## What this is

A static React app talking directly to a Supabase project. A few friends open a URL, sign
in with their email, look at a trip, and book seats in each other's cars. Peak load is a
dozen people, occasionally.

Trips live inside **groups** — a group is a set of people, like a group chat. You see a
trip if you are in its group, and nothing of it if you are not. Anyone can start a group;
whoever starts it owns it.

## Shape of the system

```
Browser (GitHub Pages, static files)
  React + TypeScript SPA
    src/api/*.ts  ──  supabase-js  ──►  Supabase
                                          ├─ Auth (email OTP)
                                          └─ Postgres + RLS
                                               ├─ tables
                                               ├─ triggers + constraints
                                               │  (booking invariants, group guards)
                                               └─ policies
                                                  (who is in which group)
```

There is **no backend of our own**. No API server, no edge functions, no serverless
handlers. The browser is the client and Postgres is the enforcement point for anything
that must not be violated.

## Key decisions

**Vite + React + TypeScript.** Standard, fast, produces a static bundle GitHub Pages can
serve as-is.

**`HashRouter`, not `BrowserRouter`.** GitHub Pages has no server-side rewrite, so a
refresh on `/trips/42` returns 404. Hash routing sidesteps it with no config. Vite `base`
is set to the repo name.

**Email OTP (6-digit code), not magic links.** A magic link redirect puts the session
tokens in the URL fragment, which collides with hash routing and with the Pages base path.
OTP keeps the whole flow on one page and needs no redirect allow-listing. Same Supabase
Auth, fewer moving parts.

The catch, confirmed the hard way on the first live deploy: Supabase still sends its
*Magic Link* template for `signInWithOtp`, and that template ships a link rather than the
code. Left alone it sends people to the Site URL — the domain root, a 404 under a repo
subpath. The template has to be edited to emit `{{ .Token }}`. See the setup steps in
[../README.md](../README.md).

**No state library, no data-fetching library.** Pages call `src/api/*` functions in
`useEffect` and own their `loading` / `error` / `data` state. Session comes from one
`AuthProvider` context. That's the whole state story. If a page ever needs more, that page
gets more — not the app.

**Data access lives in `src/api/`**, one module per area (`trips.ts`, `cars.ts`,
`bookings.ts`, `guests.ts`, `profiles.ts`). These are plain async functions that call
`supabase` and map snake_case rows to camelCase objects. No repository interfaces, no
generic CRUD factory — a function per query the UI actually makes.

**Database types are hand-written** in `src/lib/types.ts`, mirroring the migrations. The
schema is ~6 tables; codegen and its toolchain cost more than they save here. The rule is
that a migration and this file change together.

**Invariants live in Postgres.** Seat capacity and booking status consistency are enforced
by a `check` constraint, a partial unique index, and one trigger. The UI also prevents
these situations, but the UI is not the guarantee — two drivers confirming the last seat
at the same moment is a real scenario for this app, and only the database can lose that
race safely.

**RLS is on, and it is where group access lives.** The anon key ships in the bundle, so
every table needs policies or the database is world-writable. The policy set is one shape
repeated: you may `select` a row if you share a group with it — including rows about
*people* — and `insert`/`update`/`delete` require owning the row, driving the car, running
the trip, or holding the matching switch. `anon` gets nothing. Twelve `security definer`
helpers keep the policies one-liners and avoid recursive lookups — see
[data-model.md](data-model.md#row-level-security) for the list and the full table.

Two of the boundary's rules cannot be expressed as policies at all, because RLS is
row-level and says nothing about *columns*: only the owner may flip a permission switch,
and only the owner may edit a member who has one. Those live in a trigger, the same way
`guard_booking_identity` does. Policy decides which rows you reach; triggers decide which
columns you moved.

Because the boundary is in the policies rather than in the client, a trip in a group you
are not in simply is not there: `getTrip` returns `null` and the existing "Trip not found"
branch renders. There is no "access denied" screen and no client-side filtering to keep in
sync — adding a `.eq('group_id', ...)` in the API would be a second source of truth for the
same rule.

**Two RPCs, and only two.** Both exist because the caller has no rights on the group yet
and a row-level policy cannot express what is needed.

- `join_group_by_invite(token)` — no policy can say "insert your own membership if you know
  the token" without also letting anyone who guesses a group id walk in.
- `group_preview(id)` — returns a group's **name** to somebody holding its link. As a
  policy this is impossible to contain: RLS grants access to *rows*, not to "rows you name
  explicitly", so any branch letting a non-member read one group by id equally lets them
  list every group. A function takes one id and returns one string, and cannot be
  enumerated or widened to the description.

Everything else is a plain table call. A third RPC needs the same argument written down, or
it is a policy written badly.

**Deploy is manual.** `npm run deploy` builds and pushes `dist/` to the `gh-pages` branch
via the `gh-pages` package. No Actions workflow, no pipeline.

## Roles and permissions

There are two levels, and keeping them apart is the whole point.

**Site-wide** — `profiles.role` is `admin` | `user` (default `user`).

- **admin** — may do anything anywhere. The escape hatch that keeps everything else simple.
  Counts as a member, the owner and a driver of every group, and is the only account that
  can list everybody.
- **user** — everyone else. Being a "user" says nothing about what you may do; that depends
  on which groups you are in.

**Per group** — one owner, and switches on each membership.

- **owner** — `groups.owner_id`. Exactly one, because it is a single column on a single
  row rather than a role on N membership rows: no unique index to violate, no "last owner"
  rule, and a transfer is one atomic `update`. The owner may do anything in the group, and
  is the only one who grants or revokes the switches below.
- **`can_create_trips`** — start a trip in this group. That one operation, nothing more.
- **`can_manage_trips`** — edit and delete *anybody's* trip in the group, and manage its
  cars, participants and seats.
- **`can_manage_members`** — the invite link, the request queue, removing members, setting
  travel roles. Not granting permissions; only the owner does that, or a member manager
  would grant themselves the rest.
- **`travel_role`** — `driver` | `passenger`. Orthogonal to all three switches: whether you
  have a car is not a privilege.

The switches are **independent** — `can_manage_trips` does not imply `can_create_trips`,
because an implication in SQL is what surprises somebody two years later, and a UI can tick
two boxes. And **your own trip is yours regardless**: authority over one trip is "I created
it, or I may manage anyone's here", the helper `manages_trip(uuid)` that every policy under
a trip uses. Otherwise the create switch would be a trap — make a trip, then be unable to
fix a typo in it.

**There is no role enum.** With individually switchable capabilities, a role column would be
a second way to say the same thing, and the two would drift the first time somebody was
given "moderator plus one extra". Owner plus three booleans is the whole model.

The global `driver` role was retired in migration 017: driving is a property of a
membership, not of a person. Authority over a *specific* car still comes from owning it
(`cars.driver_id = auth.uid()`), not from any switch — a driver can only confirm and assign
seats in their own car.

- **+1 / guest** — **not a login**, and not a group member either. A guest is a record
  owned by its host user, and rides on the host's membership: the host must be in the group
  to book them a seat. Giving guests their own accounts would double the auth surface for
  no benefit at this size. *(This is an interpretation of the requirements — flagged, not
  hidden.)*

**Nobody outside a group sees anything of it** — not its trips, not its roster, not the
names of the people in it. `profiles` and `guests` are scoped to people you share a group
with. A new account with no groups can read its own profile and its own `+1`s, and nothing
else in the database. The one thing that leaves a group is its **name**, to somebody who
already holds its link, so they know what they are asking to join.

## Route map

| Route | Who | What |
|---|---|---|
| `/` | anyone | sign in (email + OTP) |
| `/groups` | signed in | my groups, create a group |
| `/groups/:id` | member | group: trips, roster, invite link, requests. Non-members get "request access" |
| `/join/:token` | signed in | follow an invite link and become a member |
| `/trips` | signed in | trips across my groups; create a trip in a group I manage |
| `/trips/:id` | group member | trip detail: plan, cars, seat layout, book |
| `/trips/:id/cars/new` | group driver | register a car on this trip, optionally from my garage |
| `/trips/:id/cars/:carId` | group member | car detail; driver sees confirm/deny + assignment |
| `/me` | signed in | profile (alias, photo, description), my `+1`s, my saved cars |
| `/admin` | site admin | site roles, and delete/edit anything |

A trip is still addressed by its own id, not nested under `/groups/:id/trips/:id` — trip
ids are unique and the nesting would buy nothing but longer links.

## Folder layout

```
supabase/migrations/     001_profiles.sql, 002_trips.sql, ...
src/
  lib/supabase.ts        client, created from VITE_SUPABASE_URL / _ANON_KEY
  lib/types.ts           row types mirroring the schema
  auth/AuthProvider.tsx  session context + useAuth()
  api/                   profiles.ts groups.ts groupAccess.ts trips.ts cars.ts
                         savedCars.ts guests.ts bookings.ts
  components/            small shared UI (SeatGrid, CarCard, MemberList, ...)
  pages/                 one file per route above
  App.tsx routes.tsx main.tsx
```

`AuthProvider` stays session + profile. Group memberships are **not** in it: only the pages
that show a group need them, and they can fetch. The moment it holds a fourth thing it
becomes the state library this project does not have.

## What is intentionally absent

No test framework or CI — verification is `npm run build` plus exercising the feature in
the running app, with SQL consistency checks for booking and group changes
([tasks/12](tasks/12-booking-consistency-checks.md),
[tasks/20](tasks/20-group-consistency-checks.md)). No Docker. No error-tracking
service. No i18n. No offline support. No pagination — a trip has tens of rows. No
optimistic updates: mutate, then refetch the trip.

Added to that list by the groups phase: no notifications or emails (an invite is a link you
paste into a chat), no invite expiry or use limits, no audit log of who let whom in, no
permission framework beyond three booleans, no role enum, no group avatars, no user
directory or people search, and no transferring a trip between groups — see the notes at
the end of [data-model.md](data-model.md#notes-and-assumptions).
