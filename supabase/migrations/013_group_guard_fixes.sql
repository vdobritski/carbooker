-- 013_group_guard_fixes.sql
--
-- Two holes in 012, both found by review and both confirmed against the live database.
-- Neither changes the model - one owner with full rights, members with switches - they
-- just stop it being walked around sideways.
--
-- 1. guard_group_membership() compared only the three switch columns on UPDATE, so nothing
--    stopped group_id or profile_id being rewritten. A member with only can_manage_members
--    could PATCH the *owner's* membership row into a different group: both UPDATE rules
--    looked at the switches (unchanged) and at is_group_owner(new.group_id) (their own
--    group, so true), and neither fired. The owner was left outside their own group,
--    unable to see it at all, and both DELETE rules - "hand the group over first" and
--    "only the owner can remove a member who has permissions" - were bypassed without ever
--    being evaluated. Rewriting profile_id did the same thing with no second group needed.
--
-- 2. guard_group_owner() skips its membership check when the new owner_id is null, because
--    that is exactly what the `on delete set null` from a deleted profile does. But a user
--    session could send that null deliberately and leave the group permanently ownerless:
--    nobody can rename it, transfer it, delete it, or grant a switch. A transfer dropdown
--    submitting an empty value would have done it by accident.

-- Which group, and which person, a membership row is about cannot change. Change their
-- switches, or remove them; you do not move the row. Same idea as guard_booking_identity().
create or replace function guard_group_membership() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
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
    -- New in 013, and it has to come first: every rule below reads new.group_id, so a
    -- rewritten group_id makes all of them ask about the wrong group.
    if new.group_id is distinct from old.group_id
       or new.profile_id is distinct from old.profile_id then
      raise exception
        'A membership cannot be moved to another group or person. Remove it and add the other instead.';
    end if;

    if (new.can_create_trips is distinct from old.can_create_trips
        or new.can_manage_trips is distinct from old.can_manage_trips
        or new.can_manage_members is distinct from old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change permissions';
    end if;

    if (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change a member who has permissions';
    end if;

    return new;
  end if;

  -- DELETE.
  if not exists (select 1 from groups where id = old.group_id) then
    return old;
  end if;

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


-- A group may become ownerless, but only because the owner's account was deleted - never
-- because somebody sent a null. The difference is whether the old owner still exists: the
-- FK cascade sets the column null *after* the profile row is gone.
create or replace function guard_group_owner() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.owner_id is null then
    if auth.uid() is not null
       and exists (select 1 from profiles where id = old.owner_id) then
      raise exception 'Hand the group to another member instead of leaving it without an owner';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from group_members
     where group_id = new.id and profile_id = new.owner_id
  ) then
    raise exception 'The owner has to be a member of the group';
  end if;

  return new;
end;
$$;
