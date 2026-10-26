import { basename, dirname, join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { displayPath } from './display';
import { ToolFailed } from '@runlith/agent/tool';
import { fileFailure } from '@runlith/files/replace';

export type EntryIdentity =
  | { readonly kind: 'exact' }
  | { readonly kind: 'alias'; readonly stored: string }
  | { readonly kind: 'taken' }
  | { readonly kind: 'free' };

const EXACT: EntryIdentity = { kind: 'exact' };
const FREE: EntryIdentity = { kind: 'free' };
const TAKEN: EntryIdentity = { kind: 'taken' };

function absent(error: PlatformError): boolean {
  return error.reason._tag === 'NotFound';
}

export const orAbsent = <A>(read: Effect.Effect<A, PlatformError>): Effect.Effect<A | undefined, PlatformError> =>
  read.pipe(Effect.catchIf(absent, () => Effect.succeed(undefined)));

export const entryIdentity = Effect.fn('entryIdentity')(function* (path: string) {
  return yield* readIdentity(path).pipe(
    Effect.catchTag('PlatformError', (error) =>
      Effect.fail(
        new ToolFailed({
          reason: `Cannot tell what ${path} names while reading its directory: ${fileFailure(error)}. This path was not changed.`,
        }),
      ),
    ),
  );
});

const readIdentity = Effect.fn('entryIdentity.read')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* orAbsent(fs.realPath(dirname(path)));
  if (parent === undefined) return FREE;
  const name = basename(path);
  const entries = yield* orAbsent(fs.readDirectory(parent));
  if (entries === undefined) return FREE;
  if (entries.includes(name)) return EXACT;
  const asked = yield* entryMark(fs, join(parent, name));
  if (asked === undefined) return FREE;
  const stored: string[] = [];
  for (const entry of entries) {
    const held = yield* entryMark(fs, join(parent, entry));
    if (held === asked) stored.push(entry);
  }
  if (stored.length === 1) return { kind: 'alias', stored: stored[0] as string } as const;
  return TAKEN;
});

export const isLink = Effect.fn('entryIdentity.link')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* orAbsent(notALink(fs.readLink(path))).pipe(
    Effect.map((target) => target !== undefined),
    Effect.catchTag('PlatformError', (error) =>
      Effect.fail(
        new ToolFailed({
          reason: `Cannot tell what ${path} is while reading its entry: ${fileFailure(error)}. This path was not changed.`,
        }),
      ),
    ),
  );
});

function notALink(read: Effect.Effect<string, PlatformError>): Effect.Effect<string | undefined, PlatformError> {
  return read.pipe(Effect.catchIf(sameEntryKind, () => Effect.succeed(undefined)));
}

function sameEntryKind(error: PlatformError): boolean {
  return (error.reason.cause as { code?: string } | undefined)?.code === 'EINVAL';
}

const entryMark = Effect.fn('entryIdentity.mark')(function* (fs: FileSystem.FileSystem, path: string) {
  const target = yield* orAbsent(notALink(fs.readLink(path)));
  if (target !== undefined) return `link@${target}`;
  const info = yield* orAbsent(fs.stat(path));
  if (info === undefined) return undefined;
  const ino = Option.getOrNull(info.ino);
  if (ino === null) return `entry@${yield* fs.realPath(path)}`;
  return `entry@${info.dev}:${ino}`;
});

export function aliasRefusal(root: string, asked: string, stored: string | undefined): string {
  const named = displayPath(root, asked);
  return stored === undefined
    ? `No entry is spelled ${named}, and this filesystem resolves that name to an entry of its directory this reading cannot single out — symlinks sharing a target, or an entry that changed while it was read. Read the directory and use the spelling that is there.`
    : `No entry is spelled ${named}: this filesystem resolves that name to ${displayPath(root, storedPath(asked, stored))}, a different spelling of the same file. Use the spelling that is there, or move it with the rename tool.`;
}

export function storedPath(asked: string, stored: string): string {
  return join(dirname(asked), stored);
}

export function storedOf(identity: EntryIdentity): string | undefined {
  return identity.kind === 'alias' ? identity.stored : undefined;
}
