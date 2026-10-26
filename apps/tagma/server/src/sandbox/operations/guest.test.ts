import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Schema } from 'effect';
import { ChangeScope } from '../../change-record/contract/service/scope.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { GuestPreparation } from '../contract/service/preparation.js';
import { Sandboxes } from '../contract/service/sandboxes.js';
import { GUEST_OPERATIONS } from '../contract/wire/operations/guest.js';
import { GUEST_ROUTED } from './guest.js';

const unused = () => Effect.die('a conflicting sandbox source reached a resource');
const floor = Context.make(ChangeScope, ChangeScope.of({ projectId: Effect.succeed(7) })).pipe(
  Context.add(GraphDirectory, '.tagma'),
  Context.add(GuestPreparation, GuestPreparation.of({ commitOf: unused })),
  Context.add(
    Sandboxes,
    Sandboxes.of({
      prepare: unused,
      byId: unused,
      ofThread: unused,
      records: unused,
      admit: unused,
      ready: unused,
      acquire: unused,
      release: unused,
      discard: unused,
      cleanup: unused,
      condemnUnfinished: unused,
      reconcile: unused,
    }),
  ),
);

it.effect('a prepared tree excludes a second source or recipe before preparation and names every conflicting input', () =>
  Effect.gen(function* () {
    for (const [conflict, fields] of [
      [{ commit: 'HEAD' }, ['commit']],
      [{ setup: [['/bin/sh', '-c', 'true']], exclude: ['docs'] }, ['setup', 'exclude']],
    ] as const) {
      const input = yield* Schema.decodeUnknownEffect(GUEST_OPERATIONS.prepare_sandbox.input)({ preparedTree: 'artifact', ...conflict });
      const refused = yield* Effect.flip(
        GUEST_ROUTED.prepare_sandbox.route.execute(input, undefined, { actor: { kind: 'operator' }, files: null }),
      );
      expect(refused).toMatchObject({ code: 'selection-shape' });
      for (const field of fields) expect(refused.reason).toContain(field);
    }
  }).pipe(Effect.provide(floor)),
);
