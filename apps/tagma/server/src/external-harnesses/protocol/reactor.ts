import { Effect, Schema } from 'effect';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { AccountQuota } from '../../providers/contract/service/quota.js';
import { QUOTA, QuotaReading } from '../contract/wire/extensions.js';

import type { ClientEvent } from '@runlith/acp/events';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ProtocolAsides } from './asides.js';
import type { Seated } from './facets.js';
import type { ProtocolHalts } from './halts.js';
import { measures } from './measure.js';
import type { Link, ProtocolLinks } from './links.js';
import { refusal } from './methods/declared.js';
import type { ProtocolOpening } from './opening.js';
import type { ProtocolPrompts } from './prompts.js';
import type { ProtocolAsks } from './questions.js';
import type { Persisted, ProtocolSteps, Unitwork } from './steps.js';

const decodeQuota = Schema.decodeUnknownResult(QuotaReading);

export type TitleReported = (threadId: string, title: string) => Effect.Effect<void>;

export type TurnBegun = (threadId: string, runId: string) => Effect.Effect<void>;

export type TurnStepped = (run: ThreadRunRef) => Effect.Effect<void>;

const steppedOf = (link: Link, events: readonly ClientEvent[]): ThreadRunRef | null => {
  const turn = link.row.client.turn;
  return turn !== null && Object.keys(turn.calls).length === 0 && events.some((event) => event._tag === 'ToolCallEnded')
    ? { id: turn.id, threadId: link.threadId }
    : null;
};

