#!/usr/bin/env python3
"""Writes the LOCAL fixture SQL for supabase/manual/test_delete_test_events.sh (LOCAL THROWAWAY POSTGRES ONLY).

Input: a JSON export of the two test events' rows from hosted, taken read-only (one SELECT, 2026-10-07), with private columns left out
(registration_private keeps only registration_id; fighters, teams and the organization keep only identity columns; Auth accounts only ids).
The export is NOT committed: it is production data. Usage:

    python3 supabase/manual/test_delete_test_events_fixture.py export.json > fixture.sql

The fixture loads, with the same UUIDs as hosted:
  * the two test events and every row of theirs in the export (the targets)
  * a CONTROL copy of both events under new UUIDs and slugs (control-stuff-test, control-new-test), sharing the same fighters, team, organization
    and Auth accounts, with rows in the same tables, including the four append-only logs: it must come through untouched
  * edge-case notifications: a control notification whose text mentions test-new-test (kept: no text matching), a test-new-test notification
    carrying a control fight id (kept, reported as ambiguous), a notification carrying a test registration id but no slug (kept, ambiguous),
    and a test-stuff-test notification with no ids (deleted)
"""
import json, sys, uuid

d = json.load(open(sys.argv[1]))

# load order (parents first); loaded with session_replication_role = replica so that guards and FKs do not fire while copying rows in
ORDER = ['events', 'competitions', 'waiver_versions', 'entries', 'matches', 'results', 'result_revisions', 'result_proposals', 'score_events',
         'event_staff', 'event_announcements', 'registrations', 'event_invitations', 'event_invitation_competitions', 'event_sponsors',
         'registration_checks', 'registration_competitions', 'registration_inspections', 'registration_private', 'lyst_matches', 'lyst_rounds',
         'lyst_round_revisions', 'lyst_timer', 'match_discipline', 'match_discipline_private', 'notifications', 'push_deliveries', 'audit_log']
SCOPED = [t for t in ORDER if t not in ('push_deliveries', 'audit_log', 'registration_private', 'match_discipline_private')]

def q(s):
    return "'" + s.replace("'", "''") + "'"

out = ['set session_replication_role = replica;']
for u in d['users']:
    out.append(f"insert into auth.users (id, email) values ({q(u)}, {q('fixture-' + u[:8] + '@example.invalid')});")
    out.append(f"insert into auth.identities (id, user_id) values (gen_random_uuid(), {q(u)});")
for o in d['organizations']:
    out.append(f"insert into public.organizations (id, slug, name, kind) values ({q(o['id'])}, {q(o['slug'])}, {q(o['name'])}, {q(o['kind'])});")
for t in d['teams']:
    out.append(f"insert into public.teams (id, slug, name, status) values ({q(t['id'])}, {q(t['slug'])}, {q(t['name'])}, {q(t['status'])});")
for f in d['fighters']:
    out.append(f"insert into public.fighters (id, display_name, team_id) values ({q(f['id'])}, {q(f['display_name'])}, {'null' if not f['team_id'] else q(f['team_id'])});")
for m in d['team_memberships']:
    out.append(f"insert into public.team_memberships (id, fighter_id, team_id, role) values ({q(m['id'])}, {q(m['fighter_id'])}, {q(m['team_id'])}, {q(m['role'])});")
subs = sorted({p['subscription_id'] for p in (d.get('push_deliveries') or [])})

# match_discipline_private (hosted has one per discipline record; not in the export): fixture rows, so its cascade is exercised too
d['match_discipline_private'] = [{'discipline_id': m['id'], 'reason': 'fixture', 'recorded_by': d['users'][0]} for m in d.get('match_discipline') or []]
# private columns not in the export get fixture values
for r in d.get('registration_private') or []:
    r.update(email='fixture@example.invalid', emergency_name='Fixture', emergency_relationship='Fixture', emergency_phone='000', medically_fit=True)

def insert(table, rows):
    if not rows:
        return
    cols = sorted({k for r in rows for k in r})
    collist = ', '.join(f'"{c}"' for c in cols)
    out.append(f"insert into public.{table} ({collist}) select {collist} from jsonb_populate_recordset(null::public.{table}, {q(json.dumps(rows))}::jsonb);")

# control copy: every id of an event-scoped row gets a new UUID; shared ids (users, fighters, teams, organization, rulesets) stay
remap = {}
for t in SCOPED:
    for r in d.get(t) or []:
        if isinstance(r.get('id'), str) and len(r['id']) == 36:
            remap[r['id']] = str(uuid.uuid4())
def control(rows):
    s = json.dumps(rows)
    for a, b in remap.items():
        s = s.replace(a, b)
    s = s.replace('test-stuff-test', 'control-stuff-test').replace('test-new-test', 'control-new-test')
    s = s.replace('"Test stuff test"', '"Control stuff test"').replace('"Test new test"', '"Control new test"')
    rows = json.loads(s)
    for r in rows:
        if r.get('dedupe_key'):
            r['dedupe_key'] += ':control'
    return rows

for t in ORDER:
    insert(t, d.get(t))
for t in ORDER:
    if t == 'push_deliveries':
        continue  # (notification_id, subscription_id) of the control notifications: remapped below
    insert(t, control(d.get(t) or []))
insert('push_deliveries', control(d.get('push_deliveries') or []))
# push_subscriptions (inserted after notifications exist, so the user_id select finds a row)
for s in subs:
    out.append(f"insert into public.push_subscriptions (id, user_id, endpoint, endpoint_digest, p256dh, auth) select {q(s)}, user_id, 'https://push.invalid/{s}', '{s}', 'x', 'x' from public.notifications limit 1 on conflict do nothing;")

new_ev = '1acb67d3-db5f-40a5-bce7-682e0aa6edb3'
target_match = next(m['id'] for m in d['matches'] if m['competition_id'] in {c['id'] for c in d['competitions'] if c['event_id'] == new_ev})
control_match = remap[target_match]
target_reg = d['registrations'][0]['id']
user = d['users'][0]
edge = [
    ('00000000-0000-4000-8000-0000000000d1', {'event_slug': 'control-new-test', 'title': 'Not about test-new-test at all'}),          # kept
    ('00000000-0000-4000-8000-0000000000a1', {'event_slug': 'test-new-test', 'match_id': control_match}),                                # kept, ambiguous
    ('00000000-0000-4000-8000-0000000000a2', {'registration_id': target_reg}),                                                           # kept, ambiguous
    ('00000000-0000-4000-8000-0000000000e1', {'event_slug': 'test-stuff-test', 'event_name': 'Test stuff test'}),                        # deleted
]
for nid, payload in edge:
    out.append(f"insert into public.notifications (id, user_id, kind, payload) values ({q(nid)}, {q(user)}, 'event_announcement', {q(json.dumps(payload))}::jsonb);")
out.append('set session_replication_role = origin;')
print('\n'.join(out))
