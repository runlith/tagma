import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { HoldingsFrame } from '../../../change-record/contract/wire/holdings.js';
import type { ThreadChangesFrame } from '../../../change-record/contract/wire/threadChanges.js';
import { BORN, GROWN, MINE, PROJECT, edited, fixture, layers } from './threadFilesWorld.js';

layer(layers, { excludeTestServices: true })('change channels', (it) => {
  it.effect('one edit reaches each channel as one change carrying the one path it moved', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      yield* world.holdings.settled(world.rootId);

      const holdings = yield* Stream.toPull(world.holdings.subscribe(world.rootId));
      const changes = yield* Stream.toPull(world.changes.subscribe(PROJECT, MINE, world.rootId, 30));
      const wholeHoldings = (yield* holdings)[0] as HoldingsFrame;
      const wholeChanges = (yield* changes)[0] as ThreadChangesFrame;
      expect(wholeHoldings).toMatchObject({ kind: 'whole', paths: [{ path: 'kept.txt' }] });
      expect(wholeChanges).toMatchObject({ kind: 'whole', held: { paths: 1, unproven: 0 } });

      const grown = `${GROWN}three\n`;
      yield* world.files.writeFileString(at, grown);
      yield* edited(world.mine, at, GROWN, grown);
      yield* world.holdings.settled(world.rootId);

      const nextHoldings = (yield* holdings).find((frame) => frame.kind === 'change' && frame.changed.length > 0);
      const nextChanges = (yield* changes).find(
        (frame) => frame.kind === 'change' && frame.checkouts.some((one) => one.changed.length > 0),
      );
      expect(nextHoldings).toMatchObject({ kind: 'change', changed: [{ path: 'kept.txt', lines: { added: 2, removed: 0 } }], gone: [] });
      expect(nextChanges).toMatchObject({
        kind: 'change',
        uncommitted: { added: 2, removed: 0 },
        checkouts: [
          {
            uncommitted: { added: 2, removed: 0 },
            changed: [{ section: 'uncommitted', path: 'kept.txt', lines: { added: 2, removed: 0 } }],
            gone: [],
          },
        ],
      });
    }),
  );
});
