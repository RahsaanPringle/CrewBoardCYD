It looks like we have logins (UserID and Password) for the users in the config, but we don't have them for the roster.
The crew roster needs to be able to log in.
We also need to add another section for customers.

Customers don't get to log in.

Crew Members (roster) and customers need to reference the locations table, or in some way be able to have their latitude and longitude show up on the map.

At some point, we'll want to use an API to tie the addresses in with Latitude and Longitude, so it might make sense to keep the lat/lon in a single table and reference them from the address table(s)