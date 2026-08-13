-- 003_trips.sql
-- Trips. Schema reference: docs/data-model.md

create table trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  plan        text,
  starts_on   date,
  ends_on     date,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint trips_name_not_blank check (length(trim(name)) > 0),
  constraint trips_dates_ordered check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

alter table trips enable row level security;

-- Everyone signed in sees every trip - this is one group of friends, not a multi-tenant
-- app. Only the creator or an admin may change or remove one.
create policy trips_select on trips
  for select to authenticated
  using (true);

create policy trips_insert on trips
  for insert to authenticated
  with check (created_by = auth.uid());

create policy trips_update on trips
  for update to authenticated
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

create policy trips_delete on trips
  for delete to authenticated
  using (created_by = auth.uid() or is_admin());
