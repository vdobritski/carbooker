# 14 — Groups: schema, membership, per-member permissions

## Goal

A `groups` table with exactly one owner, and a `group_members` table carrying three
switchable permissions and a travel role, plus the helpers every later task leans on.
Nothing else changes yet: trips, cars and bookings are untouched, and the running app keeps
working exactly as it does now.

The migration also creates the **first group and backfills the four live accounts into it**,
so that task 16 has something to attach the existing trip to.

## Dependencies

13. Last applied migration is `011_admin_booking_insert.sql`, so this is **012**.

## Expected changes

- `supabase/migrations/012_groups.sql` — two tables, seven helpers, three triggers,
  policies, and the one-time backfill
- `src/lib/types.ts` — `TravelRole`, `GroupRow` / `Group`,
  `GroupMemberRow` / `GroupMemberWithProfile`

No UI in this task. No `src/api/` module yet — task 15 adds it. This task is finished when
the schema is right and the existing app still behaves identically.

## The model: one owner, three switches

There is **no role enum**. Ownership is a column on the group; everything else is a
per-member boolean. A role column on top of switchable permissions would be a second way to
say the same thing, and the two would drift.

- **Owner** — `groups.owner_id`. Exactly one, by the shape of the schema rather than by a
  guard: one row, one column, no partial unique index and no "last owner" rule to get
  wrong. The owner may do anything inside the group, may grant and revoke permissions, may
  hand the group to another member, and may delete it.
- **`can_create_trips`** — start a new trip in this group. Nothing else. Gates exactly one
  operation: `insert` on `trips`.
- **`can_manage_trips`** — edit and delete **anybody's** trip in this group, and manage what
  is on it: its cars, its participants, and moving or cancelling its seats.
- **`can_manage_members`** — generate and revoke the invite link, accept and decline access
  requests, remove members, and set anyone's travel role. It does **not** include granting
  permissions: only the owner does that, or a member manager would grant themselves the
  rest.
- **`travel_role`** — `driver` may register a car on this group's trips, `passenger` may
  not. Orthogonal to all three switches: a member who runs trips but has no car is normal.

**The three switches are fully independent.** `can_manage_trips` does not imply
`can_create_trips`; someone who tidies up other people's trips without making any is a
coherent person to be, and an implication is the kind of thing that surprises people two
years later. The roster UI ticks both boxes when that is what you meant.

**Your own trip is yours regardless.** Authority over a trip is
`created_by = auth.uid()` **or** `can_manage_trips` — so somebody granted only
`can_create_trips` can still rename their own trip, add cars to it and move seats around
on it, and cannot touch anybody else's. Without that branch the create switch would be a
trap: you make a trip and immediately cannot fix a typo in it. Task 17 turns this pair into
one helper, `manages_trip(uuid)`, and every policy under a trip uses it.

`can_manage_members` is not split into "invite" and "remove". Nobody has described wanting
one without the other; that split is a one-line migration on the day somebody does.

## The schema

```sql
create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- Exactly one owner, and nullable on purpose: see "if the owner's account is deleted".
  owner_id    uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint groups_name_not_blank check (length(trim(name)) > 0)
);

create table group_members (
  group_id           uuid not null references groups (id) on delete cascade,
  profile_id         uuid not null references profiles (id) on delete cascade,
  can_create_trips   boolean not null default false,
  can_manage_trips   boolean not null default false,
  can_manage_members boolean not null default false,
  travel_role        text not null default 'passenger'
                       check (travel_role in ('driver', 'passenger')),
  joined_at          timestamptz not null default now(),

  primary key (group_id, profile_id)
);

create index group_members_profile_id_idx on group_members (profile_id);

alter table groups enable row level security;
alter table group_members enable row level security;
```

There is no `created_by`: `owner_id` starts as the creator and stays meaningful after a
transfer, so a second column recording the same fact at creation time would only ever be
history nobody reads.

## The helpers

All are `security definer stable set search_path = public`, for the reason `is_admin()`
already is: they are called from policies **on the tables they read**, and without definer
the lookup re-enters the policy and recurses.

A site admin counts as a member, an owner and a driver of every group — that keeps the
`or is_admin()` branch out of a dozen policies. It is a lie in the names; the comment in
the migration must say so out loud.

