import { existsSync } from 'node:fs';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { HarnessProvider, Provider } from '@runlith/tagma/adapter/provider';
import { importProviders } from '@runlith/tagma/adapter/loader';
import type { HarnessDeclarations } from '../../external-harnesses/hooks/rows.js';
import { harnessPackage, harnessPackages } from '../../providers/harnessIndex.js';
import { type AdapterHosts, dataHosts } from '../../providers/hosts.js';
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

const hostsOf = (data: string) => Effect.runPromise(dataHosts(data));

const installedHarness = async (data: string, harness: string, pinned: string | null): Promise<HarnessProvider | null> => {
  if (pinned !== null && existsSync(pinned)) {
    const held = (await declared(pinned, await hostsOf(data))).find(declares(harness));
    if (held !== undefined) return held;
  }
  const entry = await Effect.runPromise(harnessPackage(data, harness).pipe(Effect.provide(BunFileSystem.layer)));
  if (entry === null) return null;
  return (await declared(entry.directory, await hostsOf(data))).find(declares(harness)) ?? null;
};

const installedHarnesses = async (data: string): Promise<readonly HarnessProvider[]> => {
  const entries = await Effect.runPromise(harnessPackages(data).pipe(Effect.provide(BunFileSystem.layer)));
  if (entries.length === 0) return [];
  const hosts = await hostsOf(data);
  const providers: HarnessProvider[] = [];
  for (const entry of entries)
    providers.push(
      ...(await declared(entry.directory, hosts)).filter((provider): provider is HarnessProvider => provider.kind === 'harness'),
    );
  return providers;
};

export const harnessDeclarations: HarnessDeclarations = async (data, harness, pinned) => {
  if (harness === null) {
    const builtins = await Promise.all([...BUILTIN_HARNESS_PROVIDERS.values()].map(({ load }) => load()));
    return data === null ? builtins : [...builtins, ...(await installedHarnesses(data))];
  }
  const builtin = BUILTIN_HARNESS_PROVIDERS.get(harness);
  if (builtin !== undefined) return [await builtin.load()];
  const provider = data === null ? null : await installedHarness(data, harness, pinned);
  return provider === null ? [] : [provider];
};
