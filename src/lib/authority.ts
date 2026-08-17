import type { GroupRights } from '../api/groups'
import type { Trip } from './types'

/**
 * "May I run this trip?" — the client-side mirror of the `manages_trip(uuid)` SQL helper.
 *
 * The database expands to `created_by = auth.uid() or can_manage_trips_in(group_id)`, and
 * `can_manage_trips_in` folds in the group owner and site admins. Every policy under a
 * trip — cars, bookings, participants — asks that one question, so the UI asks it in one
 * place too. Writing the expression out per page is how a screen ends up hiding a button
 * for something the database would happily allow, which is exactly what happened to
 * CarDetail.
 *
 * `rights` is null when the caller is not a member of the trip's group, which only happens
 * for a site admin — hence the isAdmin branch standing on its own.
 */
export function managesTrip(
  trip: Pick<Trip, 'createdBy'>,
  rights: GroupRights | null,
  userId: string | null,
  isAdmin: boolean,
): boolean {
  return (
    isAdmin ||
    (userId !== null && trip.createdBy === userId) ||
    rights?.canManageTrips === true ||
    rights?.isOwner === true
  )
}
