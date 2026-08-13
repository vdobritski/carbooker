# Carbooker

A small internal MVP: a lightweight system for booking car seats on group trips (a group of friends).

Source of truth for scope: [docs/requirements.md](docs/requirements.md).
Design docs: [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md).
Work items: [docs/tasks/](docs/tasks/).

## Stack

- React + TypeScript (Vite)
- Supabase (Postgres, Auth, RLS) — accessed directly from the browser with `supabase-js`
- GitHub Pages for hosting (static SPA, `HashRouter`)

There is no backend server of our own. Business rules live in the React app plus a few
Postgres constraints/triggers for the rules that must not be violated (seat capacity,
booking status invariants).

## Scale and constraints

This is an internal tool for a handful of people. Optimize for "obvious and small",
not for growth.

**Do not introduce:**
- complex security processes (RLS policies stay minimal and readable)
- extensive automated testing (verify manually; add a check only where it protects booking correctness)
- CI/CD infrastructure (deploy is a manual `npm run deploy`)
- unnecessary abstractions (no repository/service/DI layers, no generic CRUD factories)
- microservices or edge functions
- state management libraries beyond React's built-ins

**Prefer:**
- one file per feature area, small and readable
- plain `async` functions in `src/api/*.ts` calling `supabase` directly
- inline component state; lift only when two siblings genuinely share it
- deleting code over generalizing it

## Repository layout

```
docs/            requirements, architecture, data model, tasks
supabase/
  migrations/    timestamped .sql files, applied in order, never edited after apply
src/
  lib/           supabase client, shared types
  api/           one module per table group (trips, cars, bookings, guests, profiles)
  auth/          auth provider + hooks
  components/    shared UI
  pages/         one file per route
```

## Conventions

- TypeScript `strict`. No `any` in committed code.
- Database types are hand-written in `src/lib/types.ts` and mirror the migrations.
  When a migration changes a table, update that file in the same change.
- Migrations are additive and append-only: `supabase/migrations/<NNN>_<name>.sql`.
  Never modify a migration that has already been applied — add a new one.
- Money/time: all timestamps `timestamptz`, all dates `date`. Trip dates are plain dates.
- Naming: snake_case in SQL, camelCase in TypeScript. API modules do the mapping.

## Booking rules (the part that must stay correct)

1. A seat is one `bookings` row. Occupant is either a registered user (`profile_id`)
   or a `+1` guest (`guest_id`) — exactly one of the two.
2. `car_id IS NOT NULL` **iff** `status = 'confirmed'`. A seat is only in a car once the
   driver (or an admin) confirmed it.
3. Confirmed seats in a car may never exceed that car's `seat_count`.
4. A person (user or guest) holds at most one active seat per trip.

See [docs/data-model.md](docs/data-model.md) for the full statement of these invariants.

## Workflow

The main session is the **coordinator**. It reads the task, picks the right subagent,
and reports back. Three subagents:

| Agent | Does | Never does |
|---|---|---|
| `architect` | reads requirements + code, proposes plan, names DB changes | writes application code |
| `implementer` | implements one approved task, writes migrations, verifies manually | redesigns unrelated parts |
| `reviewer` | checks implementation vs requirements, finds bugs and bad data handling | modifies code |

Slash commands: `/plan`, `/implement`, `/review`.

Normal loop for a task: `/plan` → the user approves → `/implement` → `/review` → fix → done.
Small, obvious changes may skip `/plan`.

## Verification

There is no test suite. "Verified" means:
- `npm run build` passes with no TypeScript errors
- the change was exercised in the running app (`npm run dev`) along its happy path and
  the one or two failure paths that matter
- for booking changes: the SQL checks in [docs/tasks/12-booking-consistency-checks.md](docs/tasks/12-booking-consistency-checks.md) return zero rows

Say what was actually checked. Do not report a change as working if it was only compiled.
