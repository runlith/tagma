import type { ThreadHeld } from '../../change-record/contract/wire/holdings.js';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import type { ThreadMetadataRow, ThreadRunProgress, ThreadRunRow } from '@runlith/agent/thread/rows';
import { awaitsAnswer, runHalt, runSignals } from '@runlith/agent/thread/state';
import type { RunHalt, RunLife } from '@runlith/agent/transcript/live';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { LEASE_RHYTHM } from '../contract/wire/rhythm.js';
import {
  parseThreadBornOf,
  parseThreadContextReading,
  parseThreadRunFailure,
  parseThreadRunProgress,
} from '@runlith/agent/thread/persisted';
import { thread } from '../store/kernel.js';
import { DEFAULT_TITLE, type TitleProvenance } from '../../thread-record/contract/wire/title.js';
import { parseExternalSession, type ExternalSession } from '../contract/wire/harness/externalSession.js';
import { cutText, nativeAsk, standaloneAsk } from './pendingAsk.js';
import { SAID_LINE_CHARS, type ThreadPhase, type ThreadAsk } from '../contract/wire/list.js';
import type { RecapLine } from '../contract/wire/recap.js';
import type { RecapStatus, ThreadRecap } from '../../thread-record/contract/wire/recap.js';

export type ThreadActiveRun = {
  readonly id: string;
  readonly heartbeatAt: Date;
  readonly startedAt: Date;
  readonly awaitingQuestion: boolean;
  readonly phase: AgentPhase | null;
  readonly halt: RunHalt | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
};

export type RunEnding = {
  readonly runId: string;
  readonly status: Exclude<ThreadRunRow['status'], 'running'>;
  readonly failureReason: string | null;
  readonly failure: ThreadRunRow['failure'];
  readonly hostStateFailure: boolean;
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly finishedAt: Date;
  readonly isSeen: boolean;
};

export type ThreadSummary = ThreadMetadataRow & {
  readonly life: RunLife;
  readonly owes: boolean;
  readonly title: string;
  readonly titleOrigin: TitleProvenance;
  readonly projectId: number;
  readonly scopeBlockUuid: string | null;
  readonly readerOrderAt: Date;
  readonly liveSpellStartedAt: Date | null;
  readonly pinnedAt: Date | null;
  readonly folderId: string | null;
  readonly archivedAt: Date | null;
  readonly detachedFrom: string | null;
  readonly createdBySessionId: number | null;
  readonly harness: ExternalSession | null;
  readonly activeRun: ThreadActiveRun | null;
  readonly outcome: RunEnding | null;
  readonly ask: ThreadAsk | null;
  readonly saidLine: string | null;
  readonly recap: RecapLine | null;
};

export type ThreadListProjection = ThreadSummary & {
  readonly phase: ThreadPhase | null;
  readonly held: ThreadHeld;
  readonly launchBlocked?: true;
};

export type ThreadListMove = {
  readonly threadId: string;
  readonly movedAt: Date;
  readonly rootId: string | null;
  readonly cleared: boolean;
  readonly live: boolean;
  readonly state: 'working' | 'waiting' | 'finished' | 'idle';
};

export function saidLineOf(said: string | null): string | null {
  if (said === null) return null;
  const line = cutText(said.replace(/\r$/, ''), SAID_LINE_CHARS).trimEnd();
  return line === '' ? null : line;
}

export function askOf(kinds: ThreadEntryReader, pending: unknown, running: ThreadActiveRun | null): ThreadAsk | null {
  const standing = standaloneAsk(kinds, pending);
  if (standing !== null) return standing;
  if (running === null || !running.awaitingQuestion) return null;
  return nativeAsk(kinds, pending, running.id);
}

export type SummaryRow = {
  thread: Omit<ThreadMetadataRow, 'cacheGroup' | 'provider' | 'switches'> & {
    cacheGroup: string | null;
    provider: string | null;
    switches: ThreadMetadataRow['switches'] | null;
  };
  title: string | null;
  titleOrigin: TitleProvenance | null;
  createdBySessionId: number | null;
  harness: ExternalSession | null;
  projectId: number;
  scopeBlockUuid: string | null;
  readerOrderAt: Date | null;
  liveSpellStartedAt: Date | null;
  pinnedAt: Date | null;
  folderId: string | null;
  archivedAt: Date | null;
  detachedFrom: string | null;
  runId: string | null;
  runStatus: ThreadRunRow['status'] | null;
  heartbeatAt: Date | null;
  handedOverAt: Date | null;
  runResumes: number | null;
  runStartedAt: Date | null;
  progress: ThreadRunProgress | null;
  runProvider: string | null;
  runModel: string | null;
  runReasoning: string | null;
  outcomeRunId: string | null;
  outcomeStatus: ThreadRunRow['status'] | null;
  outcomeFailureReason: string | null;
  outcomeFailure: ThreadRunRow['failure'];
  outcomeProvider: string | null;
  outcomeModel: string | null;
  outcomeReasoning: string | null;
  outcomeFinishedAt: Date | null;
  seenRunId: string | null;
  said: string | null;
  recap: ThreadRecap | null;
  recapStatus: RecapStatus | null;
};

