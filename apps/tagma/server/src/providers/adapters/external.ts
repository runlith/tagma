import { join } from 'node:path';
import { Effect } from 'effect';
import { type HostModules, importAdapter } from '@runlith/tagma/adapter/loader';
import type { AdapterSource } from '../contract/service/registry.js';
import { type AdapterInstall, readInstalls, type RecordUnreadable } from './record.js';

export const machineSources = (
  machine: string | null,
  host: HostModules,
  argv: readonly string[],
): Effect.Effect<readonly AdapterSource[], RecordUnreadable> =>
  machine === null
    ? Effect.succeed([])
    : Effect.map(readInstalls(machine), (installs: readonly AdapterInstall[]) =>
        installs.map((install) => ({
          id: install.id,
          origin: 'machine' as const,
          version: install.version,
          load: () => importAdapter(join(machine, install.directory), host, argv),
          source: install.source,
          disabled: install.enabled ? undefined : (true as const),
        })),
      );
