import { Context, Data, type Effect, type Stream } from 'effect';
import type { SerializedThread, SerializedThreadRun, ThreadPagePayload } from '@runlith/agent/protocol/http';
import type {
  ThreadChatCommandParams,
  threadCompactResultSchema,
  threadSaidResultSchema,
  threadStopResultSchema,
  threadTurnResultSchema,
  threadUnqueueResultSchema,
} from '@runlith/agent/protocol/realtime';
import type { ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import type { ThreadInteractionAnswer } from '@runlith/agent/transcript/entries';
import type { FeedPosition, RunStatus, ThreadFeedEvent, ThreadPendingInput } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ChatTold } from '../notice';

export type ChatThreadView = {
  readonly id: string;
  readonly capabilities?: { readonly history: 'journal' | 'session' | 'none'; readonly steer: 'step' | 'none' };
};

export type ThreadMode = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon?: string;
  readonly strictness?: number;
  readonly elevated?: boolean;
};

export type ThreadModes = {
  readonly declared: readonly ThreadMode[];
  readonly active: string;
};

export type ThreadContextReading = SerializedThread['contextReading'];

export type ChatState<TThread extends ChatThreadView> = {
  readonly thread: TThread;
  readonly modes?: ThreadModes;
  readonly contextReading?: ThreadContextReading;
  readonly contextLimit?: ThreadContextLimit | null;
  readonly activeRun: SerializedThreadRun | null;
  readonly latestRun: SerializedThreadRun | null;
  readonly pendingInput: ThreadPendingInput;
  readonly status: RunStatus;
  readonly now: string;
};

export type ChatFeedEvent<TThread extends ChatThreadView> = ThreadFeedEvent<ChatState<TThread>>;

export type ChatFeedInterruption = { readonly type: 'interrupted'; readonly message: string };

export type ChatFeedItem<TThread extends ChatThreadView> = ChatFeedEvent<TThread> | ChatFeedInterruption;

export type ChatSaid = typeof threadSaidResultSchema.Type;
export type ChatTurnStart = typeof threadTurnResultSchema.Type;
export type ChatCompaction = typeof threadCompactResultSchema.Type;
export type ChatUnqueued = typeof threadUnqueueResultSchema.Type;
export type ChatStopped = typeof threadStopResultSchema.Type;
export type ChatCompactAsk = ThreadChatCommandParams['compact'];

export type ChatWords = {
  readonly text: string;
  readonly attachments?: readonly ThreadAttachmentRef[];
  readonly key: string;
};

export type ChatAnswer = {
  readonly questionId: string;
  readonly answers: readonly ThreadInteractionAnswer[];
  readonly key: string;
};

export class ChatFeedRefused extends Data.TaggedError('ChatFeedRefused')<{ readonly message: string }> {}

export class ChatFeedBroken extends Data.TaggedError('ChatFeedBroken')<{ readonly message: string }> {}

export type ChatFeedFailure = ChatFeedRefused | ChatFeedBroken;

export class ChatCommandRefused extends Data.TaggedError('ChatCommandRefused')<{
  readonly message: string;
  readonly code?: string | undefined;
  readonly told?: ChatTold | undefined;
}> {}

export const refusedTold = (failure: ChatCommandFailure): ChatTold | undefined =>
  failure._tag === 'ChatCommandRefused' ? failure.told : undefined;

export class ChatCommandLost extends Data.TaggedError('ChatCommandLost')<{ readonly message: string }> {}

export class ChatReadRefused extends Data.TaggedError('ChatReadRefused')<{ readonly message: string }> {}

export type ChatCommandFailure = ChatCommandRefused | ChatCommandLost;

export interface ChatConnection<TThread extends ChatThreadView> {
  feed(threadId: string, from: Effect.Effect<FeedPosition | null>): Stream.Stream<ChatFeedItem<TThread>, ChatFeedFailure>;
  send(threadId: string, words: ChatWords): Effect.Effect<ChatSaid, ChatCommandFailure>;
  queue(threadId: string, words: ChatWords): Effect.Effect<ChatSaid, ChatCommandFailure>;
  answer(threadId: string, answer: ChatAnswer): Effect.Effect<ChatTurnStart, ChatCommandFailure>;
  compact(threadId: string, ask: ChatCompactAsk): Effect.Effect<ChatCompaction, ChatCommandFailure>;
  continue(threadId: string): Effect.Effect<ChatTurnStart, ChatCommandFailure>;
  unqueue(threadId: string, inputId: string): Effect.Effect<ChatUnqueued, ChatCommandFailure>;
  stop(threadId: string, withdraw: boolean): Effect.Effect<ChatStopped, ChatCommandFailure>;
  entriesBefore(threadId: string, before: number): Effect.Effect<ThreadPagePayload, ChatReadRefused>;
  entry(threadId: string, entryId: string): Effect.Effect<ThreadTranscriptEntry | null, ChatReadRefused>;
}

export const ChatConnection = <TThread extends ChatThreadView>(): Context.Service<ChatConnection<TThread>, ChatConnection<TThread>> =>
  Context.Service<ChatConnection<TThread>>('@runlith/chat-ui/ChatConnection');
