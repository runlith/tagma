import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { ProductIdentity } from '@runlith/llm/profiles/contract';
import type { AdapterHost } from '@runlith/tagma/adapter/provider';
import type { InstanceSnapshot } from '../contract/service/instances.js';
import { instanceFile, instanceSnapshot } from '../credentials/instanceFile.js';
import { type HostModules, importAdapter } from '@runlith/tagma/adapter/loader';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { AdapterSource } from '../contract/service/registry.js';
import { type AdapterInstall, readInstalls, type RecordUnreadable } from './record.js';

const PRODUCT: ProductIdentity = { mcpServer: 'tagma', client: { name: 'tagma', version: PROGRAM_RELEASE } };

export const adapterHost = (snapshot: InstanceSnapshot, adapter: string): AdapterHost => ({
  product: PRODUCT,
  instances: (snapshot.instances.get(adapter) ?? []).map((instance) => ({ ...instance, secrets: snapshot.secrets[instance.id] ?? {} })),
});

export type AdapterHosts = (adapter: string) => AdapterHost;

export const machineHosts = Effect.fn('MachineAdapters.hosts')(function* (machine: string) {
  const snapshot = instanceSnapshot(yield* instanceFile(dirname(machine)).read());
  return ((adapter) => adapterHost(snapshot, adapter)) satisfies AdapterHosts;
});

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
