import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { ChildProcess } from 'effect/process';
import { executionSpawner } from '@runlith/executions/executionSpawner';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { managedCall, type ManagedCall } from '@runlith/executions/ManagedCall';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import { Adapter, PIPES } from '../../holder/testing/Adapter';
import { Host, principal, textUntil, type HostAdapter } from './session';

const environment: CommandEnvironment = {
  materialize: (request) =>
    Effect.succeed(request.entries.flatMap((entry) => (entry._tag === 'Set' ? [{ name: entry.name, value: entry.value }] : []))),
};

const spawn = Effect.gen(function* () {
  const host = yield* Host;
  const platform = yield* Adapter;
  const spawner = yield* executionSpawner(environment, {
    installation: host.installation,
    purpose: 'command',
    lifetime: 'call',
    correlation: 'contract-scope',
    target: { environment: 'contract', namespace: 'contract', cwd: platform.directory, dependencies: [] },
    holder: principal,
    origin: principal,
    readerCredits: host.credits,
  }).pipe(Effect.provide(ExecutionClient.context(host.client)));
  const command = platform.fixture('fork', PIPES);
  const child = yield* spawner.spawn(
    ChildProcess.make(command.path, command.args, {
      cwd: platform.directory,
      stdin: 'pipe',
      env: { PATH: platform.searchPath },
      extendEnv: false,
    }),
  );
  const call = managedCall(child);
  if (call === undefined) return yield* Effect.die(new Error('the public child handle must carry its managed call'));
  const descendant = Number((yield* textUntil(host, call.execution, 'stdout', '\n')).trim());
  return { call, pid: Number(child.pid), descendant };
});

const settled = Effect.fnUntraced(function* (host: Host['Service'], call: ManagedCall) {
  const answer = yield* host.client.callResult(call.operation, { waitMs: 5_000 });
  expect(answer._tag).toBe('Settled');
  if (answer._tag !== 'Settled') return yield* Effect.die(new Error('the scope ending must settle its call'));
  expect(answer.result._tag).toBe('Decided');
  if (answer.result._tag !== 'Decided') return yield* Effect.die(new Error('the stopped call must be decided'));
  expect(answer.result.decision._tag).toBe('Cancelled');
  if (answer.result.decision._tag !== 'Cancelled') return yield* Effect.die(new Error('the scope ending must cancel its call'));
  expect(answer.result.decision.cause).toBe('scope-closed');
});

export const scopeContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host scope contracts`, (it) => {
    it.effect('ends the live child and its fork when the public handle scope closes', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* Effect.scoped(spawn);
        yield* settled(host, child.call);
        expect(yield* platform.standing(child.pid)).toBe('gone');
        expect(yield* platform.standing(child.descendant)).not.toBe('running');
        const state = yield* host.client.state(child.call.execution);
        expect(state).toBeUndefined();
      }).pipe(Effect.timeout(9_000)),
    );

    it.effect('releases the child and the fork when the public handle scope is interrupted', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const started = yield* Deferred.make<Effect.Success<typeof spawn>>();
        const fiber = yield* Effect.forkScoped(
          Effect.scoped(
            Effect.gen(function* () {
              const child = yield* spawn;
              yield* Deferred.succeed(started, child);
              yield* Effect.never;
            }),
          ),
        );
        const child = yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* settled(host, child.call);
        expect(yield* platform.standing(child.pid)).toBe('gone');
        expect(yield* platform.standing(child.descendant)).not.toBe('running');
        const state = yield* host.client.state(child.call.execution);
        expect(state).toBeUndefined();
      }).pipe(Effect.timeout(9_000)),
    );
  });
