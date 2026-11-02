import { Deferred, Effect, Exit } from 'effect';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { Usage } from '@runlith/acp/methods';
import { COMPACTED, COMPACTING, UNSTEPPED } from '@runlith/hosted-runner/wire/extensions';
import { CANCELLED, failed, user, type Ended, type Heard } from './calls.js';
import type { Commanded } from './channel.js';
import type { Feed } from './feed.js';
import type { Lifecycle } from './lifecycle.js';
import type { Mark, Settled, Spend } from './spend.js';

export type Compacted = {
  readonly preTokens: number;
  readonly postTokens: number | null;
  readonly summary: string | null;
  readonly usage?: Usage;
  readonly _meta?: Readonly<Record<string, unknown>>;
};

const FEW_GROUPS = 'too_few_groups';

type Boundary = { readonly trigger: string; readonly preTokens: number; readonly postTokens: number | null; summary: string | null };

type Pending = {
  readonly done: Deferred.Deferred<Compacted, AgentFault>;
  readonly instructions: string;
  readonly step: boolean;
  baseline: Mark | null;
  failure: string | null;
  cancelled: boolean;
  sent: boolean;
  command: string | null;
  last: string | null;
};

const marked = (spend: Settled, last: string | null) =>
  last === null ? spend : { ...spend, _meta: { ...spend._meta, 'tagma/turn': { last } } };

