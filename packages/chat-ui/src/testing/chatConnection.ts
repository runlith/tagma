import { Cause, Effect, Queue, Stream } from 'effect';
import type { ThreadPagePayload } from '@runlith/agent/protocol/http';
import type { FeedPosition, ThreadOpenText } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import {
  type ChatAnswer,
  type ChatCommandLost,
  ChatCommandRefused,
  type ChatCompactAsk,
  type ChatCompaction,
  type ChatConnection,
  ChatFeedBroken,
  type ChatFeedFailure,
  type ChatFeedItem,
  ChatFeedRefused,
  type ChatReadRefused,
  type ChatSaid,
  type ChatStopped,
  type ChatThreadView,
  type ChatTurnStart,
  type ChatUnqueued,
  type ChatWords,
} from '../wire/ChatConnection';

export type TestThread = ChatThreadView;

type Answers = {
  send: ChatSaid;
  queue: ChatSaid;
  answer: ChatTurnStart;
  compact: ChatCompaction;
  continue: ChatTurnStart;
  unqueue: ChatUnqueued;
  stop: ChatStopped;
  entriesBefore: ThreadPagePayload;
  entry: ThreadTranscriptEntry | null;
  text: ThreadOpenText | null;
};

type Inputs = {
  send: ChatWords;
  queue: ChatWords;
  answer: ChatAnswer;
  compact: ChatCompactAsk;
  continue: null;
  unqueue: { readonly inputId: string };
  stop: { readonly withdraw: boolean };
  entriesBefore: { readonly before: number };
  entry: { readonly entryId: string };
  text: { readonly entryId: string; readonly from: number; readonly limit: number };
};

type Errors = {
  send: ChatCommandRefused | ChatCommandLost;
  queue: ChatCommandRefused | ChatCommandLost;
  answer: ChatCommandRefused | ChatCommandLost;
  compact: ChatCommandRefused | ChatCommandLost;
  continue: ChatCommandRefused | ChatCommandLost;
  unqueue: ChatCommandRefused | ChatCommandLost;
  stop: ChatCommandRefused | ChatCommandLost;
  entriesBefore: ChatReadRefused;
  entry: ChatReadRefused;
  text: ChatReadRefused;
};

export type Command = keyof Answers;

type Stub<K extends Command> = (input: Inputs[K]) => Effect.Effect<Answers[K], Errors[K]>;

type Feed<TThread extends ChatThreadView> = {
  readonly threadId: string;
  readonly from: FeedPosition | null;
  readonly queue: Queue.Queue<ChatFeedItem<TThread>, ChatFeedFailure>;
  open: boolean;
};

type Gate = { readonly reached: Promise<void>; reach(): void; readonly opened: Promise<void>; open(): void };

export type TestCall = { readonly command: Command; readonly threadId: string; readonly input: unknown };

const DEFAULTS: { [K in Command]: Answers[K] } = {
  send: { status: 'started', runId: 'run-1', acted: true },
  queue: { status: 'started', runId: 'run-1', acted: true },
  answer: { status: 'started', runId: 'run-1' },
  compact: { status: 'started', runId: 'run-compact-1' },
  continue: { status: 'started', runId: 'run-continued-1' },
  unqueue: { status: 'unqueued' },
  stop: { status: 'stopped', runId: 'run-1' },
  entriesBefore: { entries: [], before: null },
  entry: null,
  text: null,
};

export class TestConnection<TThread extends ChatThreadView = TestThread> implements ChatConnection<TThread> {
  readonly feeds: Feed<TThread>[] = [];
  readonly calls: TestCall[] = [];
  private readonly stubs: { [K in Command]?: Stub<K> } = {};
  private readonly gates = new Map<Command, Gate>();

  stub<K extends Command>(command: K, answer: Stub<K>): this {
    this.stubs[command] = answer as (typeof this.stubs)[K];
    return this;
  }

  answers<K extends Command>(command: K, value: Answers[K]): this {
    return this.stub(command, () => Effect.succeed(value));
  }

