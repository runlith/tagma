import { Clock, Data, Deferred, Effect } from 'effect';
import type { CallAfter } from '../callProgress';
import type { Claim, ClaimTarget } from '../tool';

export type OrderedCall = {
  readonly toolCallId: string;
  readonly name: string;
  readonly claims: readonly Claim[];
};

export type CallWait = {
  readonly after: readonly CallAfter[];
  readonly waitedMs: number;
};

export class CallBlockedByReader extends Data.TaggedError('CallBlockedByReader')<{
  readonly blocker: CallAfter;
  readonly called: string;
}> {
  override get message(): string {
    const { blocker, called } = this;
    const touches = blocker.on === null ? 'its effects are not declared' : `it touches ${blocker.on}`;
    return `Same-batch dependency: ${blocker.toolName} (${blocker.toolCallId}) must settle first — ${touches}, and it waits for the reader's answer. Call ${called} in the next step.`;
  }
}

export class CallStoppedInQueue extends Data.TaggedError('CallStoppedInQueue')<{ readonly reason: string }> {
  override get message(): string {
    return `${this.reason} The call was still waiting for an earlier call of its step and had not started.`;
  }
}

type Placed = OrderedCall & {
  readonly seq: number;
  answered: boolean;
  asking: boolean;
};

type Standing = OrderedCall & {
  readonly runId: string;
  readonly seq: number;
  readonly owner: object;
};

const makeSignal = () => {
  let current = Deferred.makeUnsafe<void>();
  return {
    get now(): Deferred.Deferred<void> {
      return current;
    },
    move: (): void => {
      const was = current;
      current = Deferred.makeUnsafe<void>();
      Deferred.doneUnsafe(was, Effect.void);
    },
  };
};

export type ThreadClaims = ReturnType<typeof makeThreadClaims>;

export const makeThreadClaims = () => {
  let seq = 0;
  const threads = new Map<string, Map<string, Standing>>();
  const signals = new Map<string, ReturnType<typeof makeSignal>>();
  const keyOf = (runId: string, toolCallId: string): string => `${runId}\u0000${toolCallId}`;
  const moved = (threadId: string): void => {
    signals.get(threadId)?.move();
    if (!threads.has(threadId)) signals.delete(threadId);
  };
  const owned = (threadId: string, runId: string, toolCallId: string, owner: object): Standing | undefined => {
    const held = threads.get(threadId)?.get(keyOf(runId, toolCallId));
    return held?.owner === owner ? held : undefined;
  };
  const replace = (threadId: string, held: Standing, claims: readonly Claim[]): void => {
    const standing = threads.get(threadId);
    if (standing === undefined) return;
    if (claims.length === 0) standing.delete(keyOf(held.runId, held.toolCallId));
    else standing.set(keyOf(held.runId, held.toolCallId), { ...held, claims });
    if (standing.size === 0) threads.delete(threadId);
    moved(threadId);
  };
  return {
    next: (): number => ++seq,
    hold: (threadId: string, entry: Standing): void => {
      const standing = threads.get(threadId) ?? new Map<string, Standing>();
      threads.set(threadId, standing);
      standing.set(keyOf(entry.runId, entry.toolCallId), entry);
      moved(threadId);
    },
    narrow: (
      threadId: string,
      runId: string,
      toolCallId: string,
      owner: object,
      kept: (claims: readonly Claim[]) => readonly Claim[],
    ): void => {
      const held = owned(threadId, runId, toolCallId, owner);
      if (held !== undefined) replace(threadId, held, kept(held.claims));
    },
    release: (threadId: string, runId: string, toolCallId: string, owner: object): void => {
      const held = owned(threadId, runId, toolCallId, owner);
      if (held !== undefined) replace(threadId, held, []);
    },
    of: (threadId: string): Iterable<Standing> => threads.get(threadId)?.values() ?? [],
    changed: (threadId: string): Deferred.Deferred<void> => {
      const signal = signals.get(threadId) ?? makeSignal();
      signals.set(threadId, signal);
      return signal.now;
    },
  };
};

export type CallOrderThread = {
  readonly runId: string;
  readonly threadId: string;
  readonly claims: ThreadClaims;
};

const WINDOWS_ROOT = /^[A-Za-z]:[\\/]/;

const pathsOverlap = (left: string, right: string): boolean => {
  const windows = WINDOWS_ROOT.test(left) || WINDOWS_ROOT.test(right);
  const spelled = (path: string) => (windows ? path.replaceAll('/', '\\').toLowerCase() : path);
  const separator = windows ? '\\' : '/';
  const a = spelled(left);
  const b = spelled(right);
  const contains = (parent: string, child: string) =>
    parent === child || child.startsWith(parent.endsWith(separator) ? parent : `${parent}${separator}`);
  return contains(a, b) || contains(b, a);
};

const overlaps = (left: ClaimTarget, right: ClaimTarget): boolean => {
  if (left.kind === 'all' || right.kind === 'all') return true;
  if (left.kind === 'file' && right.kind === 'file') return pathsOverlap(left.path, right.path);
  return left.kind === 'key' && right.kind === 'key' && left.key === right.key;
};

const conflicts = (earlier: Claim, later: Claim): boolean =>
  (earlier.access === 'write' || later.access === 'write') && overlaps(earlier.on, later.on);

const labelOf = (target: ClaimTarget): string | null => (target.kind === 'file' ? target.path : target.kind === 'key' ? target.key : null);

const heldAfterAnswer = (claim: Claim): boolean => claim.access === 'write' && claim.on.kind !== 'all';