export class Compaction {
  private pending: Pending | null = null;
  private boundary: Boundary | null = null;
  private relieving = false;

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly feed: Feed,
    private readonly spend: Spend,
  ) {}

  busy(): boolean {
    return this.pending !== null;
  }

  readonly compact = Effect.fnUntraced(function* (this: Compaction, instructions: string) {
    const done = yield* Deferred.make<Compacted, AgentFault>();
    const pending: Pending = {
      done,
      baseline: null,
      instructions,
      step: false,
      failure: null,
      cancelled: false,
      sent: false,
      command: null,
      last: null,
    };
    this.pending = pending;
    this.boundary = null;
    const ready = yield* Effect.exit(this.lifecycle.ready());
    if (Exit.isFailure(ready) || pending.cancelled) {
      if (this.pending === pending) this.pending = null;
      if (Exit.isFailure(ready)) return yield* Effect.failCause(ready.cause);
      return yield* new AgentFault({ code: CANCELLED, message: 'the compaction was cancelled before Claude Code began it' });
    }
    pending.baseline = this.spend.mark();
    pending.sent = true;
    const command = crypto.randomUUID();
    pending.command = command;
    yield* this.lifecycle.send(user('/compact', { uuid: command }));
    return yield* Deferred.await(done);
  });

  readonly step = Effect.fnUntraced(function* (this: Compaction, instructions: string) {
    const done = yield* Deferred.make<Compacted, AgentFault>();
    const pending: Pending = {
      done,
      baseline: null,
      instructions,
      step: true,
      failure: null,
      cancelled: false,
      sent: true,
      command: null,
      last: null,
    };
    this.pending = pending;
    this.boundary = null;
    yield* this.switched(true).pipe(
      Effect.mapError((fault) => new AgentFault({ code: UNSTEPPED, message: fault.message })),
      Effect.tapError(() =>
        Effect.sync(() => {
          if (this.pending === pending) this.pending = null;
        }),
      ),
    );
    return yield* Deferred.await(done);
  });

  readonly overflowed = Effect.fnUntraced(function* (this: Compaction) {
    if (this.pending !== null) return false;
    const on = yield* Effect.exit(this.switched(true));
    this.relieving = Exit.isSuccess(on);
    return this.relieving;
  });

  readonly cancel = Effect.fnUntraced(function* (this: Compaction) {
    const pending = this.pending;
    if (pending === null) return false;
    if (pending.cancelled) {
      if (pending.sent) yield* Effect.exit(this.lifecycle.interrupt());
      return true;
    }
    if (pending.step) {
      yield* this.settled(pending, new AgentFault({ code: CANCELLED, message: 'the turn was cancelled before Claude Code compacted it' }));
      return false;
    }
    pending.cancelled = true;
    if (pending.sent) yield* Effect.exit(this.lifecycle.interrupt());
    return true;
  });

  readonly commanded = Effect.fnUntraced(function* (this: Compaction, said: Commanded) {
    const pending = this.pending;
    if (pending === null || !pending.cancelled || said.state !== 'started' || said.uuid !== pending.command) return;
    yield* Effect.exit(this.lifecycle.interrupt());
  });

  fail(fault: AgentFault): Effect.Effect<void> {
    const pending = this.pending;
    this.pending = null;
    return pending === null ? Effect.void : Deferred.fail(pending.done, fault).pipe(Effect.asVoid);
  }

  compacting(): Effect.Effect<string | null> {
    const pending = this.pending;
    if (pending === null) return Effect.succeed(null);
    const instructions = pending.instructions === '' ? null : pending.instructions;
    return pending.step ? Effect.as(this.feed.notify(COMPACTING, { running: true }), instructions) : Effect.succeed(instructions);
  }

  compacted(): Effect.Effect<void> {
    if (this.pending?.step !== true && !this.relieving) return Effect.void;
    this.relieving = false;
    return this.stopped();
  }

  noted(message: Extract<SDKMessage, { readonly type: 'system' }>): Effect.Effect<void> {
    if (message.subtype === 'compact_boundary') {
      const metadata = message.compact_metadata;
      this.boundary = {
        trigger: metadata.trigger,
        preTokens: metadata.pre_tokens,
        postTokens: metadata.post_tokens ?? null,
        summary: null,
      };
      return Effect.void;
    }
    const pending = this.pending;
    if (message.subtype === 'status' && message.status === 'compacting' && pending?.cancelled === true && !pending.step)
      return Effect.asVoid(Effect.exit(this.lifecycle.interrupt()));
    if (message.subtype !== 'status' || message.compact_result !== 'failed') return Effect.void;
    if (pending === null) {
      if (!this.relieving || message.compact_error === FEW_GROUPS) return Effect.void;
      this.relieving = false;
      return this.stopped();
    }
    if (pending.step && message.compact_error === FEW_GROUPS) return this.feed.notify(COMPACTING, { running: false });
    pending.failure = message.compact_error ?? 'Claude Code could not compact this session';
    return pending.step ? this.stopped() : Effect.void;
  }

  readonly summarized = Effect.fnUntraced(function* (this: Compaction, message: Heard) {
    const boundary = this.boundary;
    if (boundary === null || boundary.summary !== null || message.isSynthetic !== true) return false;
    const content = message.message.content;
    const summary = typeof content === 'string' ? content : content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
    boundary.summary = summary;
    const pending = this.pending;
    if (pending === null || pending.step) this.boundary = null;
    else pending.last = message.uuid ?? null;
    yield* this.feed.notify(COMPACTED, {
      trigger: boundary.trigger,
      preTokens: boundary.preTokens,
      postTokens: boundary.postTokens,
      summary,
    });
    if (pending?.step === true) {
      this.pending = null;
      yield* Deferred.succeed(pending.done, { preTokens: boundary.preTokens, postTokens: boundary.postTokens, summary });
    }
    return true;
  });

  recorded(uuid: string | undefined): void {
    const pending = this.pending;
    if (pending !== null && !pending.step && pending.last !== null && uuid !== undefined) pending.last = uuid;
  }

  readonly finished = Effect.fnUntraced(function* (this: Compaction, result: Ended) {
    const pending = this.pending;
    if (pending === null) {
      if (!this.relieving) return false;
      this.relieving = false;
      yield* this.stopped();
      return false;
    }
    if (pending.step) {
      yield* this.settled(
        pending,
        pending.failure !== null
          ? failed(pending.failure)
          : new AgentFault({ code: UNSTEPPED, message: 'the turn ended before Claude Code reached another step' }),
      );
      return false;
    }
    this.pending = null;
    const boundary = this.boundary;
    this.boundary = null;
    const spend = marked(pending.baseline === null ? {} : this.spend.settled(pending.baseline), pending.last);
    if (pending.cancelled) {
      yield* Deferred.fail(pending.done, new AgentFault({ code: CANCELLED, message: 'the compaction was cancelled', data: spend }));
      return true;
    }
    yield* boundary === null
      ? Deferred.fail(
          pending.done,
          new AgentFault({
            code: FAULT.internal,
            message: pending.failure ?? 'Claude Code ended the compaction without compacting',
            data: spend,
          }),
        )
      : Deferred.succeed(pending.done, {
          preTokens: boundary.preTokens,
          postTokens: boundary.postTokens,
          summary: boundary.summary,
          ...spend,
        });
    return true;
  });

  private readonly settled = Effect.fnUntraced(function* (this: Compaction, pending: Pending, fault: AgentFault) {
    if (this.pending === pending) this.pending = null;
    this.boundary = null;
    yield* this.stopped();
    yield* Deferred.fail(pending.done, fault);
  });

  private readonly stopped = Effect.fnUntraced(function* (this: Compaction) {
    const off = yield* Effect.exit(this.switched(false));
    if (Exit.isFailure(off)) yield* this.lifecycle.fall('Claude Code could not be stopped from compacting at every step');
  });

  private switched(enabled: boolean): Effect.Effect<void, AgentFault> {
    return this.lifecycle.autoCompact(enabled);
  }
}
