# Carbooker

Booking car seats on group trips, for a small group of friends.

React + TypeScript, Supabase (Postgres + Auth), hosted on GitHub Pages.
See [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md),
and the ordered work items in [docs/tasks/](docs/tasks/).

## Running locally

```bash
npm install
npm run dev
```

The dev server serves the app under the Pages base path: **http://localhost:5173/Carbooker/**
(not bare `localhost:5173`). `npm run build` type-checks and writes `dist/`.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com). Any region, free tier.
2. **Apply the migrations.** In the dashboard, open **SQL Editor → New query**, paste the
   contents of each file in `supabase/migrations/` in filename order, and run them one at
   a time. Order matters — later migrations reference earlier tables.
   Migrations are append-only: never edit one that has already been run, add a new one.
3. **Enable email auth.** Authentication → Providers → Email: on. Magic links are not
   used; the app signs in with the 6-digit OTP code from the same email template.
4. **Copy the credentials.** Project Settings → API → copy the Project URL and the
   `anon` public key into `.env`:

   ```bash
   cp .env.example .env
   ```

   Both values are inlined into the bundle at build time. That is expected for the anon
   key — the RLS policies, not secrecy, are what protect the data. Never put the
   `service_role` key in this file.
5. **Make yourself an admin.** Sign up once through the app, then run this in the SQL
   editor — it is the only way to create the first admin, by design:

   ```sql
   update profiles set role = 'admin' where id = (
     select id from auth.users where email = 'you@example.com'
   );
   ```

   After that, admins promote everyone else from `/#/admin`.

Restart the dev server after changing `.env` — Vite reads it at startup.

## Verifying a change

There is no test suite. A change is done when `npm run build` passes and the feature was
exercised in the running app, including the failure paths the task names.

Anything touching bookings also runs `supabase/checks.sql` in the SQL editor — it must
return **zero rows**. Any row it returns names the rule that broke and the offending
record. See [docs/tasks/12](docs/tasks/12-booking-consistency-checks.md).

## Deploying

Live at **https://vdobritski.github.io/carbooker/**.

```bash
npm run deploy
```

That builds and pushes `dist/` to the `gh-pages` branch. There is no CI — deploy is a
manual command, on purpose.

Things worth knowing:

- **Vite inlines `VITE_*` at build time**, so `.env` must exist on whichever machine runs
  the deploy. A deploy from a machine without it produces a bundle that throws on load.
- **`base` in `vite.config.ts` must match the repository name, including case.** The repo
  is `carbooker`; `/Carbooker/` would 404 every asset.
- **The anon key ships inside the bundle.** That is how Supabase is designed — the RLS
  policies protect the data, not the secrecy of that key. Never put the `service_role`
  key anywhere near the client.
- First deploy only: Settings → Pages → source `gh-pages` branch, root.
