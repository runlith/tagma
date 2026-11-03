import { layer } from '@runlith/effect-test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Clock, Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { CommandWalks, commandWalksLayer } from '../change-record/commandWorld.js';
import { journalOf, WRITER_WINDOW } from '../../../change-record/testing/doubles.js';
import { holdingsAt } from '../../../landing/testing/doubles.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { FILE, MINE, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { declaration, FORMATTER, steppedOver, tool } from '../stepsFixture.js';
layer(Layer.mergeAll(checkoutFixture, commandWalksLayer, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect('a landing releases its committed and clean paths while an excluded dirty path stays held', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const base = `${FILE.join('\n')}\n`;
        const changed = [...FILE.slice(0, 4), 'const five = 50;'];
        yield* world.wrote(MINE, changed);
        const rig = yield* Effect.provide(holdingsAt(world.git, world.root, world.store, world.units), world.context);
        yield* Effect.provide(rig.holdings.judged(RootId.make(TEST_CHECKOUT), ['src/a.ts']), world.context);
        yield* world.wrote(MINE, FILE);
        const temporary = join(world.root, 'src', 'temporary.ts');
        const text = 'export const temporary = true;\n';
        writeFileSync(temporary, text);
        yield* world.record(MINE, '', text, { path: 'src/temporary.ts', origin: 'write' });
        unlinkSync(temporary);
        yield* world.record(MINE, text, '', { path: 'src/temporary.ts', origin: 'delete' });
        const pending = 'export const pending = true;\n';
        writeFileSync(join(world.root, 'src', 'pending.ts'), pending);
        yield* world.record(MINE, '', pending, { path: 'src/pending.ts', origin: 'write' });
        const carried = 'export const carried = true;\n';
        writeFileSync(join(world.root, 'src', 'carried.ts'), carried);
        yield* world.record(MINE, '', carried, { path: 'src/carried.ts', origin: 'write' });
        const answer = yield* world.submit(MINE, { paths: ['src/carried.ts'] });
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.committed).toEqual(['src/carried.ts']);
        expect(answer.left).toEqual([{ path: 'src/pending.ts', reason: 'paths' }]);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts', 'src/temporary.ts', 'src/carried.ts'])).toBe('');
        expect(readFileSync(world.file, 'utf8')).toBe(base);
        const rows = yield* world.rows();
        expect(rows.filter((row) => row.state === 'held').map((row) => row.path)).toEqual(['src/pending.ts']);
        expect(rows.filter((row) => row.path === 'src/carried.ts').map((row) => row.commit)).toEqual([answer.commit]);
        expect(rows.filter((row) => row.path === 'src/a.ts' || row.path === 'src/temporary.ts').map((row) => row.reason)).toEqual([
          'reverted',
          'reverted',
          'reverted',
          'reverted',
        ]);
      })(),
    ),
  );
  it.effect('left names only the paths whose lines still stand, while an open command window keeps the landed rows in the record', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const journal = yield* Effect.provide(journalOf(world.store, world.units, yield* CommandWalks), world.context);
        const window = randomUUID();
        yield* Effect.acquireUseRelease(
          Effect.provide(
            journal.opened({
              id: window,
              projectId: world.projectId,
              threadId: MINE,
              runHint: null,
              checkout: TEST_CHECKOUT,
              spelling: world.root,
              openedAt: yield* Clock.currentTimeMillis,
              ...WRITER_WINDOW,
            }),
            world.context,
          ),
          () =>
            Effect.gen(function* () {
              yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 50;']);
              const pending = 'export const pending = true;\n';
              writeFileSync(join(world.root, 'src', 'pending.ts'), pending);
              yield* world.record(MINE, '', pending, { path: 'src/pending.ts', origin: 'write' });
              const answer = yield* world.submit(MINE, { paths: ['src/a.ts'] });
              expect(answer.status).toBe('landed');
              if (answer.status !== 'landed') return;
              expect(answer.committed).toEqual(['src/a.ts']);
              expect(answer.left).toEqual([{ path: 'src/pending.ts', reason: 'paths' }]);
            }),
          () => Effect.provide(journal.closed([window]), world.context),
        );
      })(),
    ),
  );
  it.effect('a formatter landing commits the session’s rows and leaves no holdings on its clean working path', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* tool(world.root, 'fmt.sh', FORMATTER);
        yield* declaration(world.root, [{ run: ['tools/fmt.sh'], files: ['src/**'] }]);
        yield* world.run(['add', '--', 'tools', 'tagma.config.ts']);
        yield* world.run(['commit', '-q', '-m', 'declare the formatter']);
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 50;   ']);
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 500;   ']);
        const answer = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.left ?? []).toEqual([]);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts'])).toBe('');
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 500;']);
        const rows = yield* world.rows();
        expect(rows.filter((row) => row.state === 'held')).toEqual([]);
        expect(rows.map((row) => [row.state, row.commit, row.reason])).toEqual([
          ['withdrawn', null, 'overwritten'],
          ['committed', answer.commit, null],
        ]);
      })(),
    ),
  );
});
