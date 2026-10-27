import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { homeOf, RELEASE_RECORD, type ReleaseRecord, stagedCut, type Stages } from './stage.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-stage-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const STORES = { 'machine-store': [], 'host-store': [], graph: [], journal: [] };
const recordAt = (out: string): ReleaseRecord => JSON.parse(readFileSync(join(out, RELEASE_RECORD), 'utf8'));

it.live(
  'a cut stopped during its trial leaves the cut before it standing, and cutting again tries the cut it built against that cut without building again',
  () =>
    Effect.gen(function* () {
      const parent = join(scratch, 'stopped');
      const out = join(parent, 'release');
      mkdirSync(out, { recursive: true });
      const before = new TextEncoder().encode('the archive of 0.1.1');
      writeFileSync(join(out, 'tagma-0.1.1-darwin-arm64.tar.gz'), before);
      writeFileSync(join(out, 'tagma-0.1.1-darwin-x64.tar.gz'), 'the x64 archive of 0.1.1');
      writeFileSync(join(out, 'Tagma-0.1.1.dmg'), 'the dmg of 0.1.1');
      const archived = { sha256: createHash('sha256').update(before).digest('hex'), size: before.length };
      writeFileSync(
        join(out, RELEASE_RECORD),
        JSON.stringify({
          release: '0.1.1',
          commit: 'b'.repeat(40),
          images: { 'darwin-arm64': 'Tagma-0.1.1.dmg', 'darwin-x64': 'Tagma-0.1.1.dmg' },
          platforms: {
            'darwin-arm64': { archive: 'tagma-0.1.1-darwin-arm64.tar.gz', ...archived },
            'darwin-x64': { archive: 'tagma-0.1.1-darwin-x64.tar.gz', sha256: '0'.repeat(64), size: 24 },
          },
          stores: STORES,
          irreversible: [],
          notarized: true,
        }),
      );
      const identity = { release: '0.1.2', commit: 'a'.repeat(40), stores: STORES, irreversible: [] };
      const builds: string[] = [];
      const predecessors: (string | null)[] = [];
      const inTrial = yield* Deferred.make<void>();
      const stopping = { during: true };
      const stages: Stages = {
        build: (home) =>
          Effect.sync(() => {
            builds.push(home);
            mkdirSync(join(home, 'maps'), { recursive: true });
            writeFileSync(join(home, 'tagma-0.1.2-darwin-arm64.tar.gz'), 'the archive of 0.1.2');
            writeFileSync(join(home, 'tagma-0.1.2-darwin-x64.tar.gz'), 'the x64 archive of 0.1.2');
            writeFileSync(join(home, 'Tagma-0.1.2-arm64.dmg'), 'the dmg of 0.1.2');
            writeFileSync(join(home, 'Tagma-0.1.2-x64.dmg'), 'the x64 dmg of 0.1.2');
            return {
              platforms: {
                'darwin-arm64': { archive: join(home, 'tagma-0.1.2-darwin-arm64.tar.gz'), image: join(home, 'Tagma-0.1.2-arm64.dmg') },
                'darwin-x64': { archive: join(home, 'tagma-0.1.2-darwin-x64.tar.gz'), image: join(home, 'Tagma-0.1.2-x64.dmg') },
              },
            };
          }),
        trial: (trying) =>
          Effect.suspend(() => {
            const verified = Object.entries(trying.predecessors);
            predecessors.push(verified.map(([platform, archive]) => `${platform}: ${readFileSync(archive, 'utf8')}`).join(', ') || null);
            return stopping.during ? Effect.andThen(Deferred.succeed(inTrial, undefined), Effect.never) : Effect.void;
          }),
      };
      const cut = (given: Stages) => stagedCut(out, identity, given).pipe(Effect.provide(BunFileSystem.layer));

      const stopped = yield* Effect.forkChild(cut(stages));
      yield* Deferred.await(inTrial);
      yield* Fiber.interrupt(stopped);
      const standingAfterStop = recordAt(out).release;
      stopping.during = false;
      const resumed = yield* cut(stages);

      expect(standingAfterStop).toBe('0.1.1');
      expect(builds).toEqual([homeOf(out, { ...identity, notarized: false })]);
      expect(predecessors).toEqual(['darwin-arm64: the archive of 0.1.1', 'darwin-arm64: the archive of 0.1.1']);
      expect(recordAt(out).release).toBe('0.1.2');
      const x64 = recordAt(out).platforms['darwin-x64']!;
      expect(x64).toEqual({
        archive: 'tagma-0.1.2-darwin-x64.tar.gz',
        sha256: createHash('sha256').update('the x64 archive of 0.1.2').digest('hex'),
        size: 24,
      });
      const feed = JSON.parse(readFileSync(resumed.feed, 'utf8')).releases[0];
      expect(feed.platforms['darwin-x64']).toEqual({ ...x64, archive: new URL(x64.archive, `file://${realpathSync(out)}/`).href });
      expect(readFileSync(resumed.images['darwin-x64']!, 'utf8')).toBe('the x64 dmg of 0.1.2');
      expect(readdirSync(parent).sort()).toEqual(['release', basename(builds[0]!)]);
    }),
);

it.live(
  'a cut killed after it retired the release directory of an earlier version and before its link stood is standing when cut again, without building or trying',
  () =>
    Effect.gen(function* () {
      const out = join(scratch, 'killed', 'release');
      const identity = { release: '0.1.3', commit: 'd'.repeat(40), stores: STORES, irreversible: [] };
      const home = homeOf(out, { ...identity, notarized: false });
      mkdirSync(`${out}.retired`, { recursive: true });
      writeFileSync(join(`${out}.retired`, 'tagma-0.1.2-darwin-arm64.tar.gz'), 'the archive of 0.1.2');
      mkdirSync(home);
      for (const [name, text] of [
        ['.cut', ''],
        ['tried', ''],
        ['tagma-0.1.3-darwin-arm64.tar.gz', 'the archive of 0.1.3'],
        ['Tagma-0.1.3.dmg', 'the dmg of 0.1.3'],
      ] as const)
        writeFileSync(join(home, name), text);
      writeFileSync(
        join(home, RELEASE_RECORD),
        JSON.stringify({
          ...identity,
          platforms: { 'darwin-arm64': { archive: 'tagma-0.1.3-darwin-arm64.tar.gz', sha256: '0'.repeat(64), size: 20 } },
          images: { 'darwin-arm64': 'Tagma-0.1.3.dmg' },
          notarized: false,
        }),
      );
      symlinkSync(basename(home), `${out}.next`);
      const stagesRun: string[] = [];
      const stages: Stages = {
        build: () => Effect.sync(() => (stagesRun.push('build'), { platforms: {} })),
        trial: () => Effect.sync(() => void stagesRun.push('trial')),
      };

      const standing = yield* stagedCut(out, identity, stages).pipe(Effect.provide(BunFileSystem.layer));

      expect(stagesRun).toEqual([]);
      expect(realpathSync(out)).toBe(home);
      expect(readFileSync(standing.images['darwin-arm64']!, 'utf8')).toBe('the dmg of 0.1.3');
    }),
);
