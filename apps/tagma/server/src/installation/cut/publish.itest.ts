import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, spyOn } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import type { Feed } from '../contract/wire/feed.js';
import type { Composition, Publisher } from './descriptor.js';
import { KEPT_MAPS } from './pipeline.js';
import { MAPS, RELEASE_RECORD, type ReleaseRecord } from './stage.js';
import type { Notary } from './notarize.js';
import { needsReleaseSource, publishRelease, shipCommand } from './publish.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-publish-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

const git = (args: readonly string[]) => Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
const said = (args: readonly string[]) => git(args).stdout.toString().trim();
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const cutInto = (at: string, commit: string, release: string, made = 'the archive'): void => {
  rmSync(at, { recursive: true, force: true });
  mkdirSync(join(at, MAPS), { recursive: true });
  writeFileSync(join(at, MAPS, 'http.js.map'), `{"release":"${release}"}`);
  const archive = `tagma-${release}-darwin-arm64.tar.gz`;
  const bytes = new TextEncoder().encode(`${made} of ${release}\n`);
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

const weighed = (at: string, record: ReleaseRecord) =>
  Object.fromEntries(
    Object.entries(record.images).map(([platform, image]) => {
      const bytes = readFileSync(join(at, image));
      return [platform, { sha256: sha(bytes), size: bytes.length }];
    }),
  );

const notary: Notary = {
  seal: (cut, into, record) =>
    Effect.sync(() => {
      mkdirSync(into, { recursive: true });
      for (const file of [...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)])
        writeFileSync(join(into, file), readFileSync(join(cut, file)));
      return { ...record, imageDigests: weighed(into, record), notarized: true };
    }),
};

const shelf = (serving = true) => {
  const placed: { publication: Parameters<Publisher['publish']>[0]; present: readonly boolean[] }[] = [];
  const sizes = new Map<string, number>();
  let latest: Feed | null = null;
  const publisher: Publisher = {
    place: 'the test shelf',
    latest: Effect.sync(() => latest),
    address: (release, file) => `https://shelf.test/${release}/${file}`,
    served: (release, file) => Effect.sync(() => (serving ? (sizes.get(`${release}/${file}`) ?? null) : null)),
    publish: (publication) =>
      Effect.sync(() => {
        placed.push({ publication, present: publication.files.map((file) => existsSync(join(publication.home, file))) });
        for (const file of publication.files)
          sizes.set(`${publication.record.release}/${file}`, readFileSync(join(publication.home, file)).length);
        latest = publication.feed;
        return { page: null };
      }),
  };
  return { publisher, placed };
};

it.live(
  'a descriptor publisher receives the notarized files and the feed with the release first, the checkout is tagged, a repeat of the newest is placed again, and other bytes under it, an older or a lower number are refused',
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
      const secondCommit = commit('fix: second');
      cutInto(place.cut, secondCommit, '0.2.1');
      const second = yield* publish();
      const again = yield* publish();
      cutInto(place.cut, secondCommit, '0.2.1', 'other bytes');
      const swapped = yield* publish();
      cutInto(place.cut, first, '0.2.0');
      const older = yield* publish();
      cutInto(place.cut, commit('fix: behind'), '0.1.9');
      const behind = yield* publish();

      expect(placed.map(({ present }) => present)).toEqual([
        [true, true],
        [true, true],
        [true, true],
      ]);
      expect(placed.map(({ publication }) => [publication.record.release, publication.record.notarized])).toEqual([
        ['0.2.0', true],
        ['0.2.1', true],
        ['0.2.1', true],
      ]);
      expect([again._tag, swapped._tag === 'Failure' && swapped.failure.step, older._tag === 'Failure' && older.failure.step]).toEqual([
        'Success',
        'feed',
        'version',
      ]);
      expect(placed[1]?.publication.feed.releases.map((one) => [one.release, one.platforms['darwin-arm64']?.archive])).toEqual([
        ['0.2.1', 'https://shelf.test/0.2.1/tagma-0.2.1-darwin-arm64.tar.gz'],
        ['0.2.0', 'https://shelf.test/0.2.0/tagma-0.2.0-darwin-arm64.tar.gz'],
      ]);
      expect(second._tag === 'Success' && second.success.maps).toBe(join(place.kept, '0.2.1'));
      expect(said(['-C', checkout, 'rev-parse', 'v0.2.0^{commit}'])).toBe(first);
      expect(behind._tag === 'Failure' && behind.failure.step).toBe('version');

      const unserved = shelf(false);
      const lost = commit('fix: lost');
      cutInto(place.cut, lost, '0.3.0');
      const missing = yield* Effect.result(publishRelease(unserved.publisher, notary, place).pipe(Effect.provide(machine)));
      expect(missing._tag === 'Failure' && missing.failure.step).toBe('verify');
      expect(git(['-C', checkout, 'rev-parse', '--verify', '--quiet', 'v0.3.0']).exitCode).not.toBe(0);
    }),
);

