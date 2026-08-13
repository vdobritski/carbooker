-- 001_profiles.sql
-- Profiles mirror auth.users, plus the is_admin() helper used by every later policy.
-- Schema reference: docs/data-model.md

create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  photo_url    text,
  description  text,
  role         text not null default 'user' check (role in ('admin', 'driver', 'user')),
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;


-- Helper used by policies across the whole schema.
-- security definer matters here: a policy *on* profiles calls this, and without definer
-- the lookup would re-enter the profiles policy and recurse.
create function is_admin() returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- owns_car(uuid) is the other shared helper. It is defined in 004_cars.sql, because the
-- cars table does not exist yet and a forward reference would not apply cleanly.


-- Every new auth user gets a profile row. Runs as the function owner, so it is not
-- blocked by the absence of an insert policy on profiles - which is deliberate: this
-- trigger is the only thing that may create a profile.
create function handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'user-' || left(new.id::text, 8)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- Only an admin may change a role, including their own. The update policy below lets a
-- user write their own row, so without this guard any user could promote themselves.
create function guard_role_change() returns trigger
  language plpgsql
as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'Only an admin can change a role';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role_change
  before update on profiles
  for each row execute function guard_role_change();


-- Policies. Anyone signed in can read every profile (drivers need to see passenger
-- names). Writes are your own row, or anything if you are an admin. No insert policy:
-- profiles are created only by handle_new_user(). anon gets nothing.
create policy profiles_select on profiles
  for select to authenticated
  using (true);

create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

create policy profiles_delete on profiles
  for delete to authenticated
  using (is_admin());
