import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, FileSystem, Layer, Result } from 'effect';
import { arrive, enterTrial } from '../installation/process/trial.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { passAttempt, readAttempt, writeAttempt, writeReturn } from '../installation/closure/attempt.js';
import { ATTEMPT_OPEN } from '../installation/contract/wire/attempt.js';
import { releaseAt } from '../installation/closure/manifests.js';
import { swapCurrent } from '../platform/lock/versionedDirectories.js';
import { EXECUTIONS_RUNTIME } from '../installation/contract/wire/archive.js';
import { type InstallPlace, installRelease, type Weigh } from './install.js';
import { carriedIn, serverless, syntheticReleaseEffect, trustedApplications } from './testing/release.js';

const attemptAt = (root: string) => Result.getOrThrow(readAttempt(root));

class World extends Context.Service<World, { readonly home: string; readonly root: string; readonly place: InstallPlace }>()(
  'testing/ReleaseInstallation',
) {}
const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'tagma-install-from-' }));
    const root = join(home, '.tagma/install');
    return { home, root, place: { installRoot: root, launcher: join(home, '.tagma/bin/tagma'), name: 'Tagma' } };
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));
const standing = Effect.fnUntraced(function* () {
  return yield* (yield* FileSystem.FileSystem).readLink(join((yield* World).root, 'current'));
});
const versions = Effect.fnUntraced(function* () {
  const { root } = yield* World;
  return (yield* (yield* FileSystem.FileSystem).readDirectory(root)).filter(
    (name) => name !== 'current' && releaseAt(root, name) !== undefined,
  );
});
const built = Effect.fnUntraced(function* (name: string, build: string, irreversible?: Parameters<typeof syntheticReleaseEffect>[2]) {
  const bundle = join((yield* World).home, name, 'Tagma.app');
  yield* syntheticReleaseEffect(bundle, build, irreversible);
  return bundle;
});
const offered = Effect.fnUntraced(function* (bundle: string, asking = false) {
  const { place } = yield* World;
  return yield* Effect.result(
    installRelease(carriedIn(bundle), place, trustedApplications, new Date(yield* Clock.currentTimeMillis), asking, serverless),
  );
});
const landed = Effect.fnUntraced(function* (bundle: string) {
  const { place } = yield* World;
  return yield* installRelease(
    carriedIn(bundle),
    place,
    trustedApplications,
    new Date(yield* Clock.currentTimeMillis),
    false,
    serverless,
  ).pipe(
    Effect.mapError((failure) => new Error(`${failure.step}: ${failure.reason}`)),
    Effect.orDie,
    Effect.flatMap((answer) =>
      answer.status === 'landed' ? Effect.succeed(answer) : Effect.die(answer.status === 'ask' ? answer.said : answer.detail),
    ),
  );
});

