import { Clock, Deferred, Effect, Result, Schema, type Scope } from 'effect';
import type { ToolCall } from '@runlith/acp/toolCalls';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import { familyRetries, type WireFailureFamily } from '@runlith/llm/schema/errors';
import { SERVED, type Dispatched } from '@runlith/hosted-runner/bridge';
import type { ClientOutcome } from '@runlith/hosted-runner/client';
import type { Output } from '@runlith/hosted-runner/output';
import { MEASURED, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import type { Frame, Host, MuseRefused } from './channel.js';
import {
  Approval,
  ContextUsage,
  ItemDelta,
  ItemEvent,
  Retry,
  SessionRead,
  TokenUsage,
  TurnCompleted,
  TurnStarted,
  type Item,
  type Tokens,
} from './frames.js';

const WEB = { web_search: 'websearch', web_fetch: 'webfetch' } as const;

export const LOGIN = 'muse login';

const decoder =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (value: unknown): A | null => {
    const read = Schema.decodeUnknownResult(schema)(value);
    return Result.isSuccess(read) ? read.success : null;
  };

const items = decoder(ItemEvent);
const deltas = decoder(ItemDelta);
const starts = decoder(TurnStarted);
const ends = decoder(TurnCompleted);
const usages = decoder(TokenUsage);
const contexts = decoder(ContextUsage);
const retries = decoder(Retry);
const approvals = decoder(Approval);
const reads = decoder(SessionRead);

const inputOf = (args: string | undefined): unknown => {
  if (args === undefined || args === '') return {};
  try {
    return JSON.parse(args);
  } catch (failure) {
    if (failure instanceof SyntaxError) return args;
    throw failure;
  }
};

const familyOf = (kind: string | undefined, status: number | undefined, quota: boolean): WireFailureFamily => {
  if (kind === 'authRequired' || status === 401 || status === 403) return 'auth';
  if (quota) return 'quota';
  if (status === 429) return 'rate-limit';
  if (status !== undefined && status >= 500) return 'overloaded';
  if (kind === 'configError' || kind === 'launchError') return 'invalid-request';
  if (kind === 'mcpLinkError') return 'connect-timeout';
  return 'unknown';
};

const failureOf = (ended: TurnCompleted, modelStarted: boolean): TransportFailure => {
  const family = familyOf(ended.error?.kind, undefined, ended.error?.quota !== undefined);
  return {
    stage: 'muse.turn',
    type: ended.error?.kind ?? 'Transport',
    retryable: ended.error?.retryable ?? familyRetries(family),
    modelStarted,
    reason: { family },
  };
};

export const spentOf = (usage: Tokens) => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  totalTokens: usage.inputTokens + usage.outputTokens,
  cachedReadTokens: usage.cacheReadTokens ?? usage.cachedTokens,
  cachedWriteTokens: usage.cacheWriteTokens ?? 0,
  thoughtTokens: usage.reasoningTokens,
});

export type Spent = ReturnType<typeof spentOf>;

const remainderOf = (whole: Spent, parts: Spent): Spent | 'negative' | undefined => {
  const left = {
    inputTokens: whole.inputTokens - parts.inputTokens,
    outputTokens: whole.outputTokens - parts.outputTokens,
    totalTokens: whole.totalTokens - parts.totalTokens,
    cachedReadTokens: whole.cachedReadTokens - parts.cachedReadTokens,
    cachedWriteTokens: whole.cachedWriteTokens - parts.cachedWriteTokens,
    thoughtTokens: whole.thoughtTokens - parts.thoughtTokens,
  };
  const values = Object.values(left);
  if (values.some((value) => value < 0)) return 'negative';
  return values.every((value) => value === 0) ? undefined : left;
};

