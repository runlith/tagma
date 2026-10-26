import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import {} from '@runlith/effect-test';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import type { ReshapeHolder, ReshapeMode } from '../../../change-record/contract/wire/reshape.js';
import { idleCommands, naming } from '../../../change-record/testing/doubles.js';
import { recordOver } from '../landingServices.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
const base = `${FILE.join('\n')}\n`;
const stand = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof makeCheckout>>, writes: LineWrites['Service'] = lineWrites) {
  const commands = yield* idleCommands();
  const record = yield* recordOver(w.store, w.units, commands);
  const files = makeMachineWorld(() => null).files;
  if (files === undefined) return yield* Effect.die('the test world needs files');
  const checkout = { projectId: w.projectId, root: w.root, origin: w.originFor(MINE), git: w.git };
  const blob = (text: string): string => {
    const hashed = Bun.spawnSync(['git', '-C', w.root, 'hash-object', '-w', '--stdin', '--path=src/a.ts'], {
      stdin: new TextEncoder().encode(text),
    });
    return hashed.stdout.toString().trim();
  };
  const reshape = (before: string | null, after: string | null, holder: ReshapeHolder, path = 'src/a.ts', mode?: ReshapeMode) =>
    Effect.flatMap(
      record.reshapeRead(checkout, [
        {
          path,
          before: before === null ? null : blob(before),
          after: after === null ? null : blob(after),
          mode,
        },
      ]),
      (inputs) => record.reshape(checkout, inputs, holder),
    ).pipe(Effect.provideService(LineWrites, writes), Effect.provide(files));
  return { w, reshape, commands, checkout, bytes: () => readFileSync(w.file, 'utf8') };
});
const shaped = (text: string): string => text.replace('const one = 1;', 'const one = 1; // shaped');
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a delta merges into a file holding another session’s lines, and those lines stay and nobody holds the delta', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const theirs = base.replace('const three = 3;', 'const three = 30;');
        writeFileSync(s.w.file, theirs);
        const [outcome] = yield* s.reshape(base, shaped(base), { _tag: 'unheld' });
        expect(outcome).toEqual({ _tag: 'merged', path: 'src/a.ts' });
        expect(s.bytes()).toBe(shaped(theirs));
        expect(yield* s.w.rows()).toEqual([]);
      }),
    ),
  );
  it.effect('a held delta lands in a file nobody else touched and becomes the session’s own row', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.w.namedAgent(MINE, { name: MINE, task: 'shaped lines' });
        const [outcome] = yield* s.reshape(base, shaped(base), { _tag: 'held', work: { projectId: s.w.projectId, threadId: MINE } });
        expect(outcome).toEqual({ _tag: 'merged', path: 'src/a.ts' });
        expect(s.bytes()).toBe(shaped(base));
        expect((yield* s.w.rows()).map((row) => row.holder)).toEqual([MINE]);
      }),
    ),
  );
  it.effect('a delta over lines another session rewrote conflicts and a vanished file is left as it stands', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const theirs = base.replace('const one = 1;', 'const one = 100;');
        writeFileSync(s.w.file, theirs);
        expect(yield* s.reshape(base, shaped(base), { _tag: 'unheld' })).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'conflict', owed: false },
        ]);
        expect(s.bytes()).toBe(theirs);
        rmSync(s.w.file);
        expect(yield* s.reshape(base, shaped(base), { _tag: 'unheld' })).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'moved', owed: false },
        ]);
      }),
    ),
  );
  it.effect('a CRLF file holding another session’s line takes the delta without conflicting whole', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* Effect.acquireUseRelease(
          s.w.run(['config', 'core.autocrlf', 'true']),
          () =>
            Effect.gen(function* () {
              const crlf = (text: string): string => text.replaceAll('\n', '\r\n');
              writeFileSync(s.w.file, crlf(base.replace('const three = 3;', 'const three = 30;')));
              const [outcome] = yield* s.reshape(base, shaped(base), { _tag: 'unheld' });
              expect(outcome).toEqual({ _tag: 'merged', path: 'src/a.ts' });
              expect(readFileSync(s.w.file)).toEqual(Buffer.from(crlf(shaped(base.replace('const three = 3;', 'const three = 30;')))));
            }),
          () => Effect.asVoid(s.w.run(['config', '--unset', 'core.autocrlf'])),
        );
      }),
    ),
  );
  it.effect('a file a hook added is created only where nothing stands, and one it deleted goes only while it is as it was', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const added = join(s.w.root, 'src/added.ts');
        expect(yield* s.reshape(null, 'export const added = 1;\n', { _tag: 'unheld' }, 'src/added.ts')).toEqual([
          { _tag: 'merged', path: 'src/added.ts' },
        ]);
        expect(readFileSync(added, 'utf8')).toBe('export const added = 1;\n');
        writeFileSync(added, 'export const added = 2;\n');
        expect(yield* s.reshape(null, 'export const added = 1;\n', { _tag: 'unheld' }, 'src/added.ts')).toEqual([
          { _tag: 'kept', path: 'src/added.ts', why: 'conflict', owed: false },
        ]);
        expect(readFileSync(added, 'utf8')).toBe('export const added = 2;\n');
        writeFileSync(s.w.file, base.replace('const two = 2;', 'const two = 20;'));
        expect(yield* s.reshape(base, null, { _tag: 'unheld' })).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'conflict', owed: false },
        ]);
        writeFileSync(s.w.file, base);
        expect(yield* s.reshape(base, null, { _tag: 'unheld' })).toEqual([{ _tag: 'merged', path: 'src/a.ts' }]);
        expect(existsSync(s.w.file)).toBe(false);
      }),
    ),
  );
  it.effect(
    'a mode the hook gave a file is carried: a born file lands executable, and an existing one is chmodded with or without a content write',
    () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const s = yield* stand(checkout);
          const executable = (path: string): boolean => (statSync(join(s.w.root, path)).mode & 0o100) !== 0;
          expect(yield* s.reshape(null, '#!/bin/sh\n', { _tag: 'unheld' }, 'src/run.sh', '100755')).toEqual([
            { _tag: 'merged', path: 'src/run.sh' },
          ]);
          expect(executable('src/run.sh')).toBe(true);
          expect(yield* s.reshape('#!/bin/sh\n', '#!/bin/sh\n', { _tag: 'unheld' }, 'src/run.sh', '100644')).toEqual([
            { _tag: 'merged', path: 'src/run.sh' },
          ]);
          expect(executable('src/run.sh')).toBe(false);
          expect(readFileSync(join(s.w.root, 'src/run.sh'), 'utf8')).toBe('#!/bin/sh\n');
          expect(yield* s.reshape(base, shaped(base), { _tag: 'unheld' }, 'src/a.ts', '100755')).toEqual([
            { _tag: 'merged', path: 'src/a.ts' },
          ]);
          expect(s.bytes()).toBe(shaped(base));
          expect(executable('src/a.ts')).toBe(true);
        }),
      ),
  );
  it.effect('a file that moves between the read and the write is left with the bytes that moved it', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        let moved = '';
        const racing: LineWrites['Service'] = {
          replace: (replacement, approved) => {
            moved = base.replace('const five = 5;', 'const five = 50;');
            writeFileSync(join(replacement.root, replacement.path), moved);
            return lineWrites.replace(replacement, approved);
          },
        };
        const s = yield* stand(checkout, racing);
        expect(yield* s.reshape(base, shaped(base), { _tag: 'unheld' })).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'moved', owed: false },
        ]);
        expect(s.bytes()).toBe(moved);
      }),
    ),
  );
  it.effect('a shell command running in parallel is not credited with the delta the reshape wrote, and a plain write beside it is', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const origin = s.checkout.origin;
        const life = yield* s.commands.open(
          {
            projectId: s.w.projectId,
            threadId: THEIRS,
            runHint: null,
            spelling: s.w.root,
            key: TEST_CHECKOUT,
          },
          naming(s.w.root),
          s.w.root,
        );
        life.opened();
        const from = yield* Clock.currentTimeMillis;
        yield* s.reshape(base, shaped(base), { _tag: 'unheld' });
        writeFileSync(join(s.w.root, 'src/b.ts'), 'export const b = 1;\n');
        life.ended();
        const writtenAt = yield* Clock.currentTimeMillis;
        const move = (name: string, before: string | null, text: string) => ({
          name,
          before,
          after: contentDigest(text),
          present: true,
          existed: before !== null,
          written: { from: writtenAt, to: writtenAt },
          bytes: null,
          link: false,
          mode: null,
        });
        const verdicts = yield* life.settle({
          base: null,
          window: { from, to: yield* Clock.currentTimeMillis },
          moves: [move('src/a.ts', contentDigest(base), shaped(base)), move('src/b.ts', null, 'export const b = 1;\n')],
        });
        expect(verdicts).toEqual([
          { name: 'src/a.ts', verdict: 'unclaimed' },
          { name: 'src/b.ts', verdict: 'attributed' },
        ]);
      }),
    ),
  );
  it.effect('a command that wrote exactly the delta first keeps its write when the reshape writes nothing', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const racing: LineWrites['Service'] = {
          replace: (replacement, approved) => {
            writeFileSync(join(replacement.root, replacement.path), shaped(base));
            return lineWrites.replace(replacement, approved);
          },
        };
        const s = yield* stand(checkout, racing);
        const life = yield* s.commands.open(
          {
            projectId: s.w.projectId,
            threadId: THEIRS,
            runHint: null,
            spelling: s.w.root,
            key: TEST_CHECKOUT,
          },
          naming(s.w.root),
          s.w.root,
        );
        life.opened();
        const from = yield* Clock.currentTimeMillis;
        expect(yield* s.reshape(base, shaped(base), { _tag: 'unheld' })).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'moved', owed: false },
        ]);
        life.ended();
        const writtenAt = yield* Clock.currentTimeMillis;
        const verdicts = yield* life.settle({
          base: null,
          window: { from, to: yield* Clock.currentTimeMillis },
          moves: [
            {
              name: 'src/a.ts',
              before: contentDigest(base),
              after: contentDigest(shaped(base)),
              present: true,
              existed: true,
              written: { from: writtenAt, to: writtenAt },
              bytes: null,
              link: false,
              mode: null,
            },
          ],
        });
        expect(verdicts).toEqual([{ name: 'src/a.ts', verdict: 'attributed' }]);
      }),
    ),
  );
});
