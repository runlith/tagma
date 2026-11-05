import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { ClaimHolders } from '../contract/service/host.js';
import { stateClaim } from './boot.js';
import { executionStates } from './connection.js';

export const idleStates = Effect.fn('HostBoot.idleStates')(function* (storePath: string) {
  const files = yield* FileSystem.FileSystem;
  const holders = yield* ClaimHolders;
  const root = executionStates(storePath);
  if (!(yield* files.exists(root))) return [];
  const idle: string[] = [];
  for (const name of yield* files.readDirectory(root)) {
    const state = join(root, name);
    if ((yield* stateClaim(holders, files, state))._tag === 'Free') idle.push(state);
  }
  return idle;
});
