import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { holdingsAt } from '../../../landing/testing/doubles.js';
import { retireStoreOf } from '../../../change-record/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { FILE, MINE, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { lineWrites } from '../../lineWrites.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('the operator’s independent adjacent lines stay held, and explicit taking carries them afterward', () =>
    withCheckout((checkoutWorld) =>
      Effect.fnUntraced(function* () {
        const world = checkoutWorld;
        const operator = [...FILE.slice(0, 3), 'const four = 4; // operator', FILE[4] as string];
        yield* world.wrote('operator', operator);
        const both = [...operator.slice(0, 4), 'const five = 5; // mine'];
        yield* world.wrote(MINE, both);
        expect(yield* world.submit(MINE)).toMatchObject({ status: 'landed', carried: [] });
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
        const taken = yield* world.submit(MINE, { taking: [{ threadId: 'operator', label: 'operator' }] });
        expect(taken.status).toBe('landed');
        expect(yield* world.committed()).toEqual(both);
      })(),
    ),
  );
  it.effect(
    'an exit decision lands only on the version of the row it was decided for: a row joined meanwhile stays held for the next pass',
    () =>
      withCheckout((checkoutWorld) =>
        Effect.fnUntraced(function* () {
          const world = checkoutWorld;
          yield* world.wrote('operator', [...FILE.slice(0, 2), 'const three = 3; // operator', ...FILE.slice(3)]);
          const [row] = yield* world.rows();
          const store = yield* Effect.provide(retireStoreOf(world.store, world.units), world.context);
          const commit = 'c0ffee'.repeat(6).slice(0, 40);
          const stale = yield* Effect.provide(
            store.leave([{ id: row!.id, after: 'decided-before-the-join', state: 'committed', commit }], false),
            world.context,
          );
          expect(stale).toEqual([]);
          expect((yield* world.rows()).map((one) => one.state)).toEqual(['held']);
          yield* Effect.provide(store.leave([{ id: row!.id, after: row!.afterHash, state: 'committed', commit }], false), world.context);
          expect((yield* world.rows()).map((one) => [one.state, one.commit])).toEqual([['committed', commit]]);
        })(),
      ),
  );
  it.effect('the operator outlives every sweep of departed threads, and a commit carrying their lines stamps them committed', () =>
    withCheckout((checkoutWorld) =>
      Effect.fnUntraced(function* () {
        const world = checkoutWorld;
        const rig = yield* Effect.provide(holdingsAt(world.git, world.root, world.store, world.units, lineWrites), world.context);
        const checkout = RootId.make(TEST_CHECKOUT);
        yield* world.wrote('operator', [...FILE.slice(0, 2), 'const three = 3; // operator', ...FILE.slice(3)]);
        yield* Effect.provide(rig.retirement.start, world.context);
        yield* Effect.provide(rig.retirement.pass(checkout), world.context);
        expect((yield* world.rows()).map((row) => row.state)).toEqual(['held']);
        yield* world.run(['add', '--', 'src/a.ts']);
        yield* world.run(['-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-q', '-m', 'the operator commits']);
        const commit = yield* world.run(['rev-parse', 'HEAD']);
        yield* Effect.provide(rig.retirement.pass(checkout), world.context);
        expect((yield* world.rows()).map((row) => [row.holder, row.state, row.commit])).toEqual([['operator', 'committed', commit]]);
      })(),
    ),
  );
});
