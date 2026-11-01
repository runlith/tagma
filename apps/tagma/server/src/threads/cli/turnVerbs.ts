import { Data, Deferred, Effect, Fiber, Option, Stdio, Stream } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { ThreadWireFeedEvent, ThreadWireSnapshotPayload, WireSnapshot, WireState } from '../contract/wire/snapshot.js';
import type {
  threadCompactResultSchema,
  threadSaidResultSchema,
  threadStopResultSchema,
  threadTurnResultSchema,
  threadUnqueueResultSchema,
} from '@runlith/agent/protocol/realtime';
import type { ThreadTypesPage } from '../contract/wire/birth.js';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import type { FeedPosition, ThreadOpenChange, ThreadOpenEntry } from '@runlith/agent/transcript/live';
import { OPEN_TEXT_MAX } from '@runlith/agent/transcript/openText';
import { THREAD_COMPACTION_POINTS, type ThreadCompactionPoint } from '@runlith/agent/thread/storage/inbox';
import type { SerializedThreadRun } from '@runlith/agent/protocol/http';
import { contextLine } from '../voice/threadText.js';
import { blockRefFlag } from '../../graph/cli/args.js';
import { refuse, noting, CurrentInvocation, print, write, type Invocation } from '../../platform/cli/verb.js';

type Lens = { readonly cwd?: string; readonly project?: string };

type Aimed = { readonly projectId: number; readonly threadId: string; readonly params?: unknown };

export type ThreadsDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: string };
      readonly query: Lens;
      readonly headers: {};
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export const locateThread = (ask: ThreadsCli['ask'], id: string): Effect.Effect<number, unknown> =>
  Effect.map(
    ask((door) => door.operations.perform({ params: { id: 'locate_thread' }, query: {}, headers: {}, payload: { threadId: id } })),
    (answer) => (answer as { readonly projectId: number }).projectId,
  );

export const createThread = (
  ask: ThreadsCli['ask'],
  query: Lens,
  payload: {
    readonly title?: string;
    readonly type?: string;
    readonly host?: { readonly kind: string; readonly id: string };
    readonly scopeName?: string;
  },
): Effect.Effect<ThreadWireSnapshotPayload, unknown> =>
  ask((door) => door.operations.perform({ params: { id: 'create_thread' }, query, headers: {}, payload })) as Effect.Effect<
    ThreadWireSnapshotPayload,
    unknown
  >;

const snapshotOf = (door: ThreadsDoor, threadId: string, query: Lens): Effect.Effect<ThreadWireSnapshotPayload, unknown> =>
  Effect.map(
    door.operations.perform({ params: { id: 'read_thread_snapshot' }, query, headers: {}, payload: { threadId } }),
    (answer) => answer as ThreadWireSnapshotPayload,
  );

export type ThreadLive = {
  'thread.subscribe'(payload: Aimed & { readonly since?: FeedPosition }): Stream.Stream<ThreadWireFeedEvent, unknown>;
  'thread.send'(payload: Aimed): Effect.Effect<typeof threadSaidResultSchema.Type, unknown>;
  'thread.answer'(payload: Aimed): Effect.Effect<typeof threadTurnResultSchema.Type, unknown>;
  'thread.continue'(payload: Aimed): Effect.Effect<typeof threadTurnResultSchema.Type, unknown>;
  'thread.stop'(payload: Aimed): Effect.Effect<typeof threadStopResultSchema.Type, unknown>;
  'thread.steer'(payload: Aimed): Effect.Effect<typeof threadSaidResultSchema.Type, unknown>;
  'thread.compact'(payload: Aimed): Effect.Effect<typeof threadCompactResultSchema.Type, unknown>;
  'thread.unqueue'(payload: Aimed): Effect.Effect<typeof threadUnqueueResultSchema.Type, unknown>;
};

