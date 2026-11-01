import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import type { HookInput, McpSdkServerConfigWithInstance, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT, type AgentHandlers, type Outlet } from '@runlith/acp/agent';
import { frame } from '@runlith/ndjson-rpc/envelope';
import type { SessionNotification } from '@runlith/acp/updates';
import {
  ASIDE,
  BACKGROUND,
  COMPACT,
  COMPACTED,
  COMPACTING,
  EXECUTES,
  FORK,
  INPUT,
  MEASURED,
  PHASE,
  QUOTA,
  RETRYING,
  SAID,
  STEER,
  UNSTEPPED,
  WITHDRAW,
  type Measured,
} from '@runlith/hosted-runner/wire/extensions';
import type { RequestPermissionParams } from '@runlith/acp/methods';
import type { HostedToolWire } from '@runlith/hosted-runner/wire/messages';
import { claudeAgent, type Launch } from './agent.js';
import { TAGMA_SERVER, servedPrompt } from '@runlith/hosted-runner/bridge';
import type { HostedDoor, HostedOpened } from '@runlith/hosted-runner/door';
import type { Channel, ClaudeSdk, Entry, Interrupted, Said, SideAnswer, ThinkingDisplay } from './channel.js';
import type { Runner } from './runner.js';
import { serveClaude } from './run.js';
import { ZERO, type Reading } from './translate.js';

const MODEL = 'claude-sonnet-x';
const PLAIN = 'claude-plain-x';
const WINDOW = 200_000;
const CANCELLED = -32800;

const usageOf = (input: number, output: number, cost: number) => ({
  total_cost_usd: cost,
  modelUsage: {
    [MODEL]: { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 200_000 },
  },
});

const message = (body: Record<string, unknown>): SDKMessage => ({ session_id: 's', ...body }) as unknown as SDKMessage;

const resultOf = (input: number, output: number, cost: number, extra: Record<string, unknown> = {}): SDKMessage =>
  message({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    result: '',
    uuid: crypto.randomUUID(),
    usage: { input_tokens: input, output_tokens: output },
    ...usageOf(input, output, cost),
    ...extra,
  });

const interrupted = (input: number, output: number, cost: number): SDKMessage =>
  resultOf(input, output, cost, { subtype: 'error_during_execution', is_error: true });

const assistantOf = (uuid: string, words: string, extra: Record<string, unknown> = {}): SDKMessage =>
  message({
    type: 'assistant',
    uuid,
    parent_tool_use_id: null,
    message: { id: `m-${uuid}`, model: MODEL, content: [{ type: 'text', text: words }], usage: { input_tokens: 1, output_tokens: 1 } },
    ...extra,
  });

const echoOf = (uuid: string): SDKMessage =>
  message({
    type: 'user',
    isReplay: true,
    uuid,
    parent_tool_use_id: null,
    message: { role: 'user', content: 'words' },
  });

const booted = (model: string): SDKMessage => message({ type: 'system', subtype: 'init', model });

const boundary = (trigger: string, summary: string): SDKMessage[] => [
  message({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger, pre_tokens: 9000, post_tokens: 1000 } }),
  message({
    type: 'user',
    isSynthetic: true,
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    message: { role: 'user', content: summary },
  }),
];

const text = (value: string) => [{ type: 'text' as const, text: value }];

class Pipe<A> {
  private readonly items: A[] = [];
  private waiting: ((read: IteratorResult<A, void>) => void) | null = null;
  private ended = false;

  push(item: A): void {
    const waiting = this.waiting;
    if (waiting === null) this.items.push(item);
    else {
      this.waiting = null;
      waiting({ value: item, done: false });
    }
  }

  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<A, void>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

type Script = {
  readonly onUser?: (message: SDKUserMessage, channel: ScriptedChannel) => void;
  readonly onInterrupt?: (channel: ScriptedChannel) => Interrupted;
  readonly onWithdrawn?: (channel: ScriptedChannel) => void;
  readonly withdraws?: 'absent' | boolean;
  readonly aside?: () => SideAnswer | null;
  readonly reading?: 'absent' | 'drifted' | (() => Reading);
  readonly quota?: QuotaObservation | 'drifted';
  readonly rejectedUntil?: number;
  readonly closesAtStart?: boolean;
  readonly refuses?: (open: number) => boolean;
  readonly switches?: boolean;
};

const unavailable = (what: string) => new AgentFault({ code: FAULT.methodNotFound, message: `no ${what}` });

type Waiter = { readonly count: number; readonly done: Deferred.Deferred<void> };

const waiting = (waiters: Waiter[], reached: number, count: number): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (reached >= count) return Effect.void;
    const done = Deferred.makeUnsafe<void>();
    waiters.push({ count, done });
    return Deferred.await(done);
  });

const release = (waiters: Waiter[], reached: number): void => {
  for (const waiter of waiters.filter((entry) => reached >= entry.count)) Deferred.doneUnsafe(waiter.done, Effect.void);
};

class ScriptedChannel implements Channel {
  readonly received: SDKUserMessage[] = [];
  readonly switched: boolean[] = [];
  readonly displayed: ThinkingDisplay[] = [];
  closed = false;
  interrupts = 0;
  private readonly out = new Pipe<Said>();
  private readonly waiters: Waiter[] = [];

  constructor(private readonly script: Script) {
    if (script.closesAtStart === true) queueMicrotask(() => this.dies());
  }

  readonly messages: AsyncIterable<Said> = {
    [Symbol.asyncIterator]: () => ({ next: () => this.out.next(), return: async () => (this.out.end(), { value: undefined, done: true }) }),
  };

  emit(...messages: readonly Said[]): void {
    for (const next of messages) this.out.push(next);
  }

  dies(): void {
    this.out.end();
  }

  arrived(count: number): Effect.Effect<void> {
    return waiting(this.waiters, this.received.length, count);
  }

  models: Channel['models'] = () =>
    Effect.succeed([
      { value: MODEL, displayName: 'Sonnet', description: 'scripted' },
      { value: PLAIN, displayName: 'Plain', description: 'scripted', supportsAdaptiveThinking: false },
    ]);

  window: Channel['window'] = () => Effect.succeed(WINDOW);

  send: Channel['send'] = (sent) =>
    Effect.sync(() => {
      this.received.push(sent);
      release(this.waiters, this.received.length);
      this.script.onUser?.(sent, this);
    });

  interrupt: Channel['interrupt'] = () =>
    Effect.sync(() => {
      this.interrupts += 1;
      return this.script.onInterrupt?.(this) ?? { queued: [], dropped: [] };
    });

  withdraw: Channel['withdraw'] = () => {
    const withdraws = this.script.withdraws;
    if (withdraws === 'absent') return Effect.fail(unavailable('withdrawal'));
    return Effect.sync(() => {
      const done = withdraws ?? true;
      if (done) this.script.onWithdrawn?.(this);
      return done;
    });
  };

  setModel: Channel['setModel'] = () => Effect.void;

  setEffort: Channel['setEffort'] = () => Effect.void;

  setThinking: Channel['setThinking'] = (display) => Effect.sync(() => void this.displayed.push(display));

  autoCompact: Channel['autoCompact'] = (enabled) =>
    this.script.switches === false
      ? Effect.fail(new AgentFault({ code: FAULT.internal, message: 'no flag settings' }))
      : Effect.sync(() => void this.switched.push(enabled));

  sideQuestions: Channel['sideQuestions'] = () => {
    const aside = this.script.aside;
    return aside === undefined ? Effect.fail(unavailable('side question')) : Effect.succeed(() => Effect.succeed(aside()));
  };

  reading: Channel['reading'] = () => {
    const reading = this.script.reading;
    if (reading === 'absent') return Effect.succeed(null);
    if (reading === 'drifted') return Effect.fail(new AgentFault({ code: FAULT.internal, message: 'unreadable usage' }));
    return Effect.sync(() => (reading === undefined ? ZERO : reading()));
  };

  quota: Channel['quota'] = () =>
    this.script.quota === 'drifted'
      ? Effect.fail(new AgentFault({ code: FAULT.internal, message: 'unreadable quota' }))
      : Effect.succeed(this.script.quota ?? null);

  rejectedUntil: Channel['rejectedUntil'] = () => this.script.rejectedUntil ?? null;

  close: Channel['close'] = () =>
    Effect.sync(() => {
      this.closed = true;
      this.out.end();
    });
}

type History = ReadonlyArray<Entry>;

class ScriptedSdk implements ClaudeSdk {
  readonly opened: Array<{ readonly options: Options; readonly channel: ScriptedChannel }> = [];

  constructor(
    private readonly script: Script,
    private readonly entries: History = [],
  ) {}

  open: ClaudeSdk['open'] = (options) => {
    if (this.script.refuses?.(this.opened.length) === true)
      return Effect.fail(new AgentFault({ code: FAULT.internal, message: 'claude would not start' }));
    return Effect.sync(() => {
      const channel = new ScriptedChannel(this.script);
      this.opened.push({ options, channel });
      return channel;
    });
  };

  transcript: ClaudeSdk['transcript'] = async () => this.entries;

  get first(): ScriptedChannel {
    return this.opened[0]!.channel;
  }
}

class ScriptedDoor implements HostedDoor {
  private turns = 0;

  constructor(
    private readonly prompted: string,
    private readonly opening: readonly HostedOpened[],
    private readonly offered: readonly HostedToolWire[] = [],
    private readonly web: HostedOpened['web'] = opening[0]?.web ?? 'none',
  ) {}

  held: readonly string[] = [];

  agent: HostedDoor['agent'] = () => Effect.succeed({ prompt: this.prompted, web: this.web });

  tools: HostedDoor['tools'] = () => Effect.succeed({ tools: this.offered, names: this.held, dispatch: false });

  history: HostedDoor['history'] = () => Effect.succeed([]);

  turn: HostedDoor['turn'] = () => {
    const opened = this.opening[Math.min(this.turns, this.opening.length - 1)] ?? { context: null, prompt: null, web: 'vendor' as const };
    this.turns += 1;
    return Effect.succeed(opened);
  };

  call: HostedDoor['call'] = () => Effect.fail(new AgentFault({ code: FAULT.internal, message: 'no tool is called through this door' }));
}

const steady = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'vendor' }]);

const LAUNCH: Launch = { model: null, effort: null, version: '1', titled: false };

const machine = (deaths: string[]): Runner => ({
  claude: '/bin/claude',
  version: () => '2.1.292',
  stderr: () => {},
  died: (reason) => Effect.sync(() => void deaths.push(reason)),
});

