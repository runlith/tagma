import type { EnvironmentKind } from '../contract/wire/environments.js';
import { EnvironmentBackends, type EnvironmentBackend } from '../contract/service/environments.js';

export const makeBackendRegistry = (input: { readonly backends: readonly EnvironmentBackend[] }): EnvironmentBackends['Service'] => {
  const byKind: ReadonlyMap<EnvironmentKind, EnvironmentBackend> = new Map(input.backends.map((backend) => [backend.kind, backend]));
  return EnvironmentBackends.of({ bound: (kind) => byKind.get(kind) ?? null });
};
