// Row types mirroring supabase/migrations. When a migration changes a table, change this
// file in the same edit. See docs/data-model.md for the schema these must match.
//
// `*Row` types are the shape Postgres returns (snake_case). The plain types are what the
// app uses (camelCase). src/api/* does the mapping.

export type Role = 'admin' | 'driver' | 'user'

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

// 003_trips.sql
// Dates are plain 'YYYY-MM-DD' strings, never Date objects - parsing them shifts the day
// in any timezone behind UTC.
export interface TripRow {
  id: string
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
  name: string
  description: string | null
  plan: string | null
  startsOn: string | null
  endsOn: string | null
  createdBy: string | null
  createdAt: string
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

// 004_trip_participants.sql
// Always read joined to the profile - a bare participant row is just two ids and the UI
// never wants it on its own.
export interface ParticipantWithProfile {
  profileId: string
  joinedAt: string
  displayName: string
  photoUrl: string | null
  role: Role
}
