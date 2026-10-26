import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { StartAnswer } from '@runlith/executions/protocol/launch';
import { Adapter, PIPES } from '../../holder/testing/Adapter';
import { Host, operation, principal, stop, type HostAdapter } from './session';

export const capacityContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} holder capacity contract`, (it) => {
    it.effect('reports exhausted holder handles as capacity instead of an OS spawn failure', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const profile = yield* host.client.capabilities();
        if (profile.ceilings.perTransport.pipes > 20)
          return yield* Effect.die(
            new Error(`the low-limit fixture still admits ${profile.ceilings.perTransport.pipes} executions; the fixture budget is 20`),
          );
        expect(profile.ceilings.perTransport.pipes).toBeGreaterThan(0);
        const held: ExecutionRef[] = [];
        let last: StartAnswer | undefined;
        const launches = Effect.gen(function* () {
          const command = platform.fixture('wait', PIPES);
          for (let index = 0; index <= profile.ceilings.perTransport.pipes; index++) {
            last = yield* host.client.start(yield* operation(host), {
              command: { program: command.path, args: command.args, cwd: platform.directory, environment: [] },
              transport: PIPES,
              lifetime: 'held',
              purpose: 'command',
              target: { environment: 'contract', namespace: 'contract', cwd: platform.directory, dependencies: [] },
              holder: principal,
              origin: principal,
            });
            if (last._tag === 'Started') held.push(last.execution);
            if (index < profile.ceilings.perTransport.pipes && last._tag !== 'Started')
              return yield* Effect.die(new Error(`the holder refused before its declared ceiling: ${JSON.stringify(last)}`));
          }
          expect(last?._tag).toBe('Refused');
          expect(last?._tag === 'Refused' ? last.refusal._tag : undefined).toBe('CapacityExceeded');
          const incarnation = yield* host.client.generation();
          const leaders = yield* Effect.forEach(held, (ref) => Effect.map(host.client.state(ref), (summary) => summary?.native.pid));
          expect(leaders.every((pid) => pid !== undefined)).toBe(true);
          yield* host.control.restartLogic;
          expect(yield* host.client.generation()).toBe(incarnation);
          expect(yield* Effect.forEach(held, (ref) => Effect.map(host.client.state(ref), (summary) => summary?.native.pid))).toEqual(
            leaders,
          );
        });
        yield* launches.pipe(
          Effect.ensuring(
            Effect.orDie(Effect.suspend(() => Effect.forEach(held, (execution) => stop(host, execution, 'destroy'), { discard: true }))),
          ),
        );
      }),
    );
  });
