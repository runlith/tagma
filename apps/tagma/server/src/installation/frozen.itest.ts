import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Arbitrary, Effect, FileSystem, Result, Schema } from 'effect';
import { phaseStampSchema } from '../platform/contract/wire/phases.js';
import { migrationLoadSchema } from '../platform/contract/wire/migrationLoad.js';
import { attemptSchema, returnSchema } from './contract/wire/attempt.js';
import { ATTEMPT_FILE, INSTALL_FILE, RETURN_FILE } from './contract/wire/layout.js';
import { InstallationRole, IRREVERSIBLE_STORES } from './contract/wire/manifest.js';
import { restartDoorSchema } from './contract/wire/restart.js';
import { installedSchema, installingSchema } from './contract/wire/next.js';
import { updateRecordSchema } from './contract/wire/update.js';
import { makeKeptRecord } from '../platform/durable/keptRecord.js';
import type { Source } from './contract/wire/source.js';
import { readAttempt, readReturn, writeAttempt, writeReturn } from './closure/attempt.js';
import { makeManifestProjection } from './closure/manifests.js';
import { partsAt } from './closure/read.js';
import { writeInstallation } from './closure/write.js';
import { makeProcessRestart } from './process/record.js';
import { FROZEN } from './testing/frozen.js';

const sampled = <S extends Schema.Constraint>(schema: S) => Arbitrary.sampleEffect(Arbitrary.schema(schema), { count: 24, seed: 1 });

const issuedReads = <S extends Schema.Codec<unknown, unknown>>(schema: S, text: string): string | undefined => {
  const read = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(text);
  return Result.isSuccess(read) ? undefined : read.failure.message;
};

const SOURCE: Source = {
  cut: { startedAt: '2026-11-03T18:00:00.000Z', revision: { head: 'a1841b48', dirty: true } },
  installation: { build: '7', digest: `sha256:${'0'.repeat(64)}` },
};