type Options_ = { readonly door?: HostedDoor; readonly transcript?: History; readonly request?: Outlet['request'] };

const agent = Effect.fnUntraced(function* (script: Script, options: Options_ = {}) {
  const deaths: string[] = [];
  const updates: SessionNotification[] = [];
  const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
  const notices: Array<{ readonly method: string; readonly params: unknown }> = [];
  const phases: string[] = [];
  const noticed: Waiter[] = [];
  const updated: Waiter[] = [];
  const outlet: Outlet = {
    update: (update) =>
      Effect.sync(() => {
        updates.push(update);
        release(updated, updates.length);
      }),
    notify: (method, params) =>
      Effect.sync(() => {
        if (method === PHASE) return void phases.push((params as { readonly phase: string }).phase);
        notices.push({ method, params });
        release(noticed, notices.length);
      }),
    request: (method, params) => {
      requests.push({ method, params });
      return options.request?.(method, params) ?? Effect.fail(new AgentFault({ code: FAULT.internal, message: 'no client' }));
    },
  };
  const sdk = new ScriptedSdk(script, options.transcript);
  const handlers: AgentHandlers<never> = yield* Effect.acquireRelease(
    Effect.succeed(claudeAgent(sdk, options.door ?? steady, machine(deaths), LAUNCH)(outlet)),
    (standing) => standing.ended,
  );
  const heard = (count: number) => waiting(noticed, notices.length, count);
  const saw = (count: number) => waiting(updated, updates.length, count);
  return { handlers, sdk, deaths, updates, requests, notices, phases, heard, saw };
});

const open = Effect.fnUntraced(function* (script: Script, options: Options_ = {}) {
  const built = yield* agent(script, options);
  const { handlers } = built;
  const created = yield* handlers.newSession({ cwd: '/work', mcpServers: [] });
  const sessionId = created.sessionId;
  const prompt = (words: string, meta?: Record<string, unknown>) => handlers.prompt({ sessionId, prompt: text(words), _meta: meta });
  const refusedPrompt = (words: string) => Effect.flip(handlers.prompt({ sessionId, prompt: text(words) }));
  const extension = (method: string, params: Record<string, unknown>) => handlers.extensions[method]!({ sessionId, ...params });
  const refused = (method: string, params: Record<string, unknown>) =>
    Effect.flip(handlers.extensions[method]!({ sessionId, ...params }) as Effect.Effect<unknown, AgentFault>);
  const cancel = () => handlers.cancel({ sessionId });
  return { ...built, sessionId, prompt, refusedPrompt, extension, refused, cancel };
});

const started = <A, E>(work: Effect.Effect<A, E>) => Effect.forkChild(work);

describe('a prompt', () => {
  it.live.each([
    { content: null },
    { content: [{ type: 'text', text: 7 }] },
    { content: [{ type: 'thinking', thinking: 7 }] },
    { content: [{ type: 'tool_use', name: 'read', input: {} }] },
  ])('an unreadable assistant body refuses the prompt instead of completing it with lost content: %j', ({ content }) =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            message({ type: 'assistant', uuid: 'unreadable', parent_tool_use_id: null, message: { id: 'broken', content } }),
            resultOf(1, 1, 0.1),
          ),
      });
      expect((yield* session.refusedPrompt('one')).code).toBe(FAULT.internal);
    }),
  );

  it.live('answers its stop reason, the turn spend as the difference of the cumulative usage, and the ids of the turn', () =>
    Effect.gen(function* () {
      const totals = [usageOf(100, 20, 0.5), usageOf(160, 50, 0.75)];
      const session = yield* open({
        onUser: (_, channel) => {
          const turn = channel.received.length;
          channel.emit(assistantOf(`a${turn}`, 'done'), resultOf(0, 0, 0, totals[turn - 1]));
        },
      });
      const turn = crypto.randomUUID();
      const first = yield* session.prompt('one', { 'tagma/turn': turn });
      expect(first).toMatchObject({
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        _meta: { 'tagma/turn': { prompt: turn, last: 'a1' }, 'tagma/cost': { amount: 0.5, currency: 'USD' }, 'tagma/opened': true },
      });
      expect(session.sdk.first.received[0]?.uuid).toBe(turn);

      const second = yield* session.prompt('two');
      expect(second).toMatchObject({
        stopReason: 'end_turn',
        usage: { inputTokens: 60, outputTokens: 30, totalTokens: 90 },
        _meta: { 'tagma/turn': { prompt: session.sdk.first.received[1]?.uuid, last: 'a2' }, 'tagma/cost': { amount: 0.25 } },
      });
    }),
  );

  it.live('cancelled while Tagma has not opened it yet answers cancelled and gives Claude Code nothing', () =>
    Effect.gen(function* () {
      const reached = yield* Deferred.make<void>();
      const unopened = new ScriptedDoor('v1', []);
      unopened.turn = () => Effect.andThen(Deferred.succeed(reached, undefined), Effect.never);
      const session = yield* open({}, { door: unopened });
      const running = yield* started(session.prompt('one'));
      yield* Deferred.await(reached);
      yield* session.cancel();
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      expect(session.sdk.opened.flatMap((one) => one.channel.received)).toEqual([]);
    }),
  );

  it.live('is refused while another turn runs in the session', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      expect((yield* session.refusedPrompt('two')).code).toBe(FAULT.invalidRequest);
      session.sdk.first.emit(resultOf(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('fails as a sign-in required when Claude Code reports it is not authenticated', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            assistantOf('a1', 'Invalid API key', { error: 'authentication_failed' }),
            resultOf(1, 1, 0.1, { is_error: true, result: 'Invalid API key' }),
          ),
      });
      expect((yield* session.refusedPrompt('one')).code).toBe(FAULT.authRequired);
    }),
  );

  it.live('a turn Claude Code aborted on its own answers cancelled, not a failure', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(resultOf(1, 1, 0.1, { subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' })),
      });
      expect((yield* session.prompt('one')).stopReason).toBe('cancelled');
    }),
  );

  it.live('a turn whose output limit outlasted Claude Code’s own continuations answers max_tokens, not a transport failure', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            assistantOf('a1', "API Error: Claude's response exceeded the 32000 output token maximum.", { error: 'max_output_tokens' }),
            resultOf(1, 1, 0.1, { is_error: true, terminal_reason: 'api_error', stop_reason: 'stop_sequence' }),
          ),
      });
      expect((yield* session.prompt('one')).stopReason).toBe('max_tokens');
    }),
  );

  it.live('a rate-limited turn fails with the provider class, its HTTP status and the wait until the rejected window resets', () =>
    Effect.gen(function* () {
      const resets = (yield* Clock.currentTimeMillis) + 600_000;
      const session = yield* open({
        rejectedUntil: resets,
        onUser: (_, channel) =>
          channel.emit(
            message({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }),
            assistantOf('a1', 'Rate limited', { error: 'rate_limit' }),
            resultOf(1, 1, 0.1, { is_error: true, result: 'Rate limited', api_error_status: 429 }),
          ),
      });
      const fault = yield* session.refusedPrompt('one');
      const failure = (fault.data as Record<string, { readonly rateLimit?: { readonly retryAfterMs?: number } }>)['tagma/failure'];
      expect(failure).toMatchObject({
        stage: 'claude-code.turn',
        type: 'RateLimit',
        httpStatus: 429,
        retryable: true,
        modelStarted: false,
        reason: { family: 'rate-limit', status: 429 },
      });
      expect(failure?.rateLimit?.retryAfterMs).toBeGreaterThan(590_000);
      expect(failure?.rateLimit?.retryAfterMs).toBeLessThanOrEqual(600_000);
    }),
  );

  it.live(
    'after a resume or a fork the first turn claims neither rest nor cost, since the cumulative baseline is unknown; the next one a difference',
    () =>
      Effect.gen(function* () {
        const built = yield* agent(
          {
            onUser: (_, channel) =>
              channel.emit(
                resultOf(7, 3, 5 + channel.received.length, {
                  modelUsage: usageOf(1000 * channel.received.length, 500, 5 + channel.received.length).modelUsage,
                }),
              ),
          },
          {
            transcript: [
              { type: 'user', uuid: 'u1' },
              { type: 'assistant', uuid: 'a1' },
              { type: 'user', uuid: 'u2' },
            ],
          },
        );
        const { handlers } = built;
        yield* handlers.loadSession!({ sessionId: 'earlier', cwd: '/work', mcpServers: [] });
        const resumed = yield* handlers.prompt({ sessionId: 'earlier', prompt: text('one') });
        expect(resumed.usage).toBeUndefined();
        expect(Object.keys(resumed._meta ?? {})).toEqual(['tagma/turn', 'tagma/opened']);
        const next = yield* handlers.prompt({ sessionId: 'earlier', prompt: text('two') });
        expect(next._meta).toMatchObject({ 'tagma/cost': { currency: 'USD' } });

        const forked = (yield* handlers.extensions[FORK]!({ sessionId: 'earlier', turn: 'u2' }) as Effect.Effect<
          { readonly sessionId: string },
          AgentFault
        >).sessionId;
        const first = yield* handlers.prompt({ sessionId: forked, prompt: text('three') });
        expect(first.usage).toBeUndefined();
        expect(Object.keys(first._meta ?? {})).toEqual(['tagma/turn', 'tagma/opened']);
      }),
  );
});