export const queuedReason = (after: readonly CallAfter[]): string =>
  `after ${after
    .map((blocker) => {
      const on = blocker.on === null ? null : (blocker.on.split(/[\\/]/).filter(Boolean).at(-1) ?? blocker.on);
      return on === null ? blocker.toolName : `${blocker.toolName} ${on}`;
    })
    .join(', ')}`;

export type CallOrder = ReturnType<typeof makeCallOrder>;

export const makeCallOrder = (thread?: CallOrderThread) => {
  const placed = new Map<string, Placed>();
  const ended = new Set<string>();
  const waits = new Map<string, CallWait>();
  const signal = makeSignal();
  const self = {};
  let local = 0;

  const moved = (): void => signal.move();

  const holding = (call: Placed): readonly Claim[] => (call.answered ? call.claims.filter(heldAfterAnswer) : call.claims);

  const conflictOn = (earlier: readonly Claim[], later: readonly Claim[]): string | null | undefined => {
    for (const held of earlier) {
      const claim = later.find((candidate) => conflicts(held, candidate));
      if (claim !== undefined) return held.on.kind === 'all' ? labelOf(claim.on) : labelOf(held.on);
    }
    return undefined;
  };

  const blockers = (toolCallId: string): readonly (CallAfter & { readonly asking: boolean })[] => {
    const target = placed.get(toolCallId);
    if (target === undefined) return [];
    const found: (CallAfter & { readonly asking: boolean })[] = [];
    for (const held of thread === undefined ? [] : thread.claims.of(thread.threadId)) {
      if (held.seq >= target.seq || held.owner === self || (held.runId === thread?.runId && placed.has(held.toolCallId))) continue;
      const on = conflictOn(held.claims, target.claims);
      if (on !== undefined) found.push({ toolCallId: held.toolCallId, toolName: held.name, on, asking: false });
    }
    for (const held of placed.values()) {
      if (held === target) break;
      const on = conflictOn(holding(held), target.claims);
      if (on !== undefined) found.push({ toolCallId: held.toolCallId, toolName: held.name, on, asking: held.asking });
    }
    return found;
  };

  const unstand = (toolCallId: string): void => {
    if (thread !== undefined) thread.claims.release(thread.threadId, thread.runId, toolCallId, self);
  };

  const announced = (blocker: CallAfter & { readonly asking: boolean }): CallAfter => ({
    toolCallId: blocker.toolCallId,
    toolName: blocker.toolName,
    on: blocker.on,
  });

  return {
    place: (calls: readonly OrderedCall[]): readonly string[] => {
      const fresh: string[] = [];
      for (const call of calls) {
        if (placed.has(call.toolCallId) || ended.has(call.toolCallId)) continue;
        placed.set(call.toolCallId, { ...call, seq: thread?.claims.next() ?? ++local, answered: false, asking: false });
        fresh.push(call.toolCallId);
      }
      return fresh;
    },

    has: (toolCallId: string): boolean => placed.has(toolCallId),

    blockers: (toolCallId: string): readonly CallAfter[] => blockers(toolCallId).map(announced),

    turn: Effect.fnUntraced(function* (toolCallId: string, name: string, queued: (after: readonly CallAfter[]) => void) {
      const first = blockers(toolCallId);
      if (first.length === 0) return;
      const after = first.map(announced);
      queued(after);
      const since = yield* Clock.currentTimeMillis;
      for (;;) {
        const here = signal.now;
        const outside = thread?.claims.changed(thread.threadId);
        const standing = blockers(toolCallId);
        const asking = standing.find((blocker) => blocker.asking);
        if (asking !== undefined) return yield* new CallBlockedByReader({ blocker: announced(asking), called: name });
        if (standing.length === 0) break;
        yield* outside === undefined ? Deferred.await(here) : Effect.raceFirst(Deferred.await(here), Deferred.await(outside));
      }
      waits.set(toolCallId, { after, waitedMs: (yield* Clock.currentTimeMillis) - since });
    }),

    waited: (toolCallId: string): CallWait | undefined => waits.get(toolCallId),

    asking: (toolCallId: string): void => {
      const call = placed.get(toolCallId);
      if (call === undefined || call.asking) return;
      call.asking = true;
      moved();
    },

    proceeding: (toolCallId: string): void => {
      const call = placed.get(toolCallId);
      if (call === undefined || !call.asking) return;
      call.asking = false;
      moved();
    },

    answered: (toolCallId: string): void => {
      const call = placed.get(toolCallId);
      if (call === undefined || call.answered) return;
      if (!call.claims.some(heldAfterAnswer)) {
        ended.add(toolCallId);
        placed.delete(toolCallId);
        waits.delete(toolCallId);
      } else {
        call.answered = true;
        call.asking = false;
      }
      moved();
    },

    stand: (toolCallId: string): void => {
      const call = placed.get(toolCallId);
      if (call === undefined || thread === undefined) return;
      thread.claims.hold(thread.threadId, {
        toolCallId,
        name: call.name,
        claims: call.claims,
        seq: call.seq,
        runId: thread.runId,
        owner: self,
      });
    },

    began: (toolCallId: string): void => {
      if (thread !== undefined) {
        thread.claims.narrow(thread.threadId, thread.runId, toolCallId, self, (claims) => claims.filter(heldAfterAnswer));
      }
    },

    release: (toolCallId: string): void => {
      ended.add(toolCallId);
      waits.delete(toolCallId);
      unstand(toolCallId);
      if (!placed.delete(toolCallId)) return;
      moved();
    },

    clear: (): void => {
      for (const toolCallId of placed.keys()) unstand(toolCallId);
      placed.clear();
      ended.clear();
      waits.clear();
      moved();
    },
  };
};
