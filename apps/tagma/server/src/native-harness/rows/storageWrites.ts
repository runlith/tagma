import { writes } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { thread, threadEntry, threadRun, threadRunTally } from '../../threads/store/kernel.js';
import { threadLiveSpell, threadMandate } from '../../threads/store/mandate.js';
import { threadInbox, threadResource } from '../../threads/store/tables.js';
import { conversationWrites, threadBase, threadEvent, threadRolloutForm } from '../../threads/store/journal.js';
import { externalSession } from '../../threads/store/harnessFacet.js';
import { owedCall, spentCallKey, threadCall } from '../../threads/store/calls.js';
import { assignmentMembership, assignmentSelection } from '../../workspace/store/tables.js';
import { worktree } from '../../worktrees/store/tables.js';
import { commandDelivery } from '../../executions/store/terminal.js';
import {
  threadCacheObservation,
  threadCompactionCheckpoint,
  threadHistoryItem,
  threadLog,
  threadPrunedToolCall,
  threadRunReceipt,
} from '../store/thread.js';

export const kernelStorageWrites = writes(
  'ThreadStore.kernel',
  [
    threadRecord,
    thread,
    threadRun,
    threadRunTally,
    threadRunReceipt,
    threadEntry,
    threadHistoryItem,
    threadLog,
    threadCompactionCheckpoint,
    threadPrunedToolCall,
    threadCacheObservation,
    threadMandate,
    threadInbox,
    threadResource,
    threadEvent,
    threadBase,
    threadRolloutForm,
    threadCall,
    owedCall,
    spentCallKey,
    threadLiveSpell,
    externalSession,
    assignmentMembership,
    assignmentSelection,
    worktree,
    commandDelivery,
  ],
  conversationWrites,
);
