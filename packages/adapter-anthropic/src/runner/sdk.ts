import { Clock, Effect, Result, Schema } from 'effect';
import type { Options, Query, SDKControlInterruptResponse, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { failed, said, sdkCall } from './calls.js';
import type { Channel, ClaudeSdk, Entry, Said, SideAnswer } from './channel.js';
import { readingOf } from './translate.js';

type Module = typeof import('@anthropic-ai/claude-agent-sdk');

type Unlisted = {
  askSideQuestion(question: string): Promise<SideAnswer | null>;
  cancelAsyncMessage(uuid: string): Promise<boolean>;
};

type Stopping = (options: { readonly cancelQueued: boolean }) => Promise<SDKControlInterruptResponse | undefined>;

const Lifecycle = Schema.Struct({ type: Schema.Literal('command_lifecycle'), command_uuid: Schema.String, state: Schema.String });
const decodeLifecycle = Schema.decodeUnknownResult(Lifecycle);

const saidOf = (message: SDKMessage): Said | null => {
  if ((message as { readonly type: string }).type !== 'command_lifecycle') return message;
  const decoded = decodeLifecycle(message);
  return Result.isFailure(decoded) ? null : { type: 'command_lifecycle', uuid: decoded.success.command_uuid, state: decoded.success.state };
};

const Reported = Schema.Struct({ session: Schema.Struct({ total_cost_usd: Schema.Number, model_usage: Schema.Unknown }) });
const decodeReported = Schema.decodeUnknownEffect(Reported);

const absent = (method: string, what: string): AgentFault =>
  new AgentFault({ code: FAULT.methodNotFound, message: `this Claude Code SDK does not offer ${method}, so it cannot ${what}` });

const Limit = Schema.Struct({ utilization: Schema.Finite, resetsAt: Schema.optional(Schema.Finite) });
const RateLimits = Schema.Struct({
  rate_limit_info: Schema.Struct({
    status: Schema.optional(Schema.String),
    unifiedWindows: Schema.optional(Schema.Record(Schema.String, Limit)),
    rateLimitType: Schema.optional(Schema.String),
    utilization: Schema.optional(Schema.Finite),
    resetsAt: Schema.optional(Schema.Finite),
  }),
});
const decodeRateLimits = Schema.decodeUnknownResult(RateLimits);

type Intake = {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly give: (message: SDKUserMessage) => Effect.Effect<void>;
  readonly end: () => void;
};

const intake = (): Intake => {
  const standing: Array<{ readonly message: SDKUserMessage; readonly written: () => void }> = [];
  let pulling: ((read: IteratorResult<SDKUserMessage, undefined>) => void) | null = null;
  let writing: (() => void) | null = null;
  let ended = false;
  const wrote = (): void => {
    const done = writing;
    writing = null;
    done?.();
  };
  const end = (): void => {
    ended = true;
    wrote();
    for (const given of standing.splice(0)) given.written();
    const waiting = pulling;
    pulling = null;
    waiting?.({ value: undefined, done: true });
  };
  const next = (): Promise<IteratorResult<SDKUserMessage, undefined>> => {
    wrote();
    const given = standing.shift();
    if (given !== undefined) {
      writing = given.written;
      return Promise.resolve({ value: given.message, done: false });
    }
    if (ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      pulling = resolve;
    });
  };
  return {
    prompt: { [Symbol.asyncIterator]: () => ({ next, return: () => (end(), Promise.resolve({ value: undefined, done: true })) }) },
    give: (message) =>
      Effect.callback<void>((resume) => {
        const written = () => resume(Effect.void);
        const waiting = pulling;
        if (ended) written();
        else if (waiting === null) standing.push({ message, written });
        else {
          pulling = null;
          writing = written;
          waiting({ value: message, done: false });
        }
      }),
    end,
  };
};

