import { jsonCodec } from '@runlith/utils/codec';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Data, Effect, Schema } from 'effect';
import { MANIFEST_FILE, TagmaAppEnvelope } from './contract/wire/manifest.js';
import type { TagmaAppFloor } from './contract/wire/rows.js';

export const PROJECT_APPS = '.tagma-apps';
export const PERSONAL_APPS = 'apps';
export const APP_DATA = 'app-data';

export type Found = { readonly id: string; readonly root: string; readonly floor: TagmaAppFloor };

export class FloorUnreadable extends Data.TaggedError('FloorUnreadable')<{ readonly at: string; readonly reason: string }> {}

export class ManifestRefused extends Data.TaggedError('ManifestRefused')<{ readonly root: string; readonly reason: string }> {}

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { readonly code: unknown }).code) : undefined;

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const linkBroken = (error: unknown): boolean => {
  if (codeOf(error) === 'ENOENT') return false;
  throw error;
};

const floorsOf = (projectRoot: string, home: string | null): readonly { readonly floor: TagmaAppFloor; readonly at: string }[] => [
  { floor: 'project', at: join(projectRoot, PROJECT_APPS) },
  ...(home === null ? [] : [{ floor: 'user' as const, at: join(home, PERSONAL_APPS) }]),
];

const floorEntries = (floor: TagmaAppFloor, at: string): Effect.Effect<readonly Found[], FloorUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const entries = await readdir(at, { withFileTypes: true });
        const found: Found[] = [];
        for (const entry of entries) {
          const root = join(at, entry.name);
          const directory =
            entry.isDirectory() || (entry.isSymbolicLink() && (await stat(root).then((read) => read.isDirectory(), linkBroken)));
          if (directory) found.push({ id: entry.name, root, floor });
        }
        return found;
      } catch (error) {
        if (codeOf(error) === 'ENOENT') return [];
        throw error;
      }
    },
    catch: (error) => new FloorUnreadable({ at, reason: reasonOf(error) }),
  }).pipe(Effect.withSpan('tagmaApps.floorEntries'));

export const discover = (projectRoot: string, home: string | null): Effect.Effect<readonly Found[], FloorUnreadable> =>
  Effect.map(
    Effect.forEach(floorsOf(projectRoot, home), ({ floor, at }) => floorEntries(floor, at)),
    (floors) => floors.flat(),
  );

const decodeEnvelope = Schema.decodeUnknownEffect(jsonCodec(TagmaAppEnvelope));

export const manifestOf = Effect.fn('tagmaApps.manifestOf')(function* (root: string): Effect.fn.Return<TagmaAppEnvelope, ManifestRefused> {
  const path = join(root, MANIFEST_FILE);
  const text = yield* Effect.tryPromise({
    try: () => readFile(path, 'utf8'),
    catch: (error) =>
      new ManifestRefused({
        root,
        reason: codeOf(error) === 'ENOENT' ? `${path} does not exist` : `${path} is unreadable: ${reasonOf(error)}`,
      }),
  });
  const raw = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (error) => new ManifestRefused({ root, reason: `${path} is not JSON: ${reasonOf(error)}` }),
  });
  const decoded = yield* decodeEnvelope(raw, { onExcessProperty: 'error' }).pipe(
    Effect.mapError((failure) => new ManifestRefused({ root, reason: `${path}: ${failure.message}` })),
  );
  const named = basename(root);
  if (decoded.id !== named) {
    return yield* new ManifestRefused({ root, reason: `${path} names the app ${decoded.id}, but its directory is ${named}` });
  }
  return decoded;
});