export type ThreadsCli = {
  readonly ask: <A>(call: (door: ThreadsDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly askLive: <A, R>(work: (live: ThreadLive) => Effect.Effect<A, unknown, R>) => Effect.Effect<A, never, R>;
  readonly lens: (at: Invocation, options: { readonly project?: string | undefined }) => Lens;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

type ThreadContext = {
  readonly reading: NonNullable<WireSnapshot['thread']['contextReading']>;
  readonly limit: WireState['contextLimit'];
};

function threadContextOf(state: WireState): ThreadContext | null {
  const reading = state.thread.contextReading;
  return reading === null ? null : { reading, limit: state.contextLimit };
}

type TurnOutcome = {
  readonly runId: string | null;
  readonly status: 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn' | 'question' | 'detached' | 'steered' | 'queued' | 'requested';
  readonly text: string;
  readonly usage: SerializedThreadRun['usage'];
  readonly context: ThreadContext | null;
  readonly question?: unknown;
  readonly request?: { readonly id: string; readonly at: ThreadCompactionPoint };
};

type TurnOpened =
  | { readonly status: 'started' | 'already-running' | 'steered' | 'queued'; readonly runId: string }
  | { readonly status: 'requested'; readonly runId: string; readonly requestId: string; readonly at: ThreadCompactionPoint };

const AWAITING_QUESTION = 'awaiting-question';

function refuseRunActive(threadId: string, runId: string): never {
  return refuse('run-active', `run ${runId} is already going; this call was NOT delivered`, [
    `read_thread on ${threadId} — inspect the run that is going`,
    `tagma stop ${threadId} — stop it, then try again`,
  ]);
}

const runTurn = Effect.fn('threads.runTurn')(function* (input: {
  live: ThreadLive;
  prefix: Prefix;
  projectId: number;
  threadId: string;
  start: Effect.Effect<TurnOpened, unknown>;
  quiet: boolean;
}): Effect.fn.Return<TurnOutcome, unknown, Stdio.Stdio> {
  let text = '';
  let started: string | null = null;
  let last: WireState | null = null;
  let question: ThreadTranscriptEntry | undefined;
  const takeQuestions = (entries: readonly ThreadTranscriptEntry[]): void => {
    for (const entry of entries) if (entry.type === 'question') question = entry;
  };
  const settled = yield* Deferred.make<TurnOutcome>();
  const settleOn = Effect.fnUntraced(function* (snapshot: WireState) {
    last = snapshot;
    if (started === null) return;
    if (snapshot.activeRun === null) {
      const run = snapshot.latestRun;
      if (run === null || run.id !== started || run.status === 'running') return;
      yield* Deferred.succeed(settled, {
        runId: run.id,
        status: run.status,
        text,
        usage: run.usage ?? null,
        context: threadContextOf(snapshot),
      });
      return;
    }
    if (snapshot.activeRun.id === started && snapshot.activeRun.progress.stage === AWAITING_QUESTION) {
      yield* Deferred.succeed(settled, {
        runId: snapshot.activeRun.id,
        status: 'question',
        text,
        usage: null,
        context: threadContextOf(snapshot),
        question,
      });
    }
  });
  const live = new LiveWords(input.prefix);
  const onFrame = Effect.fnUntraced(function* (frame: ThreadWireFeedEvent) {
    if (frame.type === 'open') {
      const said = yield* live.said(frame.change);
      if (said.text !== '') text += said.text;
      if (!input.quiet && said.shown !== '') yield* write(said.shown);
      return;
    }
    if (frame.type === 'snapshot') {
      takeQuestions(frame.payload.snapshot.transcript);
      yield* settleOn(frame.payload.snapshot);
      return;
    }
    takeQuestions(frame.payload.records.flatMap((record) => (record.entry ? [record.entry] : [])));
    yield* settleOn(frame.payload.snapshot);
  });
  const feed = yield* Effect.forkChild(
    Stream.runForEach(input.live['thread.subscribe']({ projectId: input.projectId, threadId: input.threadId }), onFrame),
  );
  const opened = yield* input.start;
  if (opened.status === 'already-running') {
    yield* Effect.ignore(Fiber.interrupt(feed));
    return refuseRunActive(input.threadId, opened.runId);
  }
  if (opened.status === 'steered' || opened.status === 'queued') {
    yield* Effect.ignore(Fiber.interrupt(feed));
    return { runId: opened.runId, status: opened.status, text: '', usage: null, context: null } satisfies TurnOutcome;
  }
  if (opened.status === 'requested') {
    yield* Effect.ignore(Fiber.interrupt(feed));
    return {
      runId: opened.runId,
      status: 'requested',
      text: '',
      usage: null,
      context: null,
      request: { id: opened.requestId, at: opened.at },
    } satisfies TurnOutcome;
  }
  started = opened.runId;
  if (last !== null) yield* settleOn(last);
  const outcome = yield* Deferred.await(settled);
  yield* Effect.ignore(Fiber.interrupt(feed));
  return outcome;
});

function answerWith(outcome: TurnOutcome, threadId: string, asJson: boolean) {
  if (asJson) {
    return print({ threadId, ...outcome }, true);
  }
  if (outcome.status === 'question') {
    return Effect.gen(function* () {
      yield* write(`\nparked on a question — answer with: tagma reply ${threadId} "<text>"\n`);
      yield* print(outcome.question ?? {}, true);
    });
  }
  if (outcome.status === 'steered') {
    return write(
      `\nread into run ${outcome.runId ?? '—'} — it takes the words at its next step\n` + `read it with read_thread on ${threadId}\n`,
    );
  }
  if (outcome.status === 'queued') {
    return write(
      `\nqueued behind run ${outcome.runId ?? '—'} — it opens its own turn when that run ends\n` +
        `read it with read_thread on ${threadId}\n`,
    );
  }
  if (outcome.status === 'requested') {
    const request = outcome.request;
    return write(
      (request?.at === 'end'
        ? `\ncompaction ${request.id} queued — it runs after run ${outcome.runId ?? '—'} and the turns already waiting\n`
        : `\ncompaction ${request?.id ?? '—'} requested of run ${outcome.runId ?? '—'} — it compacts at its next step and goes on\n`) +
        `take it back with: tagma unqueue ${threadId} ${request?.id ?? '<id>'}\n`,
    );
  }
  return write(
    `\n[${outcome.status}] run ${outcome.runId ?? '—'}\n${contextLine(outcome.context?.reading ?? null, outcome.context?.limit ?? null)}\n`,
  );
}

class TextGone extends Data.TaggedError('TextGone')<{ readonly message: string }> {}

type Prefix = (entryId: string, from: number) => Effect.Effect<string, unknown>;

const prefixReader =
  (ask: ThreadsCli['ask'], projectId: number, threadId: string): Prefix =>
    Effect.fnUntraced(function* (entryId: string, from: number) {
      let text = '';
      let at = from;
      while (at > 0) {
        const start = Math.max(0, at - OPEN_TEXT_MAX);
        const read = (yield* ask((door) =>
          door.operations.perform({
            params: { id: 'read_thread_text' },
            query: { project: String(projectId) },
            headers: {},
            payload: { threadId, entryId, from: start, limit: at - start },
          }),
        )) as { readonly status: 'found'; readonly text: string; readonly from: number } | { readonly status: 'absent' };
        if (read.status === 'absent' || read.from >= at) {
          return yield* new TextGone({ message: `entry ${entryId} has no text before offset ${at}` });
        }
        text = read.text + text;
        at = read.from;
      }
      return text;
    });

class LiveWords {
  private readonly words = new Set<string>();
  private readonly calls = new Set<string>();

  constructor(private readonly prefix: Prefix) {}

  said(change: ThreadOpenChange): Effect.Effect<{ readonly text: string; readonly shown: string }, unknown> {
    if (change.op === 'append') {
      return Effect.succeed(this.words.has(change.id) ? { text: change.text, shown: change.text } : { text: '', shown: '' });
    }
    if (change.op !== 'put') return Effect.succeed({ text: '', shown: '' });
    const entry = change.entry;
    if (!coreEntry(entry)) return Effect.succeed({ text: '', shown: '' });
    if (entry.type === 'message' && entry.role === 'assistant' && !this.words.has(entry.id)) {
      this.words.add(entry.id);
      const whole = change.from === 0 ? Effect.succeed(entry.text) : Effect.map(this.prefix(entry.id, change.from), (head) => head + entry.text);
      return Effect.map(whole, (text) => ({ text, shown: text }));
    }
    if (entry.type === 'tool' && !this.calls.has(entry.id)) {
      this.calls.add(entry.id);
      return Effect.succeed({ text: '', shown: `\n[tool] ${entry.toolName}\n` });
    }
    return Effect.succeed({ text: '', shown: '' });
  }

  open(entries: readonly ThreadOpenEntry[]): Effect.Effect<string, unknown> {
    return Effect.map(
      Effect.forEach(entries, (one) => this.said({ op: 'put', entry: one.entry, from: one.from })),
      (said) => said.map((one) => one.shown).join(''),
    );
  }
}

function followFrameText(frame: ThreadWireFeedEvent, asJson: boolean, live: LiveWords): Effect.Effect<string, unknown> {
  if (asJson) return Effect.succeed(`${JSON.stringify(frame)}\n`);
  const state = (snapshot: { readonly activeRun: { readonly id: string } | null }): string =>
    snapshot.activeRun === null ? '\n[idle]\n' : `\n[run ${snapshot.activeRun.id}]\n`;
  switch (frame.type) {
    case 'open':
      return Effect.map(live.said(frame.change), (said) => said.shown);
    case 'snapshot':
      return Effect.map(live.open(frame.payload.snapshot.open), (open) => state(frame.payload.snapshot) + open);
    case 'resume': {
      const records = frame.payload.records.map((record) => {
        const entry = record.entry;
        const said = entry !== undefined && 'text' in entry && typeof entry.text === 'string' && entry.text ? `${entry.text}\n` : '';
        return `\n[${entry?.type ?? record.kind} @${record.position}]\n${said}`;
      });
      return Effect.map(live.open(frame.payload.open), (open) => records.join('') + state(frame.payload.snapshot) + open);
    }
    case 'state':
      return Effect.succeed(state(frame.payload.snapshot));
  }
}

export const threadTurns = ({ ask, askLive, lens }: ThreadsCli) => {
  const locate = (id: string) => locateThread(ask, id);

  const askThread = Command.make(
    'ask',
    {
      json,
      project,
      text: Argument.String('text'),
      thread: Flag.String('thread').pipe(Flag.optional, Flag.withDescription('the thread this turn continues')),
      fresh: Flag.Boolean('new').pipe(Flag.withDefault(false), Flag.withDescription('open a new thread for this turn')),
      title: Flag.String('title').pipe(
        Flag.optional,
        Flag.withDescription("the new thread's name in the project list — REQUIRED with --new"),
      ),
      type: Flag.String('type').pipe(Flag.optional, Flag.withDescription('the agent or profile the new thread opens as; omitted, tagma')),
      scope: blockRefFlag('scope').pipe(Flag.optional, Flag.withDescription('the block whose subtree the new thread is opened inside')),
      detach: Flag.Boolean('detach').pipe(
        Flag.withDefault(false),
        Flag.withDescription('start the run and return at once; read it with read_thread'),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const scoped = lens(yield* CurrentInvocation, { project: optional(o.project) });
        let threadId = optional(o.thread);
        if (o.fresh === (threadId !== undefined)) {
          return refuse('thread-required', 'name where this turn goes: an existing thread, or a new one', [
            'tagma ask --thread <id> "<text>"',
            'tagma ask --new --title "<name>" "<text>"',
          ]);
        }
        if (o.fresh) {
          const title = optional(o.title)?.trim();
          if (!title) {
            return refuse('title-required', 'a thread born of an agent carries a name the operator can read', [
              '--title "<what this worker is for>"',
            ]);
          }
          const scopeName = optional(o.scope);
          const type = optional(o.type);
          const created = yield* createThread(ask, scoped, {
            title,
            type,
            scopeName,
          });
          threadId = created.snapshot.thread.id;
        }
        const id = threadId as string;
        const projectId = yield* locate(id);
        const outcome = yield* askLive((live) =>
          Effect.gen(function* () {
            const start = live['thread.send']({ projectId, threadId: id, params: { text: o.text, key: crypto.randomUUID() } });
            if (o.detach) {
              const opened = yield* start;
              return {
                runId: opened.runId,
                status: opened.status === 'started' ? 'detached' : opened.status,
                text: '',
                usage: null,
                context: null,
              } satisfies TurnOutcome;
            }
            return yield* runTurn({ live, prefix: prefixReader(ask, projectId, id), projectId, threadId: id, start, quiet: o.json });
          }),
        );
        if (outcome.status === 'detached') {
          yield* print(o.json ? { threadId: id, runId: outcome.runId } : `${id}\nrun ${outcome.runId} started`, o.json);
          return;
        }
        yield* answerWith(outcome, id, o.json);
      }),
  ).pipe(
    Command.withDescription('send a turn into the native harness and stream the answer'),
    noting(`The run executes in the Tagma server, not here: killing this command never kills the work,
  and the thread appears in the operator's list at once, signed by this session.

    tagma ask --new --title "Check the session migration" "Read the migration and verify it"
    tagma ask --thread <id> "And now run the tests"       another turn of the same thread
    tagma ask --thread <id> --detach "Long job"           start and return; read on with:
                                                         read_thread with after

  A turn that parks on a question prints it and exits; answer with \`tagma reply\`. A turn sent
  while a run is already going WAITS: the words are queued against that run, the command says so
  and returns, and they open their own turn when that run ends — stopped, failed or finished alike,
  behind the words somebody steered into it and it never read, which a stop hands on first. No
  deadline of its own: your timeout is the only clock, and after it fires the run is still going
  server-side.`),
  );

  const reply = Command.make(
    'reply',
    {
      json,
      id: Argument.String('thread'),
      text: Argument.String('text'),
      question: Flag.String('question').pipe(
        Flag.optional,
        Flag.withDescription('which parked question this answers; the newest one when omitted'),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const projectId = yield* locate(o.id);
        const scoped = { project: String(projectId) };
        let questionId = optional(o.question);
        if (questionId === undefined) {
          const opened = yield* ask((door) => snapshotOf(door, o.id, scoped));
          const active = opened.snapshot.activeRun as { progress?: { stage: string | null } } | null;
          const parked =
            active?.progress?.stage === AWAITING_QUESTION
              ? ([...opened.snapshot.transcript].reverse().find((entry) => entry.type === 'question') as
                  | { questionId?: string }
                  | undefined)
              : undefined;
          if (!parked?.questionId) {
            return refuse('no-question', 'this thread is not waiting on a question', [
              `read_thread on ${o.id} — what it IS right now`,
              `tagma ask --thread ${o.id} "<text>" — an ordinary turn`,
            ]);
          }
          questionId = parked.questionId;
        }
        const resolved = questionId;
        const outcome = yield* askLive((live) =>
          runTurn({
            live,
            prefix: prefixReader(ask, projectId, o.id),
            projectId,
            threadId: o.id,
            start: live['thread.answer']({
              projectId,
              threadId: o.id,
              params: { questionId: resolved, answers: [{ questionId: resolved, values: [o.text] }] },
            }),
            quiet: o.json,
          }),
        );
        yield* answerWith(outcome, o.id, o.json);
      }),
  ).pipe(Command.withDescription("answer a thread's parked question and stream the resumed run"));

  const stop = Command.make('stop', { json, id: Argument.String('thread') }, (o) =>
    Effect.gen(function* () {
      const projectId = yield* locate(o.id);
      const result = yield* askLive((live) => live['thread.stop']({ projectId, threadId: o.id, params: {} }));
      yield* print(o.json ? result : result.status, o.json);
    }),
  ).pipe(
    Command.withDescription(
      "stop a thread's running turn and the commands that turn started; on an idle thread, end every command it still holds; the thread and its history stay",
    ),
  );

  const continueThread = Command.make('continue', { json, id: Argument.String('thread') }, (o) =>
    Effect.gen(function* () {
      const projectId = yield* locate(o.id);
      const outcome = yield* askLive((live) =>
        runTurn({
          live,
          prefix: prefixReader(ask, projectId, o.id),
          projectId,
          threadId: o.id,
          start: live['thread.continue']({ projectId, threadId: o.id }),
          quiet: o.json,
        }),
      );
      yield* answerWith(outcome, o.id, o.json);
    }),
  ).pipe(Command.withDescription('open one new run over an interrupted thread through its live socket'));

  const steer = Command.make('steer', { json, id: Argument.String('thread'), text: Argument.String('text') }, (o) =>
    Effect.gen(function* () {
      const projectId = yield* locate(o.id);
      const opened = yield* ask((door) => snapshotOf(door, o.id, { project: String(projectId) }));
      const activeRun = opened.snapshot.activeRun;
      if (!activeRun) {
        return refuse('not-running', 'nothing is going in this thread, so there is no run to steer', [
          `tagma ask --thread ${o.id} "${o.text}" — send it as its own turn`,
        ]);
      }
      const result = yield* askLive((live) =>
        live['thread.steer']({
          projectId,
          threadId: o.id,
          params: { expectedRunId: activeRun.id, text: o.text, key: crypto.randomUUID() },
        }),
      );
      if (o.json) {
        yield* print(result, true);
        return;
      }
      if (result.status === 'steered') {
        yield* write(`steered into run ${result.runId} — it reads this at its next step\n`);
        return;
      }
      if (result.status === 'started') {
        yield* write(`the run had ended, so these words opened run ${result.runId}\n`);
        return;
      }
      yield* write(`kept for the turn after run ${result.runId}, which reads no words mid-run or is not the run these words named\n`);
    }),
  ).pipe(
    Command.withDescription('put words into the run that is going; it reads them at its next step'),
    noting(`Steering does not interrupt the model: the words join the run's history where they arrived
  and the loop reads them before its next request. Stop instead when the run must end now —
  whatever it had not read yet opens its own turn.

    tagma steer <id> "actually use the other table"
    tagma ask --thread <id> "..."    words that WAIT for this run and open the next turn
    tagma stop <id>                  end the run; unread steers open a turn of their own`),
  );

  const compact = Command.make(
    'compact',
    {
      json,
      id: Argument.String('thread'),
      keep: Flag.String('keep').pipe(
        Flag.optional,
        Flag.withDescription('what the summary must retain, in your words: what the next turn will need at hand'),
      ),
      at: Flag.Literals('at', THREAD_COMPACTION_POINTS).pipe(
        Flag.optional,
        Flag.withDescription('on a running thread: step — at its next step, the default; end — behind the run and whatever already waits'),
      ),
      summarizer: Flag.String('summarizer').pipe(
        Flag.optional,
        Flag.withDescription('provider:model that writes the summary instead of the rule and chain; the thread keeps its own model'),
      ),
      reasoning: Flag.String('summarizer-reasoning').pipe(
        Flag.optional,
        Flag.withDescription("the summarizer's reasoning rung; its model's default when omitted"),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const projectId = yield* locate(o.id);
        const keep = optional(o.keep);
        const at = optional(o.at);
        const named = optional(o.summarizer);
        const reasoning = optional(o.reasoning);
        const split = named?.indexOf(':') ?? -1;
        if (named !== undefined && (split <= 0 || split === named.length - 1)) {
          return refuse('summarizer-shape', `"${named}" does not name a provider and a model`, [
            'tagma compact <id> --summarizer opencode-go:deepseek-v4.1-flash',
            'read_compaction_choices lists the rows this thread can be summarized by',
          ]);
        }
        const summarizer = named === undefined ? undefined : { provider: named.slice(0, split), model: named.slice(split + 1), reasoning };
        const params = {
          keep,
          at,
          summarizer,
        };
        const outcome = yield* askLive((live) =>
          runTurn({
            live,
            prefix: prefixReader(ask, projectId, o.id),
            projectId,
            threadId: o.id,
            start: live['thread.compact']({ projectId, threadId: o.id, params }),
            quiet: o.json,
          }),
        );
        yield* answerWith(outcome, o.id, o.json);
      }),
  ).pipe(
    Command.withDescription("compact a thread's context in place — at once when idle, by request while a run is going"),
    noting(`The summary is the model's own; --keep tells it what the next turn needs kept — files, decisions,
  the spec in hand — so the thread continues with its map instead of re-reading it.

  On an idle thread the compaction is a run of its own and this command streams it. On a running thread
  it is a request, answered at once with its id: --at step (the default) compacts the going run at its
  next step and the run goes on by itself; --at end waits in the queue and runs when the turns ahead of
  it have. Either stands among the thread's pending input until it runs, and tagma unqueue takes it back.

  Who writes the summary is decided when the compaction is taken: agent.compactionSummarizerRule and
  agent.compactionSummarizers pick the thread's own model or the first spendable one of the list, and
  read_compaction_choices shows that verdict beforehand. --summarizer names the model yourself.

    tagma compact <id> --keep "the three files under packages/agent/src/collaboration and spec 6a686491"
    tagma compact <id> --at end      compact behind the run that is going and the turns already queued
    tagma compact <id> --summarizer opencode-go:deepseek-v4.1-flash`),
  );

  const unqueue = Command.make('unqueue', { json, id: Argument.String('thread'), input: Argument.String('input') }, (o) =>
    Effect.gen(function* () {
      const projectId = yield* locate(o.id);
      const result = yield* askLive((live) => live['thread.unqueue']({ projectId, threadId: o.id, params: { inputId: o.input } }));
      if (result.status === 'unqueued') {
        yield* print(o.json ? result : `took back ${o.input} — it will not run`, o.json);
        return;
      }
      return refuse(
        'not-queued',
        `${o.input} is not waiting in this thread: a run already took it, it was taken back, or it was never there`,
        [`read_thread on ${o.id} — see what ran`],
      );
    }),
  ).pipe(Command.withDescription('take back a queued turn, an unread steer or a compaction request before a run takes it'));

  const followThread = (input: {
    projectId: number;
    threadId: string;
    since: number | undefined;
    asJson: boolean;
  }): Effect.Effect<void, never, Stdio.Stdio> =>
    askLive((live) => {
      const words = new LiveWords(prefixReader(ask, input.projectId, input.threadId));
      return Stream.runForEach(
        live['thread.subscribe']({
          projectId: input.projectId,
          threadId: input.threadId,
          since: input.since === undefined ? undefined : { position: input.since, seq: 0 },
        }),
        (frame) => Effect.flatMap(followFrameText(frame, input.asJson, words), write),
      );
    });
  return { askThread, reply, stop, continueThread, steer, compact, unqueue, followThread };
};
