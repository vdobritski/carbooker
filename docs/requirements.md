Create a simple, lightweight, low-load system for booking car places in trips trips (for a small group of friends).

Basic functionality should allow:

1.  Create trip
    
2.  Add drivers and cars with amount of available places
    
3.  users can simply authorize just to identify itself
    
4.  users can book place for themselves and optional amount of +1's (person should be specified and mark as one's +1 for future manipulations/permutation)
    
5.  user can optionally specify the preferable car, but the driver should confirm
    

Roles:

1.  Admin with global rights to manage everything (including roles)
    
2.  Driver:
    
    1.  can register his car in specific trip
        
    2.  can assign people from list of trip perticipants to places in his car manually
        
    3.  can providee some description of the car with list of features, like (fridge in the car for food and bevarages, grill, opening roof etc.)
        
3.  User/passenger (default after registration):
    
    1.  can open trip details and see the current layout of users and places available
        
    2.  can book a place for itself and specified +1s
        
    3.  can select a preferred car
        
    4.  can provide some comments for additional information (health condition, special requirements or also something it can provide to be more helpful)
        
4.  +1 (a.k.a guest)
    
    1.  can just see trips details and it's placement in car
        
    2.  should be marked as specific passanger +1

Entities:
 1. User itself:
	 1. Has name/alias
	 2. optional photo
	 3. some description
	 4. list of +1's 
	 5. role/permissions level
 2. Trip:
	 1. Name
	 2. Description
	 3. Plan
	 4. List of cars
	 5. List of users
	 6. Bookings
 3. Car:
	 1. Driver
	 2. Description
	 3. Fratures
	 4. Seat count
 4. Booking:
	 1. User
	 2. Car
	 3. Trip
	 4. Status (confirmed/under review/denied) 

---

# Phase 2 — groups

Everything above is the original statement of scope and is left as written. It was built
and deployed (tasks 00–13). This section records what changed after it, and supersedes the
original where the two disagree — in particular the global `Driver` role, which no longer
exists.

## Groups

Users belong to **groups**, like group chats. A trip belongs to exactly one group.

1. Any user can create a group. Whoever creates it owns it.
2. A trip belongs to one group, and only that group's members can see it. To everyone else
   it does not exist: not in any list, and a direct link says "not found".
3. Non-members see **nothing** about a group — not its trips, not its roster, not the names
   of the people in it. A brand-new account with no groups sees only itself. The single
   exception: somebody who opens a group's link sees its **name**, so they know what they
   are asking to join. Not its description, and no way to list other groups.
4. A member sees the group's trips and joins them. Creating trips needs a permission.
5. Getting in happens two ways and no other:
   - an **invite link** — a hard-to-guess token; anyone signed in who opens it joins;
   - an **access request** — somebody sent the plain group link asks to be let in, and
     whoever manages members accepts or declines.

## Roles and permissions

The `Admin` role from the original list stays, and stays global: one site administrator who
can do anything. `Driver` and `User/passenger` move inside the group.

1. **Owner** — one per group, the creator until they hand it over. Manages everything:
   trips, bookings, members, permissions. Can transfer the group or delete it.
2. **Permissions** are switched on per member, individually and independently, by the owner:
   - *create trips* — start a trip in this group;
   - *manage trips* — edit and delete anybody's trip, and move or cancel the seats and cars
     on it;
   - *manage members* — invite, accept and decline requests, remove members, set travel
     roles.

   Whoever created a trip runs that trip — its cars, its seats, its participants — without
   needing *manage trips*, which is the right over everybody else's.
3. **Travel role** — each member is a *driver* or a *passenger* in that group. A driver may
   register a car on the group's trips. This replaces the global `Driver` role: the same
   person can drive with one group of friends and not with another.
4. A `+1` is still not an account and is not a group member. They come along on their
   host's membership.

## Cars

Cars are **kept on the person**, not invented per trip: a garage on the profile page, and
a picker when registering a car on a trip. Registering copies the car onto the trip, so a
trip's seat count is fixed for that trip.
