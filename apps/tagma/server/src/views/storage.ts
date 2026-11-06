import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type ViewMount, ViewStorage } from './contract/service/views.js';
import type { StorageRefusalCode } from './contract/wire/sets.js';
import type { ViewShelf } from './shelf.js';

const VALUE_BYTES = 1024 * 1024;
const STORE = 'view-storage';
const failed = (reason: string) =>
  new GateRefusal<StorageRefusalCode>('view-storage-failed', reason, ['make the plugin’s data directory writable, then try again']);
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const absent = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export const makeValues = (input: { readonly shelf: ViewShelf }) => {
  const { shelf } = input;
  let written = 0;
  const placeOf = Effect.fnUntraced(function* (mount: ViewMount, key: string) {
    const plugin = yield* shelf.mounted(mount);
    const directory = join(plugin.data, STORE);
    return { directory, file: join(directory, `${createHash('sha256').update(key).digest('hex')}.json`) };
  });
  return ViewStorage.of({
    get: Effect.fn('ViewStorage.get')(function* (mount, key) {
      const { file } = yield* placeOf(mount, key);
      return yield* Effect.tryPromise({
        try: () =>
          readFile(file, 'utf8').then(
            (text) => ({ stored: true, value: JSON.parse(text) as unknown }),
            (error: unknown) => {
              if (absent(error)) return { stored: false };
              throw error;
            },
          ),
        catch: (error) => failed(`the value ${key} could not be read: ${reasonOf(error)}`),
      });
    }),
    set: Effect.fn('ViewStorage.set')(function* (mount, key, value) {
      const { directory, file } = yield* placeOf(mount, key);
      if (value === undefined)
        return yield* Effect.tryPromise({
          try: () => rm(file, { force: true }).then(() => false),
          catch: (error) => failed(`the value ${key} could not be removed: ${reasonOf(error)}`),
        });
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > VALUE_BYTES)
        return yield* new GateRefusal<StorageRefusalCode>(
          'view-storage-too-large',
          `The value ${key} passes the 1 MiB a view keeps under one key.`,
          ['split it over several keys', 'or keep it in the plugin’s process'],
        );
      written += 1;
      const staged = `${file}.${process.pid}.${written}`;
      return yield* Effect.tryPromise({
        try: async () => {
          await mkdir(directory, { recursive: true });
          await writeFile(staged, text, 'utf8');
          await rename(staged, file);
          return true;
        },
        catch: (error) => failed(`the value ${key} could not be kept: ${reasonOf(error)}`),
      }).pipe(Effect.onError(() => Effect.promise(() => rm(staged, { force: true }))));
    }),
  });
};