layer(BunFileSystem.layer, { excludeTestServices: true })('frozen wire formats', (it) => {
  it.effect('every issued release takes the manifest today writes, and today takes every manifest an issued release wrote', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-frozen-' });
      for (const role of InstallationRole.literals) {
        yield* files.makeDirectory(join(root, role));
        yield* files.writeFileString(join(root, role, 'part'), role);
        yield* files.symlink('part', join(root, role, 'link'));
      }
      const parts = (yield* Effect.forEach(InstallationRole.literals, (role) => partsAt(root, role, role))).flat();
      const origin = { checkout: '/checkout', inputs: ['skills/local/SKILL.md'] };
      const changes = IRREVERSIBLE_STORES.map((store) => ({ store, release: '0.2.3' }));
      yield* writeInstallation(root, { os: 'darwin', arch: 'arm64' }, '7', parts, origin, 'tree', changes);
      const written = yield* files.readFileString(join(root, INSTALL_FILE));

      const today = makeManifestProjection();
      for (const shape of FROZEN) {
        const read = Schema.decodeUnknownResult(Schema.fromJsonString(shape.manifest))(written);
        expect(Result.isSuccess(read) ? shape.closureIssue(read.success) : read.failure.message).toBeUndefined();

        for (const [at, sample] of (yield* sampled(shape.manifest)).entries()) {
          const kept = [
            ...sample.parts.map((part, index) => ({ ...part, path: `kept/${index}` })),
            ...shape.roles.map((role) => ({
              role,
              path: `roles/${role}`,
              kind: 'file' as const,
              bytes: 0,
              digest: sample.identity.digest,
            })),
          ];
          const issued = { ...sample, parts: kept, identity: { ...sample.identity, digest: shape.identity({ ...sample, parts: kept }) } };
          const place = join(root, 'issued', String(at));
          yield* files.makeDirectory(place, { recursive: true });
          yield* files.writeFileString(join(place, INSTALL_FILE), JSON.stringify(issued));
          expect(today.read(place)).toMatchObject({ _tag: 'Read' });
        }
      }
    }),
  );

  it.effect('every issued release reads the attempt and return records today writes, and today reads the ones it wrote', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-frozen-' });
      const attempts = yield* sampled(attemptSchema);
      const returns = yield* sampled(returnSchema);
      for (const shape of FROZEN) {
        for (const attempt of attempts) {
          writeAttempt(root, attempt);
          expect(issuedReads(shape.attempt, yield* files.readFileString(join(root, ATTEMPT_FILE)))).toBeUndefined();
        }
        for (const back of returns) {
          writeReturn(root, back.left, back.to);
          expect(issuedReads(shape.returned, yield* files.readFileString(join(root, RETURN_FILE)))).toBeUndefined();
        }

        yield* files.symlink('0.2.0', join(root, 'current'));
        for (const attempt of yield* sampled(shape.attempt)) {
          yield* files.writeFileString(join(root, ATTEMPT_FILE), JSON.stringify(attempt));
          expect(Result.getOrThrow(readAttempt(root))).not.toBeNull();
        }
        for (const back of yield* sampled(shape.returned)) {
          yield* files.writeFileString(join(root, RETURN_FILE), JSON.stringify({ ...back, to: '0.2.0' }));
          expect(Result.getOrThrow(readReturn(root))).not.toBeNull();
        }
        yield* files.remove(join(root, 'current'));
      }
    }),
  );

  it.effect(
    'every issued release reads the restart record today’s predecessor and successor write, and today reads the ones it wrote',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-frozen-' });
        const path = join(root, 'restart.json');
        const [heavy] = yield* sampled(migrationLoadSchema);
        const stamps = yield* sampled(phaseStampSchema);

        const leaving = yield* makeProcessRestart({ path, pid: 101 });
        const id = yield* leaving.begin(heavy);
        for (const stamp of stamps) yield* leaving.phase({ ...stamp, pid: 101 });
        for (const door of restartDoorSchema.literals) {
          leaving.point('door-ready', { door, migrations: 2 });
          leaving.point('door-closed', { door });
        }
        leaving.point('standing-by');
        leaving.point('data-taken');
        leaving.spawned(202, SOURCE);
        leaving.hostEnded(3, 'the host ended with the predecessor');
        leaving.unreleased('the predecessor kept its lock');
        const left = yield* files.readFileString(path);

        const coming = yield* makeProcessRestart({ path, pid: 202, incoming: id });
        expect(Result.isSuccess(coming.load())).toBe(true);
        coming.identify(SOURCE);
        coming.start(1, 900);
        coming.opening({ phase: 'migration', path: 'tagma.sqlite', at: 1, name: '20261103_step', index: 1, total: 2 });
        coming.point('door-ready', { door: 'local', migrations: 2 });
        for (const door of restartDoorSchema.literals) coming.frame(door, 5, 'thread', 2);
        yield* coming.report({ restartId: id, clientId: 'client', door: 'local', projectId: 5, threadId: 'thread', durationMs: 12_000 });
        coming.fail('the successor failed after its door');
        const came = yield* files.readFileString(path);

        for (const shape of FROZEN) {
          expect(issuedReads(shape.restart, left)).toBeUndefined();
          expect(issuedReads(shape.restart, came)).toBeUndefined();
          for (const record of yield* sampled(shape.restart)) {
            yield* files.writeFileString(path, JSON.stringify(record));
            expect(Result.isSuccess((yield* makeProcessRestart({ path, pid: 303 })).load())).toBe(true);
          }
        }
      }),
  );

  it.effect('every issued release reads the update record today writes, and today reads the ones it wrote', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-frozen-' });
      const path = join(root, 'update.json');
      const record = yield* makeKeptRecord(updateRecordSchema, path, 'update record');
      const finite = <A>(value: A): A =>
        JSON.parse(JSON.stringify(value, (_key, field: unknown) => (typeof field === 'number' && !Number.isFinite(field) ? 0 : field)));
      const installings = (yield* sampled(installingSchema)).map(finite);
      const installeds = (yield* sampled(installedSchema)).map(finite);
      const feed = {
        releases: [
          {
            release: '0.2.3',
            platforms: { 'darwin-arm64': { archive: 'https://releases.example/a.tar.gz', sha256: 'a'.repeat(64), size: 1 } },
            irreversible: false,
            stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
            changes: [],
          },
        ] as const,
      };
      for (const [at, installing] of installings.entries()) {
        yield* record.write({ feed, installing, installed: installeds[at] ?? null, took: at });
        const written = yield* files.readFileString(path);
        for (const shape of FROZEN) expect(issuedReads(shape.update, written)).toBeUndefined();
      }
      for (const shape of FROZEN) {
        for (const kept of yield* sampled(shape.update)) {
          yield* files.writeFileString(path, JSON.stringify(kept));
          expect(yield* record.read).not.toBeNull();
        }
      }
    }),
  );
});
