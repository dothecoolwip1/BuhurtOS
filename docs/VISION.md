# BuhurtOS

*The owner's north star, kept verbatim. When an architectural, design, navigation or implementation decision is unclear, check it against this document. How the project applies it is in `docs/PROJECT_SPEC.md` ("North star: how it is applied").*

BuhurtOS is meant to become the central digital home for the sport of buhurt.

The goal is much bigger than building a tournament website, a ranking database, a team management app, or an admin dashboard. Those are pieces of the product, but none of them individually define what BuhurtOS is.

BuhurtOS should connect the entire sport.

Today, information about buhurt is scattered across federation websites, tournament platforms, ranking websites, spreadsheets, Facebook pages, Discord servers, Google Drive folders, registration forms, messaging apps, videos, and word of mouth.

A fighter may have one place for tournament registration, another place for rankings, another place for their team, another place for rules, and another place to find their next event.

An organizer may be using spreadsheets, messages, paper checklists, multiple websites, and separate tournament software just to run one competition.

A spectator who discovers buhurt for the first time may have absolutely no idea where to start.

BuhurtOS should bring those disconnected pieces into one coherent ecosystem.

The long term vision is that someone interested in armored combat should be able to come to BuhurtOS and understand the sport, discover teams, find events, follow fighters, view results, watch fights, understand rankings, learn the rules, and find somewhere nearby to participate.

A fighter should be able to use the same platform to manage their sporting identity, team involvement, registrations, competition schedule, fight history, results, rankings, documents, notifications, and other parts of their participation in the sport.

A team should be able to use BuhurtOS as its operational home.

An organizer should be able to run an event from planning through registration, check in, safety inspections, brackets, scheduling, live competition, scoring, results, and publication without constantly moving between unrelated systems.

A marshal should be able to access exactly what matters during a fight without navigating through an administrative maze.

A governing organization should eventually be able to manage the structure of its sport, including teams, fighters, events, seasons, rulesets, officials, rankings, records, permissions, and historical information.

And the person operating BuhurtOS should be able to manage the platform without the administrative interface leaking into everyone else's experience.

## BuhurtOS should feel like one connected sporting world

The most important idea behind BuhurtOS is that everything should connect naturally.

A tournament should not exist separately from rankings.

A result recorded during a tournament should become part of the historical record automatically.

That result should contribute to the appropriate fighter, team, event, season, and ranking information without someone manually entering the same information into several different places.

A fighter should not exist as one record in a tournament, another record on a team roster, and another record in the rankings.

Where possible, those should represent the same sporting identity.

A team should have a history.

A fighter should have a career.

An event should leave behind a permanent sporting record.

A season should tell a story.

BuhurtOS should gradually become the system that connects all of those things.

## BuhurtOS must work for people who know nothing about buhurt

The public experience is extremely important.

BuhurtOS cannot be designed only for experienced fighters who already understand words like lyst, melee, marshal, profight, or armor inspection.

Someone should be able to discover BuhurtOS after seeing one armored combat video and immediately understand what they are looking at.

The public side should make buhurt feel like a legitimate international sport.

Teams should feel like real sporting organizations.

Fighters should feel like athletes rather than database entries.

Events should feel exciting and understandable.

Rankings should have context.

Results should tell the viewer what actually happened.

Rules should be understandable.

There should always be a clear path for someone thinking:

"What is this?"

"Where can I watch it?"

"Who are these fighters?"

"Is there a team near me?"

"How do I try this?"

BuhurtOS should help turn curiosity into participation.

## The sport should come before the software

Users should not have to understand BuhurtOS in order to use BuhurtOS.

The software should adapt to the sport.

A captain should think about their team, not database tables.

An organizer should think about their event, not administrative modules.

A marshal should think about the current fight.

A fighter should think about their next competition.

A spectator should think about who is fighting and what is happening.

The interface should reflect those mental models.

