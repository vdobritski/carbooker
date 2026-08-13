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