it.live('a subscription observation reaches ACP without making the model turn depend on quota availability', () =>
  Effect.gen(function* () {
    const observation = new QuotaObservation({
      observedAt: new Date('2026-10-11T12:00:00Z'),
      source: 'reply',
      windows: [new QuotaWindow({ kind: 'session', usedPercent: 42 })],
    });
    const session = yield* open({
      quota: observation,
      onUser: (_, channel) =>
        channel.emit(message({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), resultOf(1, 1, 0.1)),
    });
    expect((yield* session.prompt('one')).stopReason).toBe('end_turn');
    expect(session.notices.find((notice) => notice.method === QUOTA)?.params).toMatchObject({
      sessionId: session.sessionId,
      observation: { observedAt: '2026-10-11T12:00:00.000Z', windows: [{ usedPercent: 42 }] },
    });
    const failedQuota = yield* open({
      quota: 'drifted',
      onUser: (_, channel) =>
        channel.emit(message({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), resultOf(1, 1, 0.1)),
    });
    expect((yield* failedQuota.prompt('two')).stopReason).toBe('end_turn');
    expect(failedQuota.notices.find((notice) => notice.method === QUOTA)?.params).toMatchObject({ failure: { _tag: 'invalid-response' } });
  }),
);

describe('a session', () => {
  it.live('ends with the Claude Code process: the running prompt fails and the runner is told', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.refusedPrompt('one'));
      yield* session.sdk.first.arrived(1);
      session.sdk.first.dies();
      expect((yield* Fiber.join(running)).code).toBe(FAULT.internal);
      yield* settled(() => session.deaths.length === 1);
      expect(session.deaths).toHaveLength(1);
      expect((yield* session.refusedPrompt('two')).code).toBe(FAULT.internal);
    }),
  );

  it.live('opens the next session on the model and effort chosen last, and on the model Claude Code reported', () =>
    Effect.gen(function* () {
      const session = yield* open({ onUser: (_, channel) => channel.emit(booted('claude-served-x'), resultOf(1, 1, 0.1)) });
      yield* session.prompt('one');
      yield* session.handlers.newSession({ cwd: '/work', mcpServers: [] });
      expect(session.sdk.opened[1]!.options.model).toBe('claude-served-x');
      const next = yield* session.handlers.newSession({ cwd: '/work', mcpServers: [] });
      const chosen = yield* session.handlers.configure!({ sessionId: next.sessionId, configId: 'effort', value: 'low' });
      expect(chosen.configOptions.find((option) => option.id === 'effort')).toMatchObject({ currentValue: 'low' });
      yield* session.handlers.newSession({ cwd: '/work', mcpServers: [] });
      expect(session.sdk.opened[3]!.options.effort).toBe('low');
    }),
  );

  it.live('shows the thinking summary the session chose, in the live query and in every query it opens next', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      expect(session.sdk.opened[0]!.options.thinking).toBeUndefined();
      const chosen = yield* session.handlers.configure!({ sessionId: session.sessionId, configId: 'thinking', value: 'summarized' });
      expect(chosen.configOptions.find((option) => option.id === 'thinking')).toMatchObject({ currentValue: 'summarized' });
      expect(session.sdk.first.displayed).toEqual(['summarized']);
      expect(session.sdk.opened).toHaveLength(1);
      yield* session.handlers.newSession({ cwd: '/work', mcpServers: [] });
      expect(session.sdk.opened.at(-1)!.options.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    }),
  );

  it.live('puts the chosen thinking summary back when it moves from a model without adaptive thinking to one with it', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const configure = (sessionId: string, configId: string, value: string) => session.handlers.configure!({ sessionId, configId, value });
      yield* configure(session.sessionId, 'thinking', 'summarized');
      const plain = yield* configure(session.sessionId, 'model', PLAIN);
      expect(plain.configOptions.find((option) => option.id === 'thinking')).toBeUndefined();
      const next = yield* session.handlers.newSession({ cwd: '/work', mcpServers: [] });
      const reopened = session.sdk.opened.at(-1)!;
      expect(reopened.options.thinking).toBeUndefined();
      const back = yield* configure(next.sessionId, 'model', MODEL);
      expect(reopened.channel.displayed).toEqual(['summarized']);
      expect(back.configOptions.find((option) => option.id === 'thinking')).toMatchObject({ currentValue: 'summarized' });
    }),
  );

  it.live('refuses an effort Claude Code does not have', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const fault = yield* Effect.flip(session.handlers.configure!({ sessionId: session.sessionId, configId: 'effort', value: 'extreme' }));
      expect(fault.code).toBe(FAULT.invalidParams);
    }),
  );
});

const streamed = (event: Record<string, unknown>): SDKMessage =>
  message({ type: 'stream_event', parent_tool_use_id: null, uuid: crypto.randomUUID(), event });

const requested = (
  input: number,
  read: number,
  written: { readonly fiveMinutes: number; readonly hour: number },
  output: number,
  thinking: number,
): SDKMessage[] => [
  streamed({
    type: 'message_start',
    message: {
      id: `m-${crypto.randomUUID()}`,
      usage: {
        input_tokens: input,
        output_tokens: 1,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: written.fiveMinutes + written.hour,
        cache_creation: { ephemeral_5m_input_tokens: written.fiveMinutes, ephemeral_1h_input_tokens: written.hour },
      },
    },
  }),
  streamed({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: output, output_tokens_details: { thinking_tokens: thinking } },
  }),
  streamed({ type: 'message_stop' }),
];

const toolResult = (id: string): SDKMessage =>
  message({
    type: 'user',
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  });

type Reading_ = { readonly used: number; readonly size: number; readonly measured: Measured };

const readingsOf = (updates: readonly SessionNotification[]): readonly Reading_[] =>
  updates.flatMap(({ update }) =>
    update.sessionUpdate === 'usage_update'
      ? [{ used: update.used, size: update.size, measured: (update._meta as Readonly<Record<string, Measured>>)[MEASURED]! }]
      : [],
  );

const settled = Effect.fnUntraced(function* (look: () => boolean) {
  while (!look()) yield* Effect.sleep(2);
});

describe('a model request', () => {
  it.effect(
    'is measured as it ends: the context it filled, the window, its usage, when its input was handed over and the cache lifetime it wrote',
    () =>
      Effect.gen(function* () {
        const session = yield* open({});
        const running = yield* started(session.prompt('one'));
        yield* session.sdk.first.arrived(1);
        session.sdk.first.emit(echoOf(session.sdk.first.received[0]!.uuid!), ...requested(10, 0, { fiveMinutes: 0, hour: 900 }, 50, 20));
        yield* session.saw(1);
        yield* TestClock.adjust(1);
        const handed = yield* Clock.currentTimeMillis;
        session.sdk.first.emit(toolResult('t1'), ...requested(5, 910, { fiveMinutes: 0, hour: 0 }, 30, 0), resultOf(1, 1, 0.1));
        yield* Fiber.join(running);
        const [first, second] = readingsOf(session.updates);
        expect(first).toMatchObject({
          used: 960,
          size: WINDOW,
          measured: { input: 910, cacheRead: 0, cacheWrite: 900, output: 50, reasoning: 20, ttlSeconds: 3_600 },
        });
        expect(second).toMatchObject({
          used: 945,
          size: WINDOW,
          measured: { input: 915, cacheRead: 910, cacheWrite: 0, output: 30, ttlSeconds: 3_600 },
        });
        expect(Date.parse(first!.measured.sentAt)).toBeLessThan(handed);
        expect(Date.parse(second!.measured.sentAt)).toBeGreaterThanOrEqual(handed);
      }),
  );

  it.live('takes the shortest cache lifetime the request wrote', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) => channel.emit(...requested(10, 0, { fiveMinutes: 100, hour: 900 }, 5, 0), resultOf(1, 1, 0.1)),
      });
      yield* session.prompt('one');
      expect(readingsOf(session.updates)[0]?.measured.ttlSeconds).toBe(300);
    }),
  );
});

describe('the phase of a turn', () => {
  it.live('follows the main agent through thinking, writing, a tool, a retry and compaction, and ignores a subagent', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            echoOf(channel.received.at(-1)!.uuid!),
            streamed({ type: 'message_start', message: { id: 'm1' } }),
            streamed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
            streamed({ type: 'content_block_stop', index: 0 }),
            streamed({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
            message({
              type: 'stream_event',
              parent_tool_use_id: 'sub',
              uuid: 'sub-1',
              event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
            }),
            streamed({ type: 'content_block_stop', index: 1 }),
            streamed({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'read', input: {} } }),
            streamed({ type: 'content_block_stop', index: 2 }),
            streamed({ type: 'message_stop' }),
            toolResult('t1'),
            message({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 1, error_status: 529 }),
            message({ type: 'system', subtype: 'status', status: 'compacting' }),
            ...boundary('auto', 'Summary.'),
            streamed({ type: 'message_start', message: { id: 'm2' } }),
            streamed({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
            streamed({ type: 'content_block_stop', index: 0 }),
            streamed({ type: 'message_stop' }),
            resultOf(1, 1, 0.1),
          ),
      });
      yield* session.prompt('one');
      expect(session.phases).toEqual([
        'calling',
        'reasoning',
        'calling',
        'writing',
        'calling',
        'tools',
        'calling',
        'retrying',
        'compacting',
        'calling',
        'writing',
        'calling',
      ]);
    }),
  );
});

describe('a request in work', () => {
  it.live('reports a retry with its family, the input the model writes in block order, and nothing of a subagent', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            message({
              type: 'system',
              subtype: 'api_retry',
              uuid: 'r1',
              attempt: 1,
              max_retries: 10,
              retry_delay_ms: 500,
              error_status: 529,
              error: 'overloaded',
            }),
            message({
              type: 'system',
              subtype: 'api_retry',
              uuid: 'r2',
              attempt: 2,
              max_retries: 10,
              retry_delay_ms: 900,
              error_status: null,
              error: 'unknown',
            }),
            streamed({ type: 'message_start', message: { id: 'm1' } }),
            streamed({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 't1', name: 'mcp__tagma__read', input: {} },
            }),
            message({
              type: 'stream_event',
              parent_tool_use_id: 'sub',
              uuid: 'sub-1',
              event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"x' } },
            }),
            streamed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path"' } }),
            streamed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"a"}' } }),
            resultOf(1, 1, 0.1),
          ),
      });
      yield* session.prompt('one');
      expect(session.notices.filter(({ method }) => method === RETRYING).map(({ params }) => params)).toMatchObject([
        { uuid: 'r1', attempt: 1, of: 10, delayMs: 500, family: 'overloaded', httpStatus: 529 },
        { uuid: 'r2', attempt: 2, family: 'connect-timeout', httpStatus: null },
      ]);
      expect(session.notices.filter(({ method }) => method === INPUT).map(({ params }) => params)).toMatchObject([
        { toolCallId: 't1', name: 'read', delta: '' },
        { toolCallId: 't1', name: 'read', delta: '{"path"' },
        { toolCallId: 't1', name: 'read', delta: ':"a"}' },
      ]);
    }),
  );
});

