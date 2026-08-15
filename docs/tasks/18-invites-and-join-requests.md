# 18 — Invite links and access requests

## Goal

Two ways into a group, and no third:

1. **Invite link** — somebody with `can_manage_members` generates `/#/join/<token>`. Anyone
   signed in who opens it is a member.
2. **Access request** — somebody who was sent the plain group link `/#/groups/<id>` sees
   the group's **name**, so they know what they are asking to join, and can request access.
   Member managers see the queue and accept or decline.

## Dependencies

17. Migration **015**.

## Expected changes

- `supabase/migrations/<next>_group_access.sql` — `group_invites`, `group_join_requests`,
  the `join_group_by_invite(text)` and `group_preview(uuid)` functions, and one widened
  `profiles` select policy
- `src/lib/types.ts` — `GroupInvite`, `GroupJoinRequest` (+ `JoinRequestStatus`)
- `src/api/groupAccess.ts` — `getInvite(groupId)`, `createInvite(groupId)`,
  `revokeInvite(groupId)`, `joinByInvite(token)`, `previewGroup(groupId)`,
  `requestAccess(groupId)`, `myRequest(groupId)`, `withdrawRequest(groupId)`,
  `listJoinRequests(groupId)`, `acceptRequest(groupId, profileId)`,
  `rejectRequest(groupId, profileId)`
- `src/pages/GroupDetail.tsx` — invite-link box and request queue for member managers; the
  "request access" branch for non-members
- `src/pages/JoinGroup.tsx` — `/join/:token`
- `src/routes.tsx` — `/join/:token`, inside `RequireAuth`

## The schema

The token lives in its own table, not in a column on `groups`. RLS is row-level and cannot
hide one column from ordinary members (the same wall `guard_booking_identity` exists to get
around) — a separate row with its own policy is the cheap way to make the link visible to
managers only, and it costs one table.

```sql
create table group_invites (
  group_id   uuid primary key references groups (id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One pending or rejected row per person per group. Accepting deletes the row.
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
```

One invite per group, keyed by `group_id`: regenerating is a delete plus an insert, revoking
is a delete. No expiry, no use count, no per-invitee invite rows — a hard-to-guess token on
a row is enough for a handful of friends, and anything more is a feature nobody asked for.
The token comes from the column default; the browser has no business choosing it.

## Following a group link: the name, and only the name

Somebody who opens `/#/groups/<id>` must see what they are asking to join. **This is not a
policy branch, and it must not become one.** RLS is row-level: any `groups` select branch
that lets a non-member read a row by id equally lets them run `select * from groups` with
no filter and read *every* group in the database. There is no "only when filtered by id" in
RLS. The two expressible policy shapes are both wrong here — `using (true)` enumerates
everything, and "only if you already have a request row" puts the request before the name,
which is backwards.

So the preview is a `security definer` function that takes one id and returns one column:

```sql
create function group_preview(group_id uuid) returns text
  language sql security definer stable set search_path = public as $$
  select name from groups where id = group_id and auth.uid() is not null;
$$;

revoke execute on function group_preview(uuid) from anon;
```

Knowing the id — that is, having been sent the link — is the ticket. A caller learns the
name of a group they can already address, cannot list groups, and **cannot read the
description**: it is not in the return type. Nothing private needs a warning label, because
nothing but the name leaves the group.

`groups_select` is therefore unchanged from task 14: still `is_group_member(id)`.

The reverse direction **is** a policy branch: a member manager has to see the *name* of
whoever is knocking, or accept and decline are blind. That is one more branch on the policy
task 17 wrote — a person who asks to join has volunteered their identity to that group's
managers, and to nobody else:

```sql
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
```

Get the correlation name right — `profiles.id` inside the sub-select, not `id`, or it
matches every row and quietly undoes task 17.

## Policies

```sql
create policy group_invites_all on group_invites
  for all to authenticated
  using (can_manage_members_in(group_id)) with check (can_manage_members_in(group_id));

-- You see your own request; member managers see the queue.
create policy group_join_requests_select on group_join_requests
  for select to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));

-- Anyone signed in may ask, for any group id - that is the point of the plain group link.
-- They still cannot read the group, only that their own request exists.
create policy group_join_requests_insert on group_join_requests
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'pending');

create policy group_join_requests_update on group_join_requests
  for update to authenticated
  using (can_manage_members_in(group_id)) with check (can_manage_members_in(group_id));

create policy group_join_requests_delete on group_join_requests
  for delete to authenticated
  using (profile_id = auth.uid() or can_manage_members_in(group_id));
```

