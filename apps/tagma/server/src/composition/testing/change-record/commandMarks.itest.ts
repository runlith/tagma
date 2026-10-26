import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { statSync, writeFileSync } from 'node:fs';
import { Clock, Deferred, Effect, Fiber } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { FILE, MINE, THEIRS } from '../checkoutFixture.js';
import { commandLayer, commandWorld } from './commandWorld.js';
import { naming } from '../../../change-record/testing/doubles.js';
import { WRITE_GAP_MS } from '../../../change-record/record/lives.js';

const base = `${FILE.join('\n')}\n`;

const commandOf = Effect.fnUntraced(function* (s: Effect.Success<ReturnType<typeof commandWorld>>, threadId: string) {
  const life = yield* (
    s.record.changes({ work: { projectId: s.w.projectId, threadId } }).command?.(s.w.root, naming(s.w.root)) ?? Effect.succeed(null)
  );
  if (life === null || life === undefined) return yield* Effect.die('the checkout opened no command window');
  life.opened();
  return { life, from: yield* Clock.currentTimeMillis };
});

const moveTo = (text: string, writtenAt: number) => ({
  name: 'src/a.ts',
  before: contentDigest(base),
  after: contentDigest(text),
  present: true,
  existed: true,
  written: { from: writtenAt, to: writtenAt },
  bytes: null,
  link: false,
  mode: null,
});

layer(commandLayer, { excludeTestServices: true })('command marks', (it) => {
  it.effect('a typed write that missed its bytes leaves no claim on the same bytes a command wrote', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const { life, from } = yield* commandOf(s, MINE);
      const text = 'export const same = 1;\n';
      writeFileSync(s.w.file, text);
      const at = new Date(yield* Clock.currentTimeMillis);
      const landed = yield* s.record.land(
        { work: { projectId: s.w.projectId, threadId: THEIRS } },
        [{ origin: 'write', path: s.w.file, at, before: contentDigest(base), after: contentDigest(text) }],
        Effect.succeed(false),
      );
      life.ended();
      const verdicts = yield* life.settle({
        base: null,
        window: { from, to: yield* Clock.currentTimeMillis },
        moves: [moveTo(text, at.getTime())],
      });
      life.close();

      expect(landed).toEqual({ _tag: 'moved' });
      expect(verdicts).toEqual([{ name: 'src/a.ts', verdict: 'attributed' }]);
    }),
  );

  it.effect('a write an outside harness reported is not credited to a command that saw its bytes appear', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const { life, from } = yield* commandOf(s, MINE);
      const text = 'export const reported = 1;\n';
      writeFileSync(s.w.file, text);
      const at = new Date(yield* Clock.currentTimeMillis);
      yield* s.record.report({ work: { projectId: s.w.projectId, threadId: THEIRS } }, [
        { origin: 'write', path: s.w.file, at, before: contentDigest(base), after: contentDigest(text) },
      ]);
      life.ended();
      const verdicts = yield* life.settle({
        base: null,
        window: { from, to: yield* Clock.currentTimeMillis },
        moves: [moveTo(text, at.getTime())],
      });
      life.close();

      expect(verdicts).toEqual([{ name: 'src/a.ts', verdict: 'taken', by: THEIRS }]);
    }),
  );

  it.effect('a command running while another thread’s typed write lands late after its intent leaves that write to the writer', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const { life, from } = yield* commandOf(s, THEIRS);
      const text = 'export const typed = 1;\n';
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const intendedAt = from - WRITE_GAP_MS - 1;
      const writing = yield* Effect.forkScoped(
        s.record.land(
          { work: { projectId: s.w.projectId, threadId: MINE } },
          [
            {
              origin: 'write',
              path: s.w.file,
              at: new Date(intendedAt),
              before: contentDigest(base),
              after: contentDigest(text),
            },
          ],
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            writeFileSync(s.w.file, text);
            return true;
          }),
        ),
      );
      yield* Deferred.await(started);
      yield* Deferred.succeed(release, undefined);
      const landed = yield* Fiber.join(writing);
      const writtenAt = statSync(s.w.file).mtimeMs;
      life.ended();
      const verdicts = yield* life.settle({
        base: null,
        window: { from, to: yield* Clock.currentTimeMillis },
        moves: [moveTo(text, writtenAt)],
      });
      life.close();

      expect(landed).toEqual({ _tag: 'written', kept: true });
      expect(verdicts).toEqual([{ name: 'src/a.ts', verdict: 'taken', by: MINE }]);
    }),
  );
});
