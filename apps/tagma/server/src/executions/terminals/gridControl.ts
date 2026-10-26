import { Context, Effect } from 'effect';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import { Principal, type BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputInstruction, InputCause, InputAnswer } from '@runlith/executions/protocol/input';
import { refusesLane } from './refusal.js';
import type { TerminalBox, TerminalDecider, ViewId } from '../contract/wire/viewLeases.js';
import type { TerminalGrids } from '../contract/service/views.js';

export type InputWitness = {
  readonly admitted: (
    execution: ExecutionRef,
    scope: { readonly binding: BindingId; readonly principal: Principal },
    request: { readonly act: InputInstruction; readonly cause: InputCause },
    outcome: InputAnswer,
  ) => Effect.Effect<void>;
  readonly ended: (execution: ExecutionRef) => Effect.Effect<void>;
  readonly transferred: (execution: ExecutionRef) => Effect.Effect<void>;
  readonly holdsLane: (execution: ExecutionRef) => boolean;
};

export const InputWitness = Context.Service<InputWitness>('tagma/executions/InputWitness');

const OPERATOR = Principal.make('operator');

const TYPING: ReadonlySet<InputCause> = new Set<InputCause>(['typed', 'paste', 'interrupt']);

type Seen = {
  readonly connection: number;
  box: TerminalBox | null;
  readonly emit: (decider: TerminalDecider) => void;
};

type GridLane = { readonly binding: BindingId; next: number };

type Grid = {
  readonly execution: ExecutionRef;
  readonly views: Map<ViewId, Seen>;
  typed: ViewId | null;
  applied: TerminalBox | null;
  appliedBy: ViewId | null;
  standing: boolean;
  lane: GridLane | null;
  applying: boolean;
};

type Resized = 'admitted' | 'refused' | 'lost';

const sameBox = (one: TerminalBox, other: TerminalBox): boolean => one.rows === other.rows && one.columns === other.columns;

const keyOf = (execution: ExecutionRef): string => `${execution.installation}/${execution.execution}/${execution.incarnation}`;

export type GridStanding = {
  readonly applied: TerminalBox | null;
  readonly decider: ViewId | null;
  readonly views: number;
  readonly lane: boolean;
};

export type ExecutionGrids = TerminalGrids['Service'] &
  InputWitness & { readonly standing: (execution: ExecutionRef) => GridStanding | null };

