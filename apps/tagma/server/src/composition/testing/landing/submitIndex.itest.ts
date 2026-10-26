import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('an operator’s staged executable bit survives a landing whose carrier recorded the staged text as its preimage', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.run(['update-index', '--chmod=+x', '--', 'src/a.ts']);
        const staged = yield* world.run(['ls-files', '--stage', '--', 'src/a.ts']);
        const mine = [...FILE.slice(0, 4), 'const five = 55;'];
        yield* world.wrote(MINE, mine);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(yield* world.committed()).toEqual(mine);
        expect(yield* world.run(['ls-files', '--stage', '--', 'src/a.ts'])).toBe(staged);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/a.ts');
      })(),
    ),
  );
  it.effect('a shell rename followed by an edit lands with a clean index, while unrelated operator staging survives', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const before = readFileSync(world.file, 'utf8');
        yield* world.run(['mv', '--', 'src/a.ts', 'src/b.ts']);
        const after = `${[...FILE.slice(0, 4), 'const five = 55;'].join('\n')}\n`;
        writeFileSync(join(world.root, 'src/b.ts'), after);
        yield* world.record(MINE, before, '', { origin: 'delete' });
        yield* world.record(MINE, '', after, { path: 'src/b.ts', origin: 'write' });
        writeFileSync(join(world.root, 'src/operator.ts'), 'const operator = 1;\n');
        yield* world.run(['add', '--', 'src/operator.ts']);
        const staged = yield* world.run(['rev-parse', ':src/operator.ts']);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.committed).toEqual(['src/a.ts', 'src/b.ts']);
        expect(yield* world.run(['show', 'HEAD:src/b.ts'])).toBe(after.trimEnd());
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts', 'src/b.ts'])).toBe('');
        expect(yield* world.run(['rev-parse', ':src/operator.ts'])).toBe(staged);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/operator.ts');
        expect((yield* world.rows()).filter((row) => row.commit === null)).toEqual([]);
      })(),
    ),
  );
  it.effect('a staged preimage recorded only as the before text of a carrier edit is brought level with the landing', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const path = 'src/b.ts';
        const before = 'const b = 1;\n';
        const after = 'const b = 2;\n';
        writeFileSync(join(world.root, path), before);
        yield* world.run(['add', '--', path]);
        writeFileSync(join(world.root, path), after);
        yield* world.record(MINE, before, after, { path });
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(yield* world.run(['show', 'HEAD:src/b.ts'])).toBe(after.trimEnd());
        expect(yield* world.run(['status', '--porcelain', '--', path])).toBe('');
      })(),
    ),
  );
  it.effect('an index level with the base is brought level with the landing when a peer’s still-held text is that base', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(THEIRS, [FILE[0] as string, 'const two = 22;', ...FILE.slice(2)]);
        yield* world.wrote(THEIRS, FILE);
        const mine = [...FILE.slice(0, 4), 'const five = 55;'];
        yield* world.wrote(MINE, mine);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        expect(yield* world.committed()).toEqual(mine);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts'])).toBe('');
      })(),
    ),
  );
  it.effect('a peer’s staged version remains staged when it is also the preimage of the landing session’s edit', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const theirs = [FILE[0] as string, 'const two = 22;', ...FILE.slice(2)];
        yield* world.wrote(THEIRS, theirs);
        yield* world.run(['add', '--', 'src/a.ts']);
        const staged = yield* world.run(['rev-parse', ':src/a.ts']);
        const both = [...theirs.slice(0, 4), 'const five = 55;'];
        yield* world.wrote(MINE, both);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.carried).toEqual([]);
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 55;']);
        expect(readFileSync(world.file, 'utf8')).toBe(`${both.join('\n')}\n`);
        expect(yield* world.run(['rev-parse', ':src/a.ts'])).toBe(staged);
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/a.ts');
      })(),
    ),
  );
});
