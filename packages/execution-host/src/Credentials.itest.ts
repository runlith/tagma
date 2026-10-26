import { credentialsLayer } from './posix/credentials';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { inspect } from 'node:util';
import * as BunCrypto from '@effect/platform-bun/BunCrypto';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Crypto, Deferred, Effect, Fiber, FileSystem, Layer, Path, PlatformError } from 'effect';
import * as Base64Url from 'effect/encoding/Base64Url';
import { Credentials } from './Credentials';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunCrypto.layer);
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'credentials-' });
  return { fs, path, root, references: { custodian: path.join(root, 'custodian'), recovery: path.join(root, 'recovery') } };
});
const open = (references: { custodian: string; recovery: string }) => Effect.provide(Credentials, credentialsLayer(references));
const sample = Base64Url.encode(new Uint8Array(32).fill(7));

layer(platform, { excludeTestServices: true })('Credentials', (it) => {
  it.effect('each role proves only its own secret and survives reopening', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, references } = yield* fixture;
          const first = yield* open(references);
          const custodianSecret = (yield* fs.readFileString(references.custodian)).trim();
          const recoverySecret = (yield* fs.readFileString(references.recovery)).trim();
          const mode = (yield* fs.stat(references.custodian)).mode & 0o777;
          const custodian = yield* first.authenticate('custodian', custodianSecret);
          const crossed = yield* Effect.flip(first.authenticate('custodian', recoverySecret));
          const reverse = yield* Effect.flip(first.authenticate('recovery', custodianSecret));
          const empty = yield* Effect.flip(first.authenticate('custodian', ''));
          const wrong = yield* Effect.flip(first.authenticate('recovery', `${recoverySecret}x`));
          const second = yield* open(references);
          const again = yield* second.authenticate('recovery', recoverySecret);
          const unchanged = (yield* fs.readFileString(references.custodian)).trim() === custodianSecret;
          return { custodian, crossed, reverse, empty, wrong, again, mode, unchanged };
        }),
      );
      expect(outcome.custodian).toBe('custodian');
      for (const refusal of [outcome.crossed, outcome.reverse, outcome.empty, outcome.wrong])
        expect(refusal._tag).toBe('CredentialRefused');
      expect(outcome.again).toBe('recovery');
      expect(outcome.mode).toBe(0o600);
      expect(outcome.unchanged).toBe(true);
    }),
  );

  it.effect.each([
    { name: 'empty', text: '' },
    { name: 'truncated', text: sample.slice(0, -1) },
    { name: 'noncanonical padding bits', text: `${sample.slice(0, -1)}B` },
    { name: 'trailing material', text: `${sample}\nx` },
    { name: 'oversized', text: 'x'.repeat(1024) },
  ])('refuses a $name standing credential without rewriting it', ({ text }) =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, references } = yield* fixture;
          yield* fs.writeFileString(references.custodian, text, { mode: 0o600 });
          const error = yield* Effect.flip(open(references));
          return { error, preserved: (yield* fs.readFileString(references.custodian)) === text };
        }),
      );
      expect(outcome.error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'format' }));
      expect(outcome.preserved).toBe(true);
    }),
  );

  it.effect.each([0o644, 0o620])('refuses a credential with foreign read or write permissions (%i)', (mode) =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, references } = yield* fixture;
          yield* fs.writeFileString(references.custodian, `${sample}\n`, { mode: 0o600 });
          yield* fs.chmod(references.custodian, mode);
          const error = yield* Effect.flip(open(references));
          return { error, mode: (yield* fs.stat(references.custodian)).mode & 0o777 };
        }),
      );
      expect(outcome.error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'identity' }));
      expect(outcome.mode).toBe(mode);
    }),
  );

  it.effect('refuses a non-private credential directory', () =>
    Effect.gen(function* () {
      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, root, references } = yield* fixture;
          yield* fs.chmod(root, 0o755);
          return yield* Effect.flip(open(references));
        }),
      );
      expect(error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'identity' }));
    }),
  );

  it.effect('refuses a foreign-writable ancestor even when the credential directory is private', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, root } = yield* fixture;
          const directory = path.join(root, 'keys');
          yield* fs.makeDirectory(directory, { mode: 0o700 });
          const references = { custodian: path.join(directory, 'custodian'), recovery: path.join(directory, 'recovery') };
          yield* fs.writeFileString(references.custodian, `${sample}\n`, { mode: 0o600 });
          yield* fs.chmod(root, 0o770);
          const error = yield* Effect.flip(open(references));
          return { error, preserved: (yield* fs.readFileString(references.custodian)) === `${sample}\n` };
        }),
      );
      expect(outcome.error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'identity' }));
      expect(outcome.preserved).toBe(true);
    }),
  );

  it.effect.each(['same path', 'parent alias', 'symbolic link', 'hard link', 'same bytes'] as const)(
    'refuses collapsed role authority through %s',
    (kind) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, root, references } = yield* fixture;
            yield* fs.writeFileString(references.custodian, `${sample}\n`, { mode: 0o600 });
            if (kind === 'same path') references.recovery = references.custodian;
            if (kind === 'parent alias') {
              const alias = path.join(root, 'alias');
              yield* fs.symlink(root, alias);
              references.recovery = path.join(alias, 'custodian');
            }
            if (kind === 'symbolic link') yield* fs.symlink(references.custodian, references.recovery);
            if (kind === 'hard link') yield* fs.link(references.custodian, references.recovery);
            if (kind === 'same bytes') yield* fs.writeFileString(references.recovery, `${sample}\n`, { mode: 0o600 });
            const error = yield* Effect.flip(open(references));
            return { error, preserved: (yield* fs.readFileString(references.custodian)) === `${sample}\n` };
          }),
        );
        expect(outcome.error._tag).toBe('CredentialsFailed');
        expect(outcome.preserved).toBe(true);
      }),
  );

  it.effect('a paused partial writer cannot publish or replace a concurrent complete winner', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, references } = yield* fixture;
          const partial = yield* Deferred.make<void>();
          const resume = yield* Deferred.make<void>();
          let paused = false;
          const controlled: FileSystem.FileSystem = {
            ...fs,
            open: (file, options) =>
              fs.open(file, options).pipe(
                Effect.map((handle) => {
                  if (options?.flag !== 'wx' || paused) return handle;
                  paused = true;
                  return {
                    [FileSystem.FileTypeId]: FileSystem.FileTypeId,
                    stat: handle.stat,
                    sync: handle.sync,
                    seek: handle.seek.bind(handle),
                    read: handle.read.bind(handle),
                    readAlloc: handle.readAlloc.bind(handle),
                    truncate: handle.truncate.bind(handle),
                    write: handle.write.bind(handle),
                    writeAll: Effect.fnUntraced(function* (bytes) {
                      yield* handle.writeAll(bytes.subarray(0, 1));
                      yield* Deferred.succeed(partial, undefined);
                      yield* Deferred.await(resume);
                      yield* handle.writeAll(bytes.subarray(1));
                    }),
                  } satisfies FileSystem.File;
                }),
              ),
          };
          const first = yield* open(references).pipe(Effect.provideService(FileSystem.FileSystem, controlled), Effect.forkChild);
          yield* Deferred.await(partial);
          const premature = yield* fs.exists(references.custodian);
          const winner = yield* open(references);
          const secret = (yield* fs.readFileString(references.custodian)).trim();
          const recovery = (yield* fs.readFileString(references.recovery)).trim();
          yield* Deferred.succeed(resume, undefined);
          const loser = yield* Fiber.join(first);
          return {
            premature,
            winner: yield* winner.authenticate('custodian', secret),
            loser: yield* loser.authenticate('custodian', secret),
            recovery: yield* loser.authenticate('recovery', recovery),
            empty: yield* Effect.flip(loser.authenticate('custodian', '')),
            preserved: (yield* fs.readFileString(references.custodian)).trim() === secret,
          };
        }),
      );
      expect(outcome.premature).toBe(false);
      expect(outcome.winner).toBe('custodian');
      expect(outcome.loser).toBe('custodian');
      expect(outcome.recovery).toBe('recovery');
      expect(outcome.empty._tag).toBe('CredentialRefused');
      expect(outcome.preserved).toBe(true);
    }),
  );

  it.effect('crypto failure remains an internal redacted failure, not invalid proof', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const { fs, references } = yield* fixture;
          const crypto = yield* Crypto.Crypto;
          let unavailable = false;
          const controlled: Crypto.Crypto = {
            ...crypto,
            digest: (algorithm, data) =>
              Effect.suspend(() =>
                unavailable
                  ? Effect.fail(
                      PlatformError.badArgument({ module: 'Crypto', method: 'digest', description: new TextDecoder().decode(data) }),
                    )
                  : crypto.digest(algorithm, data),
              ),
          };
          const credentials = yield* open(references).pipe(Effect.provideService(Crypto.Crypto, controlled));
          const secret = (yield* fs.readFileString(references.custodian)).trim();
          unavailable = true;
          const error = yield* Effect.flip(credentials.authenticate('custodian', secret));
          return { error, leaked: inspect(error, { depth: null, showHidden: true }).includes(secret) };
        }),
      );
      expect(outcome.error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'digest', detail: 'BadArgument' }));
      expect(outcome.leaked).toBe(false);
    }),
  );

  it.effect('invalid generated byte length is refused before it becomes a credential', () =>
    Effect.gen(function* () {
      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          const { references } = yield* fixture;
          const crypto = yield* Crypto.Crypto;
          const controlled: Crypto.Crypto = { ...crypto, randomBytes: () => Effect.succeed(new Uint8Array(0)) };
          return yield* Effect.flip(open(references).pipe(Effect.provideService(Crypto.Crypto, controlled)));
        }),
      );
      expect(error).toEqual(expect.objectContaining({ _tag: 'CredentialsFailed', act: 'generate' }));
    }),
  );
});