type FeedPorts = {
  readonly session: string;
  readonly turn: string;
  readonly output: Output;
  readonly host: Host;
  readonly scope: Scope.Scope;
  readonly thoughts: boolean;
  readonly window: () => number | null;
  readonly measured: (window: number) => void;
  readonly permitted: (call: ToolCall) => Effect.Effect<string | null>;
  readonly callOf: (tool: string, input: unknown) => Dispatched;
  readonly stderr: (text: string) => void;
  readonly began: Effect.Effect<void>;
  readonly abandon: Effect.Effect<void>;
  readonly pricedBefore: number | null;
  readonly priced: (usd: number) => void;
};

export const NOTHING: Spent = spentOf({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 });

export const sum = (a: Spent, b: Spent): Spent => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  cachedReadTokens: a.cachedReadTokens + b.cachedReadTokens,
  cachedWriteTokens: a.cachedWriteTokens + b.cachedWriteTokens,
  thoughtTokens: a.thoughtTokens + b.thoughtTokens,
});

const SEVERITY: Readonly<Record<string, number>> = { completed: 0, cancelled: 1 };

export class Feed {
  started = false;
  readonly unread = new Set<string>();
  private step = 0;
  private closed = false;
  private attempt = 0;
  private modelStarted = false;
  private stopping = false;
  private relinquishing = false;
  private said: AgentPhase['phase'] | null = null;
  private latest: string | null = null;
  private priced: { readonly usd: number; readonly partial: boolean } | null = null;
  private last: TurnCompleted | null = null;
  private whole: Spent = NOTHING;
  private readonly owned: Set<string>;
  private readonly open: Set<string>;
  private readonly reading = new Map<string, Deferred.Deferred<boolean>>();
  private readonly items = new Set<string>();
  private readonly announced = new Set<string>();
  private readonly written = new Map<string, number>();
  private readonly thought = new Map<string, number[]>();
  private spent: Spent = NOTHING;

  constructor(
    private readonly ports: FeedPorts,
    readonly done: Deferred.Deferred<ClientOutcome>,
  ) {
    this.owned = new Set([ports.turn]);
    this.open = new Set([ports.turn]);
  }

  get session(): string {
    return this.ports.session;
  }

  get cancelled(): boolean {
    return this.stopping;
  }

  owns(turn: string): boolean {
    return this.owned.has(turn);
  }

  get current(): string {
    return this.latest !== null && this.open.has(this.latest) ? this.latest : this.ports.turn;
  }

  readonly begin = Effect.fnUntraced(function* (this: Feed) {
    if (this.started) return;
    this.started = true;
    yield* this.ports.began;
  });

  steering(command: string): Deferred.Deferred<boolean> {
    this.owned.add(command);
    this.unread.add(command);
    const read = Deferred.makeUnsafe<boolean>();
    this.reading.set(command, read);
    return read;
  }

  readonly unsteered = Effect.fnUntraced(function* (this: Feed, command: string) {
    this.owned.delete(command);
    this.unread.delete(command);
    this.reading.delete(command);
    yield* this.settle();
  });

  readonly stop = Effect.fnUntraced(function* (this: Feed) {
    this.stopping = true;
    const open = [...this.open];
    yield* this.settle();
    return open;
  });

  private interrupt(turn: string) {
    const { host, session, scope } = this.ports;
    return Effect.forkIn(
      host.command('turn/interrupt', { sessionId: session, turnId: turn }).pipe(
        Effect.asVoid,
        Effect.catchTag('MuseRefused', (refused) =>
          refused.kind === 'commandRejected' ? Effect.void : this.lost(`Muse Code refused to stop turn ${turn}: ${refused.message}`),
        ),
      ),
      scope,
    );
  }

  private readonly lost = Effect.fnUntraced(function* (this: Feed, reason: string): Effect.fn.Return<void> {
    this.ports.stderr(`${reason}\n`);
    for (const read of this.reading.values()) yield* Deferred.succeed(read, false);
    this.reading.clear();
    yield* Deferred.succeed(this.done, { status: 'error', detail: reason, turn: this.ports.turn });
    yield* this.ports.abandon;
  });

