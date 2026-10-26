import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { contentDigest } from '@runlith/files/content';
import { WRITE_GAP_MS } from '../../../change-record/record/lives.js';
import { call, MINE, THEIRS } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld } from './commandWorld.js';
import { naming } from '../../../change-record/testing/doubles.js';

type World = Effect.Success<ReturnType<typeof commandWorld>>;

const lifeOf = Effect.fnUntraced(function* (s: World, threadId: string) {
  const life = yield* (
    s.record.changes({ work: { projectId: s.w.projectId, threadId } }).command?.(s.w.root, naming(s.w.root)) ?? Effect.succeed(null)
  );
  if (life === null) return yield* Effect.die('the checkout opened no command window');
  return life;
});

const gone = (name: string) => ({
  name,
  before: null,
  after: contentDigest(''),
  present: false,
  existed: true,
  written: null,
  bytes: null,
  link: false,
  mode: null,
});

const born = (name: string, writtenAt: number) => ({
  name,
  before: null,
  after: contentDigest(base),
  present: true,
  existed: false,
  written: { from: writtenAt, to: writtenAt },
  bytes: null,
  link: false,
  mode: null,
});

const status = (s: World) => s.w.run(['status', '--porcelain']);

layer(commandLayer, { excludeTestServices: true })('recorded moves', (it) => {
  it.effect('a file-tool rename lands as a move when paths names only the destination', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.rename, { from: 'src/a.ts', to: 'lib/a.ts' });

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['lib/a.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
      expect(yield* status(s)).toBe('');
    }),
  );

  it.effect('a file-tool rename that changes only the case of a name lands as that move', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.rename, { from: 'src/a.ts', to: 'src/A.ts' });

      const landed = yield* s.w.submit(MINE, { commands: s.commands });
      expect(landed).toMatchObject({ status: 'landed', committed: ['src/A.ts', 'src/a.ts'] });
      expect(yield* s.w.run(['ls-files', 'src'])).toBe('src/A.ts');
      expect(yield* status(s)).toBe('');
    }),
  );

  it.effect('a command move whose deletion overlapped another session’s command lands whole with a bare submit', () =>
    Effect.flatMap(TestClock.make(), (clock) =>
      Effect.gen(function* () {
        const s = yield* commandWorld();
        const head = yield* s.w.run(['rev-parse', 'HEAD']);
        const from = yield* Clock.currentTimeMillis;
        const mine = yield* lifeOf(s, MINE);
        const theirs = yield* lifeOf(s, THEIRS);
        mine.opened();
        theirs.opened();
        theirs.ended();
        yield* clock.adjust(WRITE_GAP_MS * 3);
        mkdirSync(join(s.w.root, 'lib'));
        renameSync(join(s.w.root, 'src', 'a.ts'), join(s.w.root, 'lib', 'a.ts'));
        const writtenAt = yield* Clock.currentTimeMillis;
        mine.ended();
        yield* mine.settle({ base: head, window: { from, to: writtenAt }, moves: [gone('src/a.ts'), born('lib/a.ts', writtenAt)] });
        mine.close();
        theirs.close();
        yield* s.decided(MINE);

        const landed = yield* s.w.submit(MINE, { commands: s.commands });
        expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
        if (landed.status === 'landed') expect(landed.unattributed).toBeUndefined();
        expect(yield* status(s)).toBe('');
      }).pipe(Effect.provideService(Clock.Clock, clock)),
    ),
  );

  it.effect('a move split across two commands lands whole when paths names only the destination', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const head = yield* s.w.run(['rev-parse', 'HEAD']);
      const removing = yield* lifeOf(s, MINE);
      removing.opened();
      const removedFrom = yield* Clock.currentTimeMillis;
      rmSync(join(s.w.root, 'src', 'a.ts'));
      removing.ended();
      yield* removing.settle({ base: head, window: { from: removedFrom, to: yield* Clock.currentTimeMillis }, moves: [gone('src/a.ts')] });
      removing.close();
      const writing = yield* lifeOf(s, MINE);
      writing.opened();
      const writtenFrom = yield* Clock.currentTimeMillis;
      mkdirSync(join(s.w.root, 'lib'));
      writeFileSync(join(s.w.root, 'lib', 'a.ts'), base);
      const writtenAt = yield* Clock.currentTimeMillis;
      writing.ended();
      yield* writing.settle({ base: head, window: { from: writtenFrom, to: writtenAt }, moves: [born('lib/a.ts', writtenAt)] });
      writing.close();
      yield* s.decided(MINE);

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['lib/a.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
      expect(yield* status(s)).toBe('');
    }),
  );
});
