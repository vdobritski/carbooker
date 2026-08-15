-- 012_groups.sql
-- Groups: who is in one, and what each member may do in it. Nothing else changes yet -
-- trips, cars and bookings are untouched and the running app behaves identically. Task 16
-- attaches trips to a group. Schema reference: docs/data-model.md
--
-- There is no role enum. Ownership is a column on the group; everything else is a
-- per-member boolean, and the three switches are fully independent: can_manage_trips does
-- not imply can_create_trips. A role column on top of switchable permissions would be a
-- second way to say the same thing, and the two would drift.
--
-- The migration ends with a one-time backfill that puts every existing account into one
-- group, so task 16 has something to attach the existing trips to.

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- Exactly one owner, by the shape of the schema rather than by a partial unique index
  -- and a last-owner guard. Nullable on purpose: if the owner's account is deleted the
  -- group goes ownerless rather than taking its trips with it, and a site admin can set a
  -- new owner through is_group_owner()'s is_admin() branch.
  owner_id    uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint groups_name_not_blank check (length(trim(name)) > 0)
);

-- No created_by: owner_id starts as the creator and stays meaningful after a transfer.

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

-- For "my groups": the primary key already covers lookups by group.
create index group_members_profile_id_idx on group_members (profile_id);

alter table groups enable row level security;
alter table group_members enable row level security;


-- Helpers. All security definer for the reason is_admin() already is: they are called from
-- policies *on the tables they read*, so without definer the lookup re-enters the policy
-- and recurses. Do not "simplify" any of them into an inline exists in a policy.
--
-- Note the lie in the names: a site admin counts as a member, an owner and a driver of
-- every group. That keeps an `or is_admin()` branch out of a dozen policies.

create function is_group_member(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members where group_id = g and profile_id = auth.uid()
  ) or is_admin();
$$;

create function is_group_owner(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from groups where id = g and owner_id = auth.uid()
  ) or is_admin();
$$;

create function can_create_trips_in(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_create_trips
  ) or is_group_owner(g);
$$;

create function can_manage_trips_in(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_manage_trips
  ) or is_group_owner(g);
$$;

create function can_manage_members_in(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and can_manage_members
  ) or is_group_owner(g);
$$;

-- Not owner-inclusive: driving is a fact about whether you have a car, not a privilege.
-- An owner who drives ticks their own travel role like anybody else. is_admin() is in
-- there only so a site admin can fix things.
create function can_drive_in_group(g uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from group_members
     where group_id = g and profile_id = auth.uid() and travel_role = 'driver'
  ) or is_admin();
$$;

-- Do I share any group with this person? Written now, first used by task 17 to scope names.
create function shares_group_with(p uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1
      from group_members mine
      join group_members theirs on theirs.group_id = mine.group_id
     where mine.profile_id = auth.uid() and theirs.profile_id = p
  );
$$;


-- The creator becomes the owner, and the owner is a member.
-- Definer, and it has to be: at the instant this runs the group has no members, so
-- can_manage_members_in() is false and the group_members insert policy would refuse.
create function add_group_owner_membership() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
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


-- Handing the group over is one statement on one row:
--   update groups set owner_id = <the new owner> where id = <group>;
-- The previous owner keeps their membership and drops to a plain member with whatever
-- switches they had. The new owner has to already be a member.
create function guard_group_owner() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
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


-- RLS is row-level and cannot say *which columns* a member manager may change, so the
-- rules about permissions need a trigger - the same division of labour as
-- guard_role_change() and guard_seat_assignment(): policy for rows, trigger for columns.
--
-- Task 16 replaces this function to add one more rule (you cannot leave or be kicked while
-- you still hold a seat or a car on one of the group's trips); that rule needs
-- trips.group_id, which does not exist yet.
create function guard_group_membership() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- A direct database session already bypasses RLS and is trusted by definition. This is
  -- also what lets the backfill at the bottom of this migration grant switches.
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
  -- Deleting the group cascades to its members, and by then the group row is gone. Both
  -- rules below ask about that row, so both have to step aside here or the cascade
  -- misfires: the owner's own row would look like somebody walking out, and any member
  -- holding a switch would look like a removal nobody is entitled to make - which would
  -- fail the whole delete. Same shape as guard_participant_leave() in 009.
  if not exists (select 1 from groups where id = old.group_id) then
    return old;
  end if;

  -- The owner cannot walk out of their own group.
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


-- Policies. anon gets nothing.
create policy groups_select on groups
  for select to authenticated
  using (is_group_member(id));

create policy groups_insert on groups
  for insert to authenticated
  with check (owner_id = auth.uid());

-- Owner only, and not just because renaming feels like an owner's job: owner_id lives on
-- this row, so anyone who can update it can hand the group to themselves.
create policy groups_update on groups
  for update to authenticated
  using (is_group_owner(id))
  with check (is_group_owner(id));

create policy groups_delete on groups
  for delete to authenticated
  using (is_group_owner(id));

create policy group_members_select on group_members
  for select to authenticated
  using (is_group_member(group_id));

-- No "insert yourself" branch, deliberately: that is what would let anyone who guesses a
-- group id walk in. You arrive by invite (task 18) or by being added by a member manager.
create policy group_members_insert on group_members
  for insert to authenticated
  with check (can_manage_members_in(group_id));

-- The update policy lets a member manager reach the row; the guard trigger above decides
-- which columns they actually moved.
create policy group_members_update on group_members
  for update to authenticated
  using (can_manage_members_in(group_id))
  with check (can_manage_members_in(group_id));

create policy group_members_delete on group_members
  for delete to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));


-- One-time backfill: one group, every existing account in it. The oldest admin owns it;
-- anyone whose global role is 'driver' today becomes a per-group driver; anyone who has
-- created a trip keeps being able to, via can_create_trips.
--
-- can_manage_trips is granted to nobody, and that still preserves today's behaviour
-- exactly: today the only person who can edit or delete a trip is its creator or an admin,
-- and both keep working - the creator through the created_by branch task 16 adds, the
-- admin through is_admin().
--
-- The on conflict do update matters: groups_owner_membership has also inserted the owner's
-- row (its `on conflict do nothing` and this `do update` cover both firing orders), and
-- the owner may also be a driver.
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
