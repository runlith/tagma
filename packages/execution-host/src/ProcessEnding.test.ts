import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { STOP_LADDER } from '@runlith/executions/protocol/call';
import type { ProcessTarget } from '@runlith/executions/protocol/stop';
import { endProcess } from './ProcessEnding';
import { Processes, type ProcessReader } from './ProcessReader';
import { ProcessControl } from './ProcessControl';

const target: ProcessTarget = {
  scope: { host: { _tag: 'Local', machine: 'fixture' }, network: { _tag: 'Local', machine: 'fixture' } },
  identity: { pid: 42, birth: '1000' },
};
const world = (started: number, denied = false) => {
  let alive = true;
  const reader: ProcessReader = {
    table: Effect.succeed([]),
    members: () => Effect.succeed([]),
    facts: () => Effect.succeed({ processes: [], unread: [] }),
    scan() {
      return this.table;
    },
    compareBirth: (left, right) => Number(left) - Number(right),
    bornBetween: () => false,
    resolve: () => 'unknown',
    identity: () => (alive ? { _tag: 'Read', pid: 42, birth: String(started), parent: 1, work: 42, zombie: false } : { _tag: 'Gone' }),
  };
  const control = ProcessControl.of({
    standing: () => Effect.die('this case reads identity through Processes'),
    act: () =>
      Effect.sync(() => {
        if (denied) return 'refused' as const;
        alive = false;
        return 'delivered' as const;
      }),
    signal: () => Effect.die('this case uses the ending ladder'),
  });
  return {
    alive: () => alive,
    end: (selected: ProcessTarget) =>
      endProcess({ scope: target.scope, target: selected }).pipe(
        Effect.provideService(Processes, reader),
        Effect.provideService(ProcessControl, control),
      ),
  };
};

it.effect('a replacement under the selected pid remains alive', () =>
  Effect.gen(function* () {
    const fixture = world(2000);
    const result = yield* fixture.end(target);
    expect(result).toMatchObject({ _tag: 'Refused', reason: 'identity-changed' });
    expect(fixture.alive()).toBe(true);
  }),
);

it.effect('an ending is observed and a refused signal remains a refusal', () =>
  Effect.gen(function* () {
    const ended = world(1000);
    const ending = yield* Effect.forkScoped(ended.end(target));
    yield* TestClock.adjust(STOP_LADDER.terminateAtMs);
    expect(yield* Fiber.join(ending)).toMatchObject({ _tag: 'Ended', steps: ['terminate'] });
    expect(ended.alive()).toBe(false);
    const denied = world(1000, true);
    const refusing = yield* Effect.forkScoped(denied.end(target));
    yield* TestClock.adjust(STOP_LADDER.terminateAtMs);
    expect(yield* Fiber.join(refusing)).toMatchObject({ _tag: 'Refused', reason: 'signal-failed' });
    expect(denied.alive()).toBe(true);
  }),
);

it.effect('a process in another namespace remains alive', () =>
  Effect.gen(function* () {
    const fixture = world(1000);
    const foreign: ProcessTarget = { ...target, scope: { ...target.scope, host: { _tag: 'Local', machine: 'elsewhere' } } };
    expect(yield* fixture.end(foreign)).toMatchObject({ _tag: 'Refused', reason: 'scope-mismatch' });
    expect(fixture.alive()).toBe(true);
  }),
);
