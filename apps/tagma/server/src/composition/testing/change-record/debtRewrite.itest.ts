import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import {} from '@runlith/effect-test';
import { readFileSync } from 'node:fs';
import { Effect } from 'effect';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import { idleCommands } from '../../../change-record/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { recordOver } from '../landingServices.js';
import { MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a deferred block move never inserts a second copy while a peer keeps its old copy from being removed', () =>
    withCheckout((checkoutWorld) =>
      Effect.gen(function* () {
        const w = checkoutWorld;
        const rig = yield* holdingsOver(w.store, w.units, w.git, w.root, undefined, undefined, lineWrites);
        const record = yield* recordOver(w.store, w.units, yield* idleCommands());
        const files = makeMachineWorld(() => null).files;
        if (files === undefined) return yield* Effect.die('the test world needs files');
        const base = '    );\n  const ports = Layer.mergeAll(\n    features,\n  );\n';
        const shaped = '      );\n    const ports = Layer.mergeAll(\n      features,\n    );\n';
        yield* w.wrote(MINE, base.trimEnd().split('\n'));
        yield* w.run(['add', 'src/a.ts']);
        yield* w.run(['commit', '-qm', 'prepare a block move']);
        const peer = base.replace('    features,\n', '    features,\n    peer,\n');
        yield* w.wrote(THEIRS, peer.trimEnd().split('\n'));
        const blob = (text: string): string =>
          Bun.spawnSync(['git', '-C', w.root, 'hash-object', '-w', '--stdin', '--path=src/a.ts'], {
            stdin: new TextEncoder().encode(text),
          })
            .stdout.toString()
            .trim();
        const checkout = { projectId: w.projectId, root: w.root, origin: w.originFor(MINE), git: w.git };
        const head = yield* w.run(['rev-parse', 'HEAD']);
        const outcomes = yield* Effect.flatMap(
          record.reshapeRead(checkout, [{ path: 'src/a.ts', before: blob(base), after: blob(shaped) }]),
          (inputs) => record.reshape(checkout, inputs, { _tag: 'unheld' }, { commit: head, source: 'steps' }),
        ).pipe(Effect.provideService(LineWrites, lineWrites), Effect.provide(files));
        expect(outcomes).toEqual([{ _tag: 'kept', path: 'src/a.ts', why: 'conflict', owed: true }]);
        const pending = yield* rig.retirement.settle(RootId.make(TEST_CHECKOUT));
        expect(readFileSync(w.file, 'utf8')).toBe(peer);
        expect(pending).toBe(0);
        yield* w.wrote(THEIRS, base.trimEnd().split('\n'));
        expect(yield* rig.retirement.settle(RootId.make(TEST_CHECKOUT))).toBe(1);
        expect(readFileSync(w.file, 'utf8')).toBe(shaped);
        expect(yield* rig.retirement.settle(RootId.make(TEST_CHECKOUT))).toBe(0);
        expect(readFileSync(w.file, 'utf8')).toBe(shaped);
      }),
    ),
  );
});