describe('serving a client', () => {
  const frames = [
    frame({ _tag: 'Request', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } }),
    frame({ _tag: 'Request', id: 2, method: 'session/new', params: { cwd: '/work', mcpServers: [] } }),
  ].map((line) => new TextEncoder().encode(line));

  const serving = (script: Script, input: Stream.Stream<Uint8Array, never>) =>
    serveClaude(
      input,
      () => Effect.void,
      new ScriptedSdk(script),
      steady,
      { claude: '/bin/claude', version: () => '2.1.292', stderr: () => {} },
      LAUNCH,
    );

  it.live('fails once Claude Code is gone, so the process ends non-zero and its driver sees it die', () =>
    Effect.gen(function* () {
      const fault = yield* Effect.flip(serving({ closesAtStart: true }, Stream.concat(Stream.fromIterable(frames), Stream.never)));
      expect(fault).toMatchObject({ _tag: 'AgentFault', code: FAULT.internal });
    }),
  );

  it.live('ends cleanly when the client closes its input', () => serving({}, Stream.fromIterable(frames)));
});

describe('steer', () => {
  it.live('is injected when Claude Code echoes the words into the running turn', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const steering = yield* started(session.extension(STEER, { prompt: text('more') }));
      yield* session.sdk.first.arrived(2);
      const sent = session.sdk.first.received[1]!;
      expect(sent.priority).toBe('next');
      session.sdk.first.emit(echoOf(sent.uuid!));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'injected' });
      session.sdk.first.emit(resultOf(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('starts a new turn of the same prompt when the words come after the last step', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const steering = yield* started(session.extension(STEER, { prompt: text('more') }));
      yield* session.sdk.first.arrived(2);
      session.sdk.first.emit(resultOf(1, 1, 0.1), echoOf(session.sdk.first.received[1]!.uuid!));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'startedNewTurn' });
      session.sdk.first.emit(resultOf(2, 2, 0.2));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('asks for a prompt when no turn is running', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      expect(yield* session.extension(STEER, { prompt: text('more') })).toEqual({ outcome: 'promptRequired' });
    }),
  );

  it.live('given while the query reopens for the turn reaches Claude Code once, right after the prompt', () =>
    Effect.gen(function* () {
      const replacing = yield* Deferred.make<void>();
      const resumed = yield* Deferred.make<void>();
      const session = yield* open({}, { door: new ScriptedDoor('v1', [{ context: null, prompt: 'v2', web: 'vendor' }]) });
      const original = session.sdk.open;
      session.sdk.open = (options) =>
        original(options).pipe(Effect.tap(() => Effect.andThen(Deferred.succeed(replacing, undefined), Deferred.await(resumed))));
      const running = yield* started(session.prompt('one'));
      yield* Deferred.await(replacing);
      const steering = yield* Effect.forkChild(session.extension(STEER, { prompt: text('more') }), { startImmediately: true });
      yield* Deferred.succeed(resumed, undefined);
      const [before, after] = session.sdk.opened;
      yield* after!.channel.arrived(2);
      expect(after!.channel.received.map((sent) => [sent.message.content, sent.priority])).toEqual([
        [text('one'), undefined],
        [text('more'), 'next'],
      ]);
      after!.channel.emit(echoOf(after!.channel.received[1]!.uuid!), resultOf(1, 1, 0.1));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'injected' });
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
      expect(before!.channel.received).toEqual([]);
      expect(after!.channel.received).toHaveLength(2);
    }),
  );
});

