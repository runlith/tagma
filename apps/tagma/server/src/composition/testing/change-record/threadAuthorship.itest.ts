import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { AUTHORSHIP_ANSWER_LINES } from '../../../change-record/contract/wire/operations.js';
import { OPERATIONS } from '../catalog.js';
import type { PathAuthorship } from '../../../change-record/contract/wire/authorship.js';
import { authorshipRefusal, READING_CAPTURE } from '../../../change-record/threadFiles/failures.js';
import {
  MINE,
  BORN,
  GROWN,
  WIDE_BORN,
  WIDE_GROWN,
  run,
  edited,
  fixture,
  layers,
  LONG_BORN,
  LONG_GROWN,
  committed,
} from './threadFilesWorld.js';

layer(layers, { excludeTestServices: true })('thread authorship', (it) => {
  it.effect('the authorship of one path names each changed line, and asking again reads no blob', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);

      const first = yield* world.authorship.read(world.rootId, 'kept.txt');
      const named = (text: string) => first.lines.filter((line) => line.text === text).map((line) => line.author);
      expect(first.binary).toBe(false);
      expect(named('two')).toEqual([{ holder: { kind: 'thread', thread: MINE }, agentName: 'reader' }]);
      expect(named('one')).toEqual([null]);

      const read = world.blobs.read;
      expect(read).toBeGreaterThan(0);
      const again = yield* world.authorship.read(world.rootId, 'kept.txt');
      expect(again).toEqual(first);
      expect(world.blobs.read).toBe(read);

      yield* run(world.git, world.root, ['commit', '-q', '-m', 'carried', '--', 'kept.txt']);
      const moved = yield* world.authorship.read(world.rootId, 'kept.txt');

      expect(world.blobs.read).toBeGreaterThan(read);
      expect(moved.lines).toEqual([]);
    }),
  );

  it.effect('a narrow ask after a wide one is cut from it, and is the reading a narrow ask answers', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'wide.txt');
      yield* world.files.writeFileString(at, WIDE_BORN);
      yield* run(world.git, world.root, ['add', 'wide.txt']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'wide']);
      yield* world.files.writeFileString(at, WIDE_GROWN);
      yield* edited(world.mine, at, WIDE_BORN, WIDE_GROWN);

      const narrow = yield* world.authorship.read(world.rootId, 'wide.txt');
      const wide = yield* world.authorship.read(world.rootId, 'wide.txt', 20);

      expect(wide.lines.length).toBeGreaterThan(narrow.lines.length);
      expect(narrow.timedOut).toBe(false);
      expect(narrow.lines.map((line) => line.hiddenBefore).filter((hidden) => hidden > 0)).toEqual([29]);
      expect(wide.lines.every((line) => line.hiddenBefore === 0)).toBe(true);
      const wrote = (answer: typeof narrow, text: string) => answer.lines.filter((line) => line.text === text).map((line) => line.author);
      expect(wrote(narrow, 'line two')).toEqual([{ holder: { kind: 'thread', thread: MINE }, agentName: 'reader' }]);
      expect(wrote(wide, 'line two')).toEqual(wrote(narrow, 'line two'));

      const read = world.blobs.read;
      const again = yield* world.authorship.read(world.rootId, 'wide.txt');
      expect(again).toEqual(narrow);
      expect(world.blobs.read).toBe(read);
    }),
  );

  it.effect('a changed line carries the character ranges that moved inside it', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'wide.txt');
      yield* world.files.writeFileString(at, WIDE_BORN);
      yield* run(world.git, world.root, ['add', 'wide.txt']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'wide']);
      yield* world.files.writeFileString(at, WIDE_GROWN);
      yield* edited(world.mine, at, WIDE_BORN, WIDE_GROWN);

      const answer = yield* world.authorship.read(world.rootId, 'wide.txt');
      const marked = (text: string) => {
        const line = answer.lines.find((row) => row.text === text);
        return line?.spans.map((span) => line.text.slice(span.start, span.end));
      };

      expect(marked('line 2')).toEqual(['2']);
      expect(marked('line two')).toEqual(['two']);
      expect(marked('line thirty-eight')).toEqual(['thirty-eight']);
      expect(marked('line 5')).toEqual([]);
    }),
  );

  it.effect('the ceiling counts the lines an answer emits, not the width that framed them', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'tall.txt');
      const born = `${Array.from({ length: AUTHORSHIP_ANSWER_LINES + 1 }, (_, n) => `line ${n + 1}`).join('\n')}\n`;
      const grown = born.replace('line 2\n', 'line two\n').replace('line 20000\n', 'line twenty thousand\n');
      yield* world.files.writeFileString(at, born);
      yield* run(world.git, world.root, ['add', 'tall.txt']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'tall']);
      yield* world.files.writeFileString(at, grown);
      yield* edited(world.mine, at, born, grown);

      const narrow = yield* world.authorship.read(world.rootId, 'tall.txt');
      expect(narrow.lines.length).toBeLessThan(AUTHORSHIP_ANSWER_LINES);

      const wide = yield* Effect.result(world.authorship.read(world.rootId, 'tall.txt', 11_000));
      expect(wide._tag === 'Failure' ? authorshipRefusal(wide.failure).code : null).toBe('context-too-wide');
      expect(
        Schema.decodeUnknownResult(OPERATIONS.read_authorship.params)({
          rootId: 'root-1',
          path: 'src/a.ts',
          context: AUTHORSHIP_ANSWER_LINES,
        })._tag,
      ).toBe('Success');
    }),
  );

  it.effect('opening one hidden run opens that run alone, where a width reaching it opens the file', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'long.txt');
      yield* world.files.writeFileString(at, LONG_BORN);
      yield* run(world.git, world.root, ['add', 'long.txt']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'long']);
      yield* world.files.writeFileString(at, LONG_GROWN);
      yield* edited(world.mine, at, LONG_BORN, LONG_GROWN);
      const hides = (answer: PathAuthorship) => answer.lines.reduce((total, line) => total + line.hiddenBefore, 0);

      const narrow = yield* world.authorship.read(world.rootId, 'long.txt');
      const gap = [...narrow.lines].sort((one, two) => two.hiddenBefore - one.hiddenBefore)[0];
      expect(gap?.hiddenAt).toBe((gap?.before as number) - (gap?.hiddenBefore as number));

      const opened = yield* world.authorship.read(world.rootId, 'long.txt', undefined, [{ at: gap?.hiddenAt as number, lines: 100 }]);
      expect(opened.lines.length).toBe(narrow.lines.length + 100);
      expect(hides(opened)).toBe(hides(narrow) - 100);
      expect(hides(opened)).toBeGreaterThan(0);

      const widened = yield* world.authorship.read(world.rootId, 'long.txt', (gap?.hiddenBefore as number) + 3);
      expect(widened.lines.every((line) => line.hiddenBefore === 0)).toBe(true);
      expect(widened.lines.length).toBeGreaterThan(opened.lines.length);
    }),
  );

  it.effect('an ask to open a run that no longer stands refuses rather than opening nothing', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'long.txt');
      yield* world.files.writeFileString(at, LONG_BORN);
      yield* run(world.git, world.root, ['add', 'long.txt']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'long']);
      yield* world.files.writeFileString(at, LONG_GROWN);
      yield* edited(world.mine, at, LONG_BORN, LONG_GROWN);

      const gone = yield* Effect.result(world.authorship.read(world.rootId, 'long.txt', undefined, [{ at: 4, lines: 5 }]));
      expect(gone._tag === 'Failure' ? authorshipRefusal(gone.failure).code : null).toBe('stretch-gone');
    }),
  );

  it.effect('a working file past the capture refuses rather than landing whole in this process', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'huge.txt');
      yield* world.files.writeFileString(at, 'x'.repeat(READING_CAPTURE + 1));

      const answer = yield* Effect.result(world.authorship.read(world.rootId, 'huge.txt'));
      expect(answer._tag === 'Failure' ? authorshipRefusal(answer.failure).code : null).toBe('path-oversized');
    }),
  );

  it.effect("a commit's reading of one path is its first parent against it, naming no author", () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const born = yield* run(world.git, world.root, ['rev-parse', 'HEAD']);
      const grown = yield* committed(world, 'kept.txt', BORN, GROWN, 'grow kept');
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), `${GROWN}three\n`);

      const change = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, grown);
      const changed = (answer: PathAuthorship) =>
        answer.lines.filter((line) => line.kind !== 'context').map((line) => [line.kind, line.text]);
      expect(changed(change)).toEqual([['added', 'two']]);
      expect(change.lines.every((line) => line.author === null)).toBe(true);

      const root = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, born);
      expect(root.lines.every((line) => line.kind === 'added')).toBe(true);
      expect(root.lines[0]?.text).toBe('one');

      yield* committed(world, 'other.txt', '', 'other\n', 'add other');
      const untouched = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, 'HEAD');
      expect(untouched.lines).toEqual([]);

      const nowhere = yield* Effect.result(world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, 'no-such-revision'));
      expect(nowhere._tag === 'Failure' ? authorshipRefusal(nowhere.failure).code : null).toBe('not-found');

      const nested = yield* committed(world, 'nested/inner.txt', '', 'inner\n', 'add nested');
      const directory = yield* Effect.result(world.authorship.read(world.rootId, 'nested', undefined, undefined, nested));
      expect(directory._tag === 'Failure' ? authorshipRefusal(directory.failure).code : null).toBe('not-found');

      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), GROWN);
      yield* run(world.git, world.root, ['mv', 'kept.txt', 'renamed.txt']);
      yield* world.files.writeFileString(world.paths.join(world.root, 'renamed.txt'), `${GROWN}three\n`);
      yield* run(world.git, world.root, ['add', '-A']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'rename kept']);
      const renamed = yield* world.authorship.read(world.rootId, 'renamed.txt', undefined, undefined, 'HEAD');
      expect(changed(renamed)).toEqual([['added', 'three']]);
    }),
  );

  it.effect(
    'a range reading of one path is the base commit against the tip as one change across its commits, the working file left out',
    () =>
      Effect.gen(function* () {
        const world = yield* fixture;
        const born = yield* run(world.git, world.root, ['rev-parse', 'HEAD']);
        const grown = yield* committed(world, 'kept.txt', BORN, GROWN, 'grow kept');
        yield* committed(world, 'kept.txt', GROWN, `${GROWN}three\n`, 'grow kept again');
        yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), `${GROWN}three\nfour\n`);
        const changed = (answer: PathAuthorship) =>
          answer.lines.filter((line) => line.kind !== 'context').map((line) => [line.kind, line.text]);

        const range = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, undefined, born);
        expect(changed(range)).toEqual([
          ['added', 'two'],
          ['added', 'three'],
        ]);
        expect(range.lines.every((line) => line.author === null)).toBe(true);

        const bounded = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, grown, born);
        expect(changed(bounded)).toEqual([['added', 'two']]);

        const nowhere = yield* Effect.result(
          world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, 'HEAD', 'no-such-revision'),
        );
        expect(nowhere._tag === 'Failure' ? authorshipRefusal(nowhere.failure).code : null).toBe('not-found');
      }),
  );
});