const repository = (name: string) => {
  const checkout = join(scratch, name);
  mkdirSync(checkout);
  expect(git(['-C', checkout, 'init', '-q', '-b', 'main']).exitCode).toBe(0);
  expect(
    git(['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'feat: one']).exitCode,
  ).toBe(0);
  return { checkout, head: said(['-C', checkout, 'rev-parse', 'HEAD']) };
};

it.live('a notarized cut whose disk image changed after it was sealed is refused before anything is placed', () =>
  Effect.gen(function* () {
    const { checkout, head } = repository('tampered');
    const { publisher, placed } = shelf();
    const place = { cut: join(scratch, 'tampered-release'), checkout, kept: join(scratch, 'tampered-maps') };
    cutInto(place.cut, head, '0.4.0');
    const cut = JSON.parse(readFileSync(join(place.cut, RELEASE_RECORD), 'utf8')) as ReleaseRecord;
    writeFileSync(join(place.cut, RELEASE_RECORD), JSON.stringify({ ...cut, imageDigests: weighed(place.cut, cut), notarized: true }));
    writeFileSync(join(place.cut, cut.images['darwin-arm64']!), 'an image changed after it was sealed');

    const refused = yield* Effect.result(publishRelease(publisher, notary, place).pipe(Effect.provide(machine)));

    expect(refused._tag === 'Failure' && refused.failure.step).toBe('image');
    expect(placed).toEqual([]);
  }),
);

it.live(
  'the source maps are kept before the tag, so a keep that fails leaves the checkout untagged and publishing again completes it',
  () =>
    Effect.gen(function* () {
      const { checkout, head } = repository('mapped');
      const { publisher } = shelf();
      const kept = join(scratch, 'mapped-maps');
      const place = { cut: join(scratch, 'mapped-release'), checkout, kept };
      cutInto(place.cut, head, '0.5.0');
      writeFileSync(kept, 'a file where the maps directory belongs');

      const stopped = yield* Effect.result(publishRelease(publisher, notary, place).pipe(Effect.provide(machine)));
      const taggedAfterStop = git(['-C', checkout, 'rev-parse', '--verify', '--quiet', 'v0.5.0']).exitCode === 0;
      rmSync(kept);
      const completed = yield* Effect.result(publishRelease(publisher, notary, place).pipe(Effect.provide(machine)));

      expect([stopped._tag, taggedAfterStop]).toEqual(['Failure', false]);
      expect(completed._tag).toBe('Success');
      expect(said(['-C', checkout, 'rev-parse', 'v0.5.0^{commit}'])).toBe(head);
      expect(readFileSync(join(kept, '0.5.0', 'http.js.map'), 'utf8')).toBe('{"release":"0.5.0"}');
      expect(readdirSync(kept)).toEqual(['0.5.0']);
    }),
);

it.live('only a HEAD with no standing cut and no release tag needs its release source', () =>
  Effect.gen(function* () {
    const { checkout, head } = repository('sourced');
    const { publisher } = shelf();
    const place = { cut: join(scratch, 'sourced-release'), checkout, kept: join(scratch, 'sourced-maps') };
    const needs = () => needsReleaseSource(checkout, place.cut);

    const uncut = yield* needs();
    cutInto(place.cut, head, '0.10.0');
    const cut = yield* needs();
    yield* publishRelease(publisher, notary, place).pipe(Effect.provide(machine));
    const released = yield* needs();

    expect([uncut, cut, released]).toEqual([true, false, false]);
  }),
);

const untouched = () => {
  const touched: (string | symbol)[] = [];
  const publisher = new Proxy({} as Publisher, {
    get: (_, name) => {
      touched.push(name);
      return () => Effect.die('the publisher is not for a release that is already published');
    },
  });
  return { publisher, touched };
};

const shipping = (checkout: string, data: string, publisher: Publisher) => {
  const composition = {
    roots: { checkout },
    workshop: { data: '.shipped' },
    channel: { name: 'Tagma' },
    signing: { team: 'NOSUCHTEAM', notary: 'none' },
    brand: { assets: '' },
    publisher,
    feed: null,
  } as unknown as Composition;
  return (cut: string) =>
    Effect.suspend(() => {
      const previous = process.env.TAGMA_DATABASE_PATH;
      process.env.TAGMA_DATABASE_PATH = join(data, 'tagma.db');
      const printed: string[] = [];
      const logging = spyOn(console, 'log').mockImplementation((line: unknown) => void printed.push(String(line)));
      const exiting = spyOn(process, 'exit').mockImplementation(((code: number) => {
        printed.push(`exit ${code}`);
        throw new Error('exited');
      }) as never);
      return Effect.exit(shipCommand(['--out', cut, '--json'], composition)).pipe(
        Effect.map(() => printed),
        Effect.ensuring(
          Effect.sync(() => {
            logging.mockRestore();
            exiting.mockRestore();
            if (previous === undefined) delete process.env.TAGMA_DATABASE_PATH;
            else process.env.TAGMA_DATABASE_PATH = previous;
          }),
        ),
      );
    });
};

const mapsOf = (line: string | undefined) => (line === undefined ? undefined : JSON.parse(line).maps);

it.live(
  'ship on a tagged HEAD completes the source maps from the standing cut, also over a partial directory, and touches neither publisher nor notary',
  () =>
    Effect.gen(function* () {
      const { checkout, head } = repository('shipped');
      const { publisher } = shelf();
      const data = join(scratch, 'shipped-data');
      const cut = join(scratch, 'shipped-release');
      const kept = join(data, KEPT_MAPS, '0.6.0');
      cutInto(cut, head, '0.6.0');
      writeFileSync(join(cut, MAPS, 'b.js.map'), '{"second":true}');
      yield* publishRelease(publisher, notary, { cut, checkout, kept: join(data, KEPT_MAPS) }).pipe(Effect.provide(machine));
      const idle = untouched();
      const ship = shipping(checkout, data, idle.publisher);

      const whole = yield* ship(cut);
      rmSync(kept, { recursive: true });
      const lost = yield* ship(cut);
      const completed = readdirSync(kept).sort();
      rmSync(kept, { recursive: true });
      mkdirSync(kept);
      writeFileSync(join(kept, 'http.js.map'), '{"release":"0.6.0"}');
      const partial = yield* ship(cut);

      expect([mapsOf(whole[0]), mapsOf(lost[0]), mapsOf(partial[0])]).toEqual(['kept', 'repaired', 'repaired']);
      expect(completed).toEqual(['b.js.map', 'http.js.map', 'kept.json']);
      expect(readdirSync(kept).sort()).toEqual(completed);
      expect(idle.touched).toEqual([]);
    }),
);

it.live('ship on an older tagged HEAD completes its source maps locally although a newer release is published', () =>
  Effect.gen(function* () {
    const { checkout, head } = repository('older');
    const { publisher } = shelf();
    const data = join(scratch, 'older-data');
    const kept = join(data, KEPT_MAPS);
    const older = join(scratch, 'older-release');
    cutInto(older, head, '0.7.0');
    yield* publishRelease(publisher, notary, { cut: older, checkout, kept }).pipe(Effect.provide(machine));
    expect(
      git(['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'fix: newer']).exitCode,
    ).toBe(0);
    const newer = join(scratch, 'newer-release');
    cutInto(newer, said(['-C', checkout, 'rev-parse', 'HEAD']), '0.8.0');
    yield* publishRelease(publisher, notary, { cut: newer, checkout, kept }).pipe(Effect.provide(machine));
    expect(git(['-C', checkout, 'checkout', '-q', '--detach', head]).exitCode).toBe(0);
    rmSync(join(kept, '0.7.0'), { recursive: true });
    const idle = untouched();

    const answered = yield* shipping(checkout, data, idle.publisher)(older);

    expect(mapsOf(answered[0])).toBe('repaired');
    expect(readFileSync(join(kept, '0.7.0', 'http.js.map'), 'utf8')).toBe('{"release":"0.7.0"}');
    expect(idle.touched).toEqual([]);
  }),
);

it.live('ship on a tagged HEAD whose source maps are lost and whose cut is gone refuses naming what is missing', () =>
  Effect.gen(function* () {
    const { checkout, head } = repository('gone');
    const { publisher } = shelf();
    const data = join(scratch, 'gone-data');
    const cut = join(scratch, 'gone-release');
    cutInto(cut, head, '0.9.0');
    yield* publishRelease(publisher, notary, { cut, checkout, kept: join(data, KEPT_MAPS) }).pipe(Effect.provide(machine));
    rmSync(join(data, KEPT_MAPS, '0.9.0'), { recursive: true });

    const answered = yield* shipping(checkout, data, untouched().publisher)(join(scratch, 'nowhere'));

    expect(JSON.parse(answered[0]!).code).toBe('maps-refused');
    expect(JSON.parse(answered[0]!).reason).toContain('no standing cut of 0.9.0 at HEAD holds them');
    expect(answered[1]).toBe('exit 2');
  }),
);