```sql
create function is_group_member(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members where group_id = g and profile_id = auth.uid()
  ) or is_admin();
$$;

create function is_group_owner(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from groups where id = g and owner_id = auth.uid()
  ) or is_admin();
$$;

create function can_create_trips_in(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_create_trips
  ) or is_group_owner(g);
$$;

create function can_manage_trips_in(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_manage_trips
  ) or is_group_owner(g);
$$;

create function can_manage_members_in(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_manage_members
  ) or is_group_owner(g);
$$;

-- Not owner-inclusive: driving is a fact about whether you have a car, not a privilege.
-- An owner who drives ticks their own travel role like anybody else. is_admin() is in
-- there only so a site admin can fix things.
create function can_drive_in_group(g uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and travel_role = 'driver'
  ) or is_admin();
$$;

-- Do I share any group with this person? Task 17 uses it to scope names.
create function shares_group_with(p uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from group_members mine
      join group_members theirs on theirs.group_id = mine.group_id
     where mine.profile_id = auth.uid() and theirs.profile_id = p
  );
$$;
```

## The creator becomes the owner

```sql
-- Definer, and it has to be: at the instant this runs the group has no members, so
-- can_manage_members_in() is false and the group_members insert policy would refuse.
create function add_group_owner_membership() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into group_members (group_id, profile_id)
    values (new.id, new.owner_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger groups_owner_membership
  after insert on groups
  for each row execute function add_group_owner_membership();
```

## Ownership transfer

Handing the group over is **one statement on one row**:

```sql
update groups set owner_id = <the new owner> where id = <group>;
```

The previous owner keeps their membership and drops to a plain member with whatever
switches they had — which is normally none, since an owner never needed any. Granting them
`can_manage_trips` afterwards is the new owner's call. The UI must say this before it
happens; it is not reversible without the new owner's cooperation.

The new owner has to already be a member:

```sql
create function guard_group_owner() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from group_members
     where group_id = new.id and profile_id = new.owner_id
  ) then
    raise exception 'The owner has to be a member of the group';
  end if;
  return new;
end;
$$;

-- Update only. On insert the membership row does not exist yet - the trigger above makes
-- it - and relying on two after-triggers firing in the right order would be a trap.
create trigger groups_owner_guard
  before update of owner_id on groups
  for each row execute function guard_group_owner();
```

**If the owner's account is deleted**, `on delete set null` leaves the group *ownerless*:
its trips, cars and seats are all still there, members with switches keep working, but
nobody can grant permissions, transfer, or delete the group until a site admin sets a new
owner — which `is_group_owner()`'s `is_admin()` branch already allows, with no extra code.
That is the recoverable end state; a cascade would have taken the trips with it and a
`restrict` would have made deleting the account fail from inside a cascade with an
incomprehensible error.

## The membership guard

RLS is row-level and cannot say *which columns* a member-manager may change, so the rules
about permissions need a trigger — the same reason `guard_role_change` and
`guard_seat_assignment` exist.

```sql
create function guard_group_membership() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- A direct database session already bypasses RLS and is trusted by definition.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    if (new.can_create_trips or new.can_manage_trips or new.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can grant permissions';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.can_create_trips is distinct from old.can_create_trips
        or new.can_manage_trips is distinct from old.can_manage_trips
        or new.can_manage_members is distinct from old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change permissions';
    end if;

    -- Somebody who already has any switch is the owner's to edit. Otherwise a member
    -- manager could quietly take the travel role off a peer. One rule for all three
    -- switches, including the mild one: the alternative is a table of which switch
    -- protects you from whom.
    if (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change a member who has permissions';
    end if;

    return new;
  end if;

  -- DELETE.
  -- The owner cannot walk out of their own group. The `exists` also steps aside during a
  -- cascade: deleting the group removes its row first, so this is false and the members
  -- go quietly. Same shape as guard_participant_leave() in 009.
  if exists (select 1 from groups where id = old.group_id and owner_id = old.profile_id) then
    raise exception 'Hand the group to somebody else before leaving it';
  end if;

  if old.profile_id <> auth.uid()
     and (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
     and not is_group_owner(old.group_id) then
    raise exception 'Only the group owner can remove a member who has permissions';
  end if;

  return old;
end;
$$;

create trigger group_members_guard
  before insert or update or delete on group_members
  for each row execute function guard_group_membership();
```