People should enter the thing they are working with.

Open a team and the team becomes the workspace.

Open an event and the event becomes the workspace.

Open a fighter and the fighter's sporting identity becomes the focus.

The user should not have to travel through a giant global navigation system to locate every possible function.

Permissions may be complicated underneath the application.

The experience should not feel complicated.

## BuhurtOS must serve several completely different audiences

There is no single BuhurtOS user.

There are spectators.

There are new people discovering the sport.

There are fighters.

There are team captains.

There are team administrators.

There are coaches.

There are marshals.

There are scorekeepers.

There are event organizers.

There are governing organizations.

There are platform administrators.

One person may even hold several of those roles.

BuhurtOS should recognize that each of those people has different priorities.

The public experience should be visually exciting and extremely easy to explore.

The fighter experience should feel personal and mobile.

The team experience should focus on people, participation, events, and team operations.

The event experience should feel like mission control for a competition.

The marshal experience should be extremely fast and focused.

The federation experience should prioritize organization, oversight, records, and consistency.

The platform administration experience should be powerful but restrained.

Do not force all of these audiences into the same interface simply because they share the same backend.

## Mobile is not a secondary version of BuhurtOS

Buhurt is a physical sport.

People will use this software beside a lyst.

They will use it while wearing armor.

They will use it in a bullpen.

They will use it at registration tables.

They will use it while walking through an event venue.

They will use it from hotel rooms, parking lots, practices, workshops, and tournament floors.

Many people will rarely use BuhurtOS from a desktop computer.

Mobile therefore needs to be considered one of the primary versions of the product.

The mobile interface should not simply be a compressed desktop dashboard.

It should prioritize immediate actions, readable information, large touch targets, simple navigation, contextual controls, and minimal unnecessary information.

A marshal should be able to operate important controls with one hand.

A captain should be able to check their roster quickly.

A fighter should immediately see where they need to be and when.

An organizer should see what requires attention now.

## Events should feel alive

One of the biggest opportunities for BuhurtOS is creating an event experience specifically designed for armored combat.

A tournament is not just a record with a start date and a bracket.

It is an active environment.

There are fighters arriving.

Teams registering.

Armor being inspected.

Weapons being inspected.

People being checked in.

Schedules changing.

Lysts running ahead or behind.

Teams being called to bullpen.

Matches happening.

Scores being entered.

Penalties being issued.

Results being confirmed.

Spectators following what happens next.

BuhurtOS should understand this rhythm.

During an active event, the system should prioritize what is happening now, what is happening next, and what needs attention.

The software should help the event move.

It should never become another obstacle the organizer has to manage.

## BuhurtOS should understand buhurt natively

This product should not feel like generic tournament software that happens to have medieval terminology added to it.

BuhurtOS should understand the structure of armored combat.

Different combat formats should be first class concepts.

Different rulesets should be first class concepts.

Teams, fighters, mercenaries, national teams, categories, melees, duels, profights, marshals, lysts, inspections, penalties, seasons, rankings, and historical results should all be modeled in ways that actually make sense for the sport.

BuhurtOS should support different organizations and rulesets without assuming that one organization controls the entire sport.

Buhurt International, HACSA, IMCF, independent organizations, national organizations, local clubs, and future organizations should be able to exist without forcing the entire world into one rigid hierarchy.

Geography and governance should also remain separate concepts.

A team being located in Canada does not automatically establish which organization governs it.

The system should represent what is actually known rather than inventing relationships.

## BuhurtOS should become a historical record of the sport

Over time, BuhurtOS should become more valuable simply because events continue happening.

Old tournaments should remain accessible.

Past brackets should remain accessible.

Team histories should grow.

Fighter histories should grow.

Rankings should have context across seasons.

Ruleset versions should remain traceable.

Results should retain their sources.

Videos should be connectable to fights.

Records should become meaningful.

