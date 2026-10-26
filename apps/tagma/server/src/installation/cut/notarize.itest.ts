import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { type Apple, sealingNotary } from './notarize.js';
import { packRelease } from './pipeline.js';
import { notarizeRelease } from './publish.js';
import { RELEASE_RECORD, type ReleaseRecord } from './stage.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-notarize-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(spawning, BunFileSystem.layer);

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const submissionId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recordAt = (out: string): ReleaseRecord => JSON.parse(readFileSync(join(out, RELEASE_RECORD), 'utf8'));

it.live(
  'notarization submits and staples the application and the disk image of every platform; stopped while Apple checks the last image, it leaves the cut standing whole, and notarizing again sends nothing again',
  () =>
    Effect.gen(function* () {
      const out = join(scratch, 'release');
      mkdirSync(out);
      const archive = 'tagma-0.1.0-darwin-arm64.tar.gz';
      const x64 = 'tagma-0.1.0-darwin-x64.tar.gz';
      for (const [arch, name] of [
        ['arm64', archive],
        ['x64', x64],
      ] as const) {
        const built = join(scratch, `built-${arch}`);
        mkdirSync(join(built, 'Tagma.app', 'Contents'), { recursive: true });
        writeFileSync(join(built, 'Tagma.app', 'Contents', 'Info.plist'), arch);
        yield* packRelease(built, join(out, name), 'Tagma.app').pipe(Effect.provide(machine));
      }
      const appOf = (path: string) => readFileSync(join(path, 'Contents', 'Info.plist'), 'utf8');
      const stapledIn = (path: string) => existsSync(join(path, 'Contents', 'ticket'));
      const images = { 'darwin-arm64': 'Tagma-0.1.0-arm64.dmg', 'darwin-x64': 'Tagma-0.1.0-x64.dmg' };
      for (const image of Object.values(images)) writeFileSync(join(out, image), 'the dmg as cut');
      const record: ReleaseRecord = {
        release: '0.1.0',
        commit: 'c'.repeat(40),
        archive,
        sha256: sha(join(out, archive)),
        size: readFileSync(join(out, archive)).length,
        platforms: {
          'darwin-arm64': { archive, sha256: sha(join(out, archive)), size: readFileSync(join(out, archive)).length },
          'darwin-x64': { archive: x64, sha256: sha(join(out, x64)), size: readFileSync(join(out, x64)).length },
        },
        images,
        stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
        irreversible: [],
        notarized: false,
      };
      writeFileSync(join(out, RELEASE_RECORD), JSON.stringify(record));

      const submitted: string[] = [];
      const waited: string[] = [];
      const stapled = new Set<string>();
      const checking = yield* Deferred.make<void>();
      const stopping = { during: true };
      const apple: Apple = {
        submit: (path) => Effect.sync(() => submissionId(submitted.push(path.endsWith('.app') ? appOf(path) : basename(path)))),
        accepted: (id) =>
          Effect.suspend(() => {
            waited.push(id);
            return id === submissionId(4) && stopping.during
              ? Effect.andThen(Deferred.succeed(checking, undefined), Effect.never)
              : Effect.void;
          }),
        staple: (path) =>
          Effect.sync(() => {
            if (path.endsWith('.app')) writeFileSync(join(path, 'Contents', 'ticket'), '');
            else stapled.add(basename(path));
          }),
        assess: () => Effect.void,
        image: (app, image) => Effect.sync(() => writeFileSync(image, `the dmg around ${appOf(app)}, stapled ${stapledIn(app)}`)),
      };
      const notary = yield* sealingNotary(apple).pipe(Effect.provide(machine));
      const notarize = () => notarizeRelease(notary, out).pipe(Effect.provide(machine));

      const stopped = yield* Effect.forkChild(notarize());
      yield* Deferred.await(checking);
      yield* Fiber.interrupt(stopped);
      const standingAfterStop = recordAt(out);
      const wholeAfterStop = sha(join(out, standingAfterStop.archive)) === standingAfterStop.sha256;
      stopping.during = false;
      yield* notarize();
      const notarized = recordAt(out);

      expect([standingAfterStop.notarized, wholeAfterStop]).toEqual([false, true]);
      expect(submitted).toEqual(['arm64', 'x64', 'Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg']);
      expect(waited.slice(-2)).toEqual([submissionId(3), submissionId(4)]);
      expect([...stapled].sort()).toEqual(['Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg']);
      expect(notarized.notarized).toBe(true);
      expect(sha(join(out, notarized.archive))).toBe(notarized.sha256);
      for (const [platform, one] of Object.entries(notarized.platforms)) {
        expect(sha(join(out, one.archive))).toBe(one.sha256);
        const unpacked = join(scratch, `unpacked-${platform}`);
        mkdirSync(unpacked);
        expect(Bun.spawnSync(['/usr/bin/tar', '-xzf', join(out, one.archive), '-C', unpacked]).exitCode).toBe(0);
        expect([appOf(join(unpacked, 'Tagma.app')), stapledIn(join(unpacked, 'Tagma.app'))]).toEqual([platform.slice(7), true]);
      }
      expect(Object.entries(notarized.images).map(([platform, image]) => [platform, readFileSync(join(out, image), 'utf8')])).toEqual([
        ['darwin-arm64', 'the dmg around arm64, stapled true'],
        ['darwin-x64', 'the dmg around x64, stapled true'],
      ]);
    }),
);