export const makeExecutionGrids = Effect.fnUntraced(function* ({
  executions,
  viewOf,
  close = (binding, principal) =>
    executions.closeBinding(binding, principal).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('closing a retired grid lane could not release its binding', {
          binding,
          reason: failure._tag,
        }),
      ),
      Effect.asVoid,
    ),
}: {
  readonly executions: TerminalInput['Service'];
  readonly viewOf: (binding: BindingId) => ViewId | undefined;
  readonly close?: (binding: BindingId, principal: Principal) => Effect.Effect<unknown>;
}) {
  const scope = yield* Effect.scope;
  const grids = new Map<string, Grid>();

  const gridOf = (execution: ExecutionRef): Grid => {
    const key = keyOf(execution);
    const held = grids.get(key);
    if (held !== undefined) return held;
    const grid: Grid = {
      execution,
      views: new Map(),
      typed: null,
      applied: null,
      appliedBy: null,
      standing: false,
      lane: null,
      applying: false,
    };
    grids.set(key, grid);
    return grid;
  };

  const deciderOf = (grid: Grid): { readonly view: ViewId; readonly box: TerminalBox } | null => {
    if (grid.typed !== null) {
      const box = grid.views.get(grid.typed)?.box;
      if (box !== undefined && box !== null) return { view: grid.typed, box };
    }
    let only: { readonly view: ViewId; readonly box: TerminalBox } | null = null;
    for (const [view, seen] of grid.views) {
      if (seen.box === null) continue;
      if (only !== null) return null;
      only = { view, box: seen.box };
    }
    return only;
  };

  const broadcast = (grid: Grid): void => {
    if (grid.applied === null) return;
    const frame: TerminalDecider = { decider: grid.appliedBy };
    for (const seen of grid.views.values()) seen.emit(frame);
  };

  const closeLane = (grid: Grid): Effect.Effect<void> => {
    const lane = grid.lane;
    if (lane === null) return Effect.void;
    grid.lane = null;
    return Effect.asVoid(close(lane.binding, OPERATOR));
  };

  const openLane = Effect.fnUntraced(function* (grid: Grid) {
    const opened = yield* Effect.result(executions.openBinding(OPERATOR, grid.execution));
    if (opened._tag === 'Failure' || opened.success._tag !== 'Bound') {
      yield* Effect.logInfo('the server could not open the lane it resizes a terminal through', {
        execution: grid.execution.execution,
        answer: opened._tag === 'Failure' ? opened.failure._tag : opened.success._tag,
      });
      return null;
    }
    const lane: GridLane = { binding: opened.success.binding, next: 0 };
    if (grids.get(keyOf(grid.execution)) !== grid || grid.views.size === 0) {
      yield* Effect.asVoid(close(lane.binding, OPERATOR));
      return null;
    }
    grid.lane = lane;
    return lane;
  });

  const sendResize = Effect.fnUntraced(function* (grid: Grid, box: TerminalBox): Effect.fn.Return<Resized> {
    const lane = grid.lane ?? (yield* openLane(grid));
    if (lane === null) return 'lost';
    const sent = yield* Effect.result(
      executions.input(
        grid.execution,
        { binding: lane.binding, principal: OPERATOR },
        { sequence: lane.next, cause: 'resize', act: { _tag: 'Resize', geometry: box } },
      ),
    );
    if (sent._tag === 'Failure') {
      const failure = sent.failure;
      if (failure._tag === 'HostRefused' && refusesLane(failure.refusal)) {
        yield* Effect.logDebug('the host refused the lane a terminal grid is sent through; it is opened again', {
          execution: grid.execution.execution,
          reason: failure.refusal.reason,
        });
        return 'refused';
      }
      yield* Effect.logInfo('a terminal grid was not applied', { execution: grid.execution.execution, reason: failure._tag });
      yield* closeLane(grid);
      return 'lost';
    }
    const outcome = sent.success;
    if (outcome._tag === 'InputAdmitted') {
      lane.next = outcome.receipt.sequence + 1;
      return 'admitted';
    }
    if (outcome._tag === 'InputConflict' || outcome._tag === 'InputReceiptExpired') return 'refused';
    yield* Effect.logInfo('a terminal grid was not applied', { execution: grid.execution.execution, outcome: outcome._tag });
    return 'lost';
  });

  const resize = Effect.fnUntraced(function* (grid: Grid, box: TerminalBox) {
    const first = yield* sendResize(grid, box);
    if (first !== 'refused') return first;
    yield* closeLane(grid);
    const second = yield* sendResize(grid, box);
    if (second !== 'admitted') yield* closeLane(grid);
    return second;
  });

  const apply = Effect.fnUntraced(function* (grid: Grid) {
    while (grids.get(keyOf(grid.execution)) === grid && grid.views.size > 0 && !grid.standing) {
      const decided = deciderOf(grid);
      if (decided === null) return;
      if (grid.applied !== null && sameBox(grid.applied, decided.box)) {
        if (grid.appliedBy !== decided.view) {
          grid.appliedBy = decided.view;
          broadcast(grid);
        }
        return;
      }
      const resized = yield* resize(grid, decided.box).pipe(
        Effect.withSpan('ExecutionGrids.apply', {
          attributes: {
            execution: grid.execution.execution,
            decider: decided.view,
            rows: decided.box.rows,
            columns: decided.box.columns,
          },
        }),
      );
      if (resized !== 'admitted') {
        if (grid.applied !== null) {
          grid.appliedBy = null;
          broadcast(grid);
        }
        return;
      }
      let sent = decided.box;
      let by: ViewId | null = decided.view;
      while (grid.standing && grid.applied !== null && !sameBox(grid.applied, sent)) {
        sent = grid.applied;
        by = grid.appliedBy;
        if ((yield* resize(grid, sent)) !== 'admitted') return;
      }
      if (grid.applied === null || !sameBox(grid.applied, sent) || grid.appliedBy !== by) {
        grid.applied = sent;
        grid.appliedBy = by;
        broadcast(grid);
      }
    }
  });

  const evaluate = (grid: Grid): Effect.Effect<void> => {
    if (grid.applying) return Effect.void;
    grid.applying = true;
    return Effect.asVoid(
      Effect.forkIn(
        apply(grid).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              grid.applying = false;
            }),
          ),
        ),
        scope,
      ),
    );
  };

  const executionGrids: ExecutionGrids = {
    watch: (execution, view, connection, box, emit) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          const grid = gridOf(execution);
          const seen: Seen = { connection, box: box ?? null, emit };
          if (grid.views.size === 0) grid.standing = false;
          grid.views.set(view, seen);
          if (grid.applied !== null) emit({ decider: grid.appliedBy });
          return Effect.as(evaluate(grid), seen);
        }),
        (seen) =>
          Effect.suspend(() => {
            const grid = grids.get(keyOf(execution));
            if (grid === undefined || grid.views.get(view) !== seen) return Effect.void;
            grid.views.delete(view);
            if (grid.views.size === 0) return closeLane(grid);
            return evaluate(grid);
          }),
      ).pipe(Effect.asVoid),
    report: (execution, view, connection, box) =>
      Effect.suspend(() => {
        const grid = grids.get(keyOf(execution));
        const seen = grid?.views.get(view);
        if (grid === undefined || seen === undefined || seen.connection !== connection) return Effect.succeed(false);
        const prior = seen.box;
        seen.box = box;
        if (deciderOf(grid)?.view === view && (prior === null || !sameBox(prior, box))) grid.standing = false;
        return Effect.as(evaluate(grid), true);
      }),
    admitted: (execution, lane, request, outcome) =>
      Effect.suspend(() => {
        if (outcome._tag !== 'InputAdmitted') return Effect.void;
        const act = request.act;
        const view = viewOf(lane.binding);
        const typed = view !== undefined && TYPING.has(request.cause) ? view : undefined;
        if (typed === undefined && act._tag !== 'Resize') return Effect.void;
        const grid = gridOf(execution);
        const moved = typed !== undefined && (grid.typed !== typed || grid.standing);
        if (typed !== undefined) {
          grid.typed = typed;
          grid.standing = false;
        }
        if (act._tag === 'Resize') {
          grid.applied = act.geometry;
          grid.appliedBy = view ?? null;
          if (view === undefined) grid.standing = true;
          broadcast(grid);
        }
        return moved || act._tag === 'Resize' ? evaluate(grid) : Effect.void;
      }),
    ended: (execution) =>
      Effect.suspend(() => {
        const grid = grids.get(keyOf(execution));
        if (grid === undefined) return Effect.void;
        grids.delete(keyOf(execution));
        return closeLane(grid);
      }),
    transferred: (execution) =>
      Effect.suspend(() => {
        const grid = grids.get(keyOf(execution));
        const lane = grid?.lane ?? null;
        if (grid === undefined || lane === null || lane.next === 0) return Effect.void;
        grid.lane = null;
        return Effect.asVoid(Effect.forkIn(Effect.asVoid(close(lane.binding, OPERATOR)), scope));
      }),
    holdsLane: (execution) => grids.get(keyOf(execution))?.lane != null,
    standing: (execution) => {
      const grid = grids.get(keyOf(execution));
      if (grid === undefined) return null;
      return {
        applied: grid.applied,
        decider: deciderOf(grid)?.view ?? null,
        views: grid.views.size,
        lane: grid.lane !== null,
      };
    },
  };
  return executionGrids;
});
