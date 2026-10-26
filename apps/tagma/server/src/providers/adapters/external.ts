import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { type HostModules, importAdapter, readManifest } from '@runlith/tagma/adapter/loader';
import type { AdapterSource } from '../contract/service/registry.js';
import type { AdapterOrigin } from '../contract/wire/catalog.js';
import { type AdapterInstall, readInstalls, type RecordUnreadable } from './record.js';

const sourceOf = (
  id: string,
  origin: AdapterOrigin,
  version: string | null,
  directory: string,
  host: HostModules,
  argv: readonly string[],
): AdapterSource => ({ id, origin, version, load: () => importAdapter(directory, host, argv) });

const directoriesIn = async (at: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(at, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
};

export const releaseSources = (
  release: string | null,
  host: HostModules,
  argv: readonly string[],
): Effect.Effect<readonly AdapterSource[]> =>
  release === null
    ? Effect.succeed([])
    : Effect.promise(async () =>
        Promise.all(
          (await directoriesIn(release)).map(async (name) => {
            const directory = join(release, name);
            const version = await readManifest(directory).then(
              (manifest) => manifest.version ?? null,
              () => null,
            );
            return sourceOf(name, 'release', version, directory, host, argv);
          }),
        ),
      );

export const machineSources = (
  machine: string | null,
  host: HostModules,
  argv: readonly string[],
): Effect.Effect<readonly AdapterSource[], RecordUnreadable> =>
  machine === null
    ? Effect.succeed([])
    : Effect.map(readInstalls(machine), (installs: readonly AdapterInstall[]) =>
        installs.map((install) => ({
          ...sourceOf(install.id, 'machine', install.version, join(machine, install.directory), host, argv),
          source: install.source,
          disabled: install.enabled ? undefined : (true as const),
        })),
      );
