import { writes } from '../../platform/contract/service/writes.js';
import { recordRows } from '../../thread-record/store/table.js';
import { nativeRows, runRows, threadEntry, threadRunTally } from '../../threads/store/kernel.js';
import { mandateRows, spellRows } from '../../threads/store/mandate.js';
import { inboxRows, seenRows, threadResource } from '../../threads/store/tables.js';
import { conversationWrites, threadBase, threadEvent, threadRolloutForm } from '../../threads/store/journal.js';
import { sessionFacts } from '../../threads/store/harnessFacet.js';
import { owedRows, spentCallKey, threadCall } from '../../threads/store/calls.js';
import { assignmentMembership, placementRows } from '../../workspace/store/tables.js';
import { worktree } from '../../worktrees/store/tables.js';
import { deliveryRows } from '../../executions/contract/service/commands.js';
import {
  threadCacheObservation,
  threadCompactionCheckpoint,
  threadHistoryItem,
  threadLog,
  threadPrunedToolCall,
  threadRev,
  threadRunReceipt,
} from '../store/thread.js';

export const kernelStorageWrites = writes(
  'ThreadStore.kernel',
  [
    recordRows,
    nativeRows,
    runRows,
    threadRunTally,
    threadRunReceipt,
    threadRev,
    threadEntry,
    threadHistoryItem,
    threadLog,
    threadCompactionCheckpoint,
    threadPrunedToolCall,
    threadCacheObservation,
    mandateRows,
    inboxRows,
    seenRows,
    threadResource,
    threadEvent,
    threadBase,
    threadRolloutForm,
    threadCall,
    owedRows,
    spentCallKey,
    spellRows,
    sessionFacts,
    assignmentMembership,
    placementRows,
    worktree,
    deliveryRows,
  ],
  conversationWrites,
);