  private readonly undecided = Effect.fnUntraced(function* (this: Feed, turn: string, reason: string) {
    this.ports.stderr(`${reason}\n`);
    yield* Deferred.succeed(this.done, { status: 'error', detail: reason, turn: this.ports.turn });
    yield* this.interrupt(turn);
  });

  private readonly settle = Effect.fnUntraced(function* (this: Feed): Effect.fn.Return<void> {
    const last = this.last;
    if (last === null || this.open.size > 0) return;
    if (this.unread.size > 0) {
      if (!this.stopping && last.terminal === 'completed') return;
      if (this.relinquishing) return;
      this.relinquishing = true;
      yield* Effect.forkIn(this.relinquish(), this.ports.scope);
      return;
    }
    yield* Deferred.succeed(this.done, this.outcome(last));
  });

  private readonly heard = Effect.fnUntraced(function* (this: Feed, command: string, read: boolean) {
    this.unread.delete(command);
    const waiting = this.reading.get(command);
    this.reading.delete(command);
    if (waiting !== undefined) yield* Deferred.succeed(waiting, read);
  });

  private readonly relinquish = Effect.fnUntraced(
    function* (this: Feed): Effect.fn.Return<void, MuseRefused> {
      const { host, session } = this.ports;
      for (const command of [...this.unread]) {
        const reclaimed = yield* host.command('turn/unqueue', { sessionId: session, turnId: command }).pipe(
          Effect.as(true),
          Effect.catchTag('MuseRefused', (refused) => (refused.kind === 'commandRejected' ? Effect.succeed(false) : Effect.fail(refused))),
        );
        if (reclaimed) yield* this.heard(command, false);
      }
      if (this.unread.size > 0) {
        const held = reads(yield* host.request('session/read', { sessionId: session, excludeItems: false }));
        if (held === null) return yield* this.lost(`Muse Code answered session/read for ${session} in a shape Tagma cannot read`);
        const state = held.history.snapshot?.state;
        const said = new Set(
          (state?.items ?? held.history.items ?? []).flatMap((item) =>
            item.kind === 'userMessage' && item.commandId ? [item.commandId] : [],
          ),
        );
        const running = [...(state?.activeTurn === null || state === undefined ? [] : [state.activeTurn]), ...(state?.queuedTurns ?? [])];
        for (const command of [...this.unread]) {
          const turn = running.find((ref) => ref.commandId === command || ref.turnId === command);
          if (turn !== undefined) {
            this.owned.add(turn.turnId);
            this.open.add(turn.turnId);
            yield* this.interrupt(turn.turnId);
          } else yield* this.heard(command, said.has(command));
        }
      }
      this.relinquishing = false;
      yield* this.settle();
    },
    Effect.catchTag('MuseRefused', (refused) => this.lost(`Muse Code could not account for words it accepted: ${refused.message}`)),
  );

  private message(): string {
    return `${this.ports.turn}:${this.step}`;
  }

  private content(): void {
    if (!this.closed) return;
    this.step += 1;
    this.closed = false;
  }