describe('install-from', () => {
  it.live(
    'a release lands with a copy of the application beside it, records the attempt from the release before and becomes current; the same release again changes nothing',
    () =>
      Effect.gen(function* () {
        const { root } = yield* World;
        const first = yield* built('one', '0.1.0');
        const one = yield* landed(first);
        expect(yield* standing()).toBe(one.version);
        expect(one.application).toBe(join(root, one.version, 'desktop/Tagma.app'));
        expect(existsSync(join(one.application, 'Contents/Resources/release/install.json'))).toBe(true);
        expect(readFileSync(join(one.root, EXECUTIONS_RUNTIME))).toEqual(readFileSync(join(one.root, 'bun')));
        expect(existsSync(join(carriedIn(first), 'install.json'))).toBe(true);
        expect(attemptAt(root)).toEqual({ from: null, to: one.version, starts: 0, copied: false, ended: null });

        const again = yield* landed(first);
        expect([again.version, again.previous, (yield* versions()).length]).toEqual([one.version, null, 1]);

        passAttempt(root, one.version);
        const two = yield* landed(yield* built('two', '0.2.0'));
        expect([yield* standing(), two.previous]).toEqual([two.version, one.version]);
        expect(attemptAt(root)).toMatchObject({ from: one.version, to: two.version, ended: null });
      }).pipe(Effect.provide(world)),
  );

  it.live(
    'a person is asked before updating again from a release they went back to, past a release with no way back, and onto one whose last attempt rolled back; agreeing installs',
    () =>
      Effect.gen(function* () {
        const { root } = yield* World;
        const { version: from } = yield* landed(yield* built('two', '0.2.0'));
        passAttempt(root, from);
        const before = attemptAt(root)!;
        writeReturn(root, '0.3.0', from);
        const three = yield* built('three', '0.3.0');
        const back = yield* offered(three, true);
        expect(back._tag === 'Success' ? back.success : null).toMatchObject({ status: 'ask', reason: 'stepped-back' });
        expect([yield* standing(), attemptAt(root)]).toEqual([from, before]);

        const agreed = yield* landed(three);
        expect(yield* standing()).toBe(agreed.version);
        writeAttempt(root, {
          from,
          to: agreed.version,
          starts: 1,
          copied: true,
          ended: { detail: 'the migration failed', data: 'restored' },
        });
        swapCurrent(root, from);
        const failed = yield* offered(three, true);
        expect(failed._tag === 'Success' ? failed.success : null).toMatchObject({ status: 'ask', reason: 'failed' });

        const four = yield* built('four', '0.4.0', [{ store: 'machine-store', release: '0.4.0' }]);
        const irreversible = yield* offered(four, true);
        expect(irreversible._tag === 'Success' ? irreversible.success : null).toMatchObject({ status: 'ask', reason: 'irreversible' });
        expect(yield* standing()).toBe(from);
      }).pipe(Effect.provide(world)),
  );

  it.live(
    'a release older than the one that stands, one whose part differs from its manifest, or one carrying the bun its host bundle is cloned, refuses and changes nothing that stands',
    () =>
      Effect.gen(function* () {
        const { root } = yield* World;
        const { version } = yield* landed(yield* built('two', '0.2.0'));
        passAttempt(root, version);
        const before = [yield* standing(), (yield* versions()).length];
        const older = yield* offered(yield* built('one', '0.1.0'));
        expect(older._tag === 'Failure' ? [older.failure.step, older.failure.words !== undefined] : 'installed').toEqual(['order', true]);

        const tampered = yield* built('tampered', '0.5.0');
        writeFileSync(join(carriedIn(tampered), 'bin/server/http.js'), 'export const build = "elsewhere";\n');
        const carried = yield* built('carried', '0.5.0');
        copyFileSync(join(carriedIn(carried), 'bun'), join(carriedIn(carried), EXECUTIONS_RUNTIME));
        for (const bundle of [tampered, carried]) {
          const refused = yield* offered(bundle);
          expect(refused._tag === 'Failure' ? refused.failure.step : 'installed').toBe('verify');
        }
        expect([yield* standing(), (yield* versions()).length]).toEqual(before);
      }).pipe(Effect.provide(world)),
  );

  it.live(
    'an update its release has started and not finished refuses another install; one not started yet is replaced, still going back to the release before it, which alone stays beside',
    () =>
      Effect.gen(function* () {
        const { root } = yield* World;
        const { version: from } = yield* landed(yield* built('four', '0.4.0'));
        passAttempt(root, from);
        const five = yield* landed(yield* built('five', '0.5.0'));
        writeAttempt(root, { ...attemptAt(root)!, starts: 1 });
        const six = yield* built('six', '0.6.0');
        const open = yield* offered(six);
        expect(open._tag === 'Failure' ? open.failure.code : 'installed').toBe(ATTEMPT_OPEN);
        expect(yield* standing()).toBe(five.version);

        writeAttempt(root, { ...attemptAt(root)!, starts: 0 });
        const replaced = yield* landed(six);
        expect(attemptAt(root)).toMatchObject({ from, to: replaced.version, starts: 0, ended: null });
        expect((yield* versions()).toSorted()).toEqual([from, replaced.version].toSorted());
      }).pipe(Effect.provide(world)),
  );

  it.live('two installs at once land one after the other, both moving from the release that served, and leave no copy half made', () =>
    Effect.gen(function* () {
      const { root } = yield* World;
      const { version } = yield* landed(yield* built('six', '0.6.0'));
      passAttempt(root, version);
      const [seven, eight] = [yield* built('seven', 'a7a7a7a 20261015T070000Z'), yield* built('eight', 'b8b8b8b 20261015T080000Z')];
      const both = yield* Effect.all([landed(seven), landed(eight)], { concurrency: 2 });
      const current = yield* standing();
      const last = both.find((one) => one.version === current)!;
      const first = both.find((one) => one !== last)!;
      expect([first.previous, last.previous, attemptAt(root)?.from]).toEqual([version, version, version]);
      expect((yield* versions()).toSorted()).toEqual([version, last.version].toSorted());
      expect(readdirSync(root).filter((name) => name.endsWith('.incoming'))).toEqual([]);
    }).pipe(Effect.provide(world)),
  );

  it.live(
    'an update whose data did not come back still stands: a newer release refuses to install over it, and the release before it stays',
    () =>
      Effect.gen(function* () {
        const { root } = yield* World;
        const { version: from } = yield* landed(yield* built('one', '0.1.0'));
        passAttempt(root, from);
        const two = yield* landed(yield* built('two', '0.2.0'));
        const unrestored = {
          from,
          to: two.version,
          starts: 2,
          copied: true,
          ended: { detail: 'the migration failed', data: 'unrestored' as const },
        };
        writeAttempt(root, unrestored);
        const three = yield* offered(yield* built('three', '0.3.0'));
        expect(three._tag === 'Failure' ? three.failure.code : 'installed').toBe(ATTEMPT_OPEN);
        expect([yield* standing(), attemptAt(root)]).toEqual([two.version, unrestored]);
        expect(yield* versions()).toEqual(expect.arrayContaining([from, two.version]));
      }).pipe(Effect.provide(world)),
  );

  it.live(
    'an update record or served record that does not read refuses an install over it and keeps every release, until a start sets it aside',
    () =>
      Effect.gen(function* () {
        const { home, root } = yield* World;
        const { version: from } = yield* landed(yield* built('one', '0.1.0'));
        passAttempt(root, from);
        const two = yield* landed(yield* built('two', '0.2.0'));
        writeAttempt(root, {
          from,
          to: two.version,
          starts: 2,
          copied: true,
          ended: { detail: 'the migration failed', data: 'unrestored' },
        });
        const damaged = '{"from":"one","to":';
        writeFileSync(join(root, 'attempt.json'), damaged);
        const three = yield* built('three', '0.3.0');
        const refused = yield* offered(three);
        expect(refused._tag === 'Failure' ? refused.failure.code : 'installed').toBe(ATTEMPT_OPEN);
        expect([yield* standing(), readFileSync(join(root, 'attempt.json'), 'utf8')]).toEqual([two.version, damaged]);
        expect(yield* versions()).toEqual(expect.arrayContaining([from, two.version]));

        const data = join(home, '.tagma');
        mkdirSync(data, { recursive: true });
        const starting = { installRoot: root, release: join(root, two.version), files: [join(data, 'tagma.sqlite')], stores: null };
        expect(yield* arrive(starting).pipe(Effect.orDie)).toBe('serve');
        writeFileSync(join(root, 'served.json'), '{"release":');
        const served = yield* offered(three);
        expect(served._tag === 'Failure' ? served.failure.code : 'installed').toBe(ATTEMPT_OPEN);

        expect(yield* enterTrial(starting).pipe(Effect.orDie)).toBeNull();
        expect((yield* landed(three)).previous).toBe(two.version);
      }).pipe(Effect.provide(world)),
  );

  it.live(
    'a start of the release an install would replace, arriving while the install asks the running server, enters, and the install then refuses rather than replace the update that began',
    () =>
      Effect.gen(function* () {
        const { home, root, place } = yield* World;
        const { version: from } = yield* landed(yield* built('four', '0.4.0'));
        passAttempt(root, from);
        const five = yield* landed(yield* built('five', '0.5.0'));
        const data = join(home, '.tagma');
        mkdirSync(data, { recursive: true });
        const starting = { installRoot: root, release: join(root, five.version), files: [join(data, 'tagma.sqlite')], stores: null };
        let arrived: string | null = null;
        const asked: Weigh = () =>
          Effect.map(arrive(starting).pipe(Effect.orDie), (verdict) => {
            arrived = verdict;
            return { _tag: 'Unasked', detail: 'the start arrived while the server was asked' } as const;
          });
        const six = yield* built('six', '0.6.0');
        const refused = yield* Effect.flip(
          installRelease(carriedIn(six), place, trustedApplications, new Date(yield* Clock.currentTimeMillis), false, asked),
        );
        expect([refused.code, arrived, yield* standing()]).toEqual([ATTEMPT_OPEN, 'serve', five.version]);
        expect(attemptAt(root)).toMatchObject({ from, to: five.version, starts: 1 });
      }).pipe(Effect.provide(world)),
  );

  it.live('an update moves from the release whose data a start opened last, even one that no longer stands', () =>
    Effect.gen(function* () {
      const { home, root } = yield* World;
      const one = yield* landed(yield* built('one', '0.1.0'));
      passAttempt(root, one.version);
      const two = yield* landed(yield* built('two', '0.2.0'));
      passAttempt(root, two.version);
      swapCurrent(root, one.version);
      const data = join(home, '.tagma');
      mkdirSync(data, { recursive: true });
      const serving = { installRoot: root, release: join(root, two.version), files: [join(data, 'tagma.sqlite')], stores: null };
      expect(yield* enterTrial(serving).pipe(Effect.orDie)).toBeNull();

      const three = yield* landed(yield* built('three', '0.3.0'));
      expect([attemptAt(root)?.from, three.previous]).toEqual([two.version, two.version]);
    }).pipe(Effect.provide(world)),
  );
});
