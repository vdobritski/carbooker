-- 014_member_own_travel_role.sql
--
-- Found by review: a member holding any switch could never set their own travel role.
--
-- guard_group_membership()'s third UPDATE rule protects "a member who has permissions"
-- from being edited by anyone but the owner. It fired on the member themselves too, so
-- somebody with can_manage_members who actually drives ticked 'driver' on their own row and
-- got "Only the group owner can change a member who has permissions" - about themselves.
-- Confirmed against the live database before this fix.
--
-- The DELETE branch already has exactly this exemption (`old.profile_id <> auth.uid()`):
-- anyone may remove themselves. The UPDATE branch simply never got it.
--
-- This does not let a switch-holder promote themselves: the first rule still refuses any
-- change to the three booleans from anyone who is not the owner, so the only thing this
-- opens up on your own row is travel_role - whether you have a car, which the data model
-- already calls a fact rather than a privilege.

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
    if new.group_id is distinct from old.group_id
       or new.profile_id is distinct from old.profile_id then
      raise exception
        'A membership cannot be moved to another group or person. Remove it and add the other instead.';
    end if;

    -- Nobody but the owner touches the switches, including on their own row.
    if (new.can_create_trips is distinct from old.can_create_trips
        or new.can_manage_trips is distinct from old.can_manage_trips
        or new.can_manage_members is distinct from old.can_manage_members)
       and not is_group_owner(new.group_id) then
      raise exception 'Only the group owner can change permissions';
    end if;

    -- Somebody else who holds a switch is the owner's to edit. `old.profile_id <> auth.uid()`
    -- is new in 014: your own row is your own, and the rule above already means the only
    -- thing you can change on it is your travel role.
    if old.profile_id <> auth.uid()
       and (old.can_create_trips or old.can_manage_trips or old.can_manage_members)
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
