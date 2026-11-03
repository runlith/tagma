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
import { type Apple, NotarizationRefused, sealingNotary } from './notarize.js';
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
const appOf = (path: string) => readFileSync(join(path, 'Contents', 'Info.plist'), 'utf8');
const stapledIn = (path: string) => existsSync(join(path, 'Contents', 'ticket'));

const cutAt = Effect.fnUntraced(function* (name: string) {
  const out = join(scratch, name);
  mkdirSync(out);
  const archive = 'tagma-0.1.0-darwin-arm64.tar.gz';
  const x64 = 'tagma-0.1.0-darwin-x64.tar.gz';
  for (const [arch, file] of [
    ['arm64', archive],
    ['x64', x64],
  ] as const) {
    const built = join(scratch, `${name}-built-${arch}`);
    mkdirSync(join(built, 'Tagma.app', 'Contents'), { recursive: true });
    writeFileSync(join(built, 'Tagma.app', 'Contents', 'Info.plist'), arch);
    yield* packRelease(built, join(out, file), 'Tagma.app').pipe(Effect.provide(machine));
  }
  const images = { 'darwin-arm64': 'Tagma-0.1.0-arm64.dmg', 'darwin-x64': 'Tagma-0.1.0-x64.dmg' };
  for (const image of Object.values(images)) writeFileSync(join(out, image), 'the dmg as cut');
  const record: ReleaseRecord = {
    release: '0.1.0',
    commit: 'c'.repeat(40),
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
  return out;
});

const accepting = (opens: Apple['opens']): Apple => {
  let sent = 0;
  return {
    submit: () => Effect.sync(() => submissionId((sent += 1))),
    accepted: () => Effect.void,
    staple: (path) => Effect.sync(() => (path.endsWith('.app') ? writeFileSync(join(path, 'Contents', 'ticket'), '') : undefined)),
    assess: () => Effect.void,
    opens,
    image: (app, image) => Effect.sync(() => writeFileSync(image, `the dmg around ${appOf(app)}`)),
  };
};

it.live('the sealed cut records the digest and size of each final disk image, and an image changed afterwards refuses the cut', () =>
  Effect.gen(function* () {
    const out = yield* cutAt('digest');
    const notary = yield* sealingNotary(accepting(() => Effect.void)).pipe(Effect.provide(machine));
    const notarize = () => Effect.result(notarizeRelease(notary, out).pipe(Effect.provide(machine)));

    const sealed = yield* notarize();
    const record = recordAt(out);
    const weighed = Object.fromEntries(
      Object.entries(record.images).map(([platform, image]) => [
        platform,
        { sha256: sha(join(out, image)), size: readFileSync(join(out, image)).length },
      ]),
    );
    writeFileSync(join(out, record.images['darwin-arm64']!), 'an image changed after it was sealed');
    const changed = yield* notarize();

    expect([sealed._tag, record.notarized]).toEqual(['Success', true]);
    expect(record.imageDigests).toEqual(weighed);
    expect(changed._tag === 'Failure' && changed.failure.step).toBe('image');
  }),
);

it.live(
  'a notarized cut recorded before its images were weighed is sealed in place, judged by Gatekeeper and recorded with their digests',
  () =>
    Effect.gen(function* () {
      const out = yield* cutAt('legacy');
      writeFileSync(join(out, RELEASE_RECORD), JSON.stringify({ ...recordAt(out), notarized: true }));
      const opened = new Set<string>();
      const notary = yield* sealingNotary({
        ...accepting(() => Effect.void),
        opens: (image) => Effect.sync(() => void opened.add(basename(image))),
      }).pipe(Effect.provide(machine));

      yield* notarizeRelease(notary, out).pipe(Effect.provide(machine));
      const record = recordAt(out);

      expect([...opened].sort()).toEqual(['Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg']);
      expect(record.notarized).toBe(true);
      expect(
        Object.entries(record.images).map(([platform, image]) => [
          platform,
          record.imageDigests?.[platform]?.sha256 === sha(join(out, image)),
        ]),
      ).toEqual([
        ['darwin-arm64', true],
        ['darwin-x64', true],
      ]);
    }),
);

it.live(
  'the disk images are made from the brand assets the cut carries, which pass to the notarized cut, and from the live assets when it carries none',
  () =>
    Effect.gen(function* () {
      const branded = yield* cutAt('branded');
      mkdirSync(join(branded, 'brand'));
      writeFileSync(join(branded, 'brand', 'logo'), 'the logo');
      const plain = yield* cutAt('plain');
      const assets: (string | undefined)[] = [];
      const notary = yield* sealingNotary({
        ...accepting(() => Effect.void),
        image: (app, image, given) => Effect.sync(() => (assets.push(given), writeFileSync(image, `the dmg around ${appOf(app)}`))),
      }).pipe(Effect.provide(machine));

      yield* notarizeRelease(notary, branded).pipe(Effect.provide(machine));
      const brandedAssets = assets.splice(0);
      yield* notarizeRelease(notary, plain).pipe(Effect.provide(machine));

      expect(brandedAssets).toEqual([join(branded, 'brand'), join(branded, 'brand')]);
      expect(readFileSync(join(branded, 'brand', 'logo'), 'utf8')).toBe('the logo');
      expect(assets).toEqual([undefined, undefined]);
    }),
);

it.live('a disk image Gatekeeper would not open refuses the notarization, and the cut stands unnotarized and whole', () =>
  Effect.gen(function* () {
    const out = yield* cutAt('refused');
    const before = recordAt(out);
    const notary = yield* sealingNotary(
      accepting((image) =>
        basename(image).includes('x64') ? Effect.fail(new NotarizationRefused({ detail: 'rejected', unblock: [] })) : Effect.void,
      ),
    ).pipe(Effect.provide(machine));
    const refused = yield* Effect.result(notarizeRelease(notary, out).pipe(Effect.provide(machine)));
    const standing = recordAt(out);

    expect(refused._tag === 'Failure' && refused.failure.detail).toBe('rejected');
    expect(standing).toEqual(before);
    expect(Object.values(standing.platforms).every((one) => sha(join(out, one.archive)) === one.sha256)).toBe(true);
  }),
);

it.live(
  'notarization submits, staples and judges the application and the disk image of every platform, the platforms side by side; stopped while Apple checks an image, it leaves the cut standing whole, and notarizing again sends nothing again',
  () =>
    Effect.gen(function* () {
      const out = yield* cutAt('release');

      const submitted: string[] = [];
      const stapled = new Set<string>();
      const opened = new Set<string>();
      const checking = yield* Deferred.make<void>();
      const x64Sent = yield* Deferred.make<void>();
      const arm64Opened = yield* Deferred.make<void>();
      const stopping = { during: true };
      const nameOf = (id: string) => submitted[Number(id.slice(-12)) - 1];
      const apple: Apple = {
        submit: (path) =>
          Effect.suspend(() => {
            const name = path.endsWith('.app') ? appOf(path) : basename(path);
            const id = submissionId(submitted.push(name));
            return name === 'x64' ? Effect.as(Deferred.succeed(x64Sent, undefined), id) : Effect.succeed(id);
          }),
        accepted: (id) =>
          Effect.suspend(() => {
            const name = nameOf(id);
            if (name === 'arm64') return Deferred.await(x64Sent).pipe(Effect.timeout('5 seconds'), Effect.orDie);
            return name === 'Tagma-0.1.0-x64.dmg' && stopping.during
              ? Deferred.await(arm64Opened).pipe(Effect.andThen(Deferred.succeed(checking, undefined)), Effect.andThen(Effect.never))
              : Effect.void;
          }),
        staple: (path) =>
          Effect.sync(() => {
            if (path.endsWith('.app')) writeFileSync(join(path, 'Contents', 'ticket'), '');
            else stapled.add(basename(path));
          }),
        assess: () => Effect.void,
        opens: (image) =>
          Effect.suspend(() => {
            opened.add(basename(image));
            return basename(image).includes('arm64') ? Deferred.succeed(arm64Opened, undefined).pipe(Effect.asVoid) : Effect.void;
          }),
        image: (app, image) => Effect.sync(() => writeFileSync(image, `the dmg around ${appOf(app)}, stapled ${stapledIn(app)}`)),
      };
      const notary = yield* sealingNotary(apple).pipe(Effect.provide(machine));
      const notarize = () => notarizeRelease(notary, out).pipe(Effect.provide(machine));

      const stopped = yield* Effect.forkChild(notarize());
      yield* Deferred.await(checking);
      yield* Fiber.interrupt(stopped);
      const standingAfterStop = recordAt(out);
      const wholeAfterStop = Object.values(standingAfterStop.platforms).every((one) => sha(join(out, one.archive)) === one.sha256);
      stopping.during = false;
      yield* notarize();
      const notarized = recordAt(out);

      expect([standingAfterStop.notarized, wholeAfterStop]).toEqual([false, true]);
      expect(submitted.toSorted()).toEqual(['Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg', 'arm64', 'x64']);
      expect([...stapled].sort()).toEqual(['Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg']);
      expect([...opened].sort()).toEqual(['Tagma-0.1.0-arm64.dmg', 'Tagma-0.1.0-x64.dmg']);
      expect(notarized.notarized).toBe(true);
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