export function moveOf(row: {
  threadId: string;
  updatedAt: Date;
  runId: string | null;
  progress: ThreadRunProgress | null;
  outcomeRunId: string | null;
  seenRunId: string | null;
  rootId: string | null;
  provenance: string | null;
}): ThreadListMove {
  const placed = {
    threadId: row.threadId,
    movedAt: row.updatedAt,
    rootId: row.rootId,
    cleared: row.provenance === 'cleared',
  };
  if (row.runId !== null) {
    return { ...placed, live: true, state: awaitsAnswer(row.progress?.stage ?? null) ? 'waiting' : 'working' };
  }
  const unseen = row.outcomeRunId !== null && row.outcomeRunId !== row.seenRunId;
  return { ...placed, live: false, state: unseen ? 'finished' : 'idle' };
}

export function summaryOf(kinds: ThreadEntryReader, row: SummaryRow, recapShown: boolean, now: Date): ThreadSummary {
  const thread = {
    ...row.thread,
    cacheGroup: row.thread.cacheGroup ?? row.thread.id,
    provider: row.thread.provider ?? 'external',
    switches: row.thread.switches ?? {},
  };
  const progress = row.progress === null ? null : parseThreadRunProgress(row.progress);
  const harness = parseExternalSession(row.harness);
  const activeRun: ThreadActiveRun | null =
    row.runId === null || row.heartbeatAt === null || row.runStartedAt === null
      ? null
      : {
          id: row.runId,
          heartbeatAt: row.heartbeatAt,
          startedAt: row.runStartedAt,
          awaitingQuestion: awaitsAnswer(progress?.stage ?? null),
          phase: progress?.phase ?? null,
          halt: progress === null ? null : (runHalt({ resumes: row.runResumes ?? 0, progress }) ?? null),
          provider: row.runProvider,
          model: row.runModel,
          reasoning: row.runReasoning,
        };
  const signals =
    activeRun === null || row.heartbeatAt === null || row.runStatus === null
      ? null
      : runSignals(
          {
            status: row.runStatus,
            progress: { stage: progress?.stage ?? null },
            heartbeatAt: row.heartbeatAt,
            handedOverAt: row.handedOverAt,
          },
          thread,
          now,
          LEASE_RHYTHM,
        );
  return {
    ...thread,
    life: signals?.life ?? 'idle',
    owes: false,
    bornOf: parseThreadBornOf(thread.bornOf),
    contextReading: parseThreadContextReading(kinds, thread.contextReading),
    title: row.title ?? DEFAULT_TITLE,
    titleOrigin: row.titleOrigin ?? 'random',
    projectId: row.projectId,
    scopeBlockUuid: row.scopeBlockUuid,
    readerOrderAt: row.readerOrderAt ?? thread.createdAt,
    liveSpellStartedAt: row.liveSpellStartedAt,
    pinnedAt: row.pinnedAt,
    folderId: row.folderId,
    archivedAt: row.archivedAt,
    detachedFrom: row.detachedFrom,
    createdBySessionId: row.createdBySessionId,
    harness,
    activeRun,
    outcome:
      activeRun !== null || row.outcomeRunId === null || row.outcomeStatus === null || row.outcomeFinishedAt === null
        ? null
        : {
            runId: row.outcomeRunId,
            status: row.outcomeStatus as RunEnding['status'],
            failureReason: row.outcomeFailureReason,
            failure: parseThreadRunFailure(row.outcomeFailure),
            hostStateFailure: false,
            provider: row.outcomeProvider,
            model: row.outcomeModel,
            reasoning: row.outcomeReasoning,
            finishedAt: row.outcomeFinishedAt,
            isSeen: row.outcomeRunId === row.seenRunId,
          },
    ask: askOf(kinds, thread.pendingInteraction, activeRun),
    saidLine: saidLineOf(row.said),
    recap:
      !recapShown || row.recap === null || row.recapStatus === null
        ? null
        : { summary: row.recap.summary, next: row.recap.next, generatedAt: row.recap.basis.generatedAt, status: row.recapStatus },
  };
}
