import { Effect, FileSystem, type Scope } from 'effect';
import type { SandboxRecord } from '../contract/wire/sandbox.js';
import type { GuestBackend } from '../contract/service/backends.js';
import type { SandboxFile } from '../contract/service/files.js';
import { SandboxUnavailable } from '../contract/service/sandboxes.js';

const SOURCE_CEILING = 8 * 1024 * 1024;

export const readGuestFile = Effect.fn('sandbox.readGuestFile')(function* (
  sandbox: string,
  row: SandboxRecord,
  path: string,
  stillness: string,
  runtime: GuestBackend,
): Effect.fn.Return<SandboxFile, SandboxUnavailable, Scope.Scope> {
  const refuse = (reason: string) => new SandboxUnavailable({ sandbox, reason });
  if (path.startsWith('/') || path.split('/').includes('..')) {
    return yield* refuse(`${path} is not a path inside the guest's tree, relative to its root`);
  }
  if (row.manifest === null) return yield* refuse('it carries no manifest');
  const tree = yield* runtime.sealedWorld(row.runtime, row.manifest.image);
  const files = tree.world.files;
  if (files === undefined) return yield* refuse('its reader binds no filesystem');
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const real = yield* fs.realPath(`${tree.root}/${path}`);
    if (!real.startsWith(`${tree.root}/`)) {
      return yield* refuse(`${path} resolves to ${real}, which is outside the guest's tree`);
    }
    const info = yield* fs.stat(real);
    if (info.type !== 'File') return yield* refuse(`${path} is a ${info.type.toLowerCase()}, not a file`);
    const size = Number(info.size);
    if (size > SOURCE_CEILING) {
      return yield* refuse(`${path} is ${size} bytes, past the ${SOURCE_CEILING} an import carries`);
    }
    const bytes = yield* fs.readFile(real);
    const text = decodeText(bytes);
    if (text === null) return yield* refuse(`${path} is not UTF-8 text, and an import carries text`);
    return { text, guestPath: path, stillness } satisfies SandboxFile;
  }).pipe(
    Effect.provide(files),
    Effect.catchTag('PlatformError', (cause) => Effect.fail(refuse(`${path} could not be read: ${cause.message}`))),
  );
});

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
