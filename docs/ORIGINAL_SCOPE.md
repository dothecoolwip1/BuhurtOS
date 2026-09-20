# BuhurtOS Original Product Scope

This document is the authoritative baseline for BuhurtOS. It consolidates the original BTMS planning decisions recovered from prior project discussions and should be used as the acceptance checklist for future implementation.

## Product Goal

BuhurtOS is not only a bracket or scoring app. It is intended to be a complete, mobile-first operating system for running Buhurt organizations, seasons, events, fighters, teams, marshals, scoring, live spectators, registration, compliance, standings, discipline, and event operations.

The product should be HACSA-first while remaining multi-organization and globally scalable.

## Platform and Architecture

- React + TypeScript application
- Mobile-first PWA
- PC, Android, iPhone and tablet compatible
- Offline-capable field workflows
- Local persistence for unsynced work
- Queued writes and background synchronization
- Conflict-safe recovery for simultaneous marshal use
- Realtime updates
- Supabase/PostgreSQL/Auth/Realtime/Storage/RLS backend
- UTC timestamps with local timezone conversion
- Internationalization/localization-ready
- Multi-tenant organization isolation
- Audit logging from Day 1
- Future payment/subscription readiness
- No fragile drag-and-drop for critical field controls
- High contrast, sunlight-readable UI
- Oversized touch targets for gloves/muddy field conditions
- Fast, minimal-step scoring and marshal workflows

## Hierarchy and Core Data Model

Organization
→ Season
→ Event
→ Fight Card / List
→ Pool / Bracket
→ Match

Supporting entities:

- Teams
- Fighters
- Ghost / guest / mercenary fighters
- Event roster entries
- Match participants and team lineups
- Match rounds
- Discipline records
- Suspensions
- Fight notes
- Announcements
- Registrations
- Waivers
- Payments
- Audit records

A Season table is required from Day 1 so event history, rankings, discipline and standings can be archived correctly.

Every operational table should support audit metadata such as created_at, updated_at, created_by and last_edited_by where applicable.

## Roles and Permissions

Required layered roles:

- Platform super admin
- Platform staff
- Organization admin
- Organization staff
- Event organizer
- Field marshal
- Assistant marshal
- Team captain
- Fighter
- Public spectator without login

Permissions must be scoped by platform, organization, event and participant/team context.

Team captains must only see or modify team-scoped private information belonging to their own team.

Fighters should have self-service access to their own profile and relevant schedules/results.

## Event Types

BuhurtOS must support more than ranked tournaments.

Required modes include:

- Ranked competitive
- Event-only competitive
- Non-ranked demo / fun event
- Exhibition
- Clinic / training
- Hybrid event
- Future custom event types

Standings behavior must be separate from event type so demos or exhibitions never contaminate official season standings.

## Duel Formats

Original supported duel categories include:

- Longsword
- Sword and Shield
- Sword and Buckler
- Sword and Sword
- Saber
- Greatsword
- Polearm
- Long Axe
- Profight
- Triathlon

Standard duels:

- One-minute rounds
- Most points wins a round
- Best-of round structure determines match winner
- Strict guided scoring validation

Sword and Buckler:

- First to 5 points wins a round
- First to 2 rounds wins the match

Profight and Triathlon:

- Must support event-specific rules
- Buhurt International rules
- Local/custom overrides

Scoring must be ruleset-driven rather than hard-coded to one format.

## Melee Formats

Required melee formats include:

- 3v3
- 5v5
- 10v10
- 12v12

Base melee result model:

- Last team standing
- Team lineups
- Per-side roster membership
- Round wins
- Configurable best-of structure
- Forfeits and withdrawals
- Safety/compliance gating before activation

## Marathon

Marathon must be a configurable format supporting:

- Best-of-X configurations
- Timed endurance formats
- Event-specific/local rules

## Pools and Brackets

Bracket capability is a launch requirement, not a future add-on.

Required:

- Visual brackets
- Pools feeding brackets
- Single elimination
- Double elimination
- Round-robin/pool stages
- Pools-to-bracket progression
- Automatic winner advancement
- Automatic pool winner advancement
- Byes
- Correct BYE handling without BYE-vs-BYE matches
- Participant locking after results
- Manual placement overrides
- Seeding
- Intelligent seeding
- Anti-fratricide seeding to avoid teammates meeting early where possible
- Manual override of automated seeding
- Bracket locking
- Bracket-ready relational database links for winner and loser progression

## Fight Card and Field Operations

Required field workflow:

- Ordered fight card
- Safe Up / Down reordering instead of critical drag-and-drop
- Current fight
- On Deck
- In the Hole
- Bullpen view
- Multi-list / multi-field assignment
- Multiple marshals working at the same time
- Conflict-safe live updates
- Forfeit handling
- Match activation and completion controls
- Clear visual status for field readiness
- Post-match validation before finalization

