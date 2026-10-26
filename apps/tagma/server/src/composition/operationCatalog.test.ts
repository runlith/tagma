import { layer } from '@runlith/effect-test';
import { world } from '@runlith/testbed/worlds';
import { expect } from 'bun:test';
import { Context, Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';
import { OperationChecks } from '../invocation/contract/service/operationChecks.js';
import { performIn, triggered } from '../invocation/testing/performing.js';
import { CallerWorkspace } from '../workspace/contract/service/places.js';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { OPERATIONS } from './catalog.js';
import { operationBodies } from './bodies.js';
import { catalogWorld } from './testing/catalogWorld.js';

const agent: Caller = {
  actor: {
    kind: 'thread',
    threadId: 'one',
    projectId: 1,
    principalId: 'one',
    session: { harness: 'tagma', key: 'one' },
  },
  files: null,
};
const operator: Caller = { actor: { kind: 'operator' }, files: null };

layer(world(catalogWorld, null))('operation dispatch', (it) => {
  it.effect('every declared operation loads one body, filed under its own id', () =>
    Effect.gen(function* () {
      const bodies = yield* operationBodies;
      const disagreeing = Object.entries(bodies)
        .filter(([key, body]) => body.id !== key)
        .map(([key, body]) => `${key} carries ${String(body.id)}`);
      expect(disagreeing).toEqual([]);
      expect(Object.keys(bodies).sort()).toEqual(Object.keys(OPERATIONS).sort());
    }),
  );

  it.effect('head reads by a thread use the mandatory operation check; other calls do not', () =>
    Effect.gen(function* () {
      const operationCatalog = yield* OperationCatalog;
      const called: string[] = [];
      const checks = OperationChecks.of({
        run: (id, _actor, work) =>
          Effect.suspend(() => {
            called.push(id);
            return work;
          }),
        afterEdit: () => Effect.void,
      });
      expect(
        yield* triggered('read_block', agent, Effect.succeed('read')).pipe(
          Effect.provideService(OperationChecks, checks),
          Effect.provideService(OperationCatalog, operationCatalog),
        ),
      ).toBe('read');
      expect(
        yield* triggered('read_block', operator, Effect.succeed('operator')).pipe(
          Effect.provideService(OperationChecks, checks),
          Effect.provideService(OperationCatalog, operationCatalog),
        ),
      ).toBe('operator');
      expect(
        yield* triggered('submit_work', agent, Effect.succeed('tree')).pipe(
          Effect.provideService(OperationChecks, checks),
          Effect.provideService(OperationCatalog, operationCatalog),
        ),
      ).toBe('tree');
      expect(called).toEqual(['read_block']);
    }),
  );

  it.effect('the call site supplies caller, place and world to the performer without HTTP services', () =>
    Effect.gen(function* () {
      const operationCatalog = yield* OperationCatalog;
      const checked: string[] = [];
      const checks = OperationChecks.of({
        run: (id, _actor, work) =>
          Effect.suspend(() => {
            checked.push(id);
            return work;
          }),
        afterEdit: () => Effect.void,
      });
      const owners = (caller: Caller, place: CallerWorkspace['Service'], world: 'checkout') => {
        expect(caller).toBe(agent);
        expect(place?.root).toBe('/sample');
        expect(world).toBe('checkout');
        return Effect.succeed(Context.make(OperationChecks, checks).pipe(Context.add(OperationCatalog, operationCatalog)));
      };
      const body = { id: 'read_block', execute: () => Effect.map(CallerWorkspace, (place) => place?.root) };
      const result = yield* performIn(owners)(
        body,
        { blockIds: ['sample'] },
        {
          caller: agent,
          place: { root: '/sample', origin: null },
          world: 'checkout',
        },
      );
      expect(result).toBe('/sample');
      expect(checked).toEqual(['read_block']);
    }),
  );
});
