import { Effect, Option } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { sameProcess, type ProcessIdentity } from '@runlith/executions/protocol/evidence';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { ResidualEnding, ResidualResource } from '@runlith/executions/protocol/stop';
import { climb, type LadderAim } from '@runlith/executions/stopLadder';
import { ProcessControl } from './ProcessControl';
import type { HeldExecution } from './holder/Holder';
import { workAim } from './nativeLaunch';
import type { ProvenSet } from './ProvenSet';
import { Processes } from './ProcessReader';
import { killStray } from './strayProcesses';

export type ResidualProcess = {
  readonly origin: ExecutionRef;
  readonly identity: ProcessIdentity;
  readonly relation: NativeRelation;
  readonly detail: string;
};
const keyOf = (origin: ExecutionRef, pid: number): string =>
  JSON.stringify([origin.installation, origin.incarnation, origin.execution, pid]);

export type Residuals = {
  readonly capture: (
    origin: ExecutionRef,
    proven: ProvenSet | undefined,
    resources: ReadonlyArray<ResidualResource>,
    held?: HeldExecution,
  ) => Effect.Effect<void>;
  readonly all: Effect.Effect<ReadonlyArray<ResidualProcess>>;
  readonly drop: (rows: ReadonlyArray<ResidualProcess>) => Effect.Effect<void>;
  readonly end: (origin: ExecutionRef, pid: number) => Effect.Effect<ResidualEnding>;
};

export const makeResiduals = Effect.gen(function* () {
  const reader = Option.getOrUndefined(yield* Effect.serviceOption(Processes));
  const control = Option.getOrUndefined(yield* Effect.serviceOption(ProcessControl));
  const retained = new Map<string, ResidualProcess>();
  const workAims = new Map<string, LadderAim>();
  const capture = Effect.fnUntraced(function* (
    origin: ExecutionRef,
    proven: ProvenSet | undefined,
    resources: ReadonlyArray<ResidualResource>,
    held?: HeldExecution,
  ) {
    for (const resource of resources) {
      if (resource.kind !== 'process' || resource.pid === undefined || resource.pid <= 0) continue;
      if (resource.relation === 'work' && held !== undefined && held.work === resource.pid)
        workAims.set(keyOf(origin, resource.pid), workAim(held, proven, control));
      const witness = proven === undefined ? undefined : yield* proven.witness(resource.pid);
      retained.set(keyOf(origin, resource.pid), {
        origin,
        identity: witness ?? { pid: resource.pid },
        relation: resource.relation ?? 'ancestry',
        detail: resource.detail,
      });
    }
  });

  const all = Effect.sync(() => [...retained.values()]);

  function drop(rows: ReadonlyArray<ResidualProcess>): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const row of rows)
        if (retained.get(keyOf(row.origin, row.identity.pid)) === row) {
          retained.delete(keyOf(row.origin, row.identity.pid));
          workAims.delete(keyOf(row.origin, row.identity.pid));
        }
    });
  }

  const end = Effect.fnUntraced(function* (origin: ExecutionRef, pid: number): Effect.fn.Return<ResidualEnding> {
    const row = retained.get(keyOf(origin, pid));
    const refused = (
      reason: Extract<ResidualEnding, { _tag: 'Refused' }>['reason'],
      detail: string,
      steps: ResidualEnding['steps'] = [],
    ): ResidualEnding => ({ _tag: 'Refused', origin, pid, reason, detail, steps });
    if (row === undefined) return refused('not-residual', 'the ending names no retained residual under this origin and pid');
    if (row.relation === 'work') {
      const aim = workAims.get(keyOf(origin, pid));
      if (aim === undefined) return refused('identity-unproven', 'the ending retained no work authority');
      const result = yield* climb('terminate', [aim]);
      if (result.endedAt[0] === undefined) return { _tag: 'Survived', origin, pid, steps: result.steps };
      retained.delete(keyOf(origin, pid));
      workAims.delete(keyOf(origin, pid));
      return { _tag: 'Ended', origin, pid, steps: result.steps };
    }
    const expected = row.identity.birth;
    if (expected === undefined || reader === undefined)
      return refused('identity-unproven', 'the ending retained no start witness that could authorize a signal');
    let failure: 'identity-changed' | 'unreadable' | undefined;
    const standing = Effect.sync(() => {
      const read = reader.identity(pid);
      if (read._tag === 'Gone') return false;
      if (read._tag === 'Unreadable') {
        failure = 'unreadable';
        return false;
      }
      if (!sameProcess(read, row.identity)) {
        failure = 'identity-changed';
        return false;
      }
      return !read.zombie;
    });
    const result = yield* climb('terminate', [
      {
        gone: Effect.map(standing, (alive) => !alive),
        send: Effect.fnUntraced(function* (signal) {
          if (!(yield* standing)) return;
          yield* killStray(control)({ pid, birth: expected }, signal);
        }),
      },
    ]);
    if (failure !== undefined)
      return refused(
        failure,
        failure === 'identity-changed'
          ? 'the pid now holds another process; no signal was sent to its replacement'
          : 'the retained start witness could not be read again',
        result.steps,
      );
    if (result.endedAt[0] !== undefined) {
      retained.delete(keyOf(origin, pid));
      return { _tag: 'Ended', origin, pid, steps: result.steps };
    }
    return { _tag: 'Survived', origin, pid, steps: result.steps };
  });
  return { capture, all, drop, end } satisfies Residuals;
});
