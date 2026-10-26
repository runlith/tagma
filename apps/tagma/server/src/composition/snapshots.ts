import { Effect } from 'effect';
import { credentialParticipant } from '../providers/credentials/snapshot.js';
import { restoreParticipantInto, storeSnapshots } from '../platform/store/snapshot.js';
import type { ConsoleKeyRollback } from '../installation/contract/service/steps.js';
import { snapshotParticipants } from './manifest.js';

export const snapshotAssembly = (machine: string, credentials: string) =>
  Effect.map(snapshotParticipants({ machine, credentials }), storeSnapshots);

export const consoleKeyRollback = (credentials: string): ConsoleKeyRollback['Service'] => ({
  copyToSnapshot: (snapshot) => restoreParticipantInto('providers', credentialParticipant(credentials), snapshot),
});
