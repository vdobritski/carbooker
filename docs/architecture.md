# Carbooker — Architecture

Scope: [requirements.md](requirements.md). Schema: [data-model.md](data-model.md).
Work items: [tasks/](tasks/).

## What this is

A static React app talking directly to a Supabase project. A few friends open a URL, sign
in with their email, look at a trip, and book seats in each other's cars. Peak load is a
dozen people, occasionally.

## Shape of the system

```
Browser (GitHub Pages, static files)
  React + TypeScript SPA
    src/api/*.ts  ──  supabase-js  ──►  Supabase
                                          ├─ Auth (email OTP)
                                          └─ Postgres + RLS
                                               ├─ tables
                                               └─ 2 triggers + constraints
                                                  (booking invariants)
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

**RLS is on, and deliberately thin.** The anon key ships in the bundle, so every table
needs policies or the database is world-writable. The policy set is one shape repeated:
signed-in users may `select`; `insert`/`update`/`delete` require owning the row, driving
the car, or being an admin. `anon` gets nothing. Two `security definer` helpers,
`is_admin()` and `owns_car(uuid)`, keep policies one-liners and avoid recursive lookups.

**Deploy is manual.** `npm run deploy` builds and pushes `dist/` to the `gh-pages` branch
via the `gh-pages` package. No Actions workflow, no pipeline.

## Roles

`profiles.role` is one of `admin` | `driver` | `user` (default `user`), exactly as the
requirements list them.

- **admin** — may do anything, including changing other people's roles.
- **driver** — may register a car on a trip. Authority over a *specific* car comes from
  owning it (`cars.driver_id = auth.uid()`), not from the role: a driver can only confirm
  and assign seats in their own car.
- **user** — the default. Joins trips, books seats for self and `+1`s, states a car
  preference, leaves comments.
- **+1 / guest** — **not a login.** A guest is a record owned by its host user, and the
  host manages its seat. Guests see their placement through their host or a shared trip
  view. Giving guests their own accounts would double the auth surface for no benefit at
  this size. *(This is an interpretation of the requirements — flagged, not hidden.)*

## Route map

| Route | Who | What |
|---|---|---|
| `/` | anyone | sign in (email + OTP) |
| `/trips` | signed in | trips list, create trip |
| `/trips/:id` | signed in | trip detail: plan, cars, seat layout, book |
| `/trips/:id/cars/new` | driver, admin | register a car on this trip |
| `/trips/:id/cars/:carId` | signed in | car detail; driver sees confirm/deny + assignment |
| `/me` | signed in | profile (alias, photo, description) and my `+1`s |
| `/admin` | admin | roles, and delete/edit anything |

## Folder layout

```
supabase/migrations/     001_profiles.sql, 002_trips.sql, ...
src/
  lib/supabase.ts        client, created from VITE_SUPABASE_URL / _ANON_KEY
  lib/types.ts           row types mirroring the schema
  auth/AuthProvider.tsx  session context + useAuth()
  api/                   profiles.ts trips.ts cars.ts guests.ts bookings.ts
  components/            small shared UI (SeatGrid, CarCard, RoleBadge, ...)
  pages/                 one file per route above
  App.tsx routes.tsx main.tsx
```

## What is intentionally absent

No test framework or CI — verification is `npm run build` plus exercising the feature in
the running app, with SQL consistency checks for booking changes
([tasks/12](tasks/12-booking-consistency-checks.md)). No Docker. No error-tracking
service. No i18n. No offline support. No pagination — a trip has tens of rows. No
optimistic updates: mutate, then refetch the trip.
