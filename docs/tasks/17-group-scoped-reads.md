# 17 — Everything under a trip, and everyone's name, follows the group

## Goal

Close the whole read surface in one move. Cars, bookings and trip participants are visible
only to members of the trip's group; **profiles and guests are visible only to people you
share a group with**. Somebody outside a group learns nothing about it — not its trips, not
its cars, not who is in it, not their names. At the same time the global `driver` role
retires: driving is a property of a membership.

This is the second and last flip.

## Dependencies

16. Migration **014**.

## Expected changes

- `supabase/migrations/<next>_group_scoped_reads.sql` — the `trip_group(uuid)` and
  `manages_trip(uuid)` helpers, the rewritten policies on `cars`, `bookings`,
  `trip_participants`, `profiles` and `guests`, the widened `guard_seat_assignment()`, and
  the narrowing of `profiles.role`
- `src/lib/types.ts` — `Role` becomes `'admin' | 'user'`
- `src/pages/Admin.tsx` — the role select drops `driver`; the explanatory line says driving
  and permissions are set per group, with a link to `/groups`
- `src/pages/TripDetail.tsx` — `canRegisterCar` comes from my travel role in the trip's
  group, not from `profile.role`
- `src/api/guests.ts` — the doc comments on `listMyGuests` and `listGuestsByHosts` claim
  "the select policy is open precisely so this works"; that stops being true here

## Two helpers

Cars, bookings and participants carry a `trip_id`, not a `group_id`. Two lookups keep the
policies one-liners:

```sql
create function trip_group(trip uuid) returns uuid
  language sql security definer stable set search_path = public as $$
  select group_id from trips where id = trip;
$$;

-- "May I run this trip?" - I made it, or I may manage anybody's trip in its group. This is
-- the single expression of trip authority; every policy under a trip uses it, so the
-- creator branch cannot be remembered in one place and forgotten in another.
create function manages_trip(trip uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from trips t
     where t.id = trip
       and (t.created_by = auth.uid() or can_manage_trips_in(t.group_id))
  );
$$;
```

Definer for the usual reason — a policy on `cars` must not depend on whether the caller can
read the `trips` row.

`manages_trip()` is what the three-way split of the trip switches costs: one helper, used
in place of the `can_manage_trips_in(trip_group(trip_id))` this task would otherwise have
repeated eight times. Note that it is authority over *the trip*, not over the group: a
member with only `can_create_trips` manages the cars, participants and seats on the trip
they started, and nothing on anyone else's.

## Scoping names

`shares_group_with(uuid)` already exists from task 14. Two policies use it, and that is the
whole cost:

```sql
drop policy profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (id = auth.uid() or shares_group_with(id) or is_admin());

drop policy guests_select on guests;
create policy guests_select on guests
  for select to authenticated
  using (host_id = auth.uid() or shares_group_with(host_id) or is_admin());
```

Task 18 adds one more branch to `profiles_select`, so that a member manager can see the
name of somebody who has asked to join and is not a member yet. It cannot be written here:
`group_join_requests` does not exist until 015.

**Everything that reads a name keeps working, and none of it needed a change.** Worth
checking each one rather than trusting the argument:

| read | who is being read | why it is still visible |
|---|---|---|
| `getMyProfile()` in `AuthProvider` | yourself | `id = auth.uid()` |
| `listProfiles()` on `/admin` | everybody | `is_admin()` |
| `listParticipants` → `profiles (display_name, photo_url, role)` | trip participants | participants are members of the trip's group, and so is the viewer |
| `listCars` → `profiles (display_name, photo_url)` | the driver | drivers are members of the group |
| `bookings` → `profiles!bookings_profile_id_fkey (display_name)` | the occupant | occupants are members (checks 11 and 14) |
| `bookings` → `guests (name, host_id)` | a `+1` | the host is a member (check 12), so `shares_group_with(host_id)` holds |
| `listMyGuests()` | your own `+1`s | `host_id = auth.uid()` |
| `listGuestsByHosts()` in the assign panel | other people's `+1`s | the hosts are participants of the trip, so members of the group |

A brand-new account with no groups sees **itself and nothing else** — its own profile, its
own `+1`s, no other names anywhere. That is the intended answer to "non-members can't see
anything about the groups".

