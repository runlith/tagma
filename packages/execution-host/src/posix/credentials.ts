import { Crypto, Effect, FileSystem, Layer, Option, Path, type PlatformError } from 'effect';
import * as Base64Url from 'effect/encoding/Base64Url';
import type { CredentialReferences, Role } from '@runlith/executions/protocol/registration';
import { CredentialRefused, Credentials, CredentialsFailed } from '../Credentials';

export const credentialsLayer = (references: CredentialReferences) => Layer.effect(Credentials, make(references));

const SECRET_BYTES = 32;
const SECRET_FORMAT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const FILE_BYTES = 44;
const DIGEST = 'SHA-256';

const same = (a: Uint8Array, b: Uint8Array): boolean => {
  let difference = a.length ^ b.length;
  for (let index = 0; index < a.length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
};

const make = Effect.fn('Credentials.make')(function* (references: CredentialReferences) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const uid = process.geteuid?.();
  const refuse = (file: string, act: string, detail: string) => Effect.fail(new CredentialsFailed({ path: file, act, detail }));
  const failed =
    (file: string, act: string) =>
    <A, R>(self: Effect.Effect<A, CredentialsFailed | PlatformError.PlatformError, R>) =>
      Effect.catchTag(self, 'PlatformError', (error) => refuse(file, act, error.reason._tag));

  if (uid === undefined) {
    return yield* refuse('', 'identity', 'Private filesystem identity is unsupported');
  }

  const prepare = Effect.fn('Credentials.prepare')(function* (file: string) {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
    const directory = yield* fs.realPath(path.dirname(file));
    let ancestor = directory;
    while (true) {
      const info = yield* fs.stat(ancestor);
      const owner = Option.getOrUndefined(info.uid);
      const trusted = owner === uid || owner === 0;
      const sticky = (info.mode & 0o1000) !== 0;
      if (info.type !== 'Directory' || !trusted || ((info.mode & 0o022) !== 0 && !sticky)) {
        return yield* refuse(file, 'identity', 'Credential directory has an untrusted owner or writer');
      }
      if (ancestor === directory && (owner !== uid || (info.mode & 0o077) !== 0)) {
        return yield* refuse(file, 'identity', 'Credential directory is not user-private');
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    return path.join(directory, path.basename(file));
  });

  const custodianPath = yield* prepare(references.custodian).pipe(failed(references.custodian, 'prepare'));
  const recoveryPath = yield* prepare(references.recovery).pipe(failed(references.recovery, 'prepare'));
  if (custodianPath === recoveryPath) return yield* refuse(recoveryPath, 'roles', 'Credential references alias');

  const validate = (file: string, info: FileSystem.File.Info) => {
    if (info.type !== 'File' || Option.getOrUndefined(info.uid) !== uid || (info.mode & 0o077) !== 0 || Option.isNone(info.ino)) {
      return refuse(file, 'identity', 'Credential is not a user-private regular file');
    }
    if (info.size < FILE_BYTES - 1 || info.size > FILE_BYTES) return refuse(file, 'format', 'Invalid credential encoding');
    return Effect.void;
  };

  const read = Effect.fn('Credentials.read')(function* (file: string) {
    const canonical = yield* fs.realPath(file);
    if (canonical !== file) return yield* refuse(file, 'identity', 'Credential must not be a symbolic link or path alias');
    const before = yield* fs.stat(file);
    yield* validate(file, before);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fs.open(file);
        const info = yield* handle.stat;
        yield* validate(file, info);
        if (info.dev !== before.dev || Option.getOrUndefined(info.ino) !== Option.getOrUndefined(before.ino)) {
          return yield* refuse(file, 'identity', 'Credential identity changed while opening');
        }
        const bytes = new Uint8Array(FILE_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
          const count = Number(yield* handle.read(bytes.subarray(length)));
          if (count === 0) break;
          length += count;
        }
        const after = yield* handle.stat;
        yield* validate(file, after);
        const text = new TextDecoder().decode(bytes.subarray(0, length));
        const secret = text.endsWith('\n') ? text.slice(0, -1) : text;
        if (length !== Number(after.size) || !SECRET_FORMAT.test(secret)) {
          return yield* refuse(file, 'format', 'Invalid credential encoding');
        }
        return { secret, dev: info.dev, ino: Option.getOrUndefined(info.ino) };
      }),
    );
  });

  const establish = Effect.fn('Credentials.establish')(function* (file: string) {
    const standing = yield* read(file).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)));
    if (standing !== undefined) return standing;
    const bytes = yield* crypto.randomBytes(SECRET_BYTES);
    const secret = Base64Url.encode(bytes);
    if (bytes.length !== SECRET_BYTES || !SECRET_FORMAT.test(secret)) {
      return yield* refuse(file, 'generate', 'Invalid credential encoding');
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* fs.makeTempDirectoryScoped({ directory: path.dirname(file), prefix: '.credential-' });
        const temporary = path.join(directory, 'secret');
        const handle = yield* fs.open(temporary, { flag: 'wx', mode: 0o600 });
        yield* handle.writeAll(new TextEncoder().encode(`${secret}\n`));
        yield* handle.sync;
        yield* read(temporary);
        yield* fs.link(temporary, file).pipe(Effect.catchReason('PlatformError', 'AlreadyExists', () => Effect.void));
      }),
    );
    return yield* read(file);
  });

  const custodian = yield* establish(custodianPath).pipe(failed(custodianPath, 'establish'));
  const recovery = yield* establish(recoveryPath).pipe(failed(recoveryPath, 'establish'));
  if (custodian.dev === recovery.dev && custodian.ino === recovery.ino) {
    return yield* refuse(recoveryPath, 'roles', 'Credential references alias');
  }
  const digest = Effect.fn('Credentials.digest')(function* (file: string, secret: string) {
    const bytes = yield* crypto.digest(DIGEST, new TextEncoder().encode(secret)).pipe(failed(file, 'digest'));
    if (bytes.length !== SECRET_BYTES) return yield* refuse(file, 'digest', 'Invalid digest length');
    return bytes;
  });
  const expected: Record<Role, Uint8Array> = {
    custodian: yield* digest(custodianPath, custodian.secret),
    recovery: yield* digest(recoveryPath, recovery.secret),
  };
  if (same(expected.custodian, expected.recovery)) return yield* refuse(recoveryPath, 'roles', 'Role credentials must differ');

  return Credentials.of({
    references,
    authenticate: (role, secret) =>
      Effect.suspend(() => {
        if (!SECRET_FORMAT.test(secret)) return Effect.fail(new CredentialRefused({ role }));
        return digest(references[role], secret).pipe(
          Effect.flatMap((presented) =>
            same(presented, expected[role]) ? Effect.succeed(role) : Effect.fail(new CredentialRefused({ role })),
          ),
        );
      }),
  });
});
