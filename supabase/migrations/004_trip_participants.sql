-- 004_trip_participants.sql
-- Who is going on a trip. Kept separate from bookings on purpose: a driver assigns seats
-- from the participant list, so a person has to be able to be going before they hold a
-- seat. Schema reference: docs/data-model.md

create table trip_participants (
  trip_id    uuid not null references trips (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),

  primary key (trip_id, profile_id)
);

alter table trip_participants enable row level security;

-- The composite primary key is what makes joining twice a no-op rather than a duplicate;
-- no extra guard is needed in the app.
create policy trip_participants_select on trip_participants
  for select to authenticated
  using (true);

-- You add yourself. An admin may add anyone.
create policy trip_participants_insert on trip_participants
  for insert to authenticated
  with check (profile_id = auth.uid() or is_admin());

create policy trip_participants_delete on trip_participants
  for delete to authenticated
  using (profile_id = auth.uid() or is_admin());

-- No update policy: there is nothing on this row worth changing.