  refuses<K extends 'send' | 'queue' | 'answer' | 'compact' | 'continue' | 'unqueue' | 'stop'>(
    command: K,
    message: string,
    code?: string,
  ): this {
    return this.stub(command, () => Effect.fail(new ChatCommandRefused({ message, code })));
  }

  hold(command: Command): Promise<void> {
    let reach!: () => void;
    let open!: () => void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const opened = new Promise<void>((resolve) => (open = resolve));
    this.gates.set(command, { reached, reach, opened, open });
    return reached;
  }

  release(command: Command): void {
    const gate = this.gates.get(command);
    this.gates.delete(command);
    gate?.open();
  }

  called(command: Command): readonly TestCall[] {
    return this.calls.filter((call) => call.command === command);
  }

  get open(): number {
    return this.feeds.filter((feed) => feed.open).length;
  }

  emit(item: ChatFeedItem<TThread>, threadId?: string): void {
    const target = threadId ?? this.live()?.threadId;
    for (const feed of this.feeds) if (feed.open && feed.threadId === target) Queue.offerUnsafe(feed.queue, item);
  }

  refuse(message: string, threadId?: string): void {
    const feed = this.live(threadId);
    if (feed) Queue.failCauseUnsafe(feed.queue, Cause.fail(new ChatFeedRefused({ message })));
  }

  break(message: string, threadId?: string): void {
    const feed = this.live(threadId);
    if (feed) Queue.failCauseUnsafe(feed.queue, Cause.fail(new ChatFeedBroken({ message })));
  }

  feed(threadId: string, from: Effect.Effect<FeedPosition | null>): Stream.Stream<ChatFeedItem<TThread>, ChatFeedFailure> {
    return Stream.unwrap(this.subscribed(threadId, from));
  }

  private readonly subscribed = Effect.fnUntraced(function* (
    this: TestConnection<TThread>,
    threadId: string,
    from: Effect.Effect<FeedPosition | null>,
  ) {
    const queue = yield* Queue.unbounded<ChatFeedItem<TThread>, ChatFeedFailure>();
    const feed: Feed<TThread> = { threadId, from: yield* from, queue, open: true };
    this.feeds.push(feed);
    return Stream.fromQueue(queue).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          feed.open = false;
        }),
      ),
    );
  });

  send(threadId: string, words: ChatWords) {
    return this.command('send', threadId, words);
  }

  queue(threadId: string, words: ChatWords) {
    return this.command('queue', threadId, words);
  }

  answer(threadId: string, answer: ChatAnswer) {
    return this.command('answer', threadId, answer);
  }

  compact(threadId: string, ask: ChatCompactAsk) {
    return this.command('compact', threadId, ask);
  }

  continue(threadId: string) {
    return this.command('continue', threadId, null);
  }

  unqueue(threadId: string, inputId: string) {
    return this.command('unqueue', threadId, { inputId });
  }

  stop(threadId: string, withdraw: boolean) {
    return this.command('stop', threadId, { withdraw });
  }

  entriesBefore(threadId: string, before: number) {
    return this.command('entriesBefore', threadId, { before });
  }

  entry(threadId: string, entryId: string) {
    return this.command('entry', threadId, { entryId });
  }

  text(threadId: string, entryId: string, from: number, limit: number) {
    return this.command('text', threadId, { entryId, from, limit });
  }

  private live(threadId?: string): Feed<TThread> | undefined {
    return this.feeds.findLast((feed) => feed.open && (threadId === undefined || feed.threadId === threadId));
  }

  private readonly command = Effect.fnUntraced(function* <K extends Command>(
    this: TestConnection<TThread>,
    command: K,
    threadId: string,
    input: Inputs[K],
  ): Effect.fn.Return<Answers[K], Errors[K]> {
    this.calls.push({ command, threadId, input });
    const gate = this.gates.get(command);
    if (gate) {
      gate.reach();
      yield* Effect.promise(() => gate.opened);
    }
    const stub: Stub<K> | undefined = this.stubs[command];
    return yield* stub ? stub(input) : Effect.succeed(DEFAULTS[command]);
  });
}
