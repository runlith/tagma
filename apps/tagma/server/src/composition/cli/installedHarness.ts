import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { HarnessProvider, Provider } from '@runlith/tagma/adapter/provider';
import { importAdapter } from '@runlith/tagma/adapter/loader';
import type { HarnessDeclarations } from '../../external-harnesses/hooks/rows.js';
import { machineHosts } from '../../providers/adapters/external.js';
import { harnessPackage, harnessPackages } from '../../providers/adapters/harnessIndex.js';
import { BUILTIN_HARNESS_PROVIDERS } from '../adapters.js';
import { HOST_MODULES } from '../hostModules.generated.js';

const declares =
  (harness: string) =>
  (provider: Provider): provider is HarnessProvider =>
    provider.kind === 'harness' && provider.id === harness;

const installedHarness = async (machine: string, harness: string): Promise<HarnessProvider | null> => {
  const entry = await Effect.runPromise(harnessPackage(machine, harness).pipe(Effect.provide(BunFileSystem.layer)));
  if (entry === null) return null;
  const hosts = await Effect.runPromise(machineHosts(machine));
  const { adapter } = await importAdapter(entry.directory, HOST_MODULES);
  return adapter(hosts(entry.id)).find(declares(harness)) ?? null;
};

const installedHarnesses = async (machine: string): Promise<readonly HarnessProvider[]> => {
  const entries = await Effect.runPromise(harnessPackages(machine).pipe(Effect.provide(BunFileSystem.layer)));
  if (entries.length === 0) return [];
  const hosts = await Effect.runPromise(machineHosts(machine));
  const providers: HarnessProvider[] = [];
  for (const entry of entries) {
    const { adapter } = await importAdapter(entry.directory, HOST_MODULES);
    providers.push(...adapter(hosts(entry.id)).filter((provider): provider is HarnessProvider => provider.kind === 'harness'));
  }
  return providers;
};

export const harnessDeclarations: HarnessDeclarations = async (machine, harness) => {
  if (harness === null) {
    const builtins = await Promise.all([...BUILTIN_HARNESS_PROVIDERS.values()].map((load) => load()));
    return machine === null ? builtins : [...builtins, ...(await installedHarnesses(machine))];
  }
  const builtin = BUILTIN_HARNESS_PROVIDERS.get(harness);
  if (builtin !== undefined) return [await builtin()];
  const provider = machine === null ? null : await installedHarness(machine, harness);
  return provider === null ? [] : [provider];
};
