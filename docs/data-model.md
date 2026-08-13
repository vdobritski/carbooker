# Carbooker — Data Model

Postgres on Supabase. Six tables. All ids are `uuid default gen_random_uuid()` unless
noted; all timestamps are `timestamptz default now()`.

This document is the contract the migrations implement and `src/lib/types.ts` mirrors.

## Entities and relationships

```
auth.users 1─1 profiles
                 │ 1─n guests            (a user's +1s)
                 │ 1─n cars              (driver_id)
                 │ n─m trips             (via trip_participants)
                 │
trips 1─n cars
      1─n trip_participants
      1─n bookings

cars  1─n bookings          (car_id — confirmed seat)
      1─n bookings          (preferred_car_id — requested seat)

bookings ──► exactly one occupant: profiles.id  OR  guests.id
```

A **seat is one `bookings` row.** A user booking themselves plus two `+1`s creates three
rows sharing the same `booked_by`.

## Tables

### `profiles`
Mirror of `auth.users`, created by a trigger on signup.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `references auth.users(id) on delete cascade` |
| `display_name` | text not null | name / alias |
| `photo_url` | text | optional |
| `description` | text | optional, free text |
| `role` | text not null default `'user'` | `check in ('admin','driver','user')` |
| `created_at` | timestamptz | |

Role authority: `admin` may do anything. `driver` may register cars. Authority over a
*specific* car comes from `cars.driver_id = auth.uid()`, not from the role.

### `guests` — the `+1`s
A guest is a record owned by a host user, **not** a login.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `host_id` | uuid not null | `references profiles(id) on delete cascade` |
| `name` | text not null | |
| `note` | text | optional |
| `created_at` | timestamptz | |

### `trips`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `description` | text | |
| `plan` | text | free-form itinerary |
| `starts_on` | date | optional |
| `ends_on` | date | optional |
| `created_by` | uuid | `references profiles(id) on delete set null` |
| `created_at` | timestamptz | |

Two check constraints keep obviously-broken rows out: `name` must not be blank after
trimming, and `ends_on` must not precede `starts_on` when both are set.

### `trip_participants`
Who is going. Separate from bookings, because a driver assigns seats *from the participant
list* — a person can be a participant before they hold a seat.

| column | type | notes |
|---|---|---|
| `trip_id` | uuid | `references trips(id) on delete cascade` |
| `profile_id` | uuid | `references profiles(id) on delete cascade` |
| `joined_at` | timestamptz | |

Primary key `(trip_id, profile_id)`.

### `cars`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `trip_id` | uuid not null | `references trips(id) on delete cascade` |
| `driver_id` | uuid not null | `references profiles(id) on delete cascade` |
| `title` | text not null | e.g. "Ivan's blue Passat" |
| `description` | text | |
| `features` | text[] not null default `'{}'` | `{fridge, grill, opening roof}` |
| `seat_count` | int not null | `check (seat_count > 0)` — passenger seats, excluding the driver |
| `created_at` | timestamptz | |

`features` is a plain `text[]`. No feature table, no join table — it is a list of words
shown as chips.

### `bookings` — one row per seat

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `trip_id` | uuid not null | `references trips(id) on delete cascade` |
| `profile_id` | uuid | occupant is a registered user; `on delete cascade` |
| `guest_id` | uuid | occupant is a `+1`; `on delete cascade` |
| `booked_by` | uuid not null | who created the seat (host for a `+1`); `on delete cascade` |
| `car_id` | uuid | the confirmed car; **null unless confirmed** |
| `preferred_car_id` | uuid | what the passenger asked for; `on delete set null` |
| `status` | text not null default `'pending'` | `check in ('pending','confirmed','denied')` |
| `comment` | text | health, special requirements, what they can bring |
| `created_at` / `updated_at` | timestamptz | |

**Status meaning**

- `pending` — "under review". The person holds a place on the trip but is not in a car
  yet, either because they stated no preference or because the requested driver has not
  answered.
- `confirmed` — seated in `car_id`. Only that car's driver or an admin sets this.
- `denied` — the driver rejected the request. The seat is inactive and counts against
  nothing. The passenger may request again.

## Invariants

These four rules must hold at all times. Each is enforced **in the database**, not only in
the UI.

1. **One occupant per seat.**
   `check (num_nonnulls(profile_id, guest_id) = 1)`