describe('withdraw', () => {
  it.live('takes back words Claude Code has not read: their steer fails with -32800 and a turn that only waited on them ends', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const input = crypto.randomUUID();
      const steering = yield* started(session.refused(STEER, { prompt: text('more'), input }));
      yield* session.sdk.first.arrived(2);
      expect(session.sdk.first.received[1]!.uuid).toBe(input);
      session.sdk.first.emit(resultOf(1, 1, 0.1, { queued_turn_count: 1 }));
      expect(yield* session.extension(WITHDRAW, { input })).toEqual({ withdrawn: true });
      expect((yield* Fiber.join(steering)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('takes back operator words the host names by their inbox id, which is no uuid', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const input = `input:reader:${crypto.randomUUID()}`;
      const steering = yield* started(session.refused(STEER, { prompt: text('more'), input }));
      yield* session.sdk.first.arrived(2);
      session.sdk.first.emit(resultOf(1, 1, 0.1, { queued_turn_count: 1 }));
      expect(yield* session.extension(WITHDRAW, { input })).toEqual({ withdrawn: true });
      expect((yield* Fiber.join(steering)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('fails with the channel fault when Claude Code offers no way to take words back, and the steer still waits for its echo', () =>
    Effect.gen(function* () {
      const session = yield* open({ withdraws: 'absent' });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const input = crypto.randomUUID();
      const steering = yield* started(session.extension(STEER, { prompt: text('more'), input }));
      yield* session.sdk.first.arrived(2);
      expect((yield* session.refused(WITHDRAW, { input })).code).toBe(FAULT.methodNotFound);
      session.sdk.first.emit(echoOf(input));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'injected' });
      session.sdk.first.emit(resultOf(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('answers that nothing was taken back when Claude Code already holds the words, and the steer is still injected', () =>
    Effect.gen(function* () {
      const session = yield* open({ withdraws: false });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const input = crypto.randomUUID();
      const steering = yield* started(session.extension(STEER, { prompt: text('more'), input }));
      yield* session.sdk.first.arrived(2);
      expect(yield* session.extension(WITHDRAW, { input })).toEqual({ withdrawn: false });
      session.sdk.first.emit(echoOf(input));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'injected' });
      session.sdk.first.emit(resultOf(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );
});

describe('cancel', () => {
  const steersOf = (channel: ScriptedChannel) => channel.received.flatMap((sent) => (sent.priority === 'next' ? [sent.uuid!] : []));
  const queuing = (channel: ScriptedChannel): Interrupted => {
    if (channel.interrupts > 1) return { queued: [], dropped: [] };
    channel.emit(interrupted(1, 1, 0.1));
    return { queued: steersOf(channel), dropped: [] };
  };
  const commanded = (uuid: string, state: string): Said => ({ type: 'command_lifecycle', uuid, state });

  it.live('ends the turn as cancelled and fails the steer of the words Claude Code dropped with -32800', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onInterrupt: (channel) => {
          channel.emit(interrupted(1, 1, 0.1));
          return { queued: [], dropped: steersOf(channel) };
        },
        withdraws: 'absent',
      });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const steering = yield* started(session.refused(STEER, { prompt: text('more') }));
      yield* session.sdk.first.arrived(2);
      yield* session.cancel();
      expect((yield* Fiber.join(steering)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
    }),
  );

  it.live('takes back one by one the queued words Claude Code does not drop itself, failing their steer with -32800', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onInterrupt: (channel) => ({ queued: steersOf(channel), dropped: [] }),
        onWithdrawn: (channel) => channel.emit(interrupted(1, 1, 0.1)),
      });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const steering = yield* started(session.refused(STEER, { prompt: text('more') }));
      yield* session.sdk.first.arrived(2);
      yield* session.cancel();
      expect((yield* Fiber.join(steering)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
    }),
  );

  it.live(
    'incident 2026-10-21: words Claude Code could not take back start a turn of their own, which is interrupted as it starts, and the prompt answers cancelled',
    () =>
      Effect.gen(function* () {
        const session = yield* open({ withdraws: false, onInterrupt: queuing });
        const channel = session.sdk.first;
        const running = yield* started(session.prompt('one'));
        yield* channel.arrived(1);
        const steering = yield* started(session.extension(STEER, { prompt: text('more') }));
        yield* channel.arrived(2);
        yield* session.cancel();
        const word = channel.received[1]!.uuid!;
        channel.emit(commanded(word, 'started'));
        yield* settled(() => channel.interrupts === 2);
        expect(channel.interrupts).toBe(2);
        channel.emit(echoOf(word), resultOf(5, 5, 0.3));
        expect(yield* Fiber.join(steering)).toEqual({ outcome: 'startedNewTurn' });
        expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      }),
  );

  for (const withdraws of ['absent', false] as const) {
    it.live(
      `on a Claude Code that neither drops queued words nor reports command starts, words ${withdraws === 'absent' ? 'it offers no withdrawal for' : 'it finds no longer queued'} hold the answer until their echo, whose turn is interrupted`,
      () =>
        Effect.gen(function* () {
          const session = yield* open({ withdraws, onInterrupt: queuing });
          const channel = session.sdk.first;
          const running = yield* started(session.prompt('one'));
          yield* channel.arrived(1);
          const steering = yield* started(session.extension(STEER, { prompt: text('more') }));
          yield* channel.arrived(2);
          yield* session.cancel();
          channel.emit(echoOf(channel.received[1]!.uuid!));
          yield* settled(() => channel.interrupts === 2);
          expect(channel.interrupts).toBe(2);
          channel.emit(interrupted(5, 5, 0.3));
          expect(yield* Fiber.join(steering)).toEqual({ outcome: 'startedNewTurn' });
          expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
        }),
    );
  }

  it.live('between two turns of Claude Code interrupts it, and the words it then drops fail with -32800', () =>
    Effect.gen(function* () {
      const session = yield* open({ onInterrupt: (channel) => ({ queued: [], dropped: steersOf(channel) }) });
      const channel = session.sdk.first;
      const running = yield* started(session.prompt('one'));
      yield* channel.arrived(1);
      const steering = yield* started(session.refused(STEER, { prompt: text('more') }));
      yield* channel.arrived(2);
      channel.emit(resultOf(1, 1, 0.1), message({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }));
      yield* session.heard(1);
      yield* session.cancel();
      expect(channel.interrupts).toBe(1);
      expect((yield* Fiber.join(steering)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
    }),
  );

  it.live('interrupts Claude Code again when repeated', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const channel = session.sdk.first;
      const running = yield* started(session.prompt('one'));
      yield* channel.arrived(1);
      yield* session.cancel();
      yield* session.cancel();
      expect(channel.interrupts).toBe(2);
      channel.emit(interrupted(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
    }),
  );

  it.live('a prompt Claude Code starts only after the interrupt is interrupted as it starts', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const channel = session.sdk.first;
      const running = yield* started(session.prompt('one'));
      yield* channel.arrived(1);
      yield* session.cancel();
      channel.emit(commanded(channel.received[0]!.uuid!, 'started'));
      yield* settled(() => channel.interrupts === 2);
      expect(channel.interrupts).toBe(2);
      channel.emit(interrupted(1, 1, 0.1));
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
    }),
  );

  it.live('of a prompt Claude Code dropped before starting it answers at once, without saying the opening reached it', () =>
    Effect.gen(function* () {
      const session = yield* open({ onInterrupt: (channel) => ({ queued: [], dropped: [channel.received[0]!.uuid!] }) });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      yield* session.cancel();
      const answered = yield* Fiber.join(running);
      expect(answered).toMatchObject({ stopReason: 'cancelled' });
      expect(answered._meta).not.toHaveProperty('tagma/opened');
    }),
  );

  it.live('that Claude Code cannot carry out closes the query and still answers the prompt cancelled', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const channel = session.sdk.first;
      channel.interrupt = () => Effect.fail(new AgentFault({ code: FAULT.internal, message: 'interrupt refused' }));
      const running = yield* started(session.prompt('one'));
      yield* channel.arrived(1);
      yield* session.cancel();
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      expect(channel.closed).toBe(true);
      expect(session.deaths).toHaveLength(1);
    }),
  );

  it.live('while Claude Code has not listed the changed tools again answers at once and gives Claude Code nothing', () =>
    Effect.gen(function* () {
      const revealed: HostedToolWire = { name: 'read_thread_record', description: 'Expand evidence.', inputSchema: {}, mutates: false };
      const session = yield* open({}, { door: new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'vendor' }], [revealed]) });
      const server = yield* ownServer(session.sdk.opened[0]!.options);
      const running = yield* started(session.prompt('one'));
      yield* settled(() => server.told.includes('notifications/tools/list_changed'));
      yield* session.cancel();
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      expect(session.sdk.first.received).toEqual([]);
      const next = yield* Effect.forkChild(session.prompt('two'), { startImmediately: true });
      expect(session.sdk.first.received).toEqual([]);
      yield* server.list();
      yield* session.sdk.first.arrived(1);
      session.sdk.first.emit(resultOf(1, 1, 0.1));
      expect((yield* Fiber.join(next)).stopReason).toBe('end_turn');
    }),
  );

  it.live('while the query reopens answers at once, and the next prompt goes to the reopened query', () =>
    Effect.gen(function* () {
      const replacing = yield* Deferred.make<void>();
      const resumed = yield* Deferred.make<void>();
      const door = new ScriptedDoor('v1', [{ context: null, prompt: 'v2', web: 'vendor' }]);
      const session = yield* open({ onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) }, { door });
      const original = session.sdk.open;
      session.sdk.open = (options) =>
        original(options).pipe(Effect.tap(() => Effect.andThen(Deferred.succeed(replacing, undefined), Deferred.await(resumed))));
      const running = yield* started(session.prompt('one'));
      yield* Deferred.await(replacing);
      yield* session.cancel();
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      yield* Deferred.succeed(resumed, undefined);
      expect((yield* session.prompt('two')).stopReason).toBe('end_turn');
      const [before, after] = session.sdk.opened;
      expect(before!.channel.received).toEqual([]);
      expect(after!.channel.received.map((sent) => sent.message.content)).toEqual([text('two')]);
    }),
  );

  it.live('reaches a prompt that waits for the query an earlier cancelled turn is still reopening', () =>
    Effect.gen(function* () {
      const replacing = yield* Deferred.make<void>();
      const resumed = yield* Deferred.make<void>();
      const door = new ScriptedDoor('v1', [{ context: null, prompt: 'v2', web: 'vendor' }]);
      const session = yield* open({}, { door });
      const original = session.sdk.open;
      session.sdk.open = (options) =>
        original(options).pipe(Effect.tap(() => Effect.andThen(Deferred.succeed(replacing, undefined), Deferred.await(resumed))));
      const first = yield* started(session.prompt('one'));
      yield* Deferred.await(replacing);
      yield* session.cancel();
      expect((yield* Fiber.join(first)).stopReason).toBe('cancelled');
      const second = yield* Effect.forkChild(session.prompt('two'), { startImmediately: true });
      yield* session.cancel();
      yield* Deferred.succeed(resumed, undefined);
      expect((yield* Fiber.join(second)).stopReason).toBe('cancelled');
      expect(session.sdk.opened.flatMap((one) => one.channel.received)).toEqual([]);
    }),
  );

  it.live('closing the session while the replacement query starts closes that query', () =>
    Effect.gen(function* () {
      const door = new ScriptedDoor('v1', [{ context: null, prompt: 'v2', web: 'vendor' }]);
      const session = yield* open({}, { door });
      const original = session.sdk.open;
      session.sdk.open = (options) => Effect.map(original(options), (channel) => Object.assign(channel, { models: () => Effect.never }));
      const running = yield* started(Effect.exit(session.prompt('one')));
      yield* settled(() => session.sdk.opened.length === 2);
      yield* session.handlers.close!({ sessionId: session.sessionId });
      expect(session.sdk.opened.map((one) => one.channel.closed)).toEqual([true, true]);
      yield* Fiber.join(running);
    }),
  );

  it.live(
    'answers the prompt cancelled once Claude Code runs the words it could not withdraw merged into one message of its own uuid',
    () =>
      Effect.gen(function* () {
        const session = yield* open({ withdraws: false, onInterrupt: queuing });
        const running = yield* started(session.prompt('one'));
        yield* session.sdk.first.arrived(1);
        const first = yield* started(session.extension(STEER, { prompt: text('<input>first</input>') }));
        yield* session.sdk.first.arrived(2);
        const second = yield* started(session.extension(STEER, { prompt: [...text('<input>second</input>'), ...text('notes')] }));
        yield* session.sdk.first.arrived(3);
        yield* session.cancel();
        session.sdk.first.emit(
          message({
            type: 'user',
            isReplay: true,
            uuid: crypto.randomUUID(),
            parent_tool_use_id: null,
            message: { role: 'user', content: [...text('<input>first</input>\n'), ...text('<input>second</input>'), ...text('notes')] },
          }),
          resultOf(5, 5, 0.3),
        );
        expect(yield* Fiber.join(first)).toEqual({ outcome: 'startedNewTurn' });
        expect(yield* Fiber.join(second)).toEqual({ outcome: 'injected' });
        expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
        expect(session.sdk.first.interrupts).toBe(2);
      }),
  );
});

describe('the end of a message', () => {
  const use = (id: string) => ({ type: 'tool_use', id, name: 'mcp__tagma__read', input: {} });
  const opened = (index: number, id: string) => streamed({ type: 'content_block_start', index, content_block: use(id) });
  const carried = (messageId: string, id: string): SDKMessage =>
    message({
      type: 'assistant',
      uuid: crypto.randomUUID(),
      parent_tool_use_id: null,
      message: { id: messageId, model: MODEL, content: [use(id)], usage: { input_tokens: 1, output_tokens: 1 } },
    });

  it.live(
    'incident 2026-10-22: names only the calls the message carried, so a call cut by an interrupt holds back no boundary of the next turn',
    () =>
      Effect.gen(function* () {
        let prompts = 0;
        const session = yield* open({
          onUser: (sent, channel) => {
            prompts += 1;
            if (prompts === 1)
              channel.emit(
                echoOf(sent.uuid!),
                streamed({ type: 'message_start', message: { id: 'm1' } }),
                opened(0, 't1'),
                carried('m1', 't1'),
                streamed({ type: 'content_block_stop', index: 0 }),
                opened(1, 't2'),
                streamed({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path": "/r' } }),
              );
            else
              channel.emit(
                echoOf(sent.uuid!),
                streamed({ type: 'message_start', message: { id: 'm2' } }),
                opened(0, 't3'),
                carried('m2', 't3'),
                streamed({ type: 'content_block_stop', index: 0 }),
                streamed({ type: 'message_stop' }),
                resultOf(1, 1, 0.1),
              );
          },
          onInterrupt: (channel) => {
            channel.emit(streamed({ type: 'message_stop' }), interrupted(1, 1, 0.1));
            return { queued: [], dropped: [] };
          },
        });
        const running = yield* started(session.prompt('one'));
        yield* settled(() => session.updates.some(({ update }) => update.sessionUpdate === 'tool_call'));
        yield* session.cancel();
        expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
        yield* session.prompt('two');
        expect(session.notices.filter((notice) => notice.method === SAID).map((notice) => notice.params)).toEqual([
          { sessionId: session.sessionId, messageId: 'm1', toolCallIds: ['t1'] },
          { sessionId: session.sessionId, messageId: 'm2', toolCallIds: ['t3'] },
        ]);
      }),
  );

  it.live(
    'incident 2026-10-23: a message Claude Code hands over whole after overloaded retries is closed by a boundary naming its calls',
    () =>
      Effect.gen(function* () {
        const session = yield* open({
          onUser: (sent, channel) =>
            channel.emit(
              echoOf(sent.uuid!),
              message({
                type: 'system',
                subtype: 'api_retry',
                uuid: 'r1',
                attempt: 4,
                max_retries: 7,
                retry_delay_ms: 1,
                error_status: 529,
                error: 'overloaded',
              }),
              message({
                type: 'assistant',
                uuid: crypto.randomUUID(),
                parent_tool_use_id: null,
                message: {
                  id: 'm1',
                  model: MODEL,
                  content: [{ type: 'thinking', thinking: 'Weighing it.' }, use('t1'), use('t2')],
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
              }),
              toolResult('t1'),
              toolResult('t2'),
              resultOf(1, 1, 0.1),
            ),
        });
        yield* session.prompt('one');
        expect(session.notices.filter((notice) => notice.method === SAID).map((notice) => notice.params)).toEqual([
          { sessionId: session.sessionId, messageId: 'm1', toolCallIds: ['t1', 't2'] },
        ]);
      }),
  );
});

const hooked = (session: { readonly sdk: ScriptedSdk }, event: 'PreCompact' | 'PostCompact', trigger: 'manual' | 'auto') =>
  Effect.promise(async () => {
    const hook = session.sdk.opened.at(-1)!.options.hooks?.[event]?.[0]?.hooks[0];
    const input = { hook_event_name: event, trigger, custom_instructions: null, compact_summary: '', session_id: 's', cwd: '/work' };
    return await hook!(input as unknown as HookInput, undefined, { signal: new AbortController().signal });
  });

describe('compact', () => {
  it.live('answers the sizes, the summary and the spend, and tells the client what was compacted', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const compacting = yield* started(session.extension(COMPACT, { instructions: 'keep names' }));
      yield* session.sdk.first.arrived(1);
      expect(session.sdk.first.received[0]?.message.content).toBe('/compact');
      expect(yield* hooked(session, 'PreCompact', 'manual')).toEqual({ systemMessage: 'keep names' });
      session.sdk.first.emit(...boundary('manual', 'the story so far'), resultOf(300, 40, 0.5));
      const answered = yield* Fiber.join(compacting);
      expect(answered).toMatchObject({
        preTokens: 9000,
        postTokens: 1000,
        summary: 'the story so far',
        usage: { inputTokens: 300, outputTokens: 40 },
        _meta: { 'tagma/cost': { amount: 0.5, currency: 'USD' } },
      });
      expect(session.notices).toEqual([
        {
          method: COMPACTED,
          params: { sessionId: session.sessionId, trigger: 'manual', preTokens: 9000, postTokens: 1000, summary: 'the story so far' },
        },
      ]);
    }),
  );

  it.live('tells the client of a compaction Claude Code made on its own', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      session.sdk.first.emit(...boundary('auto', 'folded by itself'));
      yield* session.heard(1);
      expect(session.notices[0]).toMatchObject({ method: COMPACTED, params: { trigger: 'auto', summary: 'folded by itself' } });
    }),
  );

  it.live('does not take an earlier automatic compaction for the one it asked for', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            message({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'nothing to compact' }),
            resultOf(30, 4, 0.25),
          ),
      });
      session.sdk.first.emit(...boundary('auto', 'folded by itself'));
      yield* session.heard(1);
      expect((yield* session.refused(COMPACT, {})).message).toBe('nothing to compact');
    }),
  );

  it.live('fails with the reason Claude Code gave and the spend in the data', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onUser: (_, channel) =>
          channel.emit(
            message({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'nothing to compact' }),
            resultOf(30, 4, 0.25),
          ),
      });
      const fault = yield* session.refused(COMPACT, {});
      expect(fault.message).toBe('nothing to compact');
      expect(fault.data).toMatchObject({ usage: { inputTokens: 30, outputTokens: 4 } });
    }),
  );

  it.live('is cancelled by session cancel with -32800 and the spend in the data', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onInterrupt: (channel) => {
          channel.emit(interrupted(30, 4, 0.25));
          return { queued: [], dropped: [] };
        },
      });
      const compacting = yield* started(session.refused(COMPACT, {}));
      yield* session.sdk.first.arrived(1);
      yield* session.cancel();
      const fault = yield* Fiber.join(compacting);
      expect(fault.code).toBe(CANCELLED);
      expect(fault.data).toMatchObject({ usage: { inputTokens: 30, outputTokens: 4 } });
    }),
  );

  it.live('cancelled before Claude Code read /compact is interrupted again when the compaction starts, and nothing is compacted', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onInterrupt: (channel) => {
          if (channel.interrupts > 1)
            channel.emit(
              message({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Request was aborted.' }),
              resultOf(30, 4, 0.25),
            );
          return { queued: [], dropped: [] };
        },
      });
      const channel = session.sdk.first;
      const compacting = yield* started(session.refused(COMPACT, {}));
      yield* channel.arrived(1);
      yield* session.cancel();
      expect(channel.interrupts).toBe(1);
      channel.emit({ type: 'command_lifecycle', uuid: channel.received[0]!.uuid!, state: 'started' });
      const fault = yield* Fiber.join(compacting);
      expect(fault.code).toBe(CANCELLED);
      expect(channel.interrupts).toBe(2);
      expect(session.notices.filter((notice) => notice.method === COMPACTED)).toEqual([]);
    }),
  );
});

