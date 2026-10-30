import { Data, Deferred, Effect, type Duration, type Semaphore } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { transportOf } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { AcpProfile } from '@runlith/tagma/adapter/harness';
import type { ProtocolRow } from './row.js';
import type { HarnessTurnEnded } from './turns.js';
import type { ProtocolWriter } from './writing.js';

export type Noise = { count: number; readonly sample: string };

export type Link = {
  readonly threadId: string;
  readonly sessionId: string;
  readonly name: HarnessName;
  readonly adapter: HarnessAdapter;
  readonly profile: AcpProfile;
  readonly lock: Semaphore.Semaphore;
  readonly writer: ProtocolWriter;
  readonly row: ProtocolRow;
  facet: ExternalSession;
  asked: HarnessAskedModel | undefined;
  readonly tried: Map<string, string>;
  refused: string | null;
  poisoned: string | null;
  refusal: GateRefusal | null;
  halted: boolean;
  stale: boolean;
  ended: HarnessTurnEnded | null;
  activeAt: number;
  readonly noise: Map<string, Noise>;
};

export type Until = { readonly within?: Duration.Input; readonly stored?: boolean };

export class LinkEnded extends Data.TaggedError('LinkEnded')<{ readonly refusal: GateRefusal }> {}

export class WaitExpired extends Data.TaggedError('WaitExpired')<{ readonly threadId: string }> {}

export type Linked = { readonly adapter: HarnessAdapter; readonly profile: AcpProfile };

export const linkedOf = (adapters: HarnessAdapters['Service'], facet: ExternalSession): Effect.Effect<Linked, HarnessFailure> =>
  Effect.flatMap(adapters.row(facet.name, facet.presentation.install), (adapter) =>
    Effect.map(transportOf(adapter, 'acp'), ({ profile }) => ({ adapter, profile })),
  );

export const facetOf = (store: HarnessSessionStore, threadId: string): Effect.Effect<ExternalSession, HarnessFailure> =>
  Effect.flatMap(store.read(threadId), (facet): Effect.Effect<ExternalSession, HarnessFailure> =>
    facet === null
      ? new GateRefusal('harness-missing', `No external session ${threadId} stands here.`, ['read the project session list'])
      : Effect.succeed(facet),
  );

export class ProtocolLinks {
  private readonly links = new Map<string, Link>();
  private readonly pulses = new Map<string, Deferred.Deferred<void>>();
  private readonly byRun = new Map<string, string>();
  private readonly inputRuns = new Map<string, string>();

  constructor(
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
  ) {}

  get(threadId: string): Link | undefined {
    return this.links.get(threadId);
  }

  all(): readonly Link[] {
    return [...this.links.values()];
  }

  set(link: Link): void {
    const standing = this.links.get(link.threadId);
    if (standing !== undefined) this.unindex(standing);
    this.links.set(link.threadId, link);
    this.index(link);
  }

  landed(link: Link, row: ProtocolRow): void {
    this.unindex(link);
    (link as { row: ProtocolRow }).row = row;
    if (this.links.get(link.threadId) === link) this.index(link);
  }

  threadOf(runId: string): string | undefined {
    return this.byRun.get(runId);
  }

  turned(runId: string): boolean {
    return this.byRun.has(runId);
  }

  holdsInputs(runId: string): boolean {
    return this.inputRuns.has(runId);
  }

  drop(threadId: string): void {
    const standing = this.links.get(threadId);
    if (standing !== undefined) this.unindex(standing);
    this.links.delete(threadId);
    this.raise(threadId);
  }

  private index(link: Link): void {
    for (const turn of link.row.turns) this.byRun.set(turn.id, link.threadId);
    for (const steer of link.row.steering) this.inputRuns.set(steer.turn, link.threadId);
    if (link.row.compact !== null && link.row.compact.ids.length > 0) this.inputRuns.set(link.row.compact.turn, link.threadId);
  }

  private unindex(link: Link): void {
    for (const turn of link.row.turns) if (this.byRun.get(turn.id) === link.threadId) this.byRun.delete(turn.id);
    for (const steer of link.row.steering) if (this.inputRuns.get(steer.turn) === link.threadId) this.inputRuns.delete(steer.turn);
    const compact = link.row.compact;
    if (compact !== null && this.inputRuns.get(compact.turn) === link.threadId) this.inputRuns.delete(compact.turn);
  }

  raise(threadId: string): void {
    const pulse = this.pulses.get(threadId);
    if (pulse !== undefined) {
      this.pulses.delete(threadId);
      Deferred.doneUnsafe(pulse, Effect.void);
    }
  }

  locked<A, E>(link: Link, work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return link.lock
      .withPermits(1)(work)
      .pipe(Effect.ensuring(Effect.sync(() => this.raise(link.threadId))));
  }

  until<A>(
    threadId: string,
    look: (link: Link | undefined, stored: ProtocolRow | null) => A | null,
    until?: Until & { readonly within?: undefined },
  ): Effect.Effect<A, LinkEnded | HarnessFailure>;
  until<A>(
    threadId: string,
    look: (link: Link | undefined, stored: ProtocolRow | null) => A | null,
    until: Until,
  ): Effect.Effect<A, LinkEnded | WaitExpired | HarnessFailure>;
  until<A>(
    threadId: string,
    look: (link: Link | undefined, stored: ProtocolRow | null) => A | null,
    until: Until = {},
  ): Effect.Effect<A, LinkEnded | WaitExpired | HarnessFailure> {
    const watched = this.watching(threadId, look, until);
    const within = until.within;
    return within === undefined
      ? watched
      : watched.pipe(Effect.timeoutOrElse({ duration: within, orElse: () => Effect.fail(new WaitExpired({ threadId })) }));
  }

  private readonly watching = Effect.fnUntraced(function* <A>(
    this: ProtocolLinks,
    threadId: string,
    look: (link: Link | undefined, stored: ProtocolRow | null) => A | null,
    until: Until,
  ) {
    for (;;) {
      const pulse = this.pulse(threadId);
      const link = this.links.get(threadId);
      const stored = link === undefined && until.stored === true ? yield* this.rows.load(threadId) : null;
      const seen = look(link, stored);
      if (seen !== null) return seen;
      const ended =
        until.stored === true
          ? null
          : link === undefined
            ? yield* this.ended(threadId)
            : (link.refusal ??
              (link.row.failure === null ? null : new GateRefusal('session-failed', link.row.failure, ['start the thread again'])));
      if (ended !== null) return yield* new LinkEnded({ refusal: ended });
      yield* Deferred.await(pulse);
    }
  });

  private pulse(threadId: string): Deferred.Deferred<void> {
    const standing = this.pulses.get(threadId);
    if (standing !== undefined) return standing;
    const pulse = Deferred.makeUnsafe<void>();
    this.pulses.set(threadId, pulse);
    return pulse;
  }

  private ended(threadId: string): Effect.Effect<GateRefusal | null, HarnessFailure> {
    return Effect.map(this.store.read(threadId), (facet) => {
      const session = facet?.session;
      if (session === undefined || session.state === 'ended') {
        return new GateRefusal('session-failed', 'The agent session ended.', ['start the thread again']);
      }
      return session.state === 'uncertain' && session.ownerId === null
        ? new GateRefusal('session-uncertain', 'The agent process ending is unknown.', [
            'read the thread state; the next recovery beat drives it again',
          ])
        : null;
    });
  }
}
