-- 006_guests.sql
-- A user's +1s. A guest is a name owned by its host, not a login: no auth row, no invite,
-- no email. Schema reference: docs/data-model.md

create table guests (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references profiles (id) on delete cascade,
  name       text not null,
  note       text,
  created_at timestamptz not null default now(),

  constraint guests_name_not_blank check (length(trim(name)) > 0)
);

create index guests_host_id_idx on guests (host_id);

alter table guests enable row level security;

-- Readable by anyone signed in: a driver has to see the name of the +1 sitting in their
-- car. Scoping the list to your own guests is the profile page's job, not the policy's.
create policy guests_select on guests
  for select to authenticated
  using (true);

create policy guests_insert on guests
  for insert to authenticated
  with check (host_id = auth.uid());

create policy guests_update on guests
  for update to authenticated
  using (host_id = auth.uid() or is_admin())
  with check (host_id = auth.uid() or is_admin());

create policy guests_delete on guests
  for delete to authenticated
  using (host_id = auth.uid() or is_admin());
