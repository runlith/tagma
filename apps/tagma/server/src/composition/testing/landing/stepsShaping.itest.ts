import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { FILE, MINE, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { declaration, EXECUTABLE, FORMATTER, STRAY, steppedOver, tool } from '../stepsFixture.js';
type World = Effect.Success<ReturnType<typeof makeCheckout>>;
const declared = Effect.fnUntraced(function* (
  world: World,
  steps: readonly object[],
  extra: Effect.Effect<void, unknown, FileSystem.FileSystem> = Effect.void,
) {
  yield* tool(world.root, 'fmt.sh', FORMATTER);
  yield* tool(world.root, 'stray.sh', STRAY);
  yield* tool(world.root, 'exec.sh', EXECUTABLE);
  yield* declaration(world.root, steps);
  yield* extra;
  yield* world.run(['add', '-A']);
  yield* world.run(['commit', '-q', '-m', 'declare the steps']);
});
const MESSY = [...FILE.slice(0, 4), 'const five = 5; // mine   '];
layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'a step that writes beside its files does not hand that write to the next step, and a bare glob reaches the file in any directory',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(
            world,
            [
              { run: ['tools/stray.sh'], files: ['a.ts'] },
              { run: ['tools/fmt.sh'], files: ['b.ts'] },
            ],
            Effect.sync(() => writeFileSync(join(world.root, 'src', 'b.ts'), 'const b = 1;\n')),
          );
          yield* world.wrote(MINE, MESSY);
          yield* world.wrote(MINE, ['const b = 1;   '], { path: 'src/b.ts' });
          const stepped = yield* steppedOver(world.store);
          const answer = yield* world.submit(MINE, { shape: stepped.shape });
          expect(answer.status).toBe('landed');
          expect(stepped.launches.map((launch) => [...launch.argv, ...(launch.operands ?? [])])).toEqual([
            ['tools/stray.sh', 'src/a.ts'],
            ['tools/fmt.sh', 'src/b.ts'],
          ]);
          expect(yield* world.run(['show', 'HEAD:src/b.ts'])).toBe('const b = 1;');
          expect(readFileSync(join(world.root, 'src', 'b.ts'), 'utf8')).toBe('const b = 1;\n');
        })(),
      ),
  );
  it.effect('step selection preserves raw-looking names with tabs and newlines while leaving binary content alone', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const odd = ':100644\t1\nb.ts';
        yield* declared(
          world,
          [{ run: ['tools/fmt.sh'], files: ['*.ts'] }],
          Effect.sync(() => writeFileSync(join(world.root, odd), 'const odd = 0;\n')),
        );
        yield* world.wrote(MINE, ['const odd = 1;   '], { path: odd });
        writeFileSync(join(world.root, 'blob.ts'), 'a\0b   \n');
        yield* world.record(MINE, '', 'a\0b   \n', { path: 'blob.ts', origin: 'write' });
        const stepped = yield* steppedOver(world.store);
        expect((yield* world.submit(MINE, { shape: stepped.shape })).status).toBe('landed');
        expect(stepped.launches.map((launch) => launch.operands)).toEqual([[odd]]);
        expect(yield* world.run(['show', `HEAD:${odd}`])).toBe('const odd = 1;');
        expect(yield* world.run(['show', 'HEAD:blob.ts'])).toBe('a\0b   ');
      })(),
    ),
  );
  it.effect('a step that makes a file executable lands the mode and gives it to the working file', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* declared(world, [{ run: ['tools/exec.sh'], files: ['src/**'] }]);
        yield* world.wrote(MINE, MESSY);
        const answer = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(answer).toMatchObject({ status: 'landed', edited: ['src/a.ts'] });
        expect(yield* world.run(['ls-tree', 'HEAD', '--', 'src/a.ts'])).toStartWith('100755');
        expect(yield* world.run(['status', '--porcelain'])).toBe('');
      })(),
    ),
  );
  it.effect(
    'a landing retried after HEAD moved a file its config imports runs its steps again rather than taking the first attempt’s answer',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(
            world,
            [],
            Effect.sync(() => {
              writeFileSync(join(world.root, 'tagma.config.ts'), `import { format } from './tools/format';\nexport default { format };\n`);
              writeFileSync(
                join(world.root, 'tools', 'format.ts'),
                `export const format = { fmt: { run: ['tools/fmt.sh'], files: ['src/**'] } };\n`,
              );
            }),
          );
          yield* world.wrote(MINE, MESSY);
          const redeclared = Effect.fnUntraced(function* () {
            const at = join(world.root, 'tools', 'format.ts');
            writeFileSync(at, `${readFileSync(at, 'utf8')}\n`);
            yield* world.run(['commit', '-q', '-m', 'moved', '--', 'tools/format.ts']);
          });
          const stepped = yield* steppedOver(world.store, { keyed: { afterFirst: redeclared } });
          const answer = yield* world.submit(MINE, { shape: stepped.shape });
          expect(answer.status).toBe('landed');
          expect(stepped.launches).toHaveLength(2);
          expect(new Set(stepped.launches.map((launch) => launch.operation)).size).toBe(2);
          expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
        })(),
      ),
  );
  it.effect(
    'one commit on the operator’s word goes through a config that is not valid, while a commit without it refuses config-invalid',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(
            world,
            [],
            Effect.sync(() => writeFileSync(join(world.root, 'tagma.config.ts'), 'export default { format: { bad: { run: 3 } } };\n')),
          );
          yield* world.wrote(MINE, MESSY);
          const stepped = yield* steppedOver(world.store);
          const refused = yield* Effect.provide(Effect.flip(world.submitAs(MINE, { shape: stepped.shape })), world.context);
          expect(refused).toMatchObject({ code: 'config-invalid' });
          const answer = yield* world.submit(MINE, { shape: stepped.shape, withoutFormat: true });
          expect(answer).toMatchObject({ status: 'landed', formatSkipped: true });
        })(),
      ),
  );
});
