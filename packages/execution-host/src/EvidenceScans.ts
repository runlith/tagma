import { Data, Clock, Context, Deferred, Effect, Exit, Ref, Semaphore } from 'effect';
import type {
  EvidenceCompleteness,
  EvidenceScope,
  ListenerSnapshot,
  ProcessSnapshot,
  UnmeasuredRegion,
} from '@runlith/executions/protocol/evidence';

import type { ProcessProbe } from './ProcessReader';

export type ListenerProbe = { readonly _tag: 'Held'; readonly pids: ReadonlyArray<number> } | { readonly _tag: 'Inventory' };

export type Measured<A> = {
  readonly observedAt: number;
  readonly completeness: EvidenceCompleteness;
  readonly unmeasured: ReadonlyArray<UnmeasuredRegion>;
  readonly found: ReadonlyArray<A>;
};

export type EvidenceProbe = {
  readonly scope: EvidenceScope;
  readonly processes: (request: ProcessProbe) => Effect.Effect<Measured<ProcessSnapshot>>;
  readonly listeners: (request: ListenerProbe) => Effect.Effect<Measured<ListenerSnapshot>>;
};

export class EvidenceReader extends Context.Service<EvidenceReader, EvidenceProbe>()('@runlith/execution-host/EvidenceReader') {}

export type Scan<A> = {
  readonly revision: number;
  readonly observedAt: number;
  readonly completeness: EvidenceCompleteness;
  readonly unmeasured: ReadonlyArray<UnmeasuredRegion>;
  readonly found: ReadonlyArray<A>;
};

export type ScanLimits = {
  readonly concurrency: number;
  readonly flight: number;
  readonly freshMs: number;
  readonly retained: number;
  readonly results: number;
};

export class ScanLimitsRefused extends Data.TaggedError('ScanLimitsRefused')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const unusable = (limits: ScanLimits): string | undefined => {
  const issues = [
    limits.concurrency >= 1 ? undefined : 'concurrency must admit at least one probe',
    limits.flight >= 1 ? undefined : 'flight must admit at least one open question',
    limits.results >= 1 ? undefined : 'results must admit at least one row',
    limits.retained >= 0 ? undefined : 'retained cannot be negative',
    limits.freshMs >= 0 ? undefined : 'freshMs cannot be negative',
  ].filter((issue): issue is string => issue !== undefined);
  return issues.length === 0 ? undefined : issues.join('; ');
};

const retainable = (limits: ScanLimits): boolean => limits.freshMs > 0;

type Entry<A> =
  | { readonly _tag: 'Claimed' }
  | { readonly _tag: 'Joined'; readonly standing: Deferred.Deferred<Scan<A>> }
  | { readonly _tag: 'Full' };

type Retained<A> = {
  readonly fresh: (key: string, since: number) => Effect.Effect<Scan<A> | undefined>;
  readonly enter: (key: string, waiting: Deferred.Deferred<Scan<A>>, open: number) => Effect.Effect<Entry<A>>;
  readonly leave: (key: string, waiting: Deferred.Deferred<Scan<A>>, outcome: Exit.Exit<Scan<A>>, keeping: boolean) => Effect.Effect<void>;
};

type RetainedInput = { readonly keep: number };
const makeRetained = Effect.fnUntraced(function* <A>({ keep }: RetainedInput) {
  const held = yield* Ref.make(new Map<string, Scan<A>>());
  const flight = yield* Ref.make(new Map<string, Deferred.Deferred<Scan<A>>>());
  return {
    fresh: (key, since) =>
      Effect.map(Ref.get(held), (scans) => {
        const scan = scans.get(key);
        return scan !== undefined && scan.observedAt >= since ? scan : undefined;
      }),
    enter: (key, waiting, open) =>
      Ref.modify(flight, (flights) => {
        const standing = flights.get(key);
        if (standing !== undefined) return [{ _tag: 'Joined', standing } as Entry<A>, flights] as const;
        if (flights.size >= open) return [{ _tag: 'Full' } as Entry<A>, flights] as const;
        flights.set(key, waiting);
        return [{ _tag: 'Claimed' } as Entry<A>, flights] as const;
      }),
    leave: Effect.fnUntraced(function* (key, waiting, outcome, keeping) {
      yield* Ref.update(flight, (flights) => {
        flights.delete(key);
        return flights;
      });
      yield* Deferred.done(waiting, outcome);
      if (!keeping || !Exit.isSuccess(outcome)) return;
      const scan = outcome.value;
      yield* Ref.update(held, (scans) => {
        scans.delete(key);
        scans.set(key, scan);
        while (scans.size > keep) {
          const oldest = scans.keys().next();
          if (oldest.done === true) break;
          scans.delete(oldest.value);
        }
        return scans;
      });
    }),
  } satisfies Retained<A>;
});

