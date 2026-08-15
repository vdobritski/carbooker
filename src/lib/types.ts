// Row types mirroring supabase/migrations. When a migration changes a table, change this
// file in the same edit. See docs/data-model.md for the schema these must match.
//
// `*Row` types are the shape Postgres returns (snake_case). The plain types are what the
// app uses (camelCase). src/api/* does the mapping.

// Site-wide, and two values since 017: `admin` may do anything anywhere, `user` is
// everyone else. Whether somebody drives is per group - see TravelRole below.
export type Role = 'admin' | 'user'

// 001_profiles.sql
export interface ProfileRow {
  id: string
  display_name: string
  photo_url: string | null
  description: string | null
  role: Role
  created_at: string
}

export interface Profile {
  id: string
  displayName: string
  photoUrl: string | null
  description: string | null
  role: Role
  createdAt: string
}

// 003_trips.sql, group_id added by 015_trips_in_groups.sql
// Dates are plain 'YYYY-MM-DD' strings, never Date objects - parsing them shifts the day
// in any timezone behind UTC.
export interface TripRow {
  id: string
  group_id: string
  name: string
  description: string | null
  plan: string | null
  starts_on: string | null
  ends_on: string | null
  created_by: string | null
  created_at: string
}

export interface Trip {
  id: string
  /** The group the trip belongs to. Immutable: a trip never moves to another group. */
  groupId: string
  name: string
  description: string | null
  plan: string | null
  startsOn: string | null
  endsOn: string | null
  createdBy: string | null
  createdAt: string
}

/** How the trips list reads a trip: the card says which group it is in. */
export interface TripWithGroup extends Trip {
  groupName: string
}

// 007_bookings.sql
// One row per seat. car_id is set if and only if status is 'confirmed'.
export type BookingStatus = 'pending' | 'confirmed' | 'denied'

export interface Booking {
  id: string
  tripId: string
  /** Set when the occupant is a registered user. Exactly one of this and guestId. */
  profileId: string | null
  /** Set when the occupant is a +1. */
  guestId: string | null
  bookedBy: string
  /** The confirmed car. Null unless status is 'confirmed'. */
  carId: string | null
  preferredCarId: string | null
  status: BookingStatus
  comment: string | null
  createdAt: string
  updatedAt: string
}

/** How the UI reads a seat: with the occupant's name resolved. */
export interface BookingWithOccupant extends Booking {
  occupantName: string
  isGuest: boolean
  /** For a +1, the profile id of the host who brought them. */
  guestHostId: string | null
}

// 006_guests.sql
// A guest is a name owned by a host, not a login.
export interface GuestRow {
  id: string
  host_id: string
  name: string
  note: string | null
  created_at: string
}

export interface Guest {
  id: string
  hostId: string
  name: string
  note: string | null
  createdAt: string
}

// 005_cars.sql
export interface CarRow {
  id: string
  trip_id: string
  driver_id: string
  title: string
  description: string | null
  features: string[]
  seat_count: number
  created_at: string
}

export interface Car {
  id: string
  tripId: string
  driverId: string
  title: string
  description: string | null
  features: string[]
  /** Passenger seats, not counting the driver. */
  seatCount: number
  createdAt: string
}

/** How the UI always reads a car: nobody wants a bare driver_id on screen. */
export interface CarWithDriver extends Car {
  driverName: string
  driverPhotoUrl: string | null
}

// 021_saved_cars.sql
// A person's garage. A saved car is a template: registering it on a trip copies its fields
// into a new `cars` row and the two are unrelated afterwards. There is no `carId` here and
// no `savedCarId` on Car - nothing syncs them, on purpose.
export interface SavedCarRow {
  id: string
  owner_id: string
  title: string
  description: string | null
  features: string[]
  seat_count: number
  created_at: string
}

export interface SavedCar {
  id: string
  ownerId: string
  title: string
  description: string | null
  features: string[]
  /** Passenger seats, not counting the driver. */
  seatCount: number
  createdAt: string
}

// 004_trip_participants.sql
// Always read joined to the profile - a bare participant row is just two ids and the UI
// never wants it on its own. No `role`: it used to carry profiles.role so the list could
// badge drivers, and since 017 that value can only be 'admin' or 'user'. Who drives is a
// fact about a group membership, not about the person.
export interface ParticipantWithProfile {
  profileId: string
  joinedAt: string
  displayName: string
  photoUrl: string | null
}

// 012_groups.sql
// What a member may do in one group. There is no role enum: ownership is a column on the
// group, everything else is a per-member boolean, and the three switches are independent.
export type TravelRole = 'driver' | 'passenger'

export interface GroupRow {
  id: string
  name: string
  description: string | null
  owner_id: string | null
  created_at: string
}

export interface Group {
  id: string
  name: string
  description: string | null
  /** Null only if the owner's account was deleted; a site admin can set a new one. */
  ownerId: string | null
  createdAt: string
}

export interface GroupMemberRow {
  group_id: string
  profile_id: string
  can_create_trips: boolean
  can_manage_trips: boolean
  can_manage_members: boolean
  travel_role: TravelRole
  joined_at: string
}

/** How the roster reads a membership: a bare row is two ids and four flags. */
export interface GroupMemberWithProfile {
  groupId: string
  profileId: string
  canCreateTrips: boolean
  /** Edit and delete anybody's trip in this group, and manage what is on it. */
  canManageTrips: boolean
  /** Invites, access requests, removing members, travel roles. Not granting switches. */
  canManageMembers: boolean
  travelRole: TravelRole
  joinedAt: string
  displayName: string
  photoUrl: string | null
}

// 019_group_access.sql
// The invite link: one row per group, or none. Only somebody with can_manage_members (and
// the owner, and a site admin) can read it - the token is the link, so a plain member
// reading it could re-share the group.
export interface GroupInviteRow {
  group_id: string
  token: string
  created_by: string | null
  created_at: string
}

export interface GroupInvite {
  groupId: string
  token: string
  createdBy: string | null
  createdAt: string
}

/** Rejected rather than deleted, so the requester learns the answer. */
export type JoinRequestStatus = 'pending' | 'rejected'

export interface GroupJoinRequestRow {
  group_id: string
  profile_id: string
  status: JoinRequestStatus
  note: string | null
  created_at: string
}

export interface GroupJoinRequest {
  groupId: string
  profileId: string
  status: JoinRequestStatus
  note: string | null
  createdAt: string
}

/** How the queue reads a request: accepting somebody whose name you cannot see is blind. */
export interface JoinRequestWithProfile extends GroupJoinRequest {
  displayName: string
  photoUrl: string | null
}
