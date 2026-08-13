-- 002_role_guard_bootstrap.sql
--
-- Fixes a bug in 001: guard_role_change() also blocked direct database sessions, which
-- made the first admin impossible to create. The bootstrap documented in the README
-- ("update profiles set role = 'admin' ...") failed with "Only an admin can change a role",
-- because auth.uid() is null in the SQL editor, so is_admin() returned false.
--
-- The fix lets a session with no auth.uid() through. That does not weaken the rule:
--
--   * A direct session (SQL editor, service_role, psql) has no uid and already bypasses
--     RLS completely. It is trusted by definition - there is nothing left to protect.
--   * A request through PostgREST as `authenticated` always carries a uid, so a normal
--     user is still blocked from changing any role, including their own.
--   * A request as `anon` never reaches this trigger: the profiles_update policy is
--     granted only to `authenticated` and requires id = auth.uid() or is_admin(), both
--     false without a uid, so no row is updatable in the first place.
--
-- Note: the comment in 001 pointing at "004_cars.sql" for owns_car() is now off by one -
-- cars becomes 005. 001 is left untouched because it has already been applied.

create or replace function guard_role_change() returns trigger
  language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not is_admin()
  then
    raise exception 'Only an admin can change a role';
  end if;
  return new;
end;
$$;