  readonly frame = Effect.fnUntraced(function* (this: Feed, frame: Frame) {
    const { output, turn } = this.ports;
    switch (frame.method) {
      case 'turn/started': {
        const id = starts(frame.params)?.turnId;
        if (id === undefined || !this.owned.has(id)) return;
        if (id === turn) yield* this.begin();
        this.open.add(id);
        this.latest = id;
        if (this.stopping) yield* this.interrupt(id);
        return;
      }
      case 'item/started':
      case 'item/updated':
      case 'item/completed': {
        const event = items(frame.params);
        if (event === null || !this.owned.has(event.item.turnId ?? '')) return;
        this.items.add(event.item.itemId);
        return yield* this.item(event.item, frame.method === 'item/started', frame.method === 'item/completed');
      }
      case 'item/delta': {
        const delta = deltas(frame.params);
        if (delta === null || !this.items.has(delta.itemId)) return;
        return yield* this.delta(delta.itemId, delta.field ?? 'text', delta.delta);
      }
      case 'session/tokenUsage': {
        const usage = usages(frame.params);
        if (usage === null || !this.owned.has(usage.turnId)) return;
        return yield* this.measure(usage, frame.params.durationMs);
      }
      case 'session/contextUsage': {
        const context = contexts(frame.params);
        if (context?.windowTokens !== undefined) this.ports.measured(context.windowTokens);
        return;
      }
      case 'turn/retryScheduled':
      case 'turn/modelRetryScheduled': {
        const retry = retries(frame.params);
        if (retry === null || !this.owned.has(retry.turnId)) return;
        this.attempt = retry.attempt;
        yield* this.phase('retrying');
        return yield* output.event({
          type: 'notification',
          method: RETRYING,
          fields: {
            uuid: `${turn}:retry:${retry.attempt}`,
            attempt: retry.attempt,
            of: retry.maxAttempts,
            delayMs: retry.retryDelayMs,
            family: familyOf(retry.errorKind, retry.httpStatus, false),
            httpStatus: retry.httpStatus ?? null,
            message: retry.reason ?? retry.errorKind ?? 'Muse Code is retrying the model call',
          },
        });
      }
      case 'approval/request': {
        const asked = approvals(frame.params);
        if (asked === null || !this.owned.has(asked.turnId)) return;
        return yield* this.approve(asked);
      }
      case 'turn/completed': {
        const ended = ends(frame.params);
        if (ended === null || !this.owned.has(ended.turnId)) return;
        this.open.delete(ended.turnId);
        if (ended.usage !== undefined && ended.usage !== null) this.whole = sum(this.whole, spentOf(ended.usage));
        if (this.last === null || (SEVERITY[ended.terminal] ?? 2) >= (SEVERITY[this.last.terminal] ?? 2)) this.last = ended;
        return yield* this.settle();
      }
      case 'turn/unqueued': {
        if (starts(frame.params)?.turnId === turn) yield* Deferred.succeed(this.done, { status: 'cancelled', turn });
        return;
      }
    }
  });

  private outcome(ended: TurnCompleted): ClientOutcome {
    const { turn, stderr, pricedBefore } = this.ports;
    const left = this.whole === NOTHING ? undefined : remainderOf(this.whole, this.spent);
    if (left === 'negative')
      stderr(
        `Muse Code reported turn ${turn} spending ${JSON.stringify(this.whole)}, less than its requests measured ${JSON.stringify(this.spent)}; the request spend stands\n`,
      );
    const usage = left === 'negative' ? undefined : left;
    const priced = this.priced;
    const cost =
      priced === null || pricedBefore === null || priced.usd < pricedBefore
        ? undefined
        : { amount: priced.usd - pricedBefore, currency: 'USD', basis: priced.partial ? 'estimate-partial' : 'estimate' };
    if (ended.terminal === 'completed') return { status: 'finished', usage, turn, cost };
    if (ended.terminal === 'cancelled') return { status: 'cancelled', usage, turn, cost };
    const signedOut = ended.error?.kind === 'authRequired';
    return {
      status: 'error',
      usage,
      turn,
      cost,
      failure: failureOf(ended, this.modelStarted),
      detail: signedOut
        ? `Muse Code is not signed in: run \`${LOGIN}\`, or sign in to Muse Code on the Providers screen. ${ended.error?.message ?? ''}`.trim()
        : (ended.error?.message ?? ended.reason ?? `Muse Code ended the turn ${ended.terminal}`),
    };
  }

