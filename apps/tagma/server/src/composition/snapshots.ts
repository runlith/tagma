import { Effect } from 'effect';
import { resolve } from 'node:path';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { credentialParticipant } from '../providers/credentials/snapshot.js';
import { restoreParticipantInto, storeSnapshots } from '../platform/store/snapshot.js';
import type { ConsoleKeyRollback } from '../installation/contract/service/steps.js';
import type { Assembly } from './manifest.js';
import type { Manifest } from '../platform/contract/service/manifest.js';

export const snapshotAssembly = (
  participants: Assembly['snapshotParticipants'],
  machine: string,
  credentials: string,
  processes: ProcessPool,
  rowFacts?: Manifest['rowFacts'],
) =>
  Effect.map(participants({ machine, credentials }), (loaded) =>
    storeSnapshots(
      loaded,
      processes,
      rowFacts === undefined
        ? undefined
        : (path) => (path === resolve(machine) ? rowFacts() : Promise.resolve({ rows: [], selections: [] })),
    ),
  );

export const consoleKeyRollback = (credentials: string, processes: ProcessPool): ConsoleKeyRollback['Service'] => ({
  copyToSnapshot: (snapshot) => restoreParticipantInto('providers', credentialParticipant(credentials), snapshot, processes),
});
