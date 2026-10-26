import type { Effect, Scope } from 'effect';
import type { Tester } from '@runlith/effect-test';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ThreadAggregateStorage } from '../storage/aggregate';
import type { ThreadRow } from '../rows';
import type { TransportBinding } from '../record';
import type { ThreadCompactionStorage } from '../storage/compaction';
import type { ThreadEventLogStorage } from '../storage/eventLog';
import type { ThreadInboxStorage } from '../storage/inbox';
import type { ThreadTransitionStorage } from '../transition/port';
import type { ThreadOwnerSettingsStorage } from '../storage/ownerSettings';
import type { ThreadRunStorage } from '../storage/runs';
import type { ThreadEntryReader } from '../../transcript/kinds';
import { describeThreadCompactionPort } from './storagePort/compaction';
import { describeThreadEventLogPort } from './storagePort/eventLog';
import { describeThreadOwnerSettingsPort } from './storagePort/ownerSettings';
import { describeThreadEndingsPort } from './storagePort/endings';
import { describeThreadLifecyclePort } from './storagePort/lifecycle';
import { describeThreadRunPort } from './storagePort/runs';
import { describeThreadSpawnPort } from './storagePort/spawn';
import { describeThreadTranscriptPort } from './storagePort/transcript';
import { describeRunLifecycleActs } from './runLifecycle';
import { describeTransportContract } from './transport';
import { describeReportCredit } from './reportCredit';
import { describeLateSpend } from './lateSpend';
import { describeUnreadWords } from './unreadWords';
import { describeVendorQuestions } from './vendorQuestions';

export type ThreadStorageHarness<TTx, TWrite extends TTx = TTx> = {
  readonly aggregate: ThreadAggregateStorage<TTx, TWrite>;
  readonly compaction: ThreadCompactionStorage<TWrite>;
  readonly eventLog: ThreadEventLogStorage<TTx, TWrite>;
  readonly transitions: ThreadTransitionStorage<TTx, TWrite>;
  readonly inbox: ThreadInboxStorage<TTx, TWrite>;
  readonly ownerSettings: ThreadOwnerSettingsStorage;
  readonly kinds: ThreadEntryReader;
  runs(input: { ownerId: string; scope: string }): ThreadRunStorage<TTx, TWrite>;
  createThread(input: { ownerId: string; scope: string; transport?: TransportBinding }): Effect.Effect<ThreadRow, ThreadPortFailure>;
  reopen(): Effect.Effect<ThreadStorageHarness<TTx, TWrite>, unknown, Scope.Scope>;
  dispose(): Effect.Effect<void>;
};

export type ThreadStorageFactory<TTx, TWrite extends TTx = TTx, R = never> = () => Effect.Effect<
  ThreadStorageHarness<TTx, TWrite>,
  unknown,
  Scope.Scope | R
>;

export function describeThreadStoragePort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeThreadStorageRows(name, open, test);
  describeThreadStorageRuns(name, open, test);
}

export function describeThreadStorageRows<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeThreadRunPort(name, open, test);
  describeThreadEndingsPort(name, open, test);
  describeThreadLifecyclePort(name, open, test);
  describeThreadTranscriptPort(name, open, test);
  describeThreadCompactionPort(name, open, test);
  describeThreadSpawnPort(name, open, test);
  describeThreadEventLogPort(name, open, test);
  describeThreadOwnerSettingsPort(name, open, test);
}

export function describeThreadStorageRuns<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeRunLifecycleActs(name, open, test);
  describeTransportContract(name, open, test);
  describeReportCredit(name, open, test);
  describeLateSpend(name, open, test);
  describeVendorQuestions(name, open, test);
  describeUnreadWords(name, open, test);
}