Task 16 replaces this function to add one more rule (you cannot leave or be kicked while
you still hold a seat or a car on one of the group's trips) — that rule needs
`trips.group_id`, which does not exist yet.

## Policies

```sql
create policy groups_select on groups
  for select to authenticated using (is_group_member(id));

create policy groups_insert on groups
  for insert to authenticated with check (owner_id = auth.uid());

-- Owner only, and not just because renaming feels like an owner's job: owner_id lives on
-- this row, so anyone who can update it can hand the group to themselves.
create policy groups_update on groups
  for update to authenticated
  using (is_group_owner(id)) with check (is_group_owner(id));

create policy groups_delete on groups
  for delete to authenticated using (is_group_owner(id));

create policy group_members_select on group_members
  for select to authenticated using (is_group_member(group_id));

-- No "insert yourself" branch, deliberately: that is what would let anyone who guesses a
-- group id walk in. You arrive by invite (task 18) or by being added by a member manager.
create policy group_members_insert on group_members
  for insert to authenticated with check (can_manage_members_in(group_id));

create policy group_members_update on group_members
  for update to authenticated
  using (can_manage_members_in(group_id)) with check (can_manage_members_in(group_id));

create policy group_members_delete on group_members
  for delete to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));
```

The update policy lets a member manager reach the row; the guard trigger decides which
columns they actually moved. That division — policy for rows, trigger for columns — is the
one this codebase already uses for bookings.

## The backfill

One group, every existing account in it. The oldest admin owns it; anyone whose global role
is `driver` today becomes a per-group `driver`; anyone who has created a trip keeps being
able to, via `can_create_trips`.

`can_manage_trips` is granted to **nobody** — and that still preserves today's behaviour
exactly, because today the only person who can edit or delete a trip is its creator or an
admin, and both of those keep working: the creator through the `created_by` branch task 16
adds, the admin through `is_admin()`.

```sql
with owner as (
  -- An admin if there is one, otherwise the oldest account. Never zero rows.
  select id from profiles order by (role = 'admin') desc, created_at asc limit 1
), g as (
  insert into groups (name, description, owner_id)
  select 'Friends', 'Everyone who was using Carbooker before groups existed', owner.id
  from owner
  returning id
)
insert into group_members (group_id, profile_id, can_create_trips, travel_role)
select g.id,
       p.id,
       -- Today anybody can create a trip. Granting it to people who actually have keeps
       -- the live group working without handing everyone somebody else's delete button.
       exists (select 1 from trips t where t.created_by = p.id),
       case when p.role = 'driver' then 'driver' else 'passenger' end
  from g cross join profiles p
on conflict (group_id, profile_id) do update
   set can_create_trips = excluded.can_create_trips,
       travel_role      = excluded.travel_role;
```

The `on conflict do update` matters: the `groups_owner_membership` trigger has already
inserted the owner's row by the time this insert runs, and the owner may also be a driver.

## Acceptance criteria

- The migration applies to the live database in one go, and afterwards
  `select * from group_members` shows all four accounts in one group, the previous
  `driver` account(s) carry `travel_role = 'driver'`, whoever created the live trip
  carries `can_create_trips`, and **no row has `can_manage_trips`**.
- `select owner_id from groups` is the oldest admin, and that account has a membership row.
- The existing app still works untouched: trips list, trip detail, booking, confirming.
  Nothing in `src/` needed changing for that to be true.
- From a normal signed-in session: `select * from groups` returns the group for a member
  and **zero rows** for a signed-in user who is not in it (create a fifth throwaway account
  to check this).
- A member with `can_manage_members` cannot grant themselves `can_create_trips` or
  `can_manage_trips` — the guard raises *"Only the group owner can change permissions"*.
  Verify from a browser session.
- A member with `can_manage_members` cannot remove or edit a member who has a switch set;
  the owner can.
- The owner cannot delete their own membership row: *"Hand the group to somebody else
  before leaving it"*.
- Transferring works in one statement, and transferring to somebody who is not a member
  raises. After a transfer the old owner is a plain member and the new owner can grant
  permissions.
- Deleting the whole group succeeds — the owner's membership row goes with it rather than
  raising.

## Implementation notes

- Verify each helper is owned by the same role that owns the tables — `is_admin()` already
  relies on that, and it is what makes definer bypass RLS here.
- `is_group_member(id)` inside the policy **on `groups`** and `is_group_member(group_id)`
  inside the policy **on `group_members`** are both self-referential. They only work
  because of `security definer`. Do not "simplify" either into an inline `exists`.
- `shares_group_with()` is written here but not used until task 17. Define it now so 017's
  migration is only policies.
- A policy that refuses a write returns zero rows rather than an error, so when task 15
  writes the API module every mutation must check the returned row count.
- Do not add a permissions table, a bitmask, a role enum, or a `group_settings` table.
  Three booleans, one travel role, one owner column.
- Do not make `can_manage_trips` imply `can_create_trips` in SQL. If the two should move
  together for a particular person, the roster ticks both boxes.

## Risk

**What could break:** nothing that is live — this migration only adds tables. The sharp
edge is the backfill picking the wrong owner if the live `profiles` has no admin; read the
result of the `with owner as (...)` select before running it.

**How you know it works:** the nine checks above, run in the Supabase SQL editor and in a
second browser profile signed in as a non-member, plus the existing app still loading a
trip and confirming a seat.
