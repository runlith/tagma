import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { principalOf } from './principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { endHeldExecutions, type HeldExecutionRoads } from './endHeld.js';
import type { TerminalDischarge } from '../contract/service/discharge.js';

const record = (execution: string, over: Partial<TerminalRecord> = {}): TerminalRecord =>
  ({
    projectId: 7,
    execution: { installation: 'inst', execution, incarnation: 1 },
    transport: 'pty',
    lifetime: 'held',
    targetKey: 'target-key',
    holder: principalOf({ _tag: 'Operator' }),
    origin: principalOf({ _tag: 'Operator' }),
    revision: 3,
    generation: 3,
    holdings: {},
    program: 'claude',
    acceptedAt: 1,
    ...over,
  }) as unknown as TerminalRecord;

type Stand = {
  readonly held?: Record<string, readonly TerminalRecord[]>;
  readonly named?: Record<string, TerminalRecord | null>;
  readonly ended?: (record: TerminalRecord) => TerminalDischarge;
  readonly stopFails?: (record: TerminalRecord) => Error | null;
  readonly heldUnreadable?: boolean;
};

const RUNNING: TerminalDischarge = { _tag: 'Retained', reason: 'unended' };

const stand = (over: Stand) => {
  const stops: { key: TerminalOperationKey; record: TerminalRecord }[] = [];
  const deps: HeldExecutionRoads = {
    heldBy: (threadIds) =>
      over.heldUnreadable === true
        ? Effect.fail(new Error('the projection is unreadable'))
        : Effect.succeed(threadIds.flatMap((threadId) => over.held?.[threadId] ?? [])),
    named: (launched) => Effect.succeed(over.named?.[launched.execution] ?? null),
    ended: (row) => Effect.succeed(over.ended?.(row) ?? RUNNING),
    stop: (key, row) => {
      const failure = over.stopFails?.(row) ?? null;
      if (failure !== null) return Effect.fail(failure);
      stops.push({ key, record: row });
      return Effect.succeed({});
    },
  };
  const end = (threadIds: readonly string[], act: string) =>
    endHeldExecutions(deps)(
      threadIds.map((id) => ({ id, launched: over.named?.[id] === undefined ? null : { execution: id, incarnation: 1 } })),
      act,
    );
  return { end, stops };
};

const ACT = 'act-1';

describe('endHeldExecutions', () => {
  it.effect('a thread standing over nothing is ended without a single stop', () =>
    Effect.gen(function* () {
      const { end, stops } = stand({});
      yield* end(['thread-idle'], ACT);
      expect(stops).toEqual([]);
    }),
  );

  it.effect('an execution the thread holds custody of is stopped under a key of the act, the thread and the execution', () =>
    Effect.gen(function* () {
      const shell = record('shell-1', { heldBy: ThreadId.make('thread-a') });
      const { end, stops } = stand({ held: { 'thread-a': [shell] } });
      yield* end(['thread-a'], ACT);
      expect(stops.map((stop) => String(stop.record.execution.execution))).toEqual(['shell-1']);
      expect(stops[0]?.key).toMatchObject({
        projectId: 7,
        operationId: `thread-delete-held:thread-a:${ACT}:shell-1`,
        mutation: 'stop',
        targetKey: 'target-key',
        execution: shell.execution,
      });
    }),
  );

  it.effect('the pty a harness thread names is stopped though its custody is the operator\u2019s', () =>
    Effect.gen(function* () {
      const { end, stops } = stand({ named: { 'thread-h': record('cli-1') } });
      yield* end(['thread-h'], ACT);
      expect(stops.map((stop) => String(stop.record.execution.execution))).toEqual(['cli-1']);
    }),
  );

  it.effect('an execution the thread both holds and names is stopped once', () =>
    Effect.gen(function* () {
      const cli = record('cli-2', { heldBy: ThreadId.make('thread-both') });
      const { end, stops } = stand({ held: { 'thread-both': [cli] }, named: { 'thread-both': cli } });
      yield* Effect.result(end(['thread-both'], ACT));
      expect(stops).toHaveLength(1);
    }),
  );

  it.effect('a process that already finished is discharged on the host\u2019s proof and never stopped again', () =>
    Effect.gen(function* () {
      const { end, stops } = stand({
        held: { 'thread-done': [record('done-1', { heldBy: ThreadId.make('thread-done') })] },
        ended: () => ({ _tag: 'Discharged' }),
      });
      yield* end(['thread-done'], ACT);
      expect(stops).toEqual([]);
    }),
  );

  it.effect('every thread of a subtree is walked, and each of its executions ends', () =>
    Effect.gen(function* () {
      const { end, stops } = stand({
        held: {
          root: [record('r-1', { heldBy: ThreadId.make('root') })],
          child: [record('c-1', { heldBy: ThreadId.make('child') }), record('c-2', { heldBy: ThreadId.make('child') })],
        },
        named: { grandchild: record('g-cli') },
      });
      yield* end(['root', 'child', 'grandchild'], ACT);
      expect(stops.map((stop) => String(stop.record.execution.execution)).sort()).toEqual(['c-1', 'c-2', 'g-cli', 'r-1']);
    }),
  );

  it.effect('a stop the host refuses leaves as a refusal naming the execution, and the walk goes no further', () =>
    Effect.gen(function* () {
      const first = record('ok-1', { heldBy: ThreadId.make('t') });
      const stuck = record('stuck-1', { heldBy: ThreadId.make('t'), program: 'codex' });
      const { end, stops } = stand({
        held: { t: [first, stuck] },
        stopFails: (row) => (row.execution.execution === 'stuck-1' ? new Error('the host is not answering') : null),
      });
      const refusal = yield* Effect.flip(end(['t', 'after'], ACT));
      expect(refusal).toBeInstanceOf(GateRefusal);
      expect(refusal.code).toBe('thread-execution-standing');
      expect(refusal.message).toContain('stuck-1');
      expect(refusal.message).toContain('codex');
      expect(refusal.message).toContain('the host is not answering');
      expect(refusal.unblock.join(' ')).toContain(`thread-delete-held:t:${ACT}:stuck-1`);
      expect(stops.map((stop) => String(stop.record.execution.execution))).toEqual(['ok-1']);
    }),
  );

  it.effect('a projection that cannot be read refuses by name instead of deleting over what it could not see', () =>
    Effect.gen(function* () {
      const { end, stops } = stand({ heldUnreadable: true });
      const refusal = yield* Effect.flip(end(['thread-blind'], ACT));
      expect(refusal.code).toBe('thread-executions-unreadable');
      expect(refusal.message).toContain('thread-blind');
      expect(stops).toEqual([]);
    }),
  );

  it.effect('an unreadable ending refuses deletion before sending a stop', () =>
    Effect.gen(function* () {
      const live = record('live-1', { heldBy: ThreadId.make('t2') });
      let stops = 0;
      const deps: HeldExecutionRoads = {
        heldBy: () => Effect.succeed([live]),
        named: () => Effect.succeed(null),
        ended: () => Effect.fail(new Error('the host did not answer')),
        stop: () =>
          Effect.sync(() => {
            stops++;
          }),
      };
      const refusal = yield* Effect.flip(endHeldExecutions(deps)([{ id: 't2', launched: null }], ACT));
      expect(refusal.code).toBe('thread-executions-unreadable');
      expect(refusal.message).toContain('the host did not answer');
      expect(stops).toBe(0);
    }),
  );
});
