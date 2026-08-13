# 01 — Supabase setup, profiles table, RLS helpers

## Goal

The Supabase project exists, the `profiles` table is live, a new signup automatically gets
a profile row, and the two RLS helper functions used by every later policy are in place.

## Dependencies

00.

## Expected changes

- `supabase/migrations/001_profiles.sql`
- `src/lib/types.ts` — add the `Profile` type and the `Role` union
- `src/api/profiles.ts` — `getMyProfile()`, `updateMyProfile(patch)`
- `README.md` — a short "Supabase setup" section: create the project, run the migrations,
  copy URL + anon key into `.env`

## Acceptance criteria

- Migration `001` applies cleanly to an empty Supabase project.
- Signing up a user through the Supabase dashboard creates a matching `profiles` row with
  `role = 'user'` and a non-empty `display_name`.
- With RLS on: a signed-in user can read all profiles and update their own; an attempt to
  update someone else's profile from the client returns an error and changes nothing.
- A non-admin cannot change their own `role` — verify by trying it from the SQL editor as
  that user, or from the client; the row must be unchanged afterwards.
- `anon` (no session) reading `profiles` returns zero rows.

## Implementation notes

Schema and policies are specified in [../data-model.md](../data-model.md) — follow it
rather than reinventing.

Contents of `001_profiles.sql`:

1. `create table profiles (...)` per the data model.
2. `alter table profiles enable row level security;`
3. `is_admin()` and `owns_car(uuid)` helpers, both `security definer stable`. `owns_car`
   references `cars`, which does not exist yet — define it in task 05 instead, and define
   only `is_admin()` here. Do not create a forward reference.
4. Signup trigger:
   ```sql
   create function handle_new_user() returns trigger language plpgsql security definer as $$
   begin
     insert into profiles (id, display_name)
     values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
     return new;
   end $$;
   create trigger on_auth_user_created after insert on auth.users
     for each row execute function handle_new_user();
   ```
5. Policies: select for `authenticated`; update where `id = auth.uid() or is_admin()`.
6. Guard the role column so only admins can change it — either a `before update` trigger
   that raises when `new.role <> old.role and not is_admin()`, or a `with check` on the
   update policy comparing against the existing row. The trigger is clearer; use it.

Set `search_path = public` explicitly on the `security definer` functions.

Make the first real user an admin by hand from the SQL editor after signup, and note that
one line in the README. Do not build a bootstrap flow for it.

The role guard must let a session with no `auth.uid()` through, or that bootstrap cannot
run — the SQL editor has no uid, so `is_admin()` is false there. This was missed on the
first pass and fixed in `002_role_guard_bootstrap.sql`; fold it into the guard directly if
this migration is ever re-run against a fresh project.