const makeChannel = Effect.fnUntraced(function* ({ query, input }: { readonly query: Query; readonly input: Intake }) {
  const clock = yield* Clock.Clock;
  const unlisted = query as Query & Partial<Unlisted>;
  let closed = false;
  let observed: QuotaObservation | undefined;
  let quotaFailure: string | undefined;
  let rejectedUntil: number | null = null;

  const reported = (message: SDKMessage): void => {
    const decoded = decodeRateLimits(message);
    if (Result.isFailure(decoded)) {
      observed = undefined;
      rejectedUntil = null;
      quotaFailure = 'Claude Code reported subscription limits in a shape this runner cannot read';
      return;
    }
    quotaFailure = undefined;
    const info = decoded.success.rate_limit_info;
    rejectedUntil = info.status === 'rejected' && info.resetsAt !== undefined ? info.resetsAt * 1000 : null;
    const limits =
      info.unifiedWindows ??
      (info.rateLimitType === undefined || info.utilization === undefined
        ? {}
        : { [info.rateLimitType]: { utilization: info.utilization, resetsAt: info.resetsAt } });
    const windows = Object.entries(limits).map(
      ([label, limit]) =>
        new QuotaWindow({
          kind: label === 'five_hour' ? 'session' : label === 'seven_day' ? 'weekly' : 'bucket',
          label,
          usedPercent: limit.utilization * 100,
          resetsAt: limit.resetsAt,
          windowMinutes: label === 'five_hour' ? 300 : label.startsWith('seven_day') ? 10_080 : undefined,
        }),
    );
    observed =
      windows.length === 0
        ? undefined
        : new QuotaObservation({ observedAt: new Date(clock.currentTimeMillisUnsafe()), source: 'reply', windows });
  };

  const channel: Channel = {
    get messages() {
      return {
        async *[Symbol.asyncIterator]() {
          for await (const message of query) {
            if (message.type === 'rate_limit_event') reported(message);
            const said = saidOf(message);
            if (said !== null) yield said;
          }
        },
      };
    },
    models: () =>
      sdkCall('to start', () => query.initializationResult()).pipe(
        Effect.map((initialized) => initialized.models),
        Effect.withSpan('claudeSdk.models'),
      ),
    window: () =>
      sdkCall('its context window', () => query.getContextUsage({ detail: 'summary' })).pipe(
        Effect.map((usage) => usage.maxTokens),
        Effect.withSpan('claudeSdk.window'),
      ),
    send: input.give,
    interrupt: () =>
      sdkCall('the interrupt', () => (query.interrupt as Stopping).call(query, { cancelQueued: true })).pipe(
        Effect.map((receipt) => ({ queued: receipt?.still_queued ?? null, dropped: receipt?.cancelled ?? [] })),
        Effect.withSpan('claudeSdk.interrupt'),
      ),
    withdraw: (uuid) => {
      const withdraw = unlisted.cancelAsyncMessage;
      return withdraw === undefined
        ? Effect.fail(absent('cancelAsyncMessage', 'withdraw a queued message'))
        : sdkCall('to withdraw a queued word', () => withdraw.call(query, uuid)).pipe(Effect.withSpan('claudeSdk.withdraw'));
    },
    setModel: (model) => sdkCall(`the model ${model}`, () => query.setModel(model)).pipe(Effect.withSpan('claudeSdk.setModel')),
    setEffort: (effort) =>
      sdkCall(`the effort ${effort}`, () => query.applyFlagSettings({ effortLevel: effort })).pipe(Effect.withSpan('claudeSdk.setEffort')),
    setThinking: (display) =>
      sdkCall(`the thinking display ${display}`, () => query.setMaxThinkingTokens(null, display)).pipe(
        Effect.withSpan('claudeSdk.setThinking'),
      ),
    autoCompact: (enabled) =>
      sdkCall(enabled ? 'to compact at its next step' : 'to stop compacting on its own', () =>
        query.applyFlagSettings({ autoCompactEnabled: enabled }),
      ).pipe(Effect.withSpan('claudeSdk.autoCompact')),
    sideQuestions: () => {
      const ask = unlisted.askSideQuestion;
      return ask === undefined
        ? Effect.fail(absent('askSideQuestion', 'answer a side question'))
        : Effect.succeed((question: string) =>
            sdkCall('the side question', () => ask.call(query, question)).pipe(Effect.withSpan('claudeSdk.sideQuestion')),
          );
    },
    quota: () => Effect.suspend(() => (quotaFailure === undefined ? Effect.succeed(observed ?? null) : Effect.fail(failed(quotaFailure)))),
    rejectedUntil: () => rejectedUntil,
    reading: Effect.fn('claudeSdk.reading')(function* () {
      if (typeof query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== 'function') return null;
      const answer = yield* sdkCall('its usage', () =>
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      );
      const decoded = yield* decodeReported(answer).pipe(
        Effect.mapError(() => failed('Claude Code answered its usage in a shape this runner cannot read')),
      );
      const reading = readingOf({ total_cost_usd: decoded.session.total_cost_usd, modelUsage: decoded.session.model_usage });
      if (reading === null) return yield* failed('Claude Code answered its usage in a shape this runner cannot read');
      return reading;
    }),
    close: () =>
      Effect.sync(() => {
        if (closed) return;
        closed = true;
        input.end();
        query.close();
      }).pipe(Effect.withSpan('claudeSdk.close')),
  };
  return channel;
});

export const claudeSdk = ({ module }: { readonly module: Module }): ClaudeSdk => ({
  open: Effect.fn('claudeSdk.open')(function* (options: Options) {
    const input = intake();
    const query = yield* Effect.try({
      try: () => module.query({ prompt: input.prompt, options }),
      catch: (cause) => failed(`Claude Code could not start: ${said(cause)}`),
    });
    return yield* makeChannel({ query, input });
  }),
  transcript: async (sessionId: string, dir: string): Promise<ReadonlyArray<Entry>> => module.getSessionMessages(sessionId, { dir }),
});
