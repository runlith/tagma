import { Effect, Semaphore } from 'effect';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';
import { refusesLane, terminalRefusal } from '../../executions/terminals/refusal.js';
import { TERMINAL_PERMISSION_REVISION } from '../../executions/contract/service/subjectPolicy.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { TerminalGrants } from '../../executions/contract/service/grants.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';

const REMEMBERED_ACTS = 64;

export const laneRefused = (failure: HarnessFailure): boolean => {
  if (!('_tag' in failure) || failure._tag !== 'ThreadCallBroke') return false;
  const cause = failure.cause;
  if (cause instanceof TerminalRefused) return cause.reason === 'no-grant' || cause.reason === 'stale';
  return (
    typeof cause === 'object' &&
    cause !== null &&
    '_tag' in cause &&
    cause._tag === 'HostRefused' &&
    'refusal' in cause &&
    typeof cause.refusal === 'object' &&
    cause.refusal !== null &&
    '_tag' in cause.refusal &&
    typeof cause.refusal._tag === 'string' &&
    refusesLane({ _tag: cause.refusal._tag })
  );
};

export class HarnessLane {
  private at = 0;
  ended = false;

  constructor(
    readonly projectId: number,
    readonly execution: ExecutionRef,
    readonly principal: Principal,
    readonly binding: BindingId,
    private readonly acts: Map<string, number | null> = new Map(),
    readonly guard: Effect.Effect<void, HarnessFailure> = Effect.void,
  ) {}

  frontier(): number {
    return this.at;
  }

  took(sequence: number, act?: string): void {
    if (act !== undefined && !this.acts.has(act)) {
      this.acts.set(act, sequence);
      if (this.acts.size > REMEMBERED_ACTS) {
        const oldest = this.acts.keys().next();
        if (!oldest.done) this.acts.delete(oldest.value);
      }
    }
    if (sequence >= this.at) this.at = sequence + 1;
  }

  sequenceOf(act: string): number | null {
    const held = this.acts.get(act);
    return held === undefined ? this.at : held;
  }

  spent(act: string): boolean {
    return this.acts.has(act);
  }

  successor(binding: BindingId): HarnessLane {
    const carried = new Map<string, number | null>();
    for (const [act, sequence] of this.acts) {
      if (sequence === null || sequence < this.at) carried.set(act, null);
    }
    return new HarnessLane(this.projectId, this.execution, this.principal, binding, carried, this.guard);
  }
}

type LaneEntry = { readonly _tag: 'Open'; readonly lane: HarnessLane } | { readonly _tag: 'Refused'; readonly refusal: GateRefusal };

export class HarnessLanes {
  private readonly lanes = new Map<string, LaneEntry>();
  private readonly queues = new Map<string, Semaphore.Semaphore>();

  constructor(
    private readonly grants: TerminalGrants['Service'],
    private readonly writing: TerminalWriting['Service'],
  ) {}

  readonly open = Effect.fnUntraced(function* (
    this: HarnessLanes,
    sessionId: string,
    projectId: number,
    execution: ExecutionRef,
    principal: Principal,
    guard: Effect.Effect<void, HarnessFailure> = Effect.void,
  ) {
    const { lanes } = this;
    const held = lanes.get(sessionId);
    if (
      held?._tag === 'Open' &&
      held.lane.execution.execution === execution.execution &&
      held.lane.execution.incarnation === execution.incarnation
    )
      return;
    if (held?._tag === 'Open') yield* this.revoked(held.lane);
    lanes.set(
      sessionId,
      yield* this.opened(
        projectId,
        execution,
        principal,
        (binding) => new HarnessLane(projectId, execution, principal, binding, new Map(), guard),
        'start this session again once its execution host opens a lane for it',
      ),
    );
  });

  held(sessionId: string): boolean {
    return this.lanes.has(sessionId);
  }

