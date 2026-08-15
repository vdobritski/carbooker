-- 020_join_request_identity.sql
--
-- Found by review, reproduced against the live database: `group_join_requests` was the one
-- table in the groups schema without the identity rule 013 added to `group_members`.
--
-- group_join_requests_update asks only about group_id, in both `using` and `with check`,
-- and nothing pinned profile_id. So a member manager could insert a request for themselves
-- (allowed: profile_id = auth.uid(), status 'pending'), then PATCH profile_id to anybody's
-- uuid. The forged row then satisfies the fourth branch of profiles_select added in 019 -
-- "somebody who has asked to join a group I manage" - and the manager could read that
-- person's name, photo and description indefinitely, while the victim appeared in the
-- queue as if they had knocked. Measured before and after: 0 rows, then 1.
--
-- Bounded rather than novel reach: a manager can already insert an arbitrary profile_id
-- into group_members (012) and see the same profile through shares_group_with(). This
-- closes the quieter route, and makes the rule uniform across the three group tables.
--
-- A request is a fact about one person and one group. Deciding it means setting `status`,
-- or deleting the row. Nothing else on it moves.

create function guard_join_request_identity() returns trigger
  language plpgsql
as $$
begin
  -- A direct database session already bypasses RLS and is trusted by definition.
  if auth.uid() is null then
    return new;
  end if;

  if new.group_id is distinct from old.group_id
     or new.profile_id is distinct from old.profile_id then
    raise exception
      'A join request cannot be moved to another group or person. Delete it instead.';
  end if;

  return new;
end;
$$;

create trigger group_join_requests_identity_guard
  before update on group_join_requests
  for each row execute function guard_join_request_identity();
