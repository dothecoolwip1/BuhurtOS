# Clickable admin mock: retired
The sample-data admin mock (`/admin/*`, `src/admin/`) was reviewed and removed; it only ever held invented data.
Its flows now run on real data inside the event workspace at `/events/:slug/manage`.
Tabs: Review (registrations), Check-in, Run (the day), Setup (event, fee, waiver, volunteer note), People (staff), Teams.
To compare with the old mock, look at the commit history from before its removal.
