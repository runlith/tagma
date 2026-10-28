import type { UUID as Uuid } from 'node:crypto';
import { Clock, Deferred, Effect, Exit, Result } from 'effect';
import type { SDKAssistantMessageError, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import { CANCELLED, failed, user, type Ended, type Heard } from './calls.js';
import type { Commanded } from './channel.js';
import type { Input, Steered, Withdrawn } from '../hosted/cycle.js';
import { FAILURE } from '../../contract/wire/extensions.js';
import { failureOf } from '../../vendors/claude-code/failure.js';
import { CONTINUE_WORDS } from '../../adapter/input.js';
import type { Feed } from './feed.js';
import type { Lifecycle } from './lifecycle.js';
import type { Mark, Spend } from './spend.js';
import { outcomeOf, promptBlocks, type Outcome, type PromptBlock } from './translate.js';

type Hold = { readonly words: readonly string[]; readonly done: Deferred.Deferred<void> };

type Running = {
  readonly uuid: string;
  readonly taken: Effect.Effect<void>;
  readonly done: Deferred.Deferred<PromptResult, AgentFault>;
  readonly halted: Deferred.Deferred<void>;
  readonly steers: Map<string, Deferred.Deferred<Steered, AgentFault>>;
  readonly words: Map<string, readonly string[]>;
  readonly inputs: Map<string, string>;
  readonly given: Set<string>;
  readonly holds: Set<Hold>;
  readonly early: SDKUserMessage[];
  readonly begun: Set<string>;
  baseline: Mark;
  sent: boolean;
  flushed: boolean;
  opener: string | null;
  cancelled: boolean;
  unauthorized: boolean;
  continued: boolean;
  inFlight: number;
  last: string | null;
  ending: Outcome | null;
  error: SDKAssistantMessageError | null;
  modelStarted: boolean;
  rejectedUntil: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STOPPED: Outcome = { _tag: 'Stopped', stopReason: 'cancelled' };

const uuidOf = (value: unknown): Uuid | null => (typeof value === 'string' && UUID.test(value) ? (value as Uuid) : null);

const textsOf = (content: Heard['message']['content'] | readonly PromptBlock[]): readonly string[] =>
  typeof content === 'string' ? [content.trim()] : content.flatMap((block) => (block.type === 'text' ? [block.text.trim()] : []));

export class Turn {
  private running: Running | null = null;

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly feed: Feed,
    private readonly spend: Spend,
    private recap: readonly ContentBlock[],
  ) {}

  busy(): boolean {
    return this.running !== null;
  }

  readonly start = Effect.fnUntraced(function* (this: Turn, input: Input) {
    const { lifecycle, spend } = this;
    const content = promptBlocks([
      ...this.recap,
      ...(input.context === null ? [] : [{ type: 'text' as const, text: input.context }]),
      ...input.prompt,
    ]);
    if (Result.isFailure(content)) return yield* new AgentFault({ code: FAULT.invalidParams, message: content.failure });
    const uuid = input.id as Uuid;
    const done = yield* Deferred.make<PromptResult, AgentFault>();
    const halted = yield* Deferred.make<void>();
    const running: Running = {
      uuid,
      taken: input.taken,
      done,
      halted,
      steers: new Map(),
      words: new Map(),
      inputs: new Map(),
      given: new Set(),
      holds: new Set(),
      early: [],
      begun: new Set(),
      baseline: spend.mark(),
      sent: false,
      flushed: false,
      opener: null,
      cancelled: false,
      unauthorized: false,
      continued: false,
      inFlight: 0,
      last: null,
      ending: null,
      error: null,
      modelStarted: false,
      rejectedUntil: null,
    };
    this.running = running;

    running.sent = true;
    running.inFlight = 1;
    running.opener = uuid;
    running.baseline = spend.mark();
    this.recap = [];
    const prompt = content.success.some((block) => block.type !== 'text' || block.text.trim() !== '') ? content.success : CONTINUE_WORDS;
    yield* lifecycle.send(user(prompt, { uuid, client_composed: true }));
    while (running.early.length > 0) {
      const message = running.early.shift()!;
      yield* lifecycle.send(message);
      this.gave(running, message.uuid);
    }
    running.flushed = true;
    return Deferred.await(done);
  });

  readonly steer = Effect.fnUntraced(function* (this: Turn, prompt: ReadonlyArray<ContentBlock>, input: string | undefined) {
    const { lifecycle } = this;
    const running = this.running;
    if (running?.cancelled === true)
      return yield* new AgentFault({ code: CANCELLED, message: 'the turn is being cancelled, so these words wait for the next one' });
    if (running === null || (running.sent && running.inFlight === 0)) {
      yield* lifecycle.ready();
      return { outcome: 'promptRequired' } as Steered;
    }
    const content = promptBlocks(prompt);
    if (Result.isFailure(content)) {
      if (input !== undefined) this.given(running, input);
      return yield* new AgentFault({ code: FAULT.invalidParams, message: content.failure });
    }
    const uuid = uuidOf(input) ?? crypto.randomUUID();
    const echoed = yield* Deferred.make<Steered, AgentFault>();
    running.steers.set(uuid, echoed);
    running.words.set(uuid, textsOf(content.success));
    if (input !== undefined) running.inputs.set(uuid, input);
    const message = user(content.success, { uuid, priority: 'next', client_composed: true });
    if (running.flushed) {
      yield* lifecycle.send(message);
      this.gave(running, uuid);
    } else running.early.push(message);
    return yield* Deferred.await(echoed);
  });

  readonly queued = Effect.fnUntraced(function* (this: Turn, words: readonly string[]) {
    const running = this.running;
    if (running === null || running.cancelled || words.every((word) => running.given.has(word))) return;
    const hold: Hold = { words, done: yield* Deferred.make<void>() };
    running.holds.add(hold);
    yield* Deferred.await(hold.done).pipe(Effect.ensuring(Effect.sync(() => running.holds.delete(hold))));
  });

  private gave(running: Running, uuid: string | undefined): void {
    const input = uuid === undefined ? undefined : running.inputs.get(uuid);
    if (input !== undefined) this.given(running, input);
  }

  private given(running: Running, input: string): void {
    running.given.add(input);
    for (const hold of running.holds)
      if (hold.words.every((word) => running.given.has(word))) {
        running.holds.delete(hold);
        Deferred.doneUnsafe(hold.done, Effect.void);
      }
  }

  private released(running: Running): void {
    for (const hold of running.holds) Deferred.doneUnsafe(hold.done, Effect.void);
    running.holds.clear();
  }

  readonly withdraw = Effect.fnUntraced(function* (this: Turn, input: string) {
    const { lifecycle } = this;
    const running = this.running;
    const uuid = running === null ? undefined : [...running.inputs].find(([, given]) => given === input)?.[0];
    if (running === null || uuid === undefined || !running.steers.has(uuid)) return { withdrawn: false } as Withdrawn;
    const early = running.early.findIndex((message) => message.uuid === uuid);
    if (early >= 0) running.early.splice(early, 1);
    else if (!(yield* Effect.flatMap(lifecycle.channel(), (channel) => channel.withdraw(uuid)))) return { withdrawn: false } as Withdrawn;
    yield* this.dropped(running, [uuid], 'the reader took these words back before Claude Code read them');
    yield* this.rest(running);
    return { withdrawn: true } as Withdrawn;
  });

  readonly cancel = Effect.fnUntraced(function* (this: Turn) {
    const running = this.running;
    if (running === null) return;
    running.cancelled = true;
    this.released(running);
    yield* Deferred.succeed(running.halted, undefined);
    if (running.sent) yield* this.halt(running);
  });

  readonly fail = Effect.fnUntraced(function* (this: Turn, fault: AgentFault) {
    const running = this.running;
    if (running === null) return;
    if (running.cancelled) yield* this.concluded(running, STOPPED);
    else {
      this.running = null;
      this.released(running);
      for (const echoed of running.steers.values()) yield* Deferred.fail(echoed, fault);
      yield* Deferred.fail(running.done, fault);
    }
    yield* Deferred.succeed(running.halted, undefined);
  });

  assistant(message: Extract<SDKMessage, { readonly type: 'assistant' }>): Effect.Effect<void, AgentFault> {
    if (this.running !== null) {
      this.running.last = message.uuid;
      if (message.error === 'authentication_failed') this.running.unauthorized = true;
      if (message.error !== undefined) this.running.error = message.error;
    }
    return this.feed.assistant(message.message);
  }

  answering(): void {
    if (this.running !== null) this.running.modelStarted = true;
  }

  limited(until: number | null): void {
    if (this.running !== null) this.running.rejectedUntil = until;
  }

  readonly commanded = Effect.fnUntraced(function* (this: Turn, said: Commanded) {
    const running = this.running;
    if (running === null || !running.sent) return;
    if (said.state === 'started') {
      running.begun.add(said.uuid);
      if (said.uuid === running.uuid) yield* running.taken;
      if (said.uuid === running.opener) running.opener = null;
      if (running.cancelled) yield* this.halt(running);
      return;
    }
    if (said.state !== 'cancelled' || !running.cancelled || running.begun.has(said.uuid)) return;
    yield* this.dropped(running, [said.uuid], 'Claude Code dropped these words when the turn was cancelled');
    yield* this.rest(running);
  });

  readonly echoed = Effect.fnUntraced(function* (this: Turn, message: Heard) {
    const running = this.running;
    const uuid = message.uuid;
    if (running === null || uuid === undefined) return;
    const idle = running.inFlight === 0;
    running.begun.add(uuid);
    if (uuid === running.uuid) yield* running.taken;
    if (uuid === running.opener) running.opener = null;
    else if (running.words.has(uuid)) yield* this.took(running, uuid);
    else {
      const said = new Set(textsOf(message.message.content));
      const merged = [...running.words].filter(([, texts]) => texts.length > 0 && texts.every((text) => said.has(text)));
      for (const [sent] of merged) yield* this.took(running, sent);
    }
    if (!running.cancelled || this.running !== running) return;
    if (idle && running.inFlight === 0) running.inFlight = 1;
    yield* this.halt(running);
  });

  private readonly took = Effect.fnUntraced(function* (this: Turn, running: Running, uuid: string) {
    running.words.delete(uuid);
    const echoed = running.steers.get(uuid);
    if (echoed === undefined) return;
    running.steers.delete(uuid);
    const fresh = running.inFlight === 0;
    if (fresh) running.inFlight += 1;
    yield* Deferred.succeed(echoed, { outcome: fresh ? 'startedNewTurn' : 'injected' } as Steered);
  });

  heard(message: Heard): Effect.Effect<void> {
    if (this.running !== null && message.uuid !== undefined) this.running.last = message.uuid;
    return this.feed.user(message.message, message.tool_use_result);
  }

  overflowed(result: Ended): boolean {
    const running = this.running;
    return (
      running !== null &&
      !running.cancelled &&
      !running.continued &&
      running.inFlight === 1 &&
      running.steers.size === 0 &&
      (result.terminal_reason === 'blocking_limit' || result.terminal_reason === 'prompt_too_long')
    );
  }

  readonly continued = Effect.fnUntraced(function* (this: Turn) {
    const running = this.running;
    if (running === null) return;
    const uuid = crypto.randomUUID();
    yield* this.lifecycle.send(user(CONTINUE_WORDS, { uuid }));
    running.continued = true;
    running.opener = uuid;
  });

  readonly finished = Effect.fnUntraced(function* (this: Turn, result: Ended) {
    const running = this.running;
    if (running === null) return;
    running.inFlight = Math.max(0, running.inFlight - 1);
    if (!running.cancelled) {
      yield* running.taken;
      const outcome = outcomeOf(result, running.error);
      running.ending =
        outcome._tag === 'Stopped'
          ? outcome
          : {
              ...outcome,
              failure: failureOf({
                error: running.error,
                status: outcome.status,
                modelStarted: running.modelStarted,
                rejectedUntil: running.rejectedUntil,
                at: yield* Clock.currentTimeMillis,
              }),
            };
    }
    yield* this.rest(running);
  });

  private readonly halt = Effect.fnUntraced(function* (this: Turn, running: Running) {
    const early = running.early.splice(0).flatMap((message) => (message.uuid === undefined ? [] : [message.uuid]));
    const receipt = yield* Effect.exit(this.lifecycle.interrupt());
    if (Exit.isFailure(receipt) || this.running !== running) return;
    const { queued, dropped } = receipt.value;
    const gone = new Set([...early, ...dropped]);
    const pending = running.opener === null ? [...running.steers.keys()] : [...running.steers.keys(), running.opener];
    for (const uuid of pending)
      if (!gone.has(uuid) && (queued === null || queued.includes(uuid)) && (yield* this.withdrawn(uuid))) gone.add(uuid);
    yield* this.dropped(running, gone, 'the turn was cancelled before Claude Code took these words');
    yield* this.rest(running);
  });

  private readonly dropped = Effect.fnUntraced(function* (this: Turn, running: Running, uuids: Iterable<string>, why: string) {
    for (const uuid of uuids) {
      if (uuid === running.opener) {
        running.opener = null;
        running.inFlight = Math.max(0, running.inFlight - 1);
      }
      const echoed = running.steers.get(uuid);
      if (echoed === undefined) continue;
      running.steers.delete(uuid);
      running.words.delete(uuid);
      yield* Deferred.fail(echoed, new AgentFault({ code: CANCELLED, message: why }));
    }
  });

  private readonly rest = Effect.fnUntraced(function* (this: Turn, running: Running) {
    if (this.running !== running || !running.sent || running.inFlight > 0 || running.steers.size > 0) return;
    if (running.cancelled) yield* this.concluded(running, STOPPED);
    else if (running.ending !== null) yield* this.concluded(running, running.ending);
  });

  private readonly withdrawn = Effect.fnUntraced(function* (this: Turn, uuid: string) {
    const done = yield* Effect.exit(Effect.flatMap(this.lifecycle.channel(), (channel) => channel.withdraw(uuid)));
    return Exit.isSuccess(done) && done.value;
  });

  private readonly concluded = Effect.fnUntraced(function* (this: Turn, running: Running, outcome: Outcome) {
    if (this.running === running) this.running = null;
    this.released(running);
    const fault = running.cancelled
      ? new AgentFault({ code: CANCELLED, message: 'the turn was cancelled before Claude Code read these words' })
      : failed('the turn ended before Claude Code confirmed these words');
    for (const echoed of running.steers.values()) yield* Deferred.fail(echoed, fault);
    running.steers.clear();
    running.words.clear();
    running.early.length = 0;
    const spend = this.spend.settled(running.baseline);
    if (outcome._tag === 'Failed') {
      const data = { ...(outcome.failure == null ? {} : { [FAILURE]: outcome.failure }), ...spend };
      yield* Deferred.fail(
        running.done,
        running.unauthorized
          ? new AgentFault({
              code: FAULT.authRequired,
              message: `Claude Code is not signed in — run \`claude auth login\`: ${outcome.message}`,
              data,
            })
          : new AgentFault({ code: FAULT.internal, message: outcome.message, data }),
      );
      return;
    }
    yield* Deferred.succeed(running.done, {
      stopReason: outcome.stopReason,
      ...(spend.usage === undefined ? {} : { usage: spend.usage }),
      _meta: { 'tagma/turn': { prompt: running.uuid, last: running.last }, ...spend._meta },
    });
  });
}