The failure mode if one of these is ever wrong is soft, not loud: PostgREST returns `null`
for an embedded row the caller cannot read, and `toBookingWithOccupant` already falls back
to `'Unknown'`. A name reading "Unknown" on the trip page is the symptom to look for.

**What this costs.** One helper, two policies, and no application changes. The bill comes
in three places, all small but all real:

1. `shares_group_with()` is a two-row join evaluated per profile row returned. At this
   size that is nothing; at ten thousand profiles it would want an index on
   `group_members (profile_id)`, which task 14 already created.
2. Anything that wants to show a name for a person outside your groups now cannot. There
   is exactly one such place today — the join-request queue — and 18 adds the branch for
   it. A *second* such place should be a signal to re-examine, not another branch.
3. `/admin` becomes the only screen that can list everybody, so it is now the only way to
   find a person by name. That is fine, because the app has no "search for a user" feature
   and must not grow one: you get people into a group by sending them a link.

The cheaper 90% version, if the above ever turns out to hurt, is to scope `profiles` and
leave `guests` open — guest rows are just names with no login behind them. It is not worth
taking now: both policies are the same shape and the same one-line helper.

## Policies under a trip

```sql
-- cars ---------------------------------------------------------------------
drop policy cars_select on cars;
create policy cars_select on cars
  for select to authenticated using (is_group_member(trip_group(trip_id)));

-- Replaces the profiles.role in ('driver','admin') test. Both halves still matter:
-- can_drive_in_group() stops a passenger registering a car, driver_id = auth.uid()
-- stops anyone registering one for somebody else.
drop policy cars_insert on cars;
create policy cars_insert on cars
  for insert to authenticated
  with check (driver_id = auth.uid() and can_drive_in_group(trip_group(trip_id)));

-- Was "driver or admin". Whoever runs the trip now counts too, which is what makes it
-- possible to clear a departing member's car out of a trip.
drop policy cars_update on cars;
create policy cars_update on cars
  for update to authenticated
  using (driver_id = auth.uid() or manages_trip(trip_id))
  with check (driver_id = auth.uid() or manages_trip(trip_id));

drop policy cars_delete on cars;
create policy cars_delete on cars
  for delete to authenticated
  using (driver_id = auth.uid() or manages_trip(trip_id));

-- trip_participants --------------------------------------------------------
drop policy trip_participants_select on trip_participants;
create policy trip_participants_select on trip_participants
  for select to authenticated using (is_group_member(trip_group(trip_id)));

drop policy trip_participants_insert on trip_participants;
create policy trip_participants_insert on trip_participants
  for insert to authenticated
  with check (
    (profile_id = auth.uid() and is_group_member(trip_group(trip_id)))
    or manages_trip(trip_id)
  );

drop policy trip_participants_delete on trip_participants;
create policy trip_participants_delete on trip_participants
  for delete to authenticated
  using (profile_id = auth.uid() or manages_trip(trip_id));

-- bookings -----------------------------------------------------------------
drop policy bookings_select on bookings;
create policy bookings_select on bookings
  for select to authenticated using (is_group_member(trip_group(trip_id)));

-- Same shape as 011, with is_admin() widened to manages_trip() and the self-booking
-- branch gated on membership so a guessed trip id is not a way in.
drop policy bookings_insert on bookings;
create policy bookings_insert on bookings
  for insert to authenticated
  with check (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and booked_by = auth.uid()
      and (
        profile_id = auth.uid()
        or exists (select 1 from guests g where g.id = guest_id and g.host_id = auth.uid())
        or owns_car(car_id)
      )
    )
  );

drop policy bookings_update on bookings;
create policy bookings_update on bookings
  for update to authenticated
  using (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and (
        booked_by = auth.uid()
        or owns_car(car_id)
        or owns_car(preferred_car_id)
        or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
      )
    )
  )
  with check (
    manages_trip(trip_id)
    or (
      is_group_member(trip_group(trip_id))
      and (
        booked_by = auth.uid()
        or owns_car(car_id)
        or owns_car(preferred_car_id)
        or (status = 'pending' and car_id is null and drives_on_trip(trip_id))
      )
    )
  );

drop policy bookings_delete on bookings;
create policy bookings_delete on bookings
  for delete to authenticated
  using (booked_by = auth.uid() or manages_trip(trip_id));
```

