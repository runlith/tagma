import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { ClaimHolders } from '../contract/service/host.js';
import { stateClaim } from './boot.js';
import { executionStates } from './connection.js';

type HostStates = { readonly idle: readonly string[]; readonly every: readonly string[] };

export const idleStates = Effect.fn('HostBoot.idleStates')(function* (storePath: string) {
  const files = yield* FileSystem.FileSystem;
  const holders = yield* ClaimHolders;
  const root = executionStates(storePath);
  if (!(yield* files.exists(root))) return { idle: [], every: [] } satisfies HostStates;
  const every = (yield* files.readDirectory(root)).map((name) => join(root, name));
  const idle: string[] = [];
  for (const state of every) if ((yield* stateClaim(holders, files, state))._tag === 'Free') idle.push(state);
  return { idle, every } satisfies HostStates;
});
