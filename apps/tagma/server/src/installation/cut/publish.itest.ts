import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import type { Feed } from '../contract/wire/feed.js';
import type { Publisher } from './descriptor.js';
import { MAPS, RELEASE_RECORD, type ReleaseRecord } from './stage.js';
import type { Notary } from './notarize.js';
import { publishRelease } from './publish.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-publish-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

const git = (args: readonly string[]) => Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
const said = (args: readonly string[]) => git(args).stdout.toString().trim();
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const cutInto = (at: string, commit: string, release: string): void => {
  rmSync(at, { recursive: true, force: true });
  mkdirSync(join(at, MAPS), { recursive: true });
  writeFileSync(join(at, MAPS, 'http.js.map'), `{"release":"${release}"}`);
  const archive = `tagma-${release}-darwin-arm64.tar.gz`;
  const bytes = new TextEncoder().encode(`the archive of ${release}\n`);
  writeFileSync(join(at, archive), bytes);
  writeFileSync(join(at, `Tagma-${release}-arm64.dmg`), `the dmg of ${release}\n`);
  const record: ReleaseRecord = {
    release,
    commit,
    platforms: { 'darwin-arm64': { archive, sha256: sha(bytes), size: bytes.length } },
    images: { 'darwin-arm64': `Tagma-${release}-arm64.dmg` },
    stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
    irreversible: [],
    notarized: false,
  };
  writeFileSync(join(at, RELEASE_RECORD), JSON.stringify(record));
};

const notary: Notary = {
  seal: (cut, into, record) =>
    Effect.sync(() => {
      mkdirSync(into, { recursive: true });
      for (const file of [...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)])
        writeFileSync(join(into, file), readFileSync(join(cut, file)));
      return { ...record, notarized: true };
    }),
};

const shelf = () => {
  const placed: { publication: Parameters<Publisher['publish']>[0]; present: readonly boolean[] }[] = [];
  let latest: Feed | null = null;
  const publisher: Publisher = {
    place: 'the test shelf',
    latest: Effect.sync(() => latest),
    address: (release, file) => `https://shelf.test/${release}/${file}`,
    publish: (publication) =>
      Effect.sync(() => {
        placed.push({ publication, present: publication.files.map((file) => existsSync(join(publication.home, file))) });
        latest = publication.feed;
        return { page: null };
      }),
  };
  return { publisher, placed };
};

it.live(
  'a descriptor publisher receives the notarized files and the feed with the release first, the checkout is tagged, and a number not above the published is refused',
  () =>
    Effect.gen(function* () {
      const checkout = join(scratch, 'checkout');
      mkdirSync(checkout);
      expect(git(['-C', checkout, 'init', '-q', '-b', 'main']).exitCode).toBe(0);
      const commit = (message: string) => {
        expect(
          git(['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message]).exitCode,
        ).toBe(0);
        return said(['-C', checkout, 'rev-parse', 'HEAD']);
      };
      const { publisher, placed } = shelf();
      const place = { cut: join(scratch, 'release'), checkout, kept: join(scratch, 'maps') };
      const publish = () => Effect.result(publishRelease(publisher, notary, place).pipe(Effect.provide(machine)));

      const first = commit('feat: first');
      cutInto(place.cut, first, '0.2.0');
      expect((yield* publish())._tag).toBe('Success');
      cutInto(place.cut, commit('fix: second'), '0.2.1');
      const second = yield* publish();
      cutInto(place.cut, commit('fix: behind'), '0.1.9');
      const behind = yield* publish();

      expect(placed.map(({ present }) => present)).toEqual([
        [true, true],
        [true, true],
      ]);
      expect(placed.map(({ publication }) => publication.record.notarized)).toEqual([true, true]);
      expect(placed[1]?.publication.feed.releases.map((one) => [one.release, one.platforms['darwin-arm64']?.archive])).toEqual([
        ['0.2.1', 'https://shelf.test/0.2.1/tagma-0.2.1-darwin-arm64.tar.gz'],
        ['0.2.0', 'https://shelf.test/0.2.0/tagma-0.2.0-darwin-arm64.tar.gz'],
      ]);
      expect(second._tag === 'Success' && second.success.maps).toBe(join(place.kept, '0.2.1'));
      expect(said(['-C', checkout, 'rev-parse', 'v0.2.0^{commit}'])).toBe(first);
      expect(behind._tag === 'Failure' && behind.failure.step).toBe('version');
    }),
);