export type EvidenceScans = {
  readonly scope: EvidenceScope;
  readonly processes: (request: ProcessProbe) => Effect.Effect<Scan<ProcessSnapshot>>;
  readonly listeners: (request: ListenerProbe) => Effect.Effect<Scan<ListenerSnapshot>>;
};

export type EvidenceScansInput = { readonly limits: ScanLimits };
export const makeEvidenceScans = Effect.fnUntraced(function* ({ limits }: EvidenceScansInput) {
  const probe = yield* EvidenceReader;
  const refused = unusable(limits);
  if (refused !== undefined) return yield* new ScanLimitsRefused({ detail: refused });
  const [gate, revisionRef, retainedProcesses, retainedListeners] = yield* Effect.all([
    Semaphore.make(limits.concurrency),
    Ref.make(0),
    makeRetained<ProcessSnapshot>({ keep: limits.retained }),
    makeRetained<ListenerSnapshot>({ keep: limits.retained }),
  ]);
  function processes(request: ProcessProbe): Effect.Effect<Scan<ProcessSnapshot>> {
    return run(retainedProcesses, processKey(request), probe.processes(request), limits.results);
  }

  function listeners(request: ListenerProbe): Effect.Effect<Scan<ListenerSnapshot>> {
    return run(retainedListeners, listenerKey(request), probe.listeners(request), limits.results);
  }

  function run<A>(retained: Retained<A>, key: string, measure: Effect.Effect<Measured<A>>, bound: number): Effect.Effect<Scan<A>> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (retainable(limits)) {
          const fresh = yield* retained.fresh(key, now - limits.freshMs);
          if (fresh !== undefined) return fresh;
        }
        const joined = Deferred.makeUnsafe<Scan<A>>();
        const entry = yield* retained.enter(key, joined, limits.flight);
        if (entry._tag === 'Joined') return yield* restore(Deferred.await(entry.standing));
        if (entry._tag === 'Full') return crowded(now, limits.flight);
        const outcome = yield* Effect.exit(restore(gate.withPermits(1)(bounded(measure, bound))));
        const answer = Exit.hasInterrupts(outcome) ? Exit.succeed(withdrawn<A>(now)) : outcome;
        yield* retained.leave(key, joined, answer, retainable(limits));
        return yield* outcome;
      }),
    );
  }

  const bounded = Effect.fnUntraced(function* <A>(measure: Effect.Effect<Measured<A>>, bound: number): Effect.fn.Return<Scan<A>> {
    const measured = yield* measure;
    const revision = yield* Ref.modify(revisionRef, (held) => [held + 1, held + 1] as const);
    if (measured.found.length <= bound) return { ...measured, revision };
    return {
      revision,
      observedAt: measured.observedAt,
      completeness: measured.completeness === 'unavailable' ? 'unavailable' : ('partial' as EvidenceCompleteness),
      unmeasured: [
        ...measured.unmeasured,
        {
          region: 'rows past the answer bound',
          reason: 'truncated' as const,
          detail: `${measured.found.length} measured, ${bound} answered`,
        },
      ],
      found: measured.found.slice(0, bound),
    };
  });

  return { scope: probe.scope, processes, listeners } satisfies EvidenceScans;
});

const withdrawn = <A>(observedAt: number): Scan<A> => ({
  revision: 0,
  observedAt,
  completeness: 'unavailable',
  unmeasured: [
    {
      region: 'this question',
      reason: 'unknown',
      detail: 'the caller that owned this measurement withdrew before it answered',
    },
  ],
  found: [],
});

const crowded = <A>(observedAt: number, flight: number): Scan<A> => ({
  revision: 0,
  observedAt,
  completeness: 'unavailable',
  unmeasured: [
    {
      region: 'this question',
      reason: 'refused',
      detail: `this host already holds ${flight} open measurements, which is as many as it will`,
    },
  ],
  found: [],
});

const processKey = (request: ProcessProbe): string =>
  request._tag === 'Table'
    ? 'processes:table'
    : request._tag === 'Terminal'
      ? `processes:terminal:${request.terminal}`
      : `processes:pids:${pidKey(request.pids)}`;

const listenerKey = (request: ListenerProbe): string =>
  request._tag === 'Inventory' ? 'listeners:inventory' : `listeners:pids:${pidKey(request.pids)}`;

const pidKey = (pids: ReadonlyArray<number>): string => [...new Set(pids)].sort((left, right) => left - right).join(',');