  of(sessionId: string): Effect.Effect<HarnessLane, HarnessFailure> {
    return Effect.suspend(() => {
      const held = this.lanes.get(sessionId);
      if (held === undefined) {
        return new GateRefusal(
          'typing-unavailable',
          `This server holds no lane for session ${sessionId}; nothing of it is typed from here.`,
          ['read this session again once its CLI is running', 'type this into the session from the server that holds it'],
        );
      }
      return held._tag === 'Open' ? Effect.succeed(held.lane) : held.refusal;
    });
  }

  typing<A>(sessionId: string, act: (lane: HarnessLane) => Effect.Effect<A, HarnessFailure>): Effect.Effect<A, HarnessFailure> {
    return Effect.suspend(() => {
      let queue = this.queues.get(sessionId);
      if (queue === undefined) {
        queue = Semaphore.makeUnsafe(1);
        this.queues.set(sessionId, queue);
      }
      return queue.withPermit(this.typed(sessionId, act));
    }).pipe(Effect.withSpan('HarnessLanes.typing'));
  }

  private readonly typed = Effect.fnUntraced(function* <A>(
    this: HarnessLanes,
    sessionId: string,
    act: (lane: HarnessLane) => Effect.Effect<A, HarnessFailure>,
  ) {
    const lane = yield* this.of(sessionId);
    yield* lane.guard;
    const before = lane.frontier();
    const first = yield* Effect.result(act(lane));
    if (first._tag === 'Success') return first.success;
    if (!laneRefused(first.failure)) return yield* Effect.fail(first.failure);
    const next = yield* this.reopen(sessionId, lane);
    if (lane.frontier() !== before) return yield* Effect.fail(first.failure);
    return yield* act(next);
  });

  close(sessionId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const held = this.lanes.get(sessionId);
      this.lanes.delete(sessionId);
      this.queues.delete(sessionId);
      if (held === undefined || held._tag !== 'Open') return Effect.void;
      return this.revoked(held.lane);
    });
  }

  private readonly reopen = Effect.fn('HarnessLanes.reopen')(function* (this: HarnessLanes, sessionId: string, spent: HarnessLane) {
    const { lanes } = this;
    const held = lanes.get(sessionId);
    if (held?._tag === 'Open' && held.lane !== spent) return held.lane;
    if (held?._tag !== 'Open') return yield* this.of(sessionId);
    yield* this.revoked(spent);
    const entry = yield* this.opened(
      spent.projectId,
      spent.execution,
      spent.principal,
      (binding) => spent.successor(binding),
      'send this again: the next act opens this session’s lane anew',
    );
    if (lanes.get(sessionId) !== held) {
      if (entry._tag === 'Open') yield* this.revoked(entry.lane);
      return yield* this.of(sessionId);
    }
    if (entry._tag === 'Refused') return yield* entry.refusal;
    lanes.set(sessionId, entry);
    return entry.lane;
  });

  private revoked(lane: HarnessLane): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (lane.ended) return Effect.void;
      lane.ended = true;
      return Effect.asVoid(
        this.grants.revoke(
          { projectId: lane.projectId, execution: lane.execution, actor: lane.principal, binding: lane.binding },
          'binding-closed',
        ),
      );
    });
  }

  private readonly opened = Effect.fnUntraced(function* (
    this: HarnessLanes,
    projectId: number,
    execution: ExecutionRef,
    principal: Principal,
    lane: (binding: BindingId) => HarnessLane,
    again: string,
  ) {
    const opened = yield* Effect.result(
      this.writing.openBinding(principal, {
        road: 'harness',
        projectId,
        execution,
        decisionRevision: TERMINAL_PERMISSION_REVISION,
      }),
    );
    if (opened._tag === 'Failure') {
      const said = terminalRefusal(opened.failure);
      return {
        _tag: 'Refused',
        refusal: new GateRefusal(
          'harness-lane-unopened',
          `The server could not open the lane it types this session's words through (${said.code}): ${said.reason} — nothing was typed, and nothing of this terminal's custody moved.`,
          [again],
        ),
      } as const satisfies LaneEntry;
    }
    return { _tag: 'Open', lane: lane(opened.success.binding) } as const satisfies LaneEntry;
  });
}
