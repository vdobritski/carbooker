import { drivesCar } from '../lib/authority'
import type { BookingWithOccupant, CarWithDriver } from '../lib/types'

interface Props {
  car: CarWithDriver
  /** Confirmed seats in this car. */
  seats: BookingWithOccupant[]
  /** Resolves a +1's host to a name, from people already loaded for the trip. */
  hostName: (hostId: string) => string
  currentUserId: string | null
  isAdmin: boolean
}

/**
 * A car's seats: who is in them, and how many are left. There is no seat map - a car has
 * N interchangeable places, so the empty ones are just placeholders.
 */
export default function SeatGrid({ car, seats, hostName, currentUserId, isAdmin }: Props) {
  const empty = Math.max(0, car.seatCount - seats.length)

  return (
    <ul className="seats">
      {seats.map((seat) => {
        // The comment is for the people it concerns: the driver of this car, whoever
        // booked the seat, its occupant, and admins.
        const mayReadComment =
          isAdmin ||
          drivesCar(car, currentUserId) ||
          seat.bookedBy === currentUserId ||
          seat.profileId === currentUserId

        return (
          <li key={seat.id} className="seat taken">
            <span>
              {seat.occupantName}
              {seat.isGuest && seat.guestHostId && (
                <span className="muted"> (+1 of {hostName(seat.guestHostId)})</span>
              )}
            </span>
            {mayReadComment && seat.comment && (
              <span className="muted seat-note">{seat.comment}</span>
            )}
          </li>
        )
      })}

      {Array.from({ length: empty }, (_, i) => (
        <li key={`empty-${i}`} className="seat empty">
          <span className="muted">free seat</span>
        </li>
      ))}
    </ul>
  )
}