Buhurt currently loses a tremendous amount of history because information disappears into social media posts, spreadsheets, temporary tournament systems, or websites that eventually vanish.

BuhurtOS should help preserve that history.

## Real data matters

BuhurtOS should never create fake sporting history merely to make the interface look populated.

Imported information should retain its source.

Official information should be distinguishable from imported information.

Unverified information should be identifiable as such.

If two sources disagree, the disagreement should not simply be hidden.

A public roster entry is not automatically a BuhurtOS user account.

A team appearing in the directory does not mean the team has officially adopted BuhurtOS.

A governing organization's information appearing inside BuhurtOS does not mean that organization endorses BuhurtOS.

Credibility matters.

The platform should earn trust by being transparent about where information came from.

## BuhurtOS needs to be useful before major organizations adopt it

The product cannot depend on Buhurt International, HACSA, IMCF, or another large organization deciding to officially adopt BuhurtOS.

It should create value from the bottom up.

A single fighter should find it useful.

A single team should find it useful.

A small local tournament should find it useful.

A marshal should find the rules reference useful.

A spectator should find the public directory useful.

If larger organizations eventually choose to use the platform, BuhurtOS should already be capable of supporting them.

But adoption by a major federation should be a result of usefulness, not a requirement for usefulness.

## BuhurtOS should make the sport feel more professional without removing its identity

This should not look like generic corporate software.

It should feel like armored combat.

The public experience can have energy, photography, movement, strong typography, competition, steel, impact, history, and personality.

At the same time, it should not become cheesy medieval fantasy software.

This is a real modern combat sport.

The visual identity should communicate that.

The administrative tools can be calmer and more functional.

The event control interfaces should be exceptionally clear.

The public side can be much more cinematic.

These areas can share a design language without being visually identical.

## The product should reduce work rather than creating new work

Every feature should be judged by whether it removes duplication.

If an organizer records a result, they should not need to enter it somewhere else later.

If a fighter updates information, the relevant parts of the platform should update appropriately.

If an event schedule changes, everyone who depends on that schedule should see the change.

If a team updates its roster, organizers should not need to reconstruct that roster manually.

If rules change, previous rules versions should remain historically traceable while current events use the correct version.

BuhurtOS should gradually replace administrative repetition with connected information.

## The platform should feel obvious

A successful BuhurtOS experience should require very little explanation.

Someone should know where they are.

They should understand what matters.

They should understand what they can do.

They should understand what happens next.

The application should use plain language whenever possible.

Complexity belongs inside the system, not in front of the user.

Avoid enormous menus.

Avoid exposing database structure as navigation.

Avoid pages filled with unrelated cards simply because information exists.

Avoid dashboards that exist only to look like dashboards.

Avoid forcing users through several screens for simple actions.

Avoid visual clutter.

Give important information hierarchy.

Give actions context.

Give users confidence that they are changing the correct team, event, organization, or profile.

## The ultimate goal

BuhurtOS should eventually be the place someone thinks of when they think about participating in or following buhurt.

If someone wants to find a team, they go to BuhurtOS.

If someone wants to find an event, they go to BuhurtOS.

If someone wants to know who a fighter is, they go to BuhurtOS.

If someone wants historical results, they go to BuhurtOS.

If someone wants rankings, they go to BuhurtOS.

If someone wants to understand a rule, they go to BuhurtOS.

If a captain needs to manage their team, they open BuhurtOS.

If an organizer needs to run a tournament, they open BuhurtOS.

If a marshal needs information during a fight, they open BuhurtOS.

If a fighter wants to know what is happening next, they open BuhurtOS.

The product should aim to become infrastructure for the sport rather than simply another website used by the sport.

That is the north star.

When making architectural, design, navigation, or implementation decisions, do not ask only:

"Does this feature work?"

Ask:

"Does this make BuhurtOS feel closer to being the connected operating system for the sport of buhurt?"

If it does not, reconsider the decision.
