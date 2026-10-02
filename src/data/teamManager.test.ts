import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { notificationLink } from '../lib/notificationView';
import {
  cleanJoinMessage, emptyNewTeamForm, newTeamPayload, notificationText, slugFromName, toInboxRequest, toMyJoinRequest, toNewTeamRequestDetails,
  toNotification, toRosterMember, toTeamProfileExtras, validateNewTeam, type NewTeamForm
} from './teamManager';

const valid = (over: Partial<NewTeamForm> = {}): NewTeamForm => ({
  ...emptyNewTeamForm(), name: 'Frostgate Free Company', city: 'Edmonton', country: 'CA', description: 'A new team training in Edmonton.',
  contactEmail: 'cap@example.test', captainReason: 'I run the weekly practice.', ...over
});

describe('mappers', () => {
  it('maps a roster row without any account field', () => {
    const m = toRosterMember({ fighter_id: 'f1', display_name: 'Jo', role: 'captain', is_captain: true, mercenary: false, since: '2025-03-01' });
    expect(m).toEqual({ fighterId: 'f1', displayName: 'Jo', role: 'captain', isCaptain: true, mercenary: false, since: '2025-03-01' });
  });
  it('maps my requests and the inbox', () => {
    expect(toMyJoinRequest({ id: 'r', team_id: 't', team_name: 'T', team_slug: 't-s', status: 'pending', message: null, created_at: 'c', decided_at: null }))
      .toEqual({ id: 'r', teamId: 't', teamName: 'T', teamSlug: 't-s', status: 'pending', message: null, createdAt: 'c', decidedAt: null });
    expect(toInboxRequest({ id: 'r', team_id: 't', team_name: 'T', team_slug: 's', requester_name: 'Jo', message: 'hi', created_at: 'c' }).requesterName).toBe('Jo');
  });
  it('maps notifications and flags unread', () => {
    expect(toNotification({ id: 'n', kind: 'team_join_decided', payload: null, created_at: 'c', read_at: null })).toMatchObject({ payload: {}, unread: true });
    expect(toNotification({ id: 'n', kind: 'team_join_decided', payload: { a: 1 }, created_at: 'c', read_at: 'x' }).unread).toBe(false);
  });
  it('maps reviewer details and public extras with safe defaults', () => {
    expect(toNewTeamRequestDetails({ team_id: 't', requested_by_name: null, contact_email: 'a@b.c', contact_phone: null, captain_reason: 'r', notes: null, created_at: 'c' }).requestedByName).toBeNull();
    expect(toTeamProfileExtras({ description: null, website: null, social_links: null, founded_year: null, claimed_organizations: null })).toEqual({ description: null, website: null, socialLinks: {}, foundedYear: null, claimedOrganizations: [] });
  });
});

describe('notificationText', () => {
  it('reads each kind and falls back when the payload is thin', () => {
    expect(notificationText({ kind: 'team_join_requested', payload: { requester_name: 'Jo', team_name: 'Ironwood' } })).toBe('Jo asked to join Ironwood.');
    expect(notificationText({ kind: 'team_join_decided', payload: { decision: 'approved', team_name: 'Ironwood' } })).toBe('You are now on the roster of Ironwood.');
    expect(notificationText({ kind: 'team_join_decided', payload: { decision: 'declined' } })).toBe('a team declined your request to join.');
    expect(notificationText({ kind: 'team_proposed', payload: { team_name: 'X' } })).toBe('X was proposed and is waiting for review.');
    expect(notificationText({ kind: 'team_join_requested', payload: {} })).toBe('Someone asked to join a team.');
  });
});

describe('cleanJoinMessage', () => {
  it('trims, nulls empty and flags over 500', () => {
    expect(cleanJoinMessage('   ')).toEqual({ message: null, error: null });
    expect(cleanJoinMessage(' hi ')).toEqual({ message: 'hi', error: null });
    expect(cleanJoinMessage('x'.repeat(501)).error).toMatch(/500/);
    expect(cleanJoinMessage('x'.repeat(500)).error).toBeNull();
  });
});

