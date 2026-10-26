import { describe, expect, test } from 'bun:test';
import { Duration } from 'effect';
import {
  ASKS_IN_REVIEW,
  ASKS_IN_TRUST,
  ASKS_NEVER,
  type Approval,
  type Condition,
  type PermissionOutcome,
} from '../permissions/vocabulary';
import { approvalIssues, judge } from './ApprovalMode';
import { builtinModes } from './builtin';

type PermissionOutcomeAsk = Extract<PermissionOutcome, { verdict: 'ask' }>;

const act = { toolName: 'bash', mutating: true };

const verdictIn = (mode: string, approval: Approval, raised: { condition: string; fact: string }[] = []) =>
  judge(approval, raised, builtinModes.find(mode)!, builtinModes, act);

const OUTSIDE: Condition = { id: 'outside', label: 'Outside', asksFrom: 'review', timeout: Duration.minutes(10) };
const SHARED: Condition = { id: 'shared', label: 'Shared', asksFrom: 'trust', timeout: Duration.minutes(10) };

describe('the judge reads a declaration against a mode rung', () => {
  test('an act that never asks passes in every mode', () => {
    for (const mode of ['bypass', 'trust', 'review']) expect(verdictIn(mode, ASKS_NEVER).verdict).toBe('allow');
  });

  test('a review act asks only in review, and a trust act in trust and review', () => {
    expect(['bypass', 'trust', 'review'].map((mode) => verdictIn(mode, ASKS_IN_REVIEW).verdict)).toEqual(['allow', 'allow', 'ask']);
    expect(['bypass', 'trust', 'review'].map((mode) => verdictIn(mode, ASKS_IN_TRUST).verdict)).toEqual(['allow', 'ask', 'ask']);
  });

  test('a raised condition asks from its own rung and the same condition differs by the act that lists it', () => {
    const outside = { condition: OUTSIDE.id, fact: 'outside' };
    const shared = { condition: SHARED.id, fact: 'shared' };
    expect(verdictIn('trust', { ...ASKS_NEVER, when: [OUTSIDE] }, [outside]).verdict).toBe('allow');
    expect(verdictIn('review', { ...ASKS_NEVER, when: [OUTSIDE] }, [outside]).verdict).toBe('ask');
    expect(verdictIn('trust', { ...ASKS_NEVER, when: [SHARED] }, [shared]).verdict).toBe('ask');
    expect(
      verdictIn('trust', { ...ASKS_NEVER, when: [{ condition: OUTSIDE, asksFrom: 'trust', timeout: 'none' }] }, [outside]).verdict,
    ).toBe('ask');
  });

  test('the shortest asking duration is the wait, and no duration waits for an answer', () => {
    const outside = { condition: OUTSIDE.id, fact: 'outside' };
    const mixed = verdictIn('review', { ...ASKS_IN_REVIEW, when: [OUTSIDE] }, [outside]) as PermissionOutcomeAsk;
    expect(mixed.timeoutMs).toBe(Duration.toMillis(Duration.minutes(10)));
    const unbounded = verdictIn('review', ASKS_IN_REVIEW) as PermissionOutcomeAsk;
    expect(unbounded.timeoutMs).toBeNull();
  });

  test('a condition the act does not list is a defect', () => {
    expect(() => verdictIn('review', ASKS_IN_REVIEW, [{ condition: 'unlisted', fact: 'x' }])).toThrow();
  });
});

describe('the declared approvals compose or the server does not start', () => {
  test('one condition id owned by two declarations, and a rung no mode names, are reported', () => {
    const twin: Condition = { ...OUTSIDE };
    expect(
      approvalIssues(
        [
          { id: 'one', approval: { ...ASKS_NEVER, when: [OUTSIDE] } },
          { id: 'two', approval: { ...ASKS_NEVER, when: [OUTSIDE] } },
          { id: 'three', approval: { ...ASKS_NEVER, when: [twin] } },
          { id: 'four', approval: { asksFrom: 'paranoid', timeout: 'none' } },
        ],
        builtinModes,
      ),
    ).toEqual(['Condition outside is declared separately by one and three.', 'four asks from paranoid, which no registered mode names.']);
  });
});