describe('compact at the next step', () => {
  it.live('keeps an armed step compaction when opening the turn replaces its query', () =>
    Effect.gen(function* () {
      const reached = yield* Deferred.make<void>();
      const opened = yield* Deferred.make<HostedOpened>();
      const door = new ScriptedDoor('v1', []);
      door.turn = () => Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(opened));
      const session = yield* open(
        {
          onUser: (_, channel) => {
            const settings = session.sdk.opened.at(-1)!.options.settings;
            const enabled = channel.switched.at(-1) ?? (typeof settings === 'object' && settings.autoCompactEnabled === true);
            if (enabled) channel.emit(...boundary('auto', 'folded after opening'));
            channel.emit(resultOf(5, 5, 0.3));
          },
        },
        { door },
      );
      const running = yield* started(session.prompt('one'));
      yield* Deferred.await(reached);
      const compacting = yield* started(session.extension(COMPACT, { at: 'step', instructions: 'keep names' }));
      yield* settled(() => session.sdk.first.switched.length === 1);
      yield* Deferred.succeed(opened, { context: null, prompt: 'v2', web: 'vendor' });
      expect(yield* Fiber.join(compacting)).toMatchObject({ summary: 'folded after opening' });
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
      expect(session.notices.filter((notice) => notice.method === COMPACTED)).toHaveLength(1);
    }),
  );

  it.live('cancels an armed step compaction while its replacement query is opening without ending the session', () =>
    Effect.gen(function* () {
      const reached = yield* Deferred.make<void>();
      const opened = yield* Deferred.make<HostedOpened>();
      const replacing = yield* Deferred.make<void>();
      const resumed = yield* Deferred.make<void>();
      const door = new ScriptedDoor('v1', []);
      door.turn = () => Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(opened));
      const session = yield* open({ onUser: (_, channel) => channel.emit(resultOf(5, 5, 0.3)) }, { door });
      const original = session.sdk.open;
      session.sdk.open = (options) =>
        original(options).pipe(Effect.tap(() => Effect.andThen(Deferred.succeed(replacing, undefined), Deferred.await(resumed))));
      const running = yield* started(session.prompt('one'));
      yield* Deferred.await(reached);
      const compacting = yield* started(session.refused(COMPACT, { at: 'step' }));
      yield* settled(() => session.sdk.first.switched.length === 1);
      yield* Deferred.succeed(opened, { context: null, prompt: 'v2', web: 'vendor' });
      yield* Deferred.await(replacing);
      yield* session.cancel();
      yield* Deferred.succeed(resumed, undefined);
      expect((yield* Fiber.join(compacting)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      expect((yield* session.prompt('next')).stopReason).toBe('end_turn');
      expect(session.deaths).toEqual([]);
    }),
  );

  it.live('lets Claude Code compact inside the running turn with the asked instructions, then stops it before the next request', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const compacting = yield* started(session.extension(COMPACT, { at: 'step', instructions: 'keep names' }));
      yield* settled(() => session.sdk.first.switched.length === 1);
      expect(session.sdk.first.switched).toEqual([true]);
      expect(yield* hooked(session, 'PreCompact', 'auto')).toEqual({ systemMessage: 'keep names' });
      yield* hooked(session, 'PostCompact', 'auto');
      expect(session.sdk.first.switched).toEqual([true, false]);
      session.sdk.first.emit(...boundary('auto', 'folded at the step'));
      expect(yield* Fiber.join(compacting)).toEqual({ preTokens: 9000, postTokens: 1000, summary: 'folded at the step' });
      expect(session.notices.map((notice) => notice.method)).toEqual([COMPACTING, COMPACTED]);
      session.sdk.first.emit(resultOf(5, 5, 0.3));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
      expect(session.sdk.first.received).toHaveLength(1);
    }),
  );

  it.live('tries again at the following step when Claude Code finds too little to fold, and tells the client the attempt did not run', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const compacting = yield* started(session.extension(COMPACT, { at: 'step' }));
      yield* settled(() => session.sdk.first.switched.length === 1);
      yield* hooked(session, 'PreCompact', 'auto');
      session.sdk.first.emit(
        message({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'too_few_groups' }),
      );
      yield* session.heard(2);
      expect(session.notices.map((notice) => notice.params)).toEqual([
        { sessionId: session.sessionId, running: true },
        { sessionId: session.sessionId, running: false },
      ]);
      expect(session.sdk.first.switched).toEqual([true]);
      yield* hooked(session, 'PreCompact', 'auto');
      yield* hooked(session, 'PostCompact', 'auto');
      session.sdk.first.emit(...boundary('auto', 'folded at the second step'));
      expect(yield* Fiber.join(compacting)).toMatchObject({ summary: 'folded at the second step' });
      session.sdk.first.emit(resultOf(5, 5, 0.3));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('answers that no step came when the turn ends first, before the prompt answers, and stops Claude Code compacting', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const order: string[] = [];
      const running = yield* started(Effect.tap(session.prompt('one'), () => Effect.sync(() => void order.push('prompt'))));
      yield* session.sdk.first.arrived(1);
      const compacting = yield* started(
        Effect.tap(session.refused(COMPACT, { at: 'step' }), () => Effect.sync(() => void order.push('compact'))),
      );
      yield* settled(() => session.sdk.first.switched.length === 1);
      session.sdk.first.emit(resultOf(5, 5, 0.3));
      expect((yield* Fiber.join(compacting)).code).toBe(UNSTEPPED);
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
      expect(order).toEqual(['compact', 'prompt']);
      expect(session.sdk.first.switched).toEqual([true, false]);
    }),
  );

  it.live('answers that no step will come when no turn runs, and compacts nothing itself', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      expect((yield* session.refused(COMPACT, { at: 'step' })).code).toBe(UNSTEPPED);
      expect(session.sdk.first.received).toHaveLength(0);
      expect(session.sdk.first.switched).toEqual([]);
    }),
  );

  it.live('answers that no step will come when Claude Code cannot be switched to compact, and the turn goes on', () =>
    Effect.gen(function* () {
      const session = yield* open({ switches: false });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      expect((yield* session.refused(COMPACT, { at: 'step' })).code).toBe(UNSTEPPED);
      session.sdk.first.emit(resultOf(5, 5, 0.3));
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );

  it.live('carries a turn that hit the window on once, letting Claude Code compact first, and lets a second overflow end it', () =>
    Effect.gen(function* () {
      const overflow = () => resultOf(0, 0, 0, { is_error: true, result: 'Prompt is too long', terminal_reason: 'blocking_limit' });
      const session = yield* open({});
      const running = yield* started(session.refusedPrompt('one'));
      yield* session.sdk.first.arrived(1);
      session.sdk.first.emit(overflow());
      yield* session.sdk.first.arrived(2);
      expect(session.sdk.first.switched).toEqual([true]);
      yield* hooked(session, 'PostCompact', 'auto');
      expect(session.sdk.first.switched).toEqual([true, false]);
      session.sdk.first.emit(...boundary('auto', 'folded at the limit'), overflow());
      expect((yield* Fiber.join(running)).message).toBe('Prompt is too long');
      expect(session.sdk.first.received).toHaveLength(2);
      expect(session.notices.map((notice) => notice.method)).toEqual([COMPACTED]);
    }),
  );

  it.live('is cancelled with the turn: -32800, and Claude Code stops compacting', () =>
    Effect.gen(function* () {
      const session = yield* open({
        onInterrupt: (channel) => {
          channel.emit(interrupted(5, 5, 0.3));
          return { queued: [], dropped: [] };
        },
      });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const compacting = yield* started(session.refused(COMPACT, { at: 'step' }));
      yield* settled(() => session.sdk.first.switched.length === 1);
      yield* session.cancel();
      expect((yield* Fiber.join(compacting)).code).toBe(CANCELLED);
      expect((yield* Fiber.join(running)).stopReason).toBe('cancelled');
      expect(session.sdk.first.switched).toEqual([true, false]);
    }),
  );
});

