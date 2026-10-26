import { Data } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import { USER_MESSAGE_SIGNAL_TYPE } from '../agent/contracts';
import type { ThreadAttachment } from '../transcript/entries';
import type { ThreadRewindScope } from '../transcript/eventFold';
import { coreEntry } from '../transcript/kinds';
import type { ThreadQueuedTurn } from '../transcript/live';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import { THREAD_INBOX_REQUEST_INTENTS } from './storage/inbox';

const TURN_REQUESTS: ReadonlySet<string> = new Set(THREAD_INBOX_REQUEST_INTENTS);

export function opensTurnEntry(entry: ThreadTranscriptEntry | undefined): boolean {
  if (entry === undefined || !coreEntry(entry)) return false;
  if (entry.type === 'message') return entry.role === 'user';
  if (entry.type !== 'signal') return false;
  return entry.addressee === 'reader' ? entry.signalType === USER_MESSAGE_SIGNAL_TYPE : TURN_REQUESTS.has(entry.signalType);
}

export type ThreadRewindCut = { readonly from: number; readonly to: number };

export type ThreadRewound = {
  readonly id: string;
  readonly scope: ThreadRewindScope;
  readonly runIds: readonly string[];
  readonly cuts: readonly ThreadRewindCut[];
};

export type ThreadRewindInsert = { readonly at: number; readonly messages: readonly Message[] };

export type ThreadRestored = {
  readonly rewindId: string;
  readonly runIds: readonly string[];
  readonly inserts: readonly ThreadRewindInsert[];
};

export type ThreadRewindAsk = { readonly at: string; readonly scope: ThreadRewindScope };

export type ThreadRewindDraft = { readonly text: string; readonly attachments?: readonly ThreadAttachment[] };

export type ThreadRewindAnswer = {
  readonly rewindId: string;
  readonly scope: ThreadRewindScope;
  readonly runIds: readonly string[];
  readonly draft: ThreadRewindDraft | null;
  readonly taken: readonly ThreadQueuedTurn[];
  readonly stopped: string | null;
};

export type ThreadRestoreAnswer = { readonly rewindId: string; readonly runIds: readonly string[] };

export type ThreadRewindChild = { readonly threadId: string; readonly name: string | null; readonly running: boolean };

export type ThreadRewindPreview = {
  readonly at: string;
  readonly scope: ThreadRewindScope;
  readonly runIds: readonly string[];
  readonly turns: number;
  readonly draft: ThreadRewindDraft | null;
  readonly running: string | null;
  readonly taken: readonly ThreadQueuedTurn[];
  readonly children: readonly ThreadRewindChild[];
  readonly rewriteTokens: number;
};

export type ThreadRewindPoint =
  | { readonly runId: string; readonly rewindable: true }
  | { readonly runId: string; readonly rewindable: false; readonly reason: ThreadRewindBlocked };

export type ThreadRewindStanding = {
  readonly rewindId: string;
  readonly scope: ThreadRewindScope;
  readonly runIds: readonly string[];
  readonly restorable: boolean;
};

export type ThreadRewindPoints = {
  readonly points: readonly ThreadRewindPoint[];
  readonly rewinds: readonly ThreadRewindStanding[];
};

export type ThreadRewindBlocked = 'rewind-summarized' | 'rewind-rewound' | 'rewind-unknown';

export type ThreadRewindRefusal = ThreadRewindBlocked | 'restore-superseded' | 'restore-unknown';

const REFUSED: Record<ThreadRewindRefusal, (subject: string) => string> = {
  'rewind-summarized': (runId) =>
    `Run ${runId} is inside the prefix the last compaction summarized, so its messages are no longer in the model's history to take out.`,
  'rewind-rewound': (runId) => `Run ${runId} is already taken out of the model's history by a rewind that still stands.`,
  'rewind-unknown': (runId) => `Run ${runId} wrote no message this thread's history still holds as its own.`,
  'restore-superseded': (rewindId) => `Rewind ${rewindId} can no longer be restored: a turn ran or a compaction settled after it.`,
  'restore-unknown': (rewindId) => `No standing rewind ${rewindId} is on this thread.`,
};

export class ThreadRewindRefusedError extends Data.TaggedError('ThreadRewindRefused')<{
  readonly message: string;
  readonly code: ThreadRewindRefusal;
  readonly threadId: string;
  readonly subject: string;
}> {
  constructor(code: ThreadRewindRefusal, threadId: string, subject: string) {
    super({ message: `${code}: ${REFUSED[code](subject)}`, code, threadId, subject });
    this.name = 'ThreadRewindRefusedError';
  }
}
