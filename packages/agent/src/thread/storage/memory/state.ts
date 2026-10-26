import type { Message } from '@runlith/llm/schema/messages';
import type { AgentApprovalMode } from '../../../agent/contracts';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadCompactionCheckpointRow, ThreadMetadataRow, ThreadRunRow } from '../../rows';
import type { RecordWrite } from '../../transition/port';
import type { ThreadCacheObservationValues } from '../cacheObservations';
import type { ThreadEventRow } from '../eventLog';
import type { ThreadResourceRow } from '../resources';
import { MemoryUnits, type MemoryTx } from './units';
import type { ThreadEntryReader } from '../../../transcript/kinds';

export type HeldThread = {
  row: ThreadMetadataRow;
  systemPrompt: string | null;
  pendingSystemPrompt: string | null;
  history: Message[];
  historyThrough: number;
  transcript: ThreadTranscriptEntry[];
  entriesThrough: number;
  events: ThreadEventRow[];
  observations: ThreadCacheObservationValues[];
  foldRev: number;
  inheritRev: number;
  runningRunId: string | null;
  ended: string[];
  scope: string | null;
};

export type HeldReceipt = { readonly digest: string; readonly result: unknown };

export type HeldRun = ThreadRunRow & {
  startKey: string | null;
  startDigest: string | null;
  endDigest: string | null;
  endResult: unknown;
  appliedSeq: number;
  receipt: HeldReceipt | null;
};

export type HeldRecord = RecordWrite & { readonly threadId: string; readonly spentAs: string };

export type HeldSpent = { readonly digest: string; readonly at: Date };

export type Removal = (threadIds: ReadonlySet<string>, tx: MemoryTx) => void;

export type MemoryStorageInput = { readonly memory: ThreadMemory };

export type MemoryRunsInput = MemoryStorageInput & {
  readonly ownerId: string;
  readonly scope: string | null;
};

export class ThreadMemory {
  constructor(readonly kinds: ThreadEntryReader) {}

  readonly units = new MemoryUnits();
  readonly threads = new Map<string, HeldThread>();
  readonly runs = new Map<string, HeldRun>();
  readonly eventIds = new Map<string, string>();
  readonly records = new Map<string, HeldRecord>();
  readonly spent = new Map<string, HeldSpent>();
  readonly checkpoints = new Map<string, ThreadCompactionCheckpointRow>();
  readonly pruned = new Map<string, Map<string, number>>();
  readonly resources = new Map<string, ThreadResourceRow>();
  readonly approvals = new Map<string, AgentApprovalMode>();
  epoch: Date | null = null;
  private readonly removals: Removal[] = [];

  read<T>(tx: MemoryTx | undefined, work: () => T): T {
    return this.units.read(tx, work);
  }

  held(threadId: string): HeldThread | undefined {
    return this.threads.get(threadId);
  }

  onRemoval(removal: Removal): void {
    this.removals.push(removal);
  }

  remove(threadIds: ReadonlySet<string>, tx: MemoryTx): void {
    for (const [id, checkpoint] of this.checkpoints) if (threadIds.has(checkpoint.threadId)) tx.remove(this.checkpoints, id);
    for (const threadId of threadIds) tx.remove(this.pruned, threadId);
    for (const [key, row] of this.resources) {
      if (row.threadId !== null && threadIds.has(row.threadId)) tx.put(this.resources, key, { ...row, threadId: null });
    }
    for (const [key, record] of this.records) if (threadIds.has(record.threadId)) tx.remove(this.records, key);
    for (const removal of this.removals) removal(threadIds, tx);
  }
}