describe('a prompt of the run that changed when the turn opened', () => {
  const changing = (first: string | null) =>
    new ScriptedDoor('v1', [
      { context: null, prompt: first, web: 'vendor' },
      { context: null, prompt: 'v2', web: 'vendor' },
    ]);
  const answering: Script = { onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) };

  it.live('reopens the query on the same session before the words go, with snapshots off', () =>
    Effect.gen(function* () {
      const session = yield* open(answering, { door: changing(null) });
      yield* session.prompt('one');
      yield* session.prompt('two');
      const [before, after] = session.sdk.opened;
      expect(before!.channel.closed).toBe(true);
      expect(before!.channel.received).toHaveLength(1);
      expect(after!.channel.received).toHaveLength(1);
      expect(after!.options).toMatchObject({
        resume: session.sessionId,
        systemPrompt: { type: 'custom', prompt: servedPrompt('v2', false), snapshot: false },
      });
    }),
  );

  it.live('keeps the origin of a session that has sent nothing, and the spend of its turn, since Claude Code wrote no file to resume', () =>
    Effect.gen(function* () {
      const session = yield* open(
        { onUser: (_, channel) => channel.emit(resultOf(0, 0, 0, usageOf(100, 20, 0.5))) },
        { door: changing('v2') },
      );
      expect((yield* session.prompt('one'))._meta).toMatchObject({ 'tagma/cost': { amount: 0.5, currency: 'USD' } });
      const [before, after] = session.sdk.opened;
      expect(before!.channel.received).toHaveLength(0);
      expect(after!.options.sessionId).toBe(session.sessionId);
      expect(after!.options.resume).toBeUndefined();
      expect(after!.options.systemPrompt).toMatchObject({ prompt: servedPrompt('v2', false), snapshot: false });
    }),
  );

  it.live(
    'is the death of the session when Claude Code cannot be reopened, so the runner is told and no prompt waits on a missing query',
    () =>
      Effect.gen(function* () {
        const session = yield* open({ ...answering, refuses: (opened) => opened === 1 }, { door: changing(null) });
        yield* session.prompt('one');
        expect((yield* session.refusedPrompt('two')).code).toBe(FAULT.internal);
        yield* settled(() => session.deaths.length > 0);
        expect(session.deaths).toHaveLength(1);
        expect((yield* session.refusedPrompt('three')).code).toBe(FAULT.internal);
      }),
  );

  it.live('tells the client that no background work runs in the reopened query', () =>
    Effect.gen(function* () {
      const session = yield* open(answering, { door: changing(null) });
      yield* session.prompt('one');
      session.sdk.first.emit(
        message({
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [{ task_id: 'a', task_type: 'bash', description: 'serve' }],
        }),
      );
      yield* session.heard(1);
      yield* session.prompt('two');
      expect(session.notices.filter((notice) => notice.method === BACKGROUND).map((notice) => notice.params)).toEqual([
        { sessionId: session.sessionId, running: 1 },
        { sessionId: session.sessionId, running: 0 },
      ]);
    }),
  );
});

describe('background work', () => {
  it.live('is reported as the count of live tasks that are not ambient', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      const task = (id: string, ambient: boolean) => ({ task_id: id, task_type: 'bash', description: id, ambient });
      session.sdk.first.emit(
        message({ type: 'system', subtype: 'background_tasks_changed', tasks: [task('a', false), task('b', true), task('c', false)] }),
        message({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }),
      );
      yield* session.heard(2);
      expect(session.notices.map((notice) => notice.params)).toEqual([
        { sessionId: session.sessionId, running: 2 },
        { sessionId: session.sessionId, running: 0 },
      ]);
    }),
  );
});

describe('fork at a turn', () => {
  const transcript: History = [
    { type: 'user', uuid: 'u1' },
    { type: 'assistant', uuid: 'a1' },
    { type: 'user', uuid: 'u2' },
    { type: 'assistant', uuid: 'a2' },
  ];

  it.live('finds the prompt by its uuid and resumes a fork at the entry before it', () =>
    Effect.gen(function* () {
      const session = yield* open({}, { transcript });
      const forked = (yield* session.extension(FORK, { turn: 'u2' })) as { readonly sessionId: string };
      expect(forked.sessionId).not.toBe(session.sessionId);
      expect(session.sdk.opened[1]!.options).toMatchObject({
        resume: session.sessionId,
        forkSession: true,
        sessionId: forked.sessionId,
        resumeSessionAt: 'a1',
      });
    }),
  );

  it.live('refuses a turn the transcript does not hold', () =>
    Effect.gen(function* () {
      const session = yield* open({}, { transcript });
      expect((yield* session.refused(FORK, { turn: 'missing' })).code).toBe(FAULT.invalidParams);
    }),
  );
});

describe('aside', () => {
  const reading = (input: number, output: number, cost: number): Reading => ({
    input,
    output,
    thought: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost,
    basis: 'list',
  });
  const readings = (): (() => Reading) => {
    const totals = [reading(100, 10, 1), reading(140, 30, 1.25)];
    let read = 0;
    return () => totals[Math.min(read++, 1)]!;
  };
  const answering = { aside: () => ({ response: 'a short answer', synthetic: false }) } satisfies Script;

  it.live('answers the text and the spend as the difference of the session usage', () =>
    Effect.gen(function* () {
      const session = yield* open({ ...answering, reading: readings() });
      expect(yield* session.extension(ASIDE, { question: 'what now?' })).toMatchObject({
        text: 'a short answer',
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        _meta: { 'tagma/cost': { amount: 0.25, currency: 'USD' } },
      });
    }),
  );

  it.live("is refused with the channel's own fault where the channel can ask no side question", () =>
    Effect.gen(function* () {
      const session = yield* open({});
      expect((yield* session.refused(ASIDE, { question: 'what now?' })).code).toBe(FAULT.methodNotFound);
    }),
  );

  it.live('answers the text with no usage where the channel reports none', () =>
    Effect.gen(function* () {
      const session = yield* open({ ...answering, reading: 'absent' });
      const answered = (yield* session.extension(ASIDE, { question: 'what now?' })) as Record<string, unknown>;
      expect(answered.text).toBe('a short answer');
      expect(Object.keys(answered)).toEqual(['text']);
    }),
  );

  it.live('fails rather than report zero spend when the channel cannot read its usage', () =>
    Effect.gen(function* () {
      const session = yield* open({ ...answering, reading: 'drifted' });
      expect((yield* session.refused(ASIDE, { question: 'what now?' })).code).toBe(FAULT.internal);
    }),
  );
});

describe('web tools', () => {
  const url = { url: 'https://example.com', prompt: 'the heading' };

  const answering =
    (answer: 'allow_once' | 'reject_once' | 'cancelled' | 'unanswered'): Outlet['request'] =>
    (_, params) => {
      if (answer === 'unanswered') return Effect.fail(new AgentFault({ code: FAULT.internal, message: 'the client connection closed' }));
      if (answer === 'cancelled') return Effect.succeed({ outcome: { outcome: 'cancelled' } });
      const { options } = params as RequestPermissionParams;
      return Effect.succeed({ outcome: { outcome: 'selected', optionId: options.find((option) => option.kind === answer)!.optionId } });
    };

  const fetchUse = () =>
    message({
      type: 'assistant',
      uuid: 'a-fetch',
      parent_tool_use_id: null,
      message: { id: 'm-fetch', model: MODEL, content: [{ type: 'tool_use', id: 'toolu_1', name: 'WebFetch', input: url }] },
    });

  const asked = (matcher: NonNullable<NonNullable<Options['hooks']>['PreToolUse']>[number]) =>
    Effect.promise(async () =>
      matcher.hooks[0]!(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'WebFetch',
          tool_use_id: 'toolu_1',
          tool_input: url,
          session_id: 's',
          cwd: '/work',
        } as unknown as HookInput,
        'toolu_1',
        { signal: new AbortController().signal },
      ),
    );

  it.live('a WebFetch allowed before its call reached the client opens already started', () =>
    Effect.gen(function* () {
      const session = yield* open({}, { request: answering('allow_once') });
      yield* asked(session.sdk.opened[0]!.options.hooks!.PreToolUse![0]!);
      session.sdk.first.emit(fetchUse());
      yield* settled(() => session.updates.some(({ update }) => update.sessionUpdate === 'tool_call'));
      const calls = session.updates.flatMap(({ update }) =>
        update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update' ? [update] : [],
      );
      expect(calls).toMatchObject([{ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', status: 'in_progress' }]);
      expect(calls).toHaveLength(1);
    }),
  );

  it.live('the query opens with the web tools of Claude Code and no other built-in tool', () =>
    Effect.gen(function* () {
      const session = yield* open({});
      expect(session.sdk.opened[0]!.options.tools).toEqual(['WebSearch', 'WebFetch']);
    }),
  );

  it.live.each([
    ['allow_once', 'allow'],
    ['reject_once', 'deny'],
    ['cancelled', 'deny'],
    ['unanswered', 'deny'],
  ] as const)('WebFetch asks the client, and the answer %s gives %s', (answer, decision) =>
    Effect.gen(function* () {
      const session = yield* open({}, { request: answering(answer) });
      const matcher = session.sdk.opened[0]!.options.hooks?.PreToolUse?.[0];
      expect(matcher?.matcher).toBe('WebFetch');
      expect(matcher?.timeout).toBeGreaterThanOrEqual(3600);
      session.sdk.first.emit(fetchUse());
      yield* settled(() => session.updates.some(({ update }) => update.sessionUpdate === 'tool_call'));
      const verdict = yield* asked(matcher!);
      expect(verdict).toMatchObject({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: decision === 'deny' ? expect.any(String) : undefined,
        },
      });
      expect(session.requests).toMatchObject([
        {
          method: 'session/request_permission',
          params: {
            sessionId: session.sessionId,
            toolCall: { toolCallId: 'toolu_1', kind: 'fetch', rawInput: url },
            options: [{ kind: 'allow_once' }, { kind: 'reject_once' }],
          },
        },
      ]);
      const begun = session.updates.filter(
        ({ update }) => update.sessionUpdate === 'tool_call_update' && update.toolCallId === 'toolu_1' && update.status === 'in_progress',
      );
      expect(begun).toHaveLength(decision === 'allow' ? 1 : 0);
    }),
  );

  it.live('a session the server serves no web of the agent opens without the web tools and without the WebFetch hook', () =>
    Effect.gen(function* () {
      const door = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'none' }]);
      const session = yield* open({ onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) }, { door });
      yield* session.prompt('one');
      expect(session.sdk.opened).toHaveLength(1);
      expect(session.sdk.opened[0]!.options.tools).toEqual([]);
      expect(session.sdk.opened[0]!.options.hooks?.PreToolUse).toEqual([]);
    }),
  );

  it.live('a turn that answers another web than the session opened with reopens the query on the same session', () =>
    Effect.gen(function* () {
      const door = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'none' }], [], 'vendor');
      const session = yield* open({ onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) }, { door });
      yield* session.prompt('one');
      const [before, after] = session.sdk.opened;
      expect(before!.options.tools).toEqual(['WebSearch', 'WebFetch']);
      expect(after!.options.tools).toEqual([]);
      expect(after!.options.hooks?.PreToolUse).toEqual([]);
      expect(after!.options.sessionId).toBe(session.sessionId);
    }),
  );

  it.live('a turn that keeps the web of the agent leaves the query as it stands', () =>
    Effect.gen(function* () {
      const session = yield* open({ onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) });
      yield* session.prompt('one');
      yield* session.prompt('two');
      expect(session.sdk.opened).toHaveLength(1);
    }),
  );
});

