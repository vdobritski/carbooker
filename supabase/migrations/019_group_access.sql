-- 019_group_access.sql
-- Two ways into a group, and no third: an invite link, or asking to be let in.
-- Schema reference: docs/data-model.md
--
-- 012 left group_members with no "insert yourself" branch on purpose - that is what stops
-- anybody who guesses a group id walking in. This migration adds the two doors that were
-- missing as a result, and both of them are security definer functions rather than
-- policies, because in both cases the caller has no rights on the group at the moment they
-- call: a joiner is not a member yet, and somebody following a plain group link is not
-- either.
--
-- The only change to an existing policy is one more branch on profiles_select (017), for a
-- member manager reading the name of somebody who is knocking. Get the correlation name
-- right there or task 17 is quietly undone - see the comment on it below.

-- The invite link. One row per group, or none - regenerating is a delete plus an insert,
-- revoking is a delete. A separate table rather than a column on groups because RLS is
-- row-level and cannot hide one column from ordinary members: on groups the token would be
-- readable, and re-shareable, by everybody in the group. Its own row gets its own policy.
--
-- The token is a column default: the browser has no business choosing it. It is 32 hex
-- characters from gen_random_uuid(), which is core Postgres and is already the default on
-- every id in this schema. docs/data-model.md described this as
-- encode(gen_random_bytes(16), 'hex'); that needs pgcrypto to be on the search_path at the
-- moment this file is applied, which could not be verified from here and buys nothing -
-- 122 random bits against 128, both far past guessable. The doc has been corrected to
-- match this file.
create table group_invites (
  group_id   uuid primary key references groups (id) on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per person per group, pending or rejected. Accepting deletes the row; rejecting
-- keeps it, so the requester learns the answer instead of watching their request vanish.
-- A rejected row is theirs to delete, which is also how they ask again.
create table group_join_requests (
  group_id   uuid not null references groups (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'rejected')),
  note       text,
  created_at timestamptz not null default now(),

  primary key (group_id, profile_id)
);

alter table group_invites enable row level security;
alter table group_join_requests enable row level security;


-- The name of a group, to somebody holding its link ------------------------
-- Deliberately a function and not a policy branch, and it must not become one: RLS grants
-- access to *rows*, not to "the row I named", so any groups_select branch that lets a
-- non-member read one group by id equally lets them run `select * from groups` with no
-- filter and list every group in the database. One id in, one string out - it cannot be
-- enumerated, and the description is not in the return type. groups_select is therefore
-- still exactly what 012 wrote: is_group_member(id).
create function group_preview(group_id uuid) returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select name from groups where id = group_id and auth.uid() is not null;
$$;


-- Joining by token ----------------------------------------------------------
-- Definer for the same reason: no policy can say "insert your own membership if you know
-- the token" without also letting anyone who guesses a group id in. It also keeps the
-- token comparison server-side.
create function join_group_by_invite(invite_token text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  g uuid;
begin
  -- Definer changes current_user but not auth.uid(), so this still asks who is signed in.
  if auth.uid() is null then
    raise exception 'Sign in first, then open the invite link again';
  end if;

  select group_id into g from group_invites where token = invite_token;
  if g is null then
    raise exception 'That invite link is not valid any more';
  end if;

  -- Defaults only: an invite makes plain members. Permissions are the owner's to grant.
  -- `do nothing` is what makes following the same link twice a no-op rather than an error,
  -- and what stops the second visit resetting anything granted since the first.
  insert into group_members (group_id, profile_id)
  values (g, auth.uid())
  on conflict (group_id, profile_id) do nothing;

  -- Following an invite settles any request they had outstanding.
  delete from group_join_requests where group_id = g and profile_id = auth.uid();

  return g;
end;
$$;

-- Both names are needed, and neither is redundant. Execute is granted to PUBLIC by default,
-- and Supabase additionally sets `alter default privileges ... grant all on functions to
-- anon, authenticated, service_role`, so a new function arrives with a PUBLIC grant *and*
-- an explicit anon one. A revoke removes a grant rather than adding a denial, so dropping
-- either alone leaves the other standing - which is why `revoke ... from anon` on its own,
-- the usual incantation, would not have been enough. Confirmed against this project: an
-- existing public function (is_group_member) answers a request carrying no session.
--
-- authenticated is then granted by name, so the revoke from public cannot take it away.
-- Both functions also test auth.uid() themselves; this is the second lock, not the only one.
revoke execute on function group_preview(uuid) from public, anon;
revoke execute on function join_group_by_invite(text) from public, anon;
grant execute on function group_preview(uuid) to authenticated;
grant execute on function join_group_by_invite(text) to authenticated;


-- Policies. anon gets nothing, here as everywhere.
create policy group_invites_all on group_invites
  for all to authenticated
  using (can_manage_members_in(group_id))
  with check (can_manage_members_in(group_id));

-- You see your own request; member managers see the queue.
create policy group_join_requests_select on group_join_requests
  for select to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));

-- Anyone signed in may ask, for any group id - that is the point of the plain group link.
-- They still cannot read the group, only that their own request exists.
create policy group_join_requests_insert on group_join_requests
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'pending');

-- Rejecting is an update. Only a manager does it: the requester writing their own verdict
-- would be a strange kind of answer.
create policy group_join_requests_update on group_join_requests
  for update to authenticated
  using (can_manage_members_in(group_id))
  with check (can_manage_members_in(group_id));

-- Withdrawing, asking again after a refusal, and accepting all go through here.
create policy group_join_requests_delete on group_join_requests
  for delete to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));


-- The one widened policy ----------------------------------------------------
-- 017's text plus a fourth branch: a member manager may read the profile of somebody who
-- has asked to join *their* group, because otherwise accepting and declining is blind.
-- Asking to join is volunteering your name to that group's managers, and to nobody else -
-- a manager of a different group still cannot read that row.
--
-- Write `r.profile_id = profiles.id`, never a bare column name. Postgres resolves an
-- unqualified name against the sub-select's own table first and only then against the outer
-- query, so the day this comparison is written against a column both tables happen to have,
-- the sub-select compares a row to itself, the branch is true for every row, and task 17 is
-- reverted with nothing to see in the diff. Naming the outer table is what pins it.
--
-- The sub-select runs under group_join_requests' own RLS, so it sees only the rows the
-- caller may already see. That is the same answer, reached twice; the can_manage_members_in
-- test is what actually decides it.
drop policy profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or shares_group_with(id)
    or is_admin()
    or exists (
      select 1 from group_join_requests r
       where r.profile_id = profiles.id and can_manage_members_in(r.group_id)
    )
  );
