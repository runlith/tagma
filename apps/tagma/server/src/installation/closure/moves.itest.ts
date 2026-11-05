import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Result } from 'effect';
import { readReturn, readStepBack } from './attempt.js';
import { claimLeased } from './leases.js';
import { madeCurrent, moveFrom, moving, published, staging, steppedBack } from './moves.js';
import { swapCurrent } from '../../platform/lock/versionedDirectories.js';
import { previousRelease } from './versions.js';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-moves-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const forget = (): void => undefined;

const rooted = (name: string, standing: string, ...releases: readonly string[]): string => {
  const root = join(tree, name);
  for (const version of releases) {
    mkdirSync(join(root, version), { recursive: true });
    writeFileSync(join(root, version, 'install.json'), '{}');
  }
  swapCurrent(root, standing);
  return root;
};

const standing = (root: string) => readlinkSync(join(root, 'current'));

const built = (root: string) => {
  const staged = claimLeased(root, new Date());
  writeFileSync(join(staged.root, 'install.json'), '{}');
  return staged;
};

const landed = (root: string, staged: ReturnType<typeof built>) =>
  moving(root, (lock) =>
    Effect.gen(function* () {
      const move = yield* moveFrom(lock);
      const version = yield* published(lock, staged);
      yield* madeCurrent(lock, version, move, false, forget);
      return version;
    }),
  ).pipe(Effect.ensuring(Effect.sync(staged.release)));

it.live(
  'a version still being built survives a move made beside it, and the release before the one that stands is the one it replaced, whatever order they began in',
  () =>
    Effect.gen(function* () {
      const root = rooted('staging', '20260101T000000000Z', '20260101T000000000Z');
      const slow = built(root);
      const quick = yield* landed(root, built(root));
      expect([standing(root), existsSync(slow.root)]).toEqual([quick, true]);

      const late = yield* landed(root, slow);
      expect([standing(root), previousRelease(root), existsSync(join(root, '20260101T000000000Z'))]).toEqual([late, quick, false]);
    }),
);

it.live(
  'stepping back asks for the release below the standing one and leaves current where it stands until the data is returned; onto the release that runs it only moves current; from the oldest kept it refuses',
  () =>
    Effect.gen(function* () {
      const root = rooted('stepping', '20260102T000000000Z', '20260101T000000000Z', '20260102T000000000Z');
      const stepped = yield* steppedBack(root, null, '20260102T000000000Z', Effect.void, Effect.void);
      expect(stepped).toMatchObject({ version: '20260101T000000000Z', from: '20260102T000000000Z' });
      expect([standing(root), Result.getOrThrow(readReturn(root)), Result.getOrThrow(readStepBack(root))]).toEqual([
        '20260102T000000000Z',
        null,
        { from: '20260102T000000000Z', to: '20260101T000000000Z', carried: false },
      ]);

      yield* steppedBack(root, null, '20260101T000000000Z', Effect.void, Effect.void);
      expect([standing(root), Result.getOrThrow(readReturn(root)), Result.getOrThrow(readStepBack(root))]).toEqual([
        '20260101T000000000Z',
        { left: '20260102T000000000Z', to: '20260101T000000000Z' },
        null,
      ]);

      const oldest = yield* Effect.flip(steppedBack(root, null, null, Effect.void, Effect.void));
      expect(oldest).toMatchObject({ _tag: 'PreviousMissing', standing: '20260101T000000000Z' });
      const moved = rooted('moved', '20260102T000000000Z', '20260102T000000000Z');
      const elsewhere = yield* Effect.flip(steppedBack(moved, '20260101T000000000Z', null, Effect.void, Effect.void));
      expect(elsewhere).toMatchObject({ _tag: 'PreviousMissing', expected: '20260101T000000000Z' });
    }),
);

it.live(
  'an install that lands while a step back prepares wins: the step back refuses and undoes its preparation, and the release it chose was not removed under it',
  () =>
    Effect.gen(function* () {
      const root = rooted('racing', '20260102T000000000Z', '20260101T000000000Z', '20260102T000000000Z');
      const happened: string[] = [];
      const refused = yield* Effect.flip(
        steppedBack(
          root,
          '20260101T000000000Z',
          null,
          Effect.map(landed(root, built(root)), (version) => void happened.push(version)),
          Effect.sync(() => void happened.push('undone')),
        ),
      );
      expect([refused._tag, ...happened]).toEqual(['PreviousMissing', standing(root), 'undone']);
      expect(existsSync(join(root, '20260101T000000000Z'))).toBe(true);
    }),
);

it.live('a stage is made only while no move holds the installation root', () =>
  Effect.gen(function* () {
    const root = rooted('staging-held', '20260101T000000000Z', '20260101T000000000Z');
    const made = yield* moving(root, () =>
      Effect.gen(function* () {
        const pending = yield* Effect.forkChild(staging(root));
        yield* Effect.sleep(300);
        expect(readdirSync(root).filter((name) => name.endsWith('.incoming'))).toEqual([]);
        return pending;
      }),
    );
    const staged = yield* Fiber.join(made);
    expect(existsSync(staged.root)).toBe(true);
    staged.release();
  }),
);
