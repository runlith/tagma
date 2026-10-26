import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
import type { ActChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { FILE, MINE, THEIRS, type makeCheckout, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { declaration, FAILING, FORMATTER, HEADING, SLEEPING, steppedOver, tool } from '../stepsFixture.js';
type World = Effect.Success<ReturnType<typeof makeCheckout>>;
const STEP = { run: ['tools/fmt.sh'], files: ['src/**'] };
const declared = Effect.fnUntraced(function* (
  world: World,
  steps: readonly object[] = [STEP],
  extra: Effect.Effect<void, unknown, FileSystem.FileSystem> = Effect.void,
) {
  yield* tool(world.root, 'fmt.sh', FORMATTER);
  yield* tool(world.root, 'fail.sh', FAILING);
  yield* tool(world.root, 'sleep.sh', SLEEPING);
  yield* declaration(world.root, steps);
  yield* extra;
  yield* world.run(['add', '-A']);
  yield* world.run(['commit', '-q', '-m', 'declare the steps']);
});
const bytes = (world: World, path = 'src/a.ts'): string => readFileSync(join(world.root, path), 'utf8');
layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect('accepted fixing steps form only eligible files, and the judged tree is committed and carried to disk', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        yield* declared(
          world,
          [{ ...STEP, ok: [0, 1] }],
          Effect.andThen(
            tool(world.root, 'fmt.sh', `${FORMATTER}exit 1\n`),
            Effect.sync(() => {
              writeFileSync(join(world.root, '.gitattributes'), '*.lfs filter=lfs\n');
              writeFileSync(join(world.root, 'src', 'gone.ts'), 'const gone = 1;\n');
            }),
          ),
        );
        const stepped = yield* steppedOver(world.store);
        const judged: string[] = [];
        const checks: ActChecks = {
          before: (subject) => Effect.sync(() => (subject.kind === 'tree' && judged.push(subject.built), UNCHECKED)),
          after: () => Effect.void,
        };
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine   ']);
        rmSync(join(world.root, 'src', 'gone.ts'));
        yield* world.record(MINE, 'const gone = 1;\n', '', { path: 'src/gone.ts', origin: 'delete' });
        symlinkSync('a.ts', join(world.root, 'src', 'link.ts'));
        yield* world.record(MINE, '', 'a.ts', { path: 'src/link.ts', origin: 'write' });
        writeFileSync(join(world.root, 'src', 'pointer.lfs'), 'pointer   \n');
        yield* world.record(MINE, '', 'pointer   \n', { path: 'src/pointer.lfs', origin: 'write' });
        writeFileSync(join(world.root, 'src', 'blob.ts'), 'a\0b   \n');
        yield* world.record(MINE, '', 'a\0b   \n', { path: 'src/blob.ts', origin: 'write' });
        const answer = yield* world.submit(MINE, { shape: stepped.shape, checks });
        expect(answer).toMatchObject({
          status: 'landed',
          committed: ['src/a.ts', 'src/blob.ts', 'src/gone.ts', 'src/link.ts', 'src/pointer.lfs'],
          edited: ['src/a.ts'],
        });
        const formatted = [...FILE.slice(0, 4), 'const five = 5; // mine'];
        expect(yield* world.committed()).toEqual(formatted);
        expect(bytes(world)).toBe(`${formatted.join('\n')}\n`);
        expect(yield* world.run(['status', '--porcelain'])).toBe('');
        const landed = yield* world.run(['rev-parse', 'HEAD']);
        expect((yield* world.rows()).map((row) => row.commit)).toEqual([landed, landed, landed, landed, landed]);
        const tree = yield* world.run(['rev-parse', 'HEAD^{tree}']);
        expect(judged).toEqual([tree]);
        expect(yield* world.run(['show', `${tree}:src/a.ts`])).toBe(formatted.join('\n'));
        expect(yield* world.run(['show', 'HEAD:src/blob.ts'])).toBe('a\0b   ');
        expect(yield* world.run(['ls-tree', 'HEAD', '--', 'src/link.ts'])).toContain('120000 blob');
        expect(yield* world.run(['show', 'HEAD:src/pointer.lfs'])).toBe('pointer   ');
        expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/a.ts.beside', 'src/gone.ts'])).toBe('');
      })(),
    ),
  );
  it.effect('a line the step wraps over several lines lands as the session’s committed line', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const wrapping =
          '#!/bin/sh\nfor file in "$@"; do awk \'{ gsub(/ \\+ /, " +\\n  "); print }\' "$file" > "$file.next" && mv "$file.next" "$file"; done\n';
        yield* declared(world, [{ run: ['tools/wrap.sh'], files: ['src/**'] }], tool(world.root, 'wrap.sh', wrapping));
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5 + 6 + 7;']);
        const answer = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(answer).toMatchObject({ status: 'landed', edited: ['src/a.ts'] });
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5 +', '  6 +', '  7;']);
        const landed = yield* world.run(['rev-parse', 'HEAD']);
        expect((yield* world.rows()).map((row) => [row.state, row.commit])).toEqual([['committed', landed]]);
      })(),
    ),
  );
  it.effect('a change the step turns into what HEAD holds answers nothing, and the working file takes HEAD form', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* declared(world);
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5;   ']);
        const answer = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(answer).toMatchObject({ status: 'nothing', edited: ['src/a.ts'] });
        expect(bytes(world)).toBe(`${FILE.join('\n')}\n`);
        expect((yield* world.rows()).map((row) => [row.state, row.reason])).toEqual([['withdrawn', 'formed']]);
      })(),
    ),
  );
  it.effect(
    "a file with another session's lines lands only this session's lines in the step's form, the peer's lines stay on disk, and the delta is nobody's",
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(world);
          const stepped = yield* steppedOver(world.store);
          const theirs = [FILE[0] as string, 'const two = 2; // theirs  ', ...FILE.slice(2)];
          yield* world.wrote(THEIRS, theirs);
          yield* world.wrote(MINE, [...theirs.slice(0, 4), 'const five = 5; // mine  ']);
          const mine = yield* world.submit(MINE, { shape: stepped.shape });
          expect(mine).toMatchObject({ status: 'landed', edited: ['src/a.ts'] });
          expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
          expect(bytes(world)).toBe(`${[...theirs.slice(0, 4), 'const five = 5; // mine'].join('\n')}\n`);
          expect((yield* world.rows()).filter((row) => row.holder === MINE).every((row) => row.commit !== null)).toBe(true);
          const peer = yield* world.submit(THEIRS, { shape: stepped.shape });
          expect(peer.status).toBe('landed');
          expect(yield* world.committed()).toEqual([
            FILE[0] as string,
            'const two = 2; // theirs',
            ...FILE.slice(2, 4),
            'const five = 5; // mine',
          ]);
          expect(yield* world.run(['status', '--porcelain'])).toBe('');
        })(),
      ),
  );
  const refusal = Effect.fnUntraced(function* (world: World, work: ReturnType<World['submitAs']>) {
    const refused = yield* Effect.provide(Effect.flip(work), world.context);
    if (!(refused instanceof GateRefusal)) return yield* Effect.die(new Error(`expected a refusal, got ${String(refused)}`));
    return refused;
  });
  for (const [code, run, options] of [
    ['format-missing', ['tools/not-installed'], {}],
    ['format-failed', ['tools/fail.sh'], {}],
    ['format-cut', ['tools/sleep.sh'], { timeMs: 200 }],
  ] as const) {
    it.effect(
      `a step that is ${code.replace('format-', '')} refuses, publishes nothing and leaves the disk and the record as they stood`,
      () =>
        withCheckout((checkout) =>
          Effect.fnUntraced(function* () {
            const world = checkout;
            yield* declared(world, [{ run, files: ['src/**'] }]);
            yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine   ']);
            const head = yield* world.run(['rev-parse', 'HEAD']);
            const before = bytes(world);
            const refused = yield* refusal(world, world.submitAs(MINE, { shape: (yield* steppedOver(world.store, options)).shape }));
            expect(refused.code).toBe(code);
            expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(head);
            expect(bytes(world)).toBe(before);
            expect(yield* world.run(['status', '--porcelain'])).toBe(' M src/a.ts');
            expect((yield* world.rows()).every((row) => row.commit === null)).toBe(true);
          })(),
        ),
    );
  }
  it.effect('a nearby step finds its program and ancestor config before a whole-tree step reads tracked files elsewhere', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        const marking = '#!/bin/sh\nmark=$(cat config/mark) || exit 1\nfor file in "$@"; do echo "// $mark" >> "$file"; done\n';
        const nearby = '#!/bin/sh\nmark=$(cat .mark) || exit 1\nfor file in "$@"; do echo "// $mark" >> "$file"; done\n';
        yield* declared(
          world,
          [{ run: ['tools/near.sh'], files: ['src/**'], reads: 'nearby' }],
          Effect.gen(function* () {
            yield* tool(world.root, 'mark.sh', marking);
            yield* tool(world.root, 'near.sh', nearby);
            mkdirSync(join(world.root, 'config'));
            writeFileSync(join(world.root, 'config', 'mark'), 'seen\n');
            writeFileSync(join(world.root, '.mark'), 'near\n');
          }),
        );
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        const near = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(near.status).toBe('landed');
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine', '// near']);
        yield* declaration(world.root, [{ run: ['tools/mark.sh'], files: ['src/**'] }]);
        yield* world.run(['add', '--', 'tagma.config.ts']);
        yield* world.run(['commit', '-qm', 'the whole-tree step']);
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 55; // mine']);
        const whole = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape });
        expect(whole.status).toBe('landed');
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 55; // mine', '// seen']);
      })(),
    ),
  );
  it.effect(
    'a violation in the form the steps gave a file carried whole with a peer’s line is attributed to the peer through the lines the steps moved',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(world, [{ run: ['tools/head.sh'], files: ['src/**'] }], tool(world.root, 'head.sh', HEADING));
          const theirs = [FILE[0] as string, 'const two = 2; // theirs', 'const three = 3; // theirs', ...FILE.slice(3)];
          yield* world.wrote(THEIRS, theirs);
          yield* world.wrote(MINE, [...theirs.slice(0, 2), 'const three = 3; // theirs, then mine', ...theirs.slice(3)]);
          const held: (readonly (readonly string[])[])[] = [];
          const checks: ActChecks = {
            before: (subject) =>
              subject.kind === 'tree' && subject.holders !== undefined
                ? Effect.map(
                    Effect.orDie(subject.holders([1, 2, 3].map((line) => ({ file: 'src/a.ts', line })))),
                    (found) => (held.push(found), UNCHECKED),
                  )
                : Effect.succeed(UNCHECKED),
            after: () => Effect.void,
          };
          const answer = yield* world.submit(MINE, { shape: (yield* steppedOver(world.store)).shape, checks, whole: ['src/a.ts'] });
          expect(answer).toMatchObject({ status: 'landed', carried: [{ path: 'src/a.ts', holders: [THEIRS] }] });
          expect(held).toEqual([[[], [], [THEIRS]]]);
        })(),
      ),
  );
  it.effect(
    "a hook refusing after the steps ran leaves the step's form and the hook's fix together in the working file, and the next landing carries both",
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* declared(world);
          const stepped = yield* steppedOver(world.store);
          yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine   ']);
          const hook = join(world.root, '.git', 'hooks', 'pre-commit');
          writeFileSync(hook, "#!/bin/sh\nsed 's/mine/MINE/' src/a.ts > src/a.ts.next && mv src/a.ts.next src/a.ts\nexit 1\n");
          chmodSync(hook, 0o755);
          const refused = yield* world.submit(MINE, { shape: stepped.shape });
          expect(refused).toMatchObject({ status: 'refused', edited: ['src/a.ts'] });
          const fixed = [...FILE.slice(0, 4), 'const five = 5; // MINE'];
          expect(bytes(world)).toBe(`${fixed.join('\n')}\n`);
          writeFileSync(hook, '#!/bin/sh\n');
          expect(yield* world.submit(MINE, { shape: stepped.shape })).toMatchObject({ status: 'landed' });
          expect(yield* world.committed()).toEqual(fixed);
        })(),
      ),
  );
});