## The seating guard

Somebody moving another person between cars is refused by `guard_seat_assignment()` today —
it exempts site admins only. Widen that one exemption and nothing else:

```sql
create or replace function guard_seat_assignment() returns trigger
  language plpgsql as $$
declare
  allowed boolean;
begin
  if auth.uid() is null
     or is_admin()
     or manages_trip(new.trip_id)
  then
    return new;
  end if;

  ... the rest of 009, unchanged ...
end;
$$;
```

`guard_booking_identity()` is **not** widened. Moving a seat to another trip or another
occupant stays a site-admin-only escape hatch: "move bookings" means between the cars of
one trip, and checks 5 and 6 in `supabase/checks.sql` exist precisely to catch the
cross-trip version.

## Retiring the global driver role

```sql
update profiles set role = 'user' where role = 'driver';

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'user'));
```

`is_admin()` and `guard_role_change()` are unchanged: `admin` still means site admin, and
still only an admin may set it.

## Acceptance criteria

- Confirm the live constraint name before writing the migration
  (`select conname from pg_constraint where conrelid = 'profiles'::regclass`) — the
  `profiles_role_check` name above is the Postgres default, not a promise.
- Everything a member could do on the live trip before, they can still do: join, book,
  state a preference, cancel; a driver still confirms and assigns in their own car. Names
  and photos still render everywhere — no "Unknown" anywhere on the trip page.
- The account that used to be a global `driver` can still register a car, because task 14
  gave them `travel_role = 'driver'` in the group. No re-granting needed.
- A member with `travel_role = 'passenger'` sees no "Register my car" link **and** a direct
  `createCar` call is refused by RLS. Verify the refusal.
- From a throwaway account in no group: `select * from profiles` returns **exactly one
  row** — their own. `select * from guests`, `cars`, `bookings`, `trip_participants` and
  `trips` all return zero. Run these from the browser console with the anon key, not from
  the SQL editor.
- That same account can still sign in, see their own name in the nav bar, edit their
  profile and add a `+1`. Losing sight of everybody else must not break the account's own
  pages.
- A site admin still sees every account on `/admin` and can still change site roles.
- Two members of *different* groups cannot see each other's names: create a second group
  with the throwaway account, and confirm each sees only themselves.
- A member with `can_manage_trips` can take a passenger out of somebody else's car and put
  them in another car on the same trip, and can delete a member's car; the released seats
  go back to `pending` rather than disappearing.
- A member with only `can_create_trips` can do all of that **on the trip they created**,
  and none of it on a trip somebody else created. Check both halves — this is the branch
  `manages_trip()` exists for.
- That member **cannot** move a seat to another trip — `guard_booking_identity` still
  raises.
- Over-filling a car still fails, for members, managers and admins alike.
- `supabase/checks.sql` returns zero rows.

## Implementation notes

- `owns_car()` and `drives_on_trip()` are unchanged and keep their meaning: authority over
  a *specific* car still comes from driving it, and the manual-assignment branch from 010
  still keys off owning a car on the trip.
- Two nested definer calls per row (`is_group_member(trip_group(trip_id))`) is fine at a
  few dozen rows and both are `stable`. Do not cache group ids in the client to "save" a
  lookup.
- Update the two doc comments in `src/api/guests.ts`. `listGuestsByHosts` still works, but
  for a new reason — the hosts are in your group — and a comment that says the policy is
  open is worse than no comment.
- After this task nothing reads `profile.role === 'driver'`. Grep for it and delete every
  branch rather than leaving one behind a feature flag.
- If a name does come back "Unknown", the bug is in a policy, not in the component. Do not
  add a fallback lookup that fetches profiles by id — that would route around the boundary
  this task exists to draw.

## Risk

**What could break:** the trip page, in the most visible way possible — a policy that is
one branch short shows an empty car list, or a seat labelled "Unknown", rather than an
error. `bookings_update` is the one to get exactly right; it has four branches and 010
already learned that missing one looks like a silent no-op.

**How you know it works:** walk one whole trip in three sessions (owner, driver-member,
passenger-member) — join, book, prefer, confirm, assign, unassign, cancel — with every
name rendering; then the throwaway account in no group sees exactly one profile row and
nothing else; then `supabase/checks.sql` returns zero rows.