## Registration and Event Intake

Required registration system:

- Public registration without account requirement where appropriate
- Event registration opening/closing
- Categories/divisions
- Team affiliation
- Guest/mercenary support
- Approval / rejection / waitlist workflow
- Transactional approval into permanent team/fighter/roster records
- Duplicate fighter/ghost detection
- Ghost fighter linking/merging into permanent fighter identities
- Waiver acknowledgement
- Private waiver uploads
- Registration payment readiness
- Payment status
- Future monthly, annual or one-time product payment support

## Check-in and Safety Compliance

Per-event roster readiness must support:

- Registered
- Approved
- No-show
- Late
- Withdrawn
- Checked in
- Armor cleared
- Medical cleared
- Waiver confirmed
- Weigh-in cleared

Competition must be blocked when required compliance checks are incomplete.

## Teams and Fighters

Required:

- Reusable team records
- Reusable fighter records
- Fighter profiles
- Team profiles
- Team membership
- Fighter event history
- Fighter season history
- Ghost/guest/mercenary fighter identities
- Later merge of temporary identities into permanent fighters without losing historical references
- Captain team-scoped access
- Fighter self-service
- Schedules and results relevant to the fighter

## Standings and Rankings

Required:

- Event standings
- Season standings
- Separation of ranked and non-ranked events
- Correct exclusion of byes
- Configurable standings/ranking logic
- Historical season archive
- Team and/or fighter standings as required by ruleset
- Future analytics around performance and participation

## Discipline and Safety History

Required:

- Yellow cards
- Red cards
- Fighter-level discipline history
- Event-level discipline history
- Season-level discipline history
- Suspensions
- Reasons and notes
- Issuing marshal/admin
- Match reference where applicable
- Repeat-offense visibility for authorized staff

## Fight Notes and Comments

Required:

- Private notes
- Team-only notes
- Marshal-visible notes
- Team captain isolation
- Match-linked comments/notes
- Access rules enforced in the backend, not only hidden in UI

## Public Spectator Experience

No login should be required for public spectator surfaces.

Required public pages:

- Event page
- Live scoreboard
- Current match
- On Deck / upcoming match
- Schedule
- Fight card
- Pools
- Visual brackets
- Event standings
- Relevant season standings
- Announcements
- Livestream
- YouTube/Twitch/etc. embedding where supported
- Read-only fighter/team/event information appropriate for public display
- Shareable public links
- Embeddable widgets for websites/streams where practical

## Event Management

Required organizer tools:

- Event settings
- Ruleset selection
- Event-type configuration
- Standings mode
- Registration settings
- Stream settings
- Announcements
- Participant management
- Fight-card management
- Pool/bracket management
- Marshal assignments
- Team captain assignments
- Event publishing and archiving
- Multi-field/list configuration

## Announcements

Required:

- Public announcements
- Internal operational announcements
- Scheduling where appropriate
- Realtime delivery to active event views

## Exports and Reporting

Required:

- CSV exports
- PDF/printable reports
- Event results
- Standings
- Rosters
- Fight cards
- Brackets
- Discipline records where permissions allow
- Registration/admin reports
- Future analytics/reporting

## Offline and Realtime Requirements

Offline support is a core product requirement.

Required:

- Local persistence
- Queue of unsynced actions
- Background retry
- Automatic sync when connection returns
- Visible sync state
- Conflict detection
- Manual retry/discard where needed
- No silent overwrite of newer marshal changes
- Multi-device and cross-device synchronization
- Realtime event updates
- Recovery from interrupted sync
- No loss of critical scoring/result actions

## Auditability

Important changes must be attributable.

Required audit coverage includes:

- Match result changes
- Match state changes
- Roster/compliance changes
- Bracket creation/changes
- Discipline
- Registration decisions
- Event membership/role changes
- Announcements
- Important administrative changes

## UX Requirements

- Mobile-first
- Works well on phones, tablets and desktop
- Bright-sun readability
- Large buttons
- Gloves-friendly
- Minimal typing during live fights
- Minimal navigation during marshal work
- Guided scoring
- Explicit confirmation for irreversible/final results
- No critical drag-and-drop dependency
- Clear offline/online/sync indicators
- Fast bullpen visibility
- Clear competitor readiness state
- Public UI separated from operational/admin UI

## Current Rebuild Gap Warning

The September 20, 2026 standalone rebuild contains only part of this scope.

Present or partially present:

- Organization / season / event hierarchy
- Basic roles and RLS scaffolding
- Basic marshal fight queue
- On Deck / In the Hole / Active states
- Basic duel scoring
- Basic Sword and Buckler configuration
- Basic team-fight scoring structure
- Single-elimination bracket generation
- Anti-fratricide logic
- Bye auto-advancement
- Basic event standings
- Compliance gate
- Ghost fighter creation
- Basic discipline cards
- Basic fight notes
- Basic public event page
- Basic registration/waiver/payment hooks
- Offline queue
- Realtime hooks
- Audit schema/RPC groundwork
- CSV/print standings export

Missing or substantially incomplete:

- Full original ruleset library
- All duel weapon categories in UI/configuration
- Full melee formats and team lineup workflows
- Marathon
- Full Profight/Triathlon handling
- Double elimination
- Full pools and pools-to-bracket workflow
- Manual bracket placement/override/locking
- Multi-field/multi-list operations
- Proper event settings UI
- Announcements management UI
- Full participant management
- Ghost/mercenary merge workflow
- Registration review/approval/waitlist/rejection workflow
- Transactional registration-to-fighter/team/roster approval
- Real payment implementation/hardening
- Full waiver review/admin flow
- Suspensions
- Full season discipline handling
- Fighter self-service profiles
- Team profiles
- Fighter/team history
- Full event/season ranking system
- Public schedule/pools/full bracket/standings experience
- Embeddable widgets
- Broader comments/community features originally discussed
- Analytics
- Expanded exports/reports
- Localization UI
- Multi-field marshal workflow
- Full production conflict-resolution UI
- Full production backend deployment
- Complete end-to-end regression coverage

This file must remain the source of truth until each original requirement is either completed or explicitly removed by the product owner.


## Organization, Team, Captain, and Member Self-Service

BuhurtOS must support a delegated organization and team management model so HACSA does not need to manually maintain every team and fighter.

### Organization-controlled team creation

Authorized organization administrators must be able to:

- Create new teams inside their organization
- Approve or disable teams
- Assign or replace team captains
- Maintain team status, region, logo, public description, colours, links, and contact information
- View team rosters and tournament participation
- Transfer team administration when leadership changes
- Preserve historical team records even when a team is renamed or leadership changes

Teams remain owned by the organization, not by an individual captain account.

### Team captain roster management

Authorized team captains must be able to:

- Invite existing BuhurtOS members to join their team
- Invite people who do not yet have a BuhurtOS account
- Add temporary or pending members
- Remove members from the active roster without deleting historical records
- Assign member roles where permitted
- Review team membership requests
- Confirm or reject team affiliation requests
- Manage team tournament lineups
- Add guest or mercenary fighters for an event
- See fighter eligibility and event registration status
- Never gain access to private information belonging to another team

Team membership changes must be auditable and historical membership periods should be preserved.

### Member and fighter self-service profiles

Every member should be able to maintain their own personal profile without requiring a captain or HACSA administrator to edit it for them.

Self-service profile fields should support:

- Display name
- Legal name where required for private administrative use
- Fighter name / nickname
- Profile photo
- Additional gallery photos
- Biography
- Home region
- Team affiliation
- Preferred weapons / divisions
- Height and weight where the fighter chooses to provide them and where appropriate
- Social links
- Achievements
- Experience
- Certifications or qualifications where relevant
- Emergency/medical information only where specifically required, with strict private access controls
- Public/private visibility settings for individual profile fields

Members must be able to upload, replace, reorder, and remove their own profile photos.

### Public fighter profiles

A fighter may choose to expose a public sports profile containing appropriate information such as:

- Profile photo
- Fighter name
- Team
- Region
- Categories competed in
- Career record
- Season record
- Tournament history
- Placements and podiums
- Upcoming public events
- Achievements
- Public biography
- Selected public photos

Private contact, waiver, medical, emergency, login, and administrative information must never appear on the public profile.

### Identity and historical integrity

The fighter account, fighter record, and team membership must remain separate concepts.

A fighter changing teams must not create a new fighter identity or reset their career history.

Historical results must continue to show the team the fighter represented at the time of the event while the current profile may show their current team.

Temporary/ghost fighters must be mergeable into a permanent member profile without losing past match, bracket, discipline, or standings references.

### Suggested onboarding flow

1. HACSA or another authorized organization creates/approves a team.
2. The organization assigns one or more team captains.
3. A captain invites members by email or shareable invite link.
4. The member creates/signs into their BuhurtOS account.
5. The member builds their personal fighter profile and uploads photos.
6. The member accepts the team invitation.
7. The captain confirms the roster relationship where required.
8. The fighter can register for events and their future results attach to the same permanent fighter record.

This delegated model is a core product requirement for BuhurtOS.