## Joining by token

The joiner is not a member yet, so no policy can let them insert their own membership
without also letting anyone who guesses a group id walk in. One `security definer`
function, which is also what keeps the token comparison server-side:

```sql
create function join_group_by_invite(invite_token text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  g uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select group_id into g from group_invites where token = invite_token;
  if g is null then
    raise exception 'That invite link is not valid any more';
  end if;

  -- Defaults only: an invite makes plain members. Permissions are the owner's to grant.
  insert into group_members (group_id, profile_id)
  values (g, auth.uid())
  on conflict (group_id, profile_id) do nothing;

  -- Following an invite settles any request they had outstanding.
  delete from group_join_requests where group_id = g and profile_id = auth.uid();

  return g;
end;
$$;

revoke execute on function join_group_by_invite(text) from anon;
```

## Acceptance criteria

- A member manager generates a link, copies it, revokes it, generates a new one. The old
  link then fails with *"That invite link is not valid any more"*.
- A plain member of the group sees no token anywhere — confirm by selecting `group_invites`
  from a member session and getting zero rows, not just by the UI hiding it.
- Opening `/#/join/<token>` while signed out lands on sign-in and, after the code, on the
  group — or, if that is more work than it is worth, it says "sign in and open the link
  again". Pick one and make the page say what it does.
- Opening a valid link twice is a no-op the second time, not an error. The second visit
  does not reset any permissions the person has been granted since.
- A non-member opening `/#/groups/<id>` sees the group's **name**, a line saying they are
  not a member, and a "Request access" button; after requesting, the page says it is
  waiting for a decision and offers to withdraw. The name is still there afterwards.
- That same non-member gets **no description, no roster, no trip count and no owner name**,
  and `select * from groups` from their session still returns zero rows. Check the bare
  select explicitly — it is the thing the preview function exists to avoid.
- `group_preview` with a random uuid returns null and the page says the link does not point
  at a group. With a malformed id it is the same message, not a crash.
- A member manager sees the queue **with names**, accepts one (they appear in the roster,
  the request row disappears) and declines another (the requester's page says declined;
  they can ask again).
- The requester's name is visible to that group's managers and to nobody else: a manager of
  a *different* group cannot read that profile row.
- Accepting somebody who is already a member is harmless.
- A request for a group id that does not exist fails on the foreign key with a readable
  message.
- Someone joining by invite arrives with both permission checkboxes off and
  `travel_role = 'passenger'`.

## Implementation notes

- `acceptRequest` is two calls — insert the membership, then delete the request. If the
  second fails you get a stale queue entry and nothing worse; filter the queue against the
  roster when rendering. Do not wrap it in a third RPC for atomicity that does not matter.
- The non-member branch of `GroupDetail` is reached when `getGroup(id)` returns `null`; it
  then calls `previewGroup(id)` for the name. Reuse the `22P02` handling from `getTrip` for
  a malformed id, in both calls.
- `joinByInvite` calls `supabase.rpc('join_group_by_invite', { invite_token: token })` and
  `previewGroup` calls `supabase.rpc('group_preview', { group_id: id })`. These are the
  only two RPCs in the codebase and `docs/architecture.md` says why each exists — in both
  cases the caller has no rights on the group yet, and in the preview's case a policy could
  not restrict the answer to one row or one column. A third RPC needs the same argument
  made in writing, or it is a policy written badly.
- Requests carry a `status` rather than vanishing on rejection, so the requester learns the
  answer. Rejected rows are theirs to delete; a manager clearing the queue may also delete
  them. Do not add a cooldown or a block list.
- No email, no notification, no share sheet. Copy-to-clipboard on the link, and that is it.

## Risk

**What could break:** the widened `profiles` select policy is the only change to an
existing policy, and a mistake in it silently re-opens what task 17 just closed. Re-run
task 17's "throwaway account sees exactly one profile row" check after this migration, with
a pending request outstanding and again without one.

**How you know it works:** two browser profiles, one of them a fresh account in no group:
request → the manager sees the name → accept → visible; revoke → old link dead; new link →
instant membership; and a member session selecting `group_invites` returns nothing.