describe('new team form', () => {
  it('derives slugs', () => { expect(slugFromName('  Frostgate Free Co. ')).toBe('frostgate-free-co'); });
  it('accepts a minimal valid form', () => { expect(validateNewTeam(valid())).toEqual({}); });
  it('refuses what the database refuses', () => {
    const now = new Date('2026-10-01');
    expect(validateNewTeam(valid({ name: 'X' })).name).toBeDefined();
    expect(validateNewTeam(valid({ city: '' })).city).toBeDefined();
    expect(validateNewTeam(valid({ country: ' ' })).country).toBeDefined();
    expect(validateNewTeam(valid({ description: 'short' })).description).toBeDefined();
    expect(validateNewTeam(valid({ website: 'http://x.example' })).website).toBeDefined();
    expect(validateNewTeam(valid({ website: 'javascript:alert(1)' })).website).toBeDefined();
    expect(validateNewTeam(valid({ website: 'https://x.example/a' })).website).toBeUndefined();
    expect(validateNewTeam(valid({ socialLinks: { instagram: 'http://i.example' } })).socialLinks).toBeDefined();
    expect(validateNewTeam(valid({ foundedYear: '2999' }), now).foundedYear).toBeDefined();
    expect(validateNewTeam(valid({ foundedYear: '1850' }), now).foundedYear).toBeDefined();
    expect(validateNewTeam(valid({ foundedYear: '2024' }), now).foundedYear).toBeUndefined();
    expect(validateNewTeam(valid({ claimedOrganizations: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] })).claimedOrganizations).toBeDefined();
    expect(validateNewTeam(valid({ colors: ['red', '#000000'] })).colors).toBeDefined();
    expect(validateNewTeam(valid({ contactEmail: 'nope' })).contactEmail).toBeDefined();
    expect(validateNewTeam(valid({ captainReason: 'short' })).captainReason).toBeDefined();
    expect(validateNewTeam(valid({ slug: 'Not A Slug' })).slug).toBeDefined();
  });
  it('builds a payload that leaves empty optional fields out and keeps the reviewer-only keys', () => {
    const p = newTeamPayload(valid({ region: ' ', foundedYear: '2024', claimedOrganizations: [' HACSA ', ''], socialLinks: { instagram: ' https://i.example/x ', facebook: '' }, colors: ['#112233', '#EEDDCC'] }));
    expect(p).toEqual({
      name: 'Frostgate Free Company', city: 'Edmonton', country: 'CA', description: 'A new team training in Edmonton.', founded_year: 2024,
      claimed_organizations: ['HACSA'], social_links: { instagram: 'https://i.example/x' }, colors: ['#112233', '#EEDDCC'], crest_division: 'pale',
      contact_email: 'cap@example.test', captain_reason: 'I run the weekly practice.'
    });
    expect('region' in p).toBe(false);
  });
});

describe('sign-up notifications', () => {
  it('tells organizers who signed up, and the person what was decided', () => {
    expect(notificationText({ kind: 'registration_submitted', payload: { person_name: 'Sam Doe', event_name: 'Red Deer Rumble' } })).toBe('Sam Doe signed up for Red Deer Rumble.');
    expect(notificationText({ kind: 'registration_submitted', payload: { person_name: 'Sam Doe', event_name: 'Red Deer Rumble', volunteer: true } })).toBe('Sam Doe signed up to volunteer at Red Deer Rumble.');
    expect(notificationText({ kind: 'registration_decided', payload: { event_name: 'Red Deer Rumble', decision: 'accepted' } })).toBe('You are accepted for Red Deer Rumble.');
    expect(notificationText({ kind: 'registration_decided', payload: { event_name: 'Red Deer Rumble', decision: 'declined' } })).toBe('Your registration for Red Deer Rumble was declined.');
  });
  it('links organizers to managing the event and the person to the event page', () => {
    expect(notificationLink({ kind: 'registration_submitted', payload: { event_slug: 'red-deer-rumble' } })).toBe('/events/red-deer-rumble/manage');
    expect(notificationLink({ kind: 'registration_decided', payload: { event_slug: 'red-deer-rumble' } })).toBe('/events/red-deer-rumble');
    expect(notificationLink({ kind: 'registration_decided', payload: { event_slug: '../x' } })).toBe('/account');
  });
});
