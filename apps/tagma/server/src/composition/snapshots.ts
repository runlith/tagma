import { Effect } from 'effect';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { credentialParticipant } from '../providers/credentials/snapshot.js';
import { restoreParticipantInto, storeSnapshots } from '../platform/store/snapshot.js';
import type { ConsoleKeyRollback } from '../installation/contract/service/steps.js';
import { snapshotParticipants } from './manifest.js';

export const snapshotAssembly = (machine: string, credentials: string, processes: ProcessPool) =>
  Effect.map(snapshotParticipants({ machine, credentials }), (participants) => storeSnapshots(participants, processes));

export const consoleKeyRollback = (credentials: string, processes: ProcessPool): ConsoleKeyRollback['Service'] => ({
  copyToSnapshot: (snapshot) => restoreParticipantInto('providers', credentialParticipant(credentials), snapshot, processes),
});
