import { expect, test } from 'bun:test';
import { ExecutionId, ExecutionRef, Incarnation, InstallationId } from '@runlith/executions/protocol/execution';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { TargetKey } from '../contract/wire/targets.js';
import type { TerminalActor } from '../contract/wire/terminals.js';
import type { CommandRelation } from '../contract/wire/commandSubject.js';
import { commandEligibility, type CommandOperation, type CommandEligibilityRequest } from './eligibility.js';

const PROJECT = 7;
const agent: TerminalActor = { _tag: 'Thread', threadId: ThreadId.make('thread-alpha'), projectId: PROJECT };
const operator: TerminalActor = { _tag: 'Operator' };
const foreign: TerminalActor = { _tag: 'Foreign', harness: 'claude-code', key: 'vendor-session', projectId: PROJECT };

const execution: ExecutionRef = {
  installation: InstallationId.make('installation-one'),
  execution: ExecutionId.make('execution-one'),
  incarnation: Incarnation.make(1),
};

const record = (owner: CommandRecord['owner'] = { _tag: 'Thread', thread: ThreadId.make('thread-alpha') }): CommandRecord => ({
  projectId: PROJECT,
  execution,
  owner,
  origin: { _tag: 'Thread', thread: ThreadId.make('thread-alpha') },
  policyIdentity: 'policy-one',
  targetKey: TargetKey.make('target-one'),
  holdings: {},
  admittedAt: 0,
});

const ask = (actor: TerminalActor, act: CommandOperation, relation: CommandRelation, over: Partial<CommandEligibilityRequest> = {}) =>
  commandEligibility({
    actor,
    actorKnown: true,
    identity: testSessionIdentity,
    scope: PROJECT,
    relation,
    origin: act._tag === 'Launch' ? undefined : record(),
    act,
    ...over,
  });

const refusalOf = (verdict: ReturnType<typeof ask>): string | null => (verdict._tag === 'Refused' ? verdict.refusal.reason : null);

test('a thread of another project manages a command of the project it addresses, and no command recorded elsewhere', () => {
  const stop: CommandOperation = { _tag: 'Stop', execution };
  const thread: TerminalActor = { _tag: 'Thread', threadId: ThreadId.make('thread-beta'), projectId: PROJECT + 1 };
  expect(ask(thread, stop, 'other')).toEqual({ _tag: 'Eligible' });
  expect(refusalOf(ask(thread, stop, 'other', { origin: { ...record(), projectId: PROJECT + 1 } }))).toBe('foreign-project');
});

test('a thread alone launches only into its own ownership', () => {
  const launch: CommandOperation = { _tag: 'Launch', owner: { _tag: 'Operator' } };
  expect(refusalOf(ask(agent, launch, 'other'))).toBe('unrelated');
  expect(ask(foreign, launch, 'ungated')).toEqual({ _tag: 'Eligible' });
  expect(ask(operator, launch, 'operator')).toEqual({ _tag: 'Eligible' });
});

test('a thread moves its own command either way within the rule it started under, freely where none stands, and not past it', () => {
  const revise = (current: { readonly executionMs?: number; readonly ceilingMs?: number }, executionMs: number): CommandOperation => ({
    _tag: 'Revise',
    execution,
    current,
    change: { _tag: 'Total', executionMs },
    exception: false,
  });
  const ruled = { executionMs: 1_000, ceilingMs: 60_000 };
  expect(ask(agent, revise(ruled, 5_000), 'own')).toEqual({ _tag: 'Eligible' });
  expect(ask(agent, revise(ruled, 500), 'own')).toEqual({ _tag: 'Eligible' });
  const remaining: CommandOperation = {
    _tag: 'Revise',
    execution,
    current: ruled,
    change: { _tag: 'Remaining', remainingMs: 5_000 },
    exception: false,
  };
  expect(ask(agent, remaining, 'own')).toEqual({ _tag: 'Eligible' });
  expect(ask(agent, revise({ executionMs: 1_000 }, 3_600_000), 'own')).toEqual({ _tag: 'Eligible' });
  expect(ask(agent, revise({}, 3_600_000), 'own')).toEqual({ _tag: 'Eligible' });
  for (const actor of [agent, operator] as const) {
    expect(refusalOf(ask(actor, revise(ruled, 120_000), actor === agent ? 'own' : 'operator'))).toBe('ceiling');
  }
});

test("a ceiling exception is eligible to every actor; whose word it needs is the act's question", () => {
  const exception: CommandOperation = {
    _tag: 'Revise',
    execution,
    current: { executionMs: 1_000, ceilingMs: 60_000 },
    change: { _tag: 'Total', executionMs: 120_000 },
    exception: true,
  };
  expect(ask(agent, exception, 'own')).toEqual({ _tag: 'Eligible' });
  expect(ask(foreign, exception, 'ungated')).toEqual({ _tag: 'Eligible' });
  expect(ask(operator, exception, 'operator')).toEqual({ _tag: 'Eligible' });
});

test('observation is project-scoped for every actor, and grants nothing', () => {
  for (const act of [
    { _tag: 'Observe' as const, execution },
    { _tag: 'Await' as const, execution },
  ]) {
    for (const actor of [operator, agent, foreign]) {
      expect(ask(actor, act, actor === operator ? 'operator' : actor === agent ? 'other' : 'ungated')).toEqual({ _tag: 'Eligible' });
    }
  }
});
