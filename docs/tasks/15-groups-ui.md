# 15 — Groups in the app: list, create, roster, permissions

## Goal

Screens for what task 14 built: see the groups I am in, create one, open it, and — if I may
— tick people's permissions, mark someone a driver or a passenger, remove them, and hand
the group over. Trips are still ungrouped at this point; the group page has no trips
section yet.

## Dependencies

14. No migration.

## Expected changes

- `src/api/groups.ts` — `listMyGroups()`, `getGroup(id)`, `createGroup(input)`,
  `updateGroup(id, patch)`, `deleteGroup(id)`, `transferOwnership(groupId, profileId)`,
  `listMembers(groupId)`, `setMemberPermissions(groupId, profileId, patch)`,
  `setMemberTravelRole(groupId, profileId, travelRole)`,
  `removeMember(groupId, profileId)`, `leaveGroup(groupId)`
- `src/components/MemberList.tsx` — name, photo, "owner" marker, three permission
  checkboxes, the travel-role select, the remove button
- `src/pages/Groups.tsx` — `/groups`: my groups, and the create form
- `src/pages/GroupDetail.tsx` — `/groups/:id`: name, description, member list, leave
  button, edit/delete/transfer for the owner
- `src/routes.tsx` — `/groups` and `/groups/:id`
- `src/components/NavBar.tsx` — a "Groups" link

## Acceptance criteria

- `/groups` lists exactly the groups I am a member of, and marks the ones I own. A new
  account sees an empty list and a line explaining it should create a group or follow an
  invite.
- Creating a group lands me on its page as owner, without a reload — the trigger from task
  14 makes the membership row, so the page must refetch members after creating.
- `/groups/<id>` for a group I am not in shows **"Group not found"**, not an error and not
  a blank page. Same shape as the existing "Trip not found" branch in `TripDetail.tsx`.
- The owner sees all three permission checkboxes on every other member and can tick and
  untick them independently; the change is visible to that member on their next page load.
  Ticking "manage trips" does not tick "create trips" for them.
- A member with `can_manage_members` sees the travel-role select and the remove button, but
  the permission checkboxes are read-only for them, **and** a direct
  `setMemberPermissions` call from their session is refused by the guard trigger with its
  message shown on screen. Verify the second one.
- A member with `can_manage_members` cannot remove a member who has a switch set; the
  message says why.
- A plain member sees the roster and nothing but a "Leave group" button.
- Transfer asks for confirmation, spells out that the current owner drops to a plain member
  with no permissions, and afterwards the page reflects both changes.
- The owner sees no "Leave group" button — they get "Transfer or delete the group" instead
  — and a direct `leaveGroup` call raises.
- Deleting a group asks for confirmation and says that its trips go with it (they will,
  from task 16 onward, via `on delete cascade`).
- If a group is ownerless (its owner's account was deleted), the page says so and only a
  site admin sees the controls.

## Implementation notes

- `listMyGroups()` needs no `where` clause — the select policy is the filter. Read `groups`
  and the caller's own membership in one query:
  `select('id, name, description, owner_id, created_at, group_members!inner (can_create_trips, can_manage_trips, can_manage_members, travel_role)')`
  with `.eq('group_members.profile_id', userId)`. One query, not one per group.
- `listMembers` joins profiles the way `listParticipants` already does in
  `src/api/trips.ts` — same cast-through-`unknown` shape, same reason.
- The three checkboxes write one column each. Do not build a permissions form with a save
  button; tick, write, refetch, exactly like the role select on `/admin` does today.
- Label them in plain words — "can start trips", "can manage anyone's trip", "can manage
  people" — with one line under the second saying it covers editing and deleting other
  people's trips and moving their seats. Column names are not labels.
- `transferOwnership` is `update groups set owner_id = ...` — one statement. Do not
  demote the old owner separately; there is nothing to demote, ownership is one column.
- Every mutation here can be refused silently by RLS. Follow the existing convention:
  `.select(...).single()` for updates that must return a row, and the explicit
  `if (!data || data.length === 0) throw new Error(...)` check that
  `deleteTrip`/`removeParticipant` already use.
- Do not put group memberships into `AuthProvider`. Only two pages need them, and they can
  fetch. The provider stays session + profile.
- No group avatars, no group settings page, no member search box, no permission presets
  ("make moderator" as a shortcut for ticking all three). A roster of a handful of people
  is a `<ul>`.

## Risk

**What could break:** nothing outside the new pages — this task adds routes and reads; the
only writes are on tables introduced in task 14.

**How you know it works:** `npm run build` clean, then in three browser profiles (owner, a
member with `can_manage_members`, a plain member) walk the list: create, tick, untick, set
driver, remove, leave, transfer, and hit `/#/groups/<id>` as an outsider expecting "Group
not found".
