import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CarWithDriver } from '../lib/types'

interface Props {
  car: CarWithDriver
  /** Confirmed seats taken, derived from the same bookings the layout draws. */
  seatsTaken: number
  children?: ReactNode
}

export default function CarCard({ car, seatsTaken, children }: Props) {
  return (
    <li className="card">
      <Link to={`/trips/${car.tripId}/cars/${car.id}`}>
        <strong>{car.title}</strong>
      </Link>

      <p className="muted">
        {car.driverName} · {seatsTaken} / {car.seatCount} seats taken
      </p>

      {car.description && <p>{car.description}</p>}

      {car.features.length > 0 && (
        <p className="chips">
          {car.features.map((f) => (
            <span key={f} className="badge">
              {f}
            </span>
          ))}
        </p>
      )}

      {children}
    </li>
  )
}