2. **A seat is in a car iff it is confirmed.**
   `check ((car_id is not null) = (status = 'confirmed'))`
   This makes "confirmed but carless" and "sitting in a car while pending/denied" both
   unrepresentable.

3. **A car never holds more confirmed seats than it has.**
   Trigger `trg_bookings_capacity`, `before insert or update on bookings`: when
   `new.car_id is not null`, `select seat_count from cars where id = new.car_id for update`
   (the `for update` is what makes two drivers confirming the last seat at the same moment
   safe), count confirmed seats in that car excluding `new.id`, and `raise exception` if
   the seat would be the one too many.
   The same function guards `cars`: `before update on cars`, reject lowering `seat_count`
   below the number of seats already confirmed in it.

4. **One active seat per person per trip.**
   ```sql
   create unique index bookings_one_active_user on bookings (trip_id, profile_id)
     where profile_id is not null and status <> 'denied';
   create unique index bookings_one_active_guest on bookings (trip_id, guest_id)
     where guest_id is not null and status <> 'denied';
   ```
   Denied rows are excluded so a rejected passenger can request again.

**A seat's identity is immutable.** `trip_id`, `profile_id`, `guest_id` and `booked_by`
cannot be changed after the row exists — trigger `bookings_identity_guard`. Only the
comment, the preferred car and the seating move. Without this the booker could put someone
else in a seat they never booked, or drag a confirmed seat onto a trip its car is not on.

**Only the driver of the affected car may seat or unseat anyone**, on insert as well as
update — trigger `bookings_assignment_guard`. Ownership is required of the car the seat
*ends up in*, not merely of some car mentioned on the row.

**You cannot leave a trip while holding an active seat** — trigger
`trip_participants_leave_guard`. This is what makes check 7 below true rather than usually
true. It steps aside during a cascade, when the trip or the profile is being deleted
outright.

**Deleting a car releases its seats, it does not delete them.** Trigger
`trg_cars_release_seats`, `before delete on cars`:
`update bookings set car_id = null, status = 'pending' where car_id = old.id;`
Requests pointing at it fall back to `null` via `preferred_car_id on delete set null`.

Supporting indexes: `bookings(trip_id)`, `bookings(car_id)`, `bookings(preferred_car_id)`,
`cars(trip_id)`.

## Row Level Security

RLS is enabled on every table. The anon key is public — without policies the database is
world-writable. The policy set is deliberately one shape repeated.

Two `security definer` helpers keep the policies one-liners and avoid recursive lookups
into `profiles`:

```sql
create function is_admin() returns boolean language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create function owns_car(car uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from cars where id = car and driver_id = auth.uid());
$$;
```

| table | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | any authenticated | trigger only | self, or admin. **Only an admin may change `role`.** | admin |
| `guests` | any authenticated | `host_id = auth.uid()` | host, or admin | host, or admin |
| `trips` | any authenticated | any authenticated | `created_by = auth.uid()`, or admin | creator, or admin |
| `trip_participants` | any authenticated | `profile_id = auth.uid()`, or admin | — | self, or admin |
| `cars` | any authenticated | `driver_id = auth.uid()` and role in (`driver`,`admin`) | `driver_id = auth.uid()`, or admin | driver, or admin |
| `bookings` | any authenticated | `booked_by = auth.uid()` and occupant is self or own guest | see below | `booked_by = auth.uid()`, or admin |

`bookings` update splits by who is doing what:

- the booker may change `comment` and `preferred_car_id` on their own rows;
- `owns_car(car_id)` **or** `owns_car(preferred_car_id)` may set `status` and `car_id` —
  this is the driver confirming, denying, or manually assigning a seat in *their* car;
- admins may do either.

`anon` has no policy on any table and therefore no access.

## Notes and assumptions

- **`+1`s are not accounts.** The requirements list "+1 (guest)" among the roles, but a
  guest only needs to see the trip and their placement. Modelling them as records owned by
  their host avoids a second auth path. If guests later need their own view, the cheapest
  addition is a read-only share link per trip — no schema change to `guests`.
- **`seat_count` excludes the driver.** The driver is not a `bookings` row; a 5-seat car
  with the driver in it has `seat_count = 4`.
- **No soft deletes, no audit log.** A deleted trip takes its cars and seats with it.