describe('the names a turn calls Tagma’s tools by', () => {
  const answering: Script = { onUser: (_, channel) => channel.emit(resultOf(1, 1, 0.1)) };

  it.live('open the query with an alias from each name the run holds to the tool Claude Code lists, once for the same names', () =>
    Effect.gen(function* () {
      const door = new ScriptedDoor('v1', [{ context: null, prompt: 'v1', web: 'vendor' }]);
      door.held = ['read', 'search_threads'];
      const session = yield* open(answering, { door });
      yield* session.prompt('one');
      yield* session.prompt('two');
      expect(session.sdk.opened.map(({ options }) => options.toolAliases)).toEqual([
        {},
        { read: 'mcp__tagma__read', search_threads: 'mcp__tagma__search_threads' },
      ]);
    }),
  );

  it.live('reopen the query when the next run holds other names, and leave a name of another server of the session to that server', () =>
    Effect.gen(function* () {
      const door = new ScriptedDoor('v1', [{ context: null, prompt: 'v1', web: 'vendor' }]);
      const built = yield* agent(answering, { door });
      const { sessionId } = yield* built.handlers.newSession({
        cwd: '/work',
        mcpServers: [{ name: 'calendar', command: 'calendar', args: [], env: [] }],
      });
      const prompt = (words: string) => built.handlers.prompt({ sessionId, prompt: text(words) });
      door.held = ['read'];
      yield* prompt('one');
      door.held = ['read', 'mcp__calendar__create', 'mcp__notes__add'];
      yield* prompt('two');
      expect(built.sdk.opened.at(-1)!.options.toolAliases).toEqual({
        read: 'mcp__tagma__read',
        mcp__notes__add: 'mcp__tagma__mcp__notes__add',
      });
      expect(built.sdk.opened).toHaveLength(3);
    }),
  );
});

type Answered = {
  readonly id: number;
  readonly result: { readonly isError?: boolean; readonly tools?: readonly { readonly name: string }[] };
};

const ownServer = Effect.fnUntraced(function* (options: Options, answering: () => void = () => {}) {
  const { instance } = options.mcpServers![TAGMA_SERVER] as McpSdkServerConfigWithInstance;
  const pending = new Map<number, (answer: Answered) => void>();
  const told: string[] = [];
  const transport: { onmessage?: (message: unknown) => void } & Record<string, unknown> = {
    start: async () => {},
    close: async () => {},
    send: async (said: Answered | { readonly method: string }) => {
      if ('method' in said) told.push(said.method);
      else {
        answering();
        pending.get(said.id)?.(said);
      }
    },
  };
  yield* Effect.promise(() => instance.connect(transport as unknown as Parameters<typeof instance.connect>[0]));
  let requests = 0;
  const asked = (method: string, params: Record<string, unknown>) =>
    Effect.promise(
      () =>
        new Promise<Answered>((resolve) => {
          requests += 1;
          pending.set(requests, resolve);
          transport.onmessage!({ jsonrpc: '2.0', id: requests, method, params });
        }),
    );
  const call = (name: string, meta: Record<string, unknown>) => asked('tools/call', { name, arguments: {}, _meta: meta });
  return Object.assign(call, { told, list: () => asked('tools/list', {}) });
});

describe('a call of a Tagma tool', () => {
  it.live('ends as Tagma’s only when Tagma took it, and one naming no tool use is refused without reaching Tagma', () =>
    Effect.gen(function* () {
      const called: string[] = [];
      const door = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'none' }]);
      door.call = (toolCallId) =>
        Effect.suspend(() => {
          called.push(toolCallId);
          return toolCallId === 'toolu_3'
            ? Effect.fail(new AgentFault({ code: FAULT.internal, message: 'call_hosted_tool refused not-hosted', data: 'not-hosted' }))
            : Effect.succeed({
                status: 'called' as const,
                content: [{ type: 'text' as const, text: 'read' }],
                failed: false,
                offered: false,
                words: [],
              });
        });
      const session = yield* open({}, { door });
      const call = yield* ownServer(session.sdk.opened[0]!.options);
      const use = (id: string, name: string) => ({ type: 'tool_use', id, name, input: {} });
      session.sdk.first.emit(
        message({
          type: 'assistant',
          uuid: 'a-1',
          parent_tool_use_id: null,
          message: {
            id: 'm-1',
            model: MODEL,
            content: [use('toolu_1', 'mcp__tagma__read'), use('toolu_2', 'mcp__tagma__read_output'), use('toolu_3', 'mcp__tagma__read')],
          },
        }),
      );
      const unnamed = yield* call('read', {});
      yield* call('read', { 'claudecode/toolUseId': 'toolu_1' });
      const refused = yield* call('read', { 'claudecode/toolUseId': 'toolu_3' });
      session.sdk.first.emit(
        message({
          type: 'user',
          uuid: 'u-1',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'read' },
              { type: 'tool_result', tool_use_id: 'toolu_2', content: 'No such tool available: mcp__tagma__read_output', is_error: true },
              { type: 'tool_result', tool_use_id: 'toolu_3', content: 'call_hosted_tool refused not-hosted', is_error: true },
            ],
          },
        }),
      );
      const calls = () =>
        session.updates.flatMap(({ update }) =>
          update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update'
            ? [
                {
                  id: update.toolCallId,
                  status: update.status,
                  executes: (update._meta as Record<string, unknown> | undefined)?.[EXECUTES],
                },
              ]
            : [],
        );
      yield* settled(() => calls().length === 6);
      expect(unnamed.result.isError).toBe(true);
      expect(refused.result.isError).toBe(true);
      expect(called).toEqual(['toolu_1', 'toolu_3']);
      expect(calls()).toEqual([
        { id: 'toolu_1', status: 'pending', executes: true },
        { id: 'toolu_2', status: 'pending', executes: true },
        { id: 'toolu_3', status: 'pending', executes: true },
        { id: 'toolu_1', status: 'completed', executes: true },
        { id: 'toolu_2', status: 'failed', executes: false },
        { id: 'toolu_3', status: 'failed', executes: false },
      ]);
    }),
  );

  it.live('that moved the tool list answers only after Claude Code listed the tools again', () =>
    Effect.gen(function* () {
      const revealed: HostedToolWire = { name: 'read_thread_record', description: 'Expand evidence.', inputSchema: {}, mutates: false };
      const door = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'none' }], [revealed]);
      door.call = () =>
        Effect.succeed({
          status: 'called' as const,
          content: [{ type: 'text' as const, text: 'revealed' }],
          failed: false,
          offered: true,
          words: [],
        });
      const session = yield* open({}, { door });
      const server = yield* ownServer(session.sdk.opened[0]!.options);
      const order: string[] = [];
      const answered = yield* started(
        Effect.map(server('tool_search', { 'claudecode/toolUseId': 'toolu_1' }), () => void order.push('answered')),
      );
      yield* settled(() => server.told.includes('notifications/tools/list_changed'));
      order.push('told');
      const listed = yield* server.list();
      order.push('listed');
      yield* Fiber.join(answered);
      expect(listed.result.tools?.map((tool) => tool.name)).toEqual(['read_thread_record']);
      expect(order).toEqual(['told', 'listed', 'answered']);
    }),
  );

  it.live('whose answer names words handed to the turn answers only once those words reach Claude Code', () =>
    Effect.gen(function* () {
      const word = crypto.randomUUID();
      const order: string[] = [];
      const reached = yield* Deferred.make<void>();
      const door = new ScriptedDoor('v1', [{ context: null, prompt: null, web: 'none' }]);
      door.call = () =>
        Effect.as(Deferred.succeed(reached, undefined), {
          status: 'called' as const,
          content: [{ type: 'text' as const, text: 'waited' }],
          failed: false,
          offered: false,
          words: [word],
        });
      const session = yield* open({ onUser: (sent) => void order.push(sent.priority === 'next' ? 'steered' : 'prompted') }, { door });
      const running = yield* started(session.prompt('one'));
      yield* session.sdk.first.arrived(1);
      const server = yield* ownServer(session.sdk.opened[0]!.options, () => void order.push('answered'));
      const answered = yield* started(server('wait_terminal', { 'claudecode/toolUseId': 'toolu_1' }));
      yield* Deferred.await(reached);
      const steering = yield* started(session.extension(STEER, { prompt: text('Look here instead.'), input: word }));
      yield* Fiber.join(answered);
      expect(order).toEqual(['prompted', 'steered', 'answered']);
      session.sdk.first.emit(echoOf(word), resultOf(1, 1, 0.1));
      expect(yield* Fiber.join(steering)).toEqual({ outcome: 'injected' });
      expect((yield* Fiber.join(running)).stopReason).toBe('end_turn');
    }),
  );
});
