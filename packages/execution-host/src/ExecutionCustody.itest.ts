import { fixtureHolder } from './hostFixture';
import { afterAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, Layer } from 'effect';
import { join } from 'node:path';
import { type ExecutionRef, ExecutionId, HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionCapacity } from './ExecutionCapacity';
import { makeExecutionCustody } from './ExecutionCustody';
import { executionStore, ExecutionStore } from './store/ExecutionStore';
import type { LaunchRequest } from './store/records';
import { INSTALLATION, hostProfile, registrationOf, stateDirectories } from './hostFixture';

const directories = stateDirectories('execution-custody-');
afterAll(directories.clear);

const profile = hostProfile({ executions: 2 });

const installation = InstallationId.make(INSTALLATION);
const ref = (execution: string, incarnation = 0): ExecutionRef => ({ installation, execution: ExecutionId.make(execution), incarnation });

const launch = (execution: string, key: string, holder: string): LaunchRequest => {
  const identity = ref(execution);
  return {
    operation: { installation, operation: HostRequestKey.make(key) },
    fingerprint: 'command:echo one',
    ref: identity,
    transport: 'pipes',
    lifetime: 'call',
    purpose: 'command',
    target: { environment: 'local', namespace: 'default', cwd: '/tmp', dependencies: [] },
    holder: Principal.make(holder),
    origin: Principal.make(holder),
    receipt: { _tag: 'Accepted', execution: identity },
  };
};

const over = (directory: string) =>
  Layer.unwrap(
    Effect.map(sharedPool, (pool) => executionStore(join(directory, 'executions.sqlite'), registrationOf(directory), pool)),
  ).pipe(Layer.provide(fixtureHolder()), Layer.provideMerge(ExecutionCapacity.layer(profile)));

describe('custody moves', () => {
  it.live('refuses a transfer presented by a principal that does not hold the execution, and commits the holder’s own', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const capacity = yield* ExecutionCapacity;
        const executions = yield* ExecutionStore;
        yield* capacity.reserve(ref('exec-1').execution, 'pipes');
        yield* executions.reserve(launch('exec-1', 'start-1', 'operator'));
        const custody = yield* makeExecutionCustody({ ref: ref('exec-1') });

        const refused = yield* Effect.result(
          custody.accept(Principal.make('thread-7'), 0, { _tag: 'Transfer', holder: Principal.make('thread-7') }),
        );
        const standing = yield* custody.current;
        const moved = yield* custody.accept(Principal.make('operator'), 0, {
          _tag: 'Transfer',
          holder: Principal.make('thread-7'),
        });
        const reread = yield* executions.custodyOf(ref('exec-1').execution);
        const late = yield* Effect.result(
          custody.accept(Principal.make('operator'), 0, { _tag: 'Transfer', holder: Principal.make('agent-2') }),
        );
        return { refused, standing, moved, reread, late };
      }).pipe(Effect.provide(over(directories.open())));

      expect(outcome.refused._tag).toBe('Failure');
      if (outcome.refused._tag === 'Failure') {
        expect(outcome.refused.failure._tag).toBe('NotHolder');
      }
      expect(String(outcome.standing.holder)).toBe('operator');
      expect(outcome.standing.revision).toBe(0);
      expect(String(outcome.moved.custody.holder)).toBe('thread-7');
      expect(outcome.moved.custody.revision).toBe(1);
      expect(String(outcome.reread.holder)).toBe('thread-7');
      expect(outcome.reread.revision).toBe(1);
      expect(outcome.late._tag).toBe('Failure');
      if (outcome.late._tag === 'Failure') expect(outcome.late.failure._tag).toBe('RevisionConflict');
    }),
  );
});