export class ProtocolReactor {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly steps: ProtocolSteps,
    private readonly halts: ProtocolHalts,
    private readonly asks: ProtocolAsks,
    private readonly prompts: ProtocolPrompts,
    private readonly opening: ProtocolOpening,
    private readonly asides: ProtocolAsides,
    private readonly quota: AccountQuota['Service'],
    private readonly titled: TitleReported,
    private readonly begun: TurnBegun,
    private readonly stepped: TurnStepped,
  ) {}

  locked(link: Link, work: Effect.Effect<Persisted | null, HarnessFailure>): Effect.Effect<void, HarnessFailure> {
    return this.links.locked(link, this.settling(link, work));
  }

  private readonly settling = Effect.fnUntraced(function* (
    this: ProtocolReactor,
    link: Link,
    work: Effect.Effect<Persisted | null, HarnessFailure>,
  ) {
    yield* this.drained(link);
    const done = yield* work;
    if (done !== null) yield* this.react(link, done);
    yield* this.halts.settled(link);
  });

  private readonly drained = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link) {
    for (let landing = link.writer.take(); landing !== undefined; landing = link.writer.take()) {
      yield* this.react(link, yield* this.steps.landed(link, landing));
    }
  });

  pump(link: Link): Effect.Effect<void, HarnessFailure> {
    return this.locked(link, this.prompts.prompt(link));
  }

  held(link: Link): Effect.Effect<void, HarnessFailure> {
    return this.locked(link, this.asks.held(link));
  }

  change(threadId: string, work: Unitwork): Effect.Effect<Seated, HarnessFailure> {
    return Effect.suspend(() => {
      const link = this.links.get(threadId);
      if (link === undefined) {
        return Effect.tap(this.steps.stored(threadId, work), () => Effect.sync(() => this.links.raise(threadId)));
      }
      return this.changeLinked(link, threadId, work);
    });
  }

  private readonly changeLinked = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link, threadId: string, work: Unitwork) {
    const seated = yield* this.links.locked(link, this.persisting(link, threadId, work));
    if (seated === null) return yield* this.change(threadId, work);
    return seated;
  });

  private readonly persisting = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link, threadId: string, work: Unitwork) {
    if (this.links.get(threadId) !== link) return null;
    yield* this.drained(link);
    const done = yield* this.steps.persist(link, { within: work }, false);
    const seated: Seated = { facet: link.facet, row: link.row };
    yield* this.react(link, done);
    yield* this.halts.settled(link);
    return seated;
  });

  readonly react = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link, persisted: Persisted) {
    const { asides, prompts, begun } = this;
    const queue: Persisted[] = [persisted];
    while (queue.length > 0) {
      const next = queue.shift()!;
      for (const turn of next.begun) yield* begun(link.threadId, turn);
      if (next.ended.length > 0) yield* this.quieted(link);
      for (const closing of next.endings) yield* asides.kept(link, closing);
      const boundary = steppedOf(link, next.events);
      if (boundary !== null) yield* this.stepped(boundary);
      for (const event of next.events) {
        const followed = yield* this.follow(link, event);
        if (followed !== null) queue.push(followed);
      }
      if (next.ended.length > 0 || next.events.some((event) => event._tag === 'TurnEnded'))
        queue.push(yield* prompts.afterTurn(link, next.ended));
    }
  });

  readonly prepared = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link) {
    const { links, prompts } = this;
    while (true) {
      const seen = yield* links
        .until(link.threadId, (current) => (current !== link ? ('gone' as const) : prompts.due(link.threadId) ? ('due' as const) : null))
        .pipe(Effect.catchTag('LinkEnded', () => Effect.succeed('gone' as const)));
      if (seen === 'gone') return yield* Effect.never;
      prompts.pumped(link.threadId);
      yield* this.pump(link);
    }
  });

  private quieted(link: Link): Effect.Effect<void> {
    if (link.noise.size === 0) return Effect.void;
    const heard = [...link.noise.entries()].map(([method, noise]) => ({ method, count: noise.count, sample: noise.sample }));
    link.noise.clear();
    return Effect.logWarning('the agent sent frames this turn that Tagma does not read', { threadId: link.threadId, heard });
  }

  private readonly follow = Effect.fnUntraced(function* (this: ProtocolReactor, link: Link, event: ClientEvent) {
    const { opening, quota, prompts, halts, asks, titled } = this;
    switch (event._tag) {
      case 'Initialized':
        return yield* opening.initialized(link, event.result);
      case 'SessionReady':
        return yield* opening.configured(link, event.sessionId, event.setup);
      case 'ModeChanged':
        return yield* opening.moded(link, event.modeId);
      case 'ConfigChanged':
        return yield* opening.changed(link);
      case 'Extended': {
        if (event.method !== QUOTA) return null;
        const read = decodeQuota(event.params);
        if (read._tag === 'Failure') {
          yield* Effect.logWarning('the agent quota reading is unreadable', { threadId: link.threadId, failure: read.failure });
          return null;
        }
        const account = link.facet.session?.account;
        if (account !== undefined && read.success.sessionId === link.facet.sessionKey) {
          if ('observation' in read.success) yield* quota.observe(account.provider, AccountKey.make(account.key), read.success.observation);
          else yield* quota.fail(account.provider, AccountKey.make(account.key), read.success.failure);
        } else {
          yield* Effect.logWarning('the agent quota reading has no matching pinned account session', {
            threadId: link.threadId,
            sessionId: read.success.sessionId,
          });
        }
        return null;
      }
      case 'ExtensionAnswered':
        return yield* prompts.prompt(link);
      case 'RequestFailed': {
        if (event.cause._tag === 'Exited') return null;
        if (event.request.meaning !== 'extension') return yield* opening.refused(link, event);
        const refused = refusal(event);
        if (refused === null) return yield* prompts.prompt(link);
        yield* halts.failed(link, refused);
        return null;
      }
      case 'Asked':
        return yield* asks.asked(link, event.ask);
      case 'SessionChanged': {
        if (measures(event)) {
          yield* this.asides.measured(link);
          return yield* prompts.measured(link);
        }
        const title = event.update.sessionUpdate === 'session_info_update' ? (event.update.title?.trim() ?? '') : '';
        if (title !== '') yield* titled(link.threadId, title);
        return null;
      }
      default:
        return null;
    }
  });
}
