import { Effect } from 'effect';
import type { ProductIdentity } from '@runlith/llm/profiles/contract';
import type { AdapterHost } from '@runlith/tagma/adapter/provider';
import type { InstanceSnapshot } from './contract/service/instances.js';
import { instanceFile, instanceSnapshot } from './credentials/instanceFile.js';
import { PROGRAM_RELEASE } from '../platform/contract/wire/program.js';

const PRODUCT: ProductIdentity = { mcpServer: 'tagma', client: { name: 'tagma', version: PROGRAM_RELEASE } };

export const adapterHost = (snapshot: InstanceSnapshot, adapter: string): AdapterHost => ({
  product: PRODUCT,
  instances: (snapshot.instances.get(adapter) ?? []).map((instance) => ({ ...instance, secrets: snapshot.secrets[instance.id] ?? {} })),
});

export type AdapterHosts = (adapter: string) => AdapterHost;

export const dataHosts = Effect.fn('providers.hosts')(function* (data: string) {
  const snapshot = instanceSnapshot(yield* instanceFile(data).read());
  return ((adapter) => adapterHost(snapshot, adapter)) satisfies AdapterHosts;
});