  private readonly item = Effect.fnUntraced(function* (this: Feed, item: Item, opened: boolean, closed: boolean) {
    const { output } = this.ports;
    switch (item.kind) {
      case 'userMessage': {
        if (item.steered !== true || item.commandId === undefined) return;
        this.unread.delete(item.commandId);
        const read = this.reading.get(item.commandId);
        this.reading.delete(item.commandId);
        if (read !== undefined) yield* Deferred.succeed(read, true);
        return;
      }
      case 'reasoning': {
        if (opened) {
          this.content();
          this.modelStarted = true;
          yield* this.phase('reasoning');
        }
        if (closed && this.ports.thoughts)
          for (const [part, text] of (item.summary ?? []).entries()) yield* this.delta(item.itemId, `summary.${part}`, text, true);
        return;
      }
      case 'agentMessage': {
        if (opened) {
          this.content();
          this.modelStarted = true;
          yield* this.phase('writing');
        }
        if (closed && item.text !== undefined) yield* this.delta(item.itemId, 'text', item.text, true);
        return;
      }
      case 'toolCall': {
        const tool = item.tool ?? 'tool';
        const id = item.callId ?? item.itemId;
        if (opened || !this.announced.has(id)) yield* this.announce(id, tool, item.args);
        if (!closed) return;
        const text = item.visibleOutput ?? item.failureReason ?? '';
        yield* output.event({
          type: 'result',
          hosted: tool.startsWith(SERVED),
          result: {
            toolCallId: id,
            status: item.status === 'completed' ? 'completed' : 'failed',
            content: text === '' ? undefined : [{ type: 'content', content: { type: 'text', text } }],
          },
        });
        return yield* this.phase('calling');
      }
      case 'compaction': {
        if (opened) return yield* this.phase('compacting');
        if (!closed) return;
        if (item.outcome === 'compacted')
          yield* output.event({
            type: 'compacted',
            summary: '',
            trigger: item.trigger === 'manual' ? 'manual' : 'auto',
            preTokens: item.tokensBefore,
            postTokens: item.tokensAfter,
          });
        return yield* this.phase('calling');
      }
    }
  });

  private phase(phase: AgentPhase['phase']) {
    if (this.said === phase) return Effect.void;
    this.said = phase;
    return this.ports.output.event({ type: 'phase', phase });
  }

  private readonly delta = Effect.fnUntraced(function* (this: Feed, itemId: string, field: string, text: string, whole = false) {
    const { output } = this.ports;
    if (field === 'text') {
      const before = this.written.get(itemId) ?? 0;
      const fresh = whole ? text.slice(before) : text;
      this.written.set(itemId, whole ? Math.max(before, text.length) : before + text.length);
      return yield* output.event({ type: 'text', messageId: this.message(), text: fresh });
    }
    if (!field.startsWith('summary.') || !this.ports.thoughts) return;
    const part = Number(field.slice('summary.'.length));
    if (!Number.isSafeInteger(part) || part < 0) return;
    const parts = this.thought.get(itemId) ?? [];
    this.thought.set(itemId, parts);
    const before = parts[part] ?? 0;
    const fresh = whole ? text.slice(before) : `${before === 0 && part > 0 ? '\n\n' : ''}${text}`;
    parts[part] = whole ? Math.max(before, text.length) : before + text.length;
    return yield* output.event({ type: 'thought', messageId: this.message(), text: fresh });
  });

  private readonly measure = Effect.fnUntraced(function* (this: Feed, usage: TokenUsage, duration: unknown) {
    const { output } = this.ports;
    const now = yield* Clock.currentTimeMillis;
    const took = typeof duration === 'number' && Number.isFinite(duration) ? duration : 0;
    const spent = spentOf(usage.usage);
    this.spent = sum(this.spent, spent);
    this.modelStarted = true;
    const cost = usage.cumulative?.cost;
    if (cost !== undefined) {
      this.priced = cost;
      this.ports.priced(cost.usd);
    }
    yield* output.event({
      type: 'usage',
      update: {
        sessionUpdate: 'usage_update',
        used: usage.promptTokens + usage.usage.outputTokens,
        size: this.ports.window() ?? 0,
        _meta: {
          [MEASURED]: {
            message: this.message(),
            sentAt: new Date(now - took).toISOString(),
            input: spent.inputTokens,
            cacheRead: spent.cachedReadTokens,
            cacheWrite: spent.cachedWriteTokens,
            output: spent.outputTokens,
            reasoning: spent.thoughtTokens,
            ttlSeconds: null,
            ...(this.attempt > 0 ? { attempt: this.attempt } : {}),
          },
        },
      },
    });
    this.attempt = 0;
    this.closed = true;
    return yield* this.phase('calling');
  });

