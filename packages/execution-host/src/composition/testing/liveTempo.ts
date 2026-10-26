import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schedule } from 'effect';
import { Adapter, PIPES, PTY } from '../../holder/testing/Adapter';
import { Host, start, textUntil, withExecution, type HostAdapter } from './session';

export const liveTempoContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host live tempo contracts`, (it) => {
    for (const transport of [PTY, PIPES]) {
      for (const initial of ['full', 'lowest'] as const) {
        it.effect(`${transport._tag}: lowers and raises work born at ${initial} only where supported`, () =>
          Effect.gen(function* () {
            const host = yield* Host;
            const platform = yield* Adapter;
            yield* host.client.pace(initial);
            const child = yield* start(transport, 'fork', undefined, true);
            yield* withExecution(
              host,
              child.execution,
              Effect.gen(function* () {
                const stream = transport._tag === 'pty' ? 'pty' : 'stdout';
                const descendant = Number((yield* textUntil(host, child.execution, stream, '\n')).trim());
                if (child.native.pid === undefined) return yield* Effect.die(new Error('the host must identify the live leader'));
                const leader = child.native.pid;
                if (initial === 'lowest') {
                  yield* platform
                    .background(descendant)
                    .pipe(Effect.repeat({ while: (background) => !background, schedule: Schedule.spaced(20) }));
                  expect(yield* platform.background(leader)).toBe(true);
                  expect(yield* platform.background(descendant)).toBe(true);
                }
                const lowest = yield* host.client.pace('lowest');
                expect(lowest).toEqual({ _tag: 'Applied', pace: 'lowest', reached: 2, kept: 0, failed: 0 });
                expect(yield* platform.background(leader)).toBe(true);
                expect(yield* platform.background(descendant)).toBe(true);
                const served = yield* host.client.served();
                const full = yield* host.client.pace('full');
                const raises = served.has('pace-raise');
                expect(full._tag).toBe(raises ? 'Applied' : 'Unavailable');
                const remains = !raises;
                expect(yield* platform.background(leader)).toBe(remains);
                expect(yield* platform.background(descendant)).toBe(remains);
              }),
            );
          }),
        );
      }
    }
  });
