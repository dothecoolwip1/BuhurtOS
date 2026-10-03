import { describe, expect, it } from 'vitest';
import { countInvitationStates, invitationState, invitationSummary, invitationTodo } from './invitationView';

describe('organizer-added fighter states', () => {
  it('an added fighter with an account is pending until they complete the form and waiver', () => {
    const i = { status: 'invited' as const, hasAccount: true, registrationStatus: null };
    expect(invitationState(i)).toBe('pending_confirmation');
    expect(invitationTodo(i)).toEqual(['Pending form submission', 'Pending waiver']);
    expect(invitationSummary(i)).toBe('Added by organizer · Pending fighter confirmation · Pending form submission · Pending waiver');
  });
  it('a record with no account cannot confirm at all, and says so', () => {
    const i = { status: 'invited' as const, hasAccount: false, registrationStatus: null };
    expect(invitationState(i)).toBe('no_account');
    expect(invitationTodo(i)[0]).toMatch(/claims this record/);
  });
  it('is ready only once the registration exists and is accepted', () => {
    expect(invitationState({ status: 'registered', hasAccount: true, registrationStatus: 'accepted' })).toBe('ready');
    expect(invitationTodo({ status: 'registered', hasAccount: true, registrationStatus: 'accepted' })).toEqual([]);
  });
  it('a withdrawn registration or invitation is withdrawn; a cancelled one is cancelled', () => {
    expect(invitationState({ status: 'registered', hasAccount: true, registrationStatus: 'withdrawn' })).toBe('withdrawn');
    expect(invitationState({ status: 'withdrawn', hasAccount: true, registrationStatus: null })).toBe('withdrawn');
    expect(invitationState({ status: 'cancelled', hasAccount: false, registrationStatus: null })).toBe('cancelled');
  });
  it('counts states', () => {
    const c = countInvitationStates([
      { status: 'invited', hasAccount: true, registrationStatus: null }, { status: 'invited', hasAccount: false, registrationStatus: null }, { status: 'registered', hasAccount: true, registrationStatus: 'accepted' }
    ]);
    expect(c).toEqual({ no_account: 1, pending_confirmation: 1, ready: 1, withdrawn: 0, cancelled: 0 });
  });
});
