import { basename, join } from 'node:path';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { HarnessProvider, Provider } from '@runlith/tagma/adapter/provider';
import { importProviders } from '@runlith/tagma/adapter/loader';
import type { HarnessDeclarations } from '../../external-harnesses/hooks/rows.js';
import { type AdapterHosts, machineHosts } from '../../providers/adapters/external.js';
import { harnessPackage, harnessPackages } from '../../providers/adapters/harnessIndex.js';
import { BUILTIN_HARNESS_PROVIDERS } from '../adapters.js';
import { HOST_MODULES } from '../hostModules.generated.js';

const declares =
  (harness: string) =>
  (provider: Provider): provider is HarnessProvider =>
    provider.kind === 'harness' && provider.id === harness;

const declared = async (directory: string, hosts: AdapterHosts): Promise<readonly Provider[]> => {
  const { id, models } = await importProviders(directory, HOST_MODULES);
  return models === undefined ? [] : models(hosts(id));
};

const pinnedHarness = async (machine: string, harness: string, pinned: string): Promise<HarnessProvider | null> => {
  const directory = join(machine, basename(pinned));
  if (!(await Bun.file(join(directory, 'tagma-plugin.json')).exists())) return null;
  return (await declared(directory, await Effect.runPromise(machineHosts(machine)))).find(declares(harness)) ?? null;
};

const installedHarness = async (machine: string, harness: string, pinned: string | null): Promise<HarnessProvider | null> => {
  const held = pinned === null ? null : await pinnedHarness(machine, harness, pinned);
  if (held !== null) return held;
  const entry = await Effect.runPromise(harnessPackage(machine, harness).pipe(Effect.provide(BunFileSystem.layer)));
  if (entry === null) return null;
  return (await declared(entry.directory, await Effect.runPromise(machineHosts(machine)))).find(declares(harness)) ?? null;
};

const installedHarnesses = async (machine: string): Promise<readonly HarnessProvider[]> => {
  const entries = await Effect.runPromise(harnessPackages(machine).pipe(Effect.provide(BunFileSystem.layer)));
  if (entries.length === 0) return [];
  const hosts = await Effect.runPromise(machineHosts(machine));
  const providers: HarnessProvider[] = [];
  for (const entry of entries)
    providers.push(
      ...(await declared(entry.directory, hosts)).filter((provider): provider is HarnessProvider => provider.kind === 'harness'),
    );
  return providers;
};

export const harnessDeclarations: HarnessDeclarations = async (machine, harness, pinned) => {
  if (harness === null) {
    const builtins = await Promise.all([...BUILTIN_HARNESS_PROVIDERS.values()].map(({ load }) => load()));
    return machine === null ? builtins : [...builtins, ...(await installedHarnesses(machine))];
  }
  const builtin = BUILTIN_HARNESS_PROVIDERS.get(harness);
  if (builtin !== undefined) return [await builtin.load()];
  const provider = machine === null ? null : await installedHarness(machine, harness, pinned);
  return provider === null ? [] : [provider];
};