  private readonly announce = Effect.fnUntraced(function* (this: Feed, id: string, tool: string, args: string | undefined) {
    if (this.announced.has(id)) return;
    this.announced.add(id);
    const { output } = this.ports;
    const hosted = tool.startsWith(SERVED);
    const web = tool === 'web_search' || tool === 'web_fetch' ? WEB[tool] : undefined;
    const call = hosted ? this.ports.callOf(tool.slice(SERVED.length), inputOf(args)) : { name: web ?? tool, input: inputOf(args) };
    this.modelStarted = true;
    yield* this.phase('tools');
    yield* output.event({
      type: 'call',
      hosted,
      call: {
        toolCallId: id,
        title: call.name,
        name: call.name,
        kind: web === undefined ? undefined : 'fetch',
        status: hosted || tool === 'web_fetch' ? 'pending' : 'in_progress',
        rawInput: call.input,
      },
    });
    yield* output.event({ type: 'said', said: { messageId: this.message(), toolCallIds: [id] } });
    this.step += 1;
    this.closed = false;
  });

  private readonly approve = Effect.fnUntraced(function* (this: Feed, asked: Approval) {
    const { output, host, scope, stderr } = this.ports;
    const choose = (allow: boolean) =>
      asked.availableChoices.find((choice) =>
        allow ? choice.decision === 'approved' && choice.scope === 'once' : choice.decision === 'denied',
      ) ?? (allow ? undefined : asked.availableChoices.find((choice) => choice.decision === 'abort'));
    const decide = (allow: boolean) => {
      const choice = choose(allow);
      if (choice === undefined)
        return this.undecided(asked.turnId, `Muse Code offered no ${allow ? 'allow-once' : 'refusing'} choice for ${asked.toolName}`);
      return host
        .command('approval/decide', {
          sessionId: asked.sessionId,
          approvalId: asked.approvalId,
          choiceId: choice.choiceId,
          requirementId: asked.currentRequirementId,
        })
        .pipe(
          Effect.asVoid,
          Effect.catchTag('MuseRefused', (refused) =>
            this.undecided(asked.turnId, `Muse Code refused the decision on ${asked.toolName}: ${refused.message}`),
          ),
        );
    };
    if (asked.toolName.startsWith(SERVED)) {
      yield* this.announce(asked.toolCallId, asked.toolName, asked.rawArgs);
      return yield* Effect.forkIn(decide(true), scope);
    }
    if (asked.subject.kind !== 'network') {
      stderr(`Muse Code asked about ${asked.toolName}, which Tagma never offered; it is refused\n`);
      return yield* Effect.forkIn(decide(false), scope);
    }
    yield* this.announce(asked.toolCallId, 'web_fetch', asked.rawArgs);
    yield* Effect.forkIn(
      Effect.flatMap(
        this.ports.permitted({
          toolCallId: asked.toolCallId,
          title: WEB.web_fetch,
          name: WEB.web_fetch,
          kind: 'fetch',
          rawInput: inputOf(asked.rawArgs),
        }),
        (refusal) =>
          refusal === null
            ? Effect.andThen(
                output.event({ type: 'result', hosted: false, result: { toolCallId: asked.toolCallId, status: 'in_progress' } }),
                decide(true),
              )
            : decide(false),
      ),
      scope,
    );
  });
}
