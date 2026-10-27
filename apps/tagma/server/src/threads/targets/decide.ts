import { createHash } from 'node:crypto';
import { ThreadCallBroke, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadContextConflictError, type ThreadContextAnswer, type ThreadContextAsk } from '@runlith/agent/thread/run/ThreadRunContexts';
import { Effect, Schema } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Assignment, AssignmentActor } from '../../workspace/contract/wire/assignments.js';
import { SelectionRevision } from '../../workspace/contract/wire/assignments.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { AssignmentRefused } from '../../workspace/contract/wire/assignments.js';
import { RootConflict, RootInvalid, RootMissing, RootRefused, RootUnavailable } from '../../workspace/contract/wire/roots.js';
import { placementRefusal, type PlacementFailure } from './placementRefusal.js';
import { ThreadTargetOperationKey } from '../contract/wire/target.js';
import {
  targetSourceKey,
  type ThreadTargetCaller,
  type ThreadTargetChange,
  type ThreadTargetChangeInput,
  type ThreadTargetRead,
  type ThreadTargetReadInput,
} from '../contract/wire/target.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import { TargetPreparation, type TargetThread, type WorldAcquire } from '../contract/service/preparation.js';
import { Assignments } from '../../workspace/contract/service/assignments.js';
import { TargetSnapshots, type TargetStoreFailure } from '../contract/service/targetSnapshots.js';
import {
  makeThreadTargetOperationStore,
  ThreadTargetStorageFailed,
  type ThreadTargetOperation,
  type ThreadTargetOperationFailure,
} from '../store/targetIntents.js';
import { threadTargetOperation } from '../store/tables.js';
import { assignmentMembership, assignmentSelection } from '../../workspace/store/tables.js';
import type { ThreadHomes } from '../contract/service/homes.js';
import type { HomeMove } from '../../thread-record/contract/service/homes.js';

export type ThreadTargetFailure =
  | StoreFailure
  | GateRefusal
  | TargetStoreFailure
  | ThreadTargetOperationFailure
  | ThreadCallBroke
  | ThreadStorageFailed;

export type ThreadTargetKernel = {
  readonly request: (runId: string, ask: ThreadContextAsk<WriteUnit<'machine'>>) => Effect.Effect<ThreadContextAnswer, ThreadBorderFailed>;
};

export type ThreadTargetCreations = {
  readonly of: (
    operationId: string,
  ) => Effect.Effect<{ readonly operationId: string; readonly rootId: string | null } | null, StoreFailure | ThreadStorageFailed>;
};

export type ThreadTargetThreads = {
  readonly facetOf: (
    threadId: string,
  ) => Effect.Effect<{ readonly projectId: number; readonly hostKind: string | null } | undefined, StoreFailure>;
};

export type TargetEffects = {
  readonly kernel: ThreadTargetKernel;
  readonly acquire: WorldAcquire;
  readonly homes?: ThreadHomes['Service'];
};

const crossing = (caller: ThreadTargetCaller, input: ThreadTargetChangeInput): number | null =>
  input.home === undefined || input.home === caller.projectId ? null : input.home;

export type ThreadTargets = Effect.Success<ReturnType<typeof makeThreadTargets>>;

export const makeThreadTargets = Effect.fnUntraced(function* ({
  threads,
  creations,
}: {
  readonly threads: ThreadTargetThreads;
  readonly creations: ThreadTargetCreations;
}) {
  const units = yield* MachineUnits;
  const assignments = yield* Assignments;
  const contexts = yield* TargetPreparation;
  const snapshots = yield* TargetSnapshots;
  const operations = yield* makeThreadTargetOperationStore;
  const change: (
    caller: ThreadTargetCaller,
    input: ThreadTargetChangeInput,
    ports: TargetEffects,
  ) => Effect.Effect<ThreadTargetChange, ThreadTargetFailure> = Effect.fn('ThreadTargets.change')(function* (
    caller: ThreadTargetCaller,
    input: ThreadTargetChangeInput,
    ports: TargetEffects,
  ): Effect.fn.Return<ThreadTargetChange, ThreadTargetFailure> {
    const digest = digestOf(input);
    const home = crossing(caller, input);
    const homes = home === null ? undefined : ports.homes;
    if (home !== null && homes === undefined) {
      return yield* Effect.die(new Error('A move into another project reached the targets without the owner of thread homes.'));
    }
    const shift =
      home === null || homes === undefined ? null : { homes, move: { threadId: input.threadId, from: caller.projectId, to: home } };
    const decided = yield* units.write(
      writes(
        'ThreadTargets.decided',
        [threadTargetOperation, assignmentMembership, assignmentSelection],
        ...(homes === undefined ? [] : [homes.writes]),
      ),
      (unit) => decide(caller, input, digest, unit, shift),
    );
    if (decided.kind === 'replay') return yield* replay(caller, decided.row, digest, ports);
    if (decided.kind === 'idle') {
      return { status: 'selected', operationKey: input.operationKey, revision: decided.revision };
    }
    const thread: TargetThread = { id: input.threadId, projectId: home ?? caller.projectId };
    const prepared = yield* Effect.result(
      contexts.prepare(
        {
          thread,
          runId: decided.runId,
          fromGeneration: decided.fromGeneration,
          requestId: input.operationKey,
          home:
            shift === null
              ? undefined
              : {
                  root: input.root,
                  revision: decided.revision,
                  actor: caller.actor,
                  shift: (unit) => shift.homes.move(unit, shift.move),
                },
        },
        ports.acquire,
      ),
    );
    if (prepared._tag === 'Failure') {
      const failure = prepared.failure;
      const detail =
        failure instanceof GateRefusal
          ? failure.reason
          : typeof failure === 'object' &&
              failure !== null &&
              '_tag' in failure &&
              (failure as { _tag: unknown })._tag === 'WorldUnavailable'
            ? failure instanceof Error
              ? failure.message
              : String(failure)
            : undefined;
      if (detail === undefined) return yield* Effect.fail(failure as StoreFailure);
      yield* units.write(writes('ThreadTargets.change', [threadTargetOperation]), (unit) =>
        operations.settle(input.threadId, input.operationKey, { status: 'failed', detail }, unit),
      );
      return { status: 'failed', operationKey: input.operationKey, detail };
    }
    const asked = yield* Effect.result(
      ports.kernel.request(decided.runId, {
        requestId: input.operationKey,
        sourceKey: prepared.success.ask.sourceKey,
        commit: prepared.success.ask.commit,
      }),
    );
    return yield* resolveAsk(input.threadId, input.operationKey, decided.runId, asked);
  });

  const read: (
    caller: ThreadTargetCaller,
    input: ThreadTargetReadInput,
    ports: Pick<TargetEffects, 'kernel'>,
  ) => Effect.Effect<ThreadTargetRead, ThreadTargetFailure> = Effect.fn('ThreadTargets.read')(function* (
    caller: ThreadTargetCaller,
    input: ThreadTargetReadInput,
    ports: Pick<TargetEffects, 'kernel'>,
  ): Effect.fn.Return<ThreadTargetRead, ThreadTargetFailure> {
    const seen = yield* units.read(
      Effect.fnUntraced(function* (unit) {
        yield* checkThread(caller, input.threadId);
        if (input.operationKey !== undefined) {
          const row = yield* operations.of(input.threadId, input.operationKey, unit);
          if (row === undefined) {
            return yield* new GateRefusal('not-found', `No target move ${input.operationKey} of thread ${input.threadId} stands.`, [
              'Name the operation key the change call carried.',
            ]);
          }
          return { kind: 'row' as const, row };
        }
        const assignment = yield* assignments.read(unit, input.threadId).pipe(refusing);
        const active = yield* snapshots.readActive(input.threadId, unit);
        if (active.state === 'admitted') return { kind: 'effective' as const, active };
        if (active.state === 'unavailable' && active.reason === 'no-target') {
          return {
            kind: 'unavailable' as const,
            detail: `Run ${active.runId} works generation ${active.generation}, and no destination was recorded for it.`,
          };
        }
        return {
          kind: 'selection' as const,
          revision: assignment.selection.revision,
          rootId: assignment.selection.rootId,
        };
      }),
    );
    if (seen.kind === 'effective') return { state: 'effective', target: seen.active.target };
    if (seen.kind === 'selection') return { state: 'selected', revision: seen.revision, rootId: seen.rootId };
    if (seen.kind === 'unavailable') return { state: 'failed', operationKey: null, detail: seen.detail };
    return yield* replayRead(seen.row, ports);
  });

  const decide = Effect.fn('ThreadTargets.decide')(function* (
    caller: ThreadTargetCaller,
    input: ThreadTargetChangeInput,
    digest: string,
    unit: WriteUnit<'machine'>,
    shift: HomeShift | null,
  ): Effect.fn.Return<
    | { readonly kind: 'replay'; readonly row: ThreadTargetOperation }
    | { readonly kind: 'idle'; readonly revision: SelectionRevision }
    | {
        readonly kind: 'active';
        readonly runId: string;
        readonly fromGeneration: WorkspaceGeneration;
        readonly revision: SelectionRevision;
      },
    ThreadTargetFailure
  > {
    const standing = yield* operations.of(input.threadId, input.operationKey, unit);
    if (standing !== undefined) return { kind: 'replay', row: standing };
    const facet = yield* checkThread(caller, input.threadId);
    yield* checkActor(caller, input.threadId, unit);
    if (facet.hostKind !== null) {
      return yield* new GateRefusal(
        'guest-mobility',
        `Thread ${input.threadId} was born against a ${facet.hostKind} host and keeps that world's root; a registered local root is not a move for it.`,
        ["Work in the thread's own world, or open a checkout thread for local trees."],
      );
    }
    const assignment = yield* assignments.read(unit, input.threadId).pipe(refusing);
    if (input.expectedSelectionRevision !== undefined && assignment.selection.revision !== input.expectedSelectionRevision) {
      return yield* new GateRefusal(
        'stale-revision',
        `Thread ${input.threadId} stands at selection revision ${assignment.selection.revision}, not the decided ${input.expectedSelectionRevision}.`,
        ["Read the thread's placement and decide the move against what stands."],
      );
    }
    if (input.creationOperationId !== undefined) {
      const receipt = yield* creations.of(input.creationOperationId);
      if (receipt === null) {
        return yield* new GateRefusal(
          'creation-unknown',
          `Creation ${input.creationOperationId} stands in no recorded operation: it was never made here.`,
          ['Create through the owning operation first, then hand its recorded id back.'],
        );
      }
      if (receipt.rootId !== null && receipt.rootId !== input.root.rootId) {
        return yield* new GateRefusal(
          'creation-mismatch',
          `Creation ${input.creationOperationId} made another checkout: a receipt authorizes the move into the tree it made, and no other.`,
          ['Move into the checkout the creation made, or create the tree this move should enter.'],
        );
      }
    }
    const active = yield* snapshots.readActive(input.threadId, unit);
    const homeId = shift === null ? null : shift.move.to;
    if (active.state === 'unavailable' && active.reason === 'no-run') {
      const selected = yield* select(caller.actor, input, unit);
      if (shift !== null) yield* shift.homes.move(unit, shift.move);
      const row = yield* operations.insert(
        {
          threadId: input.threadId,
          operationKey: input.operationKey,
          projectId: caller.projectId,
          homeId,
          payloadDigest: digest,
          rootId: input.root.rootId,
          locationRevision: input.root.locationRevision,
          expectedSelectionRevision: input.expectedSelectionRevision ?? null,
          selectionRevision: selected.selection.revision,
          expectedGeneration: input.expectedGeneration ?? null,
          fromGeneration: null,
          creationOperationId: input.creationOperationId ?? null,
          runId: null,
          status: 'selected',
        },
        unit,
      );
      if (row.payloadDigest !== digest) return { kind: 'replay', row };
      return { kind: 'idle', revision: SelectionRevision.make(row.selectionRevision) };
    }
    const runId = active.state === 'admitted' ? active.target.runId : active.runId;
    const generation = active.state === 'admitted' ? active.target.generation : active.generation;
    if (input.expectedGeneration !== undefined && generation !== input.expectedGeneration) {
      return yield* new GateRefusal(
        'stale-generation',
        `Run ${runId} has reached generation ${generation}, not the decided ${input.expectedGeneration}.`,
        ["Read the run's context changes and decide the move against the generation it stands in."],
      );
    }
    if (shift !== null) yield* shift.homes.admit(unit, shift.move);
    const revision = shift === null ? (yield* select(caller.actor, input, unit)).selection.revision : assignment.selection.revision;
    const row = yield* operations.insert(
      {
        threadId: input.threadId,
        operationKey: input.operationKey,
        projectId: caller.projectId,
        homeId,
        payloadDigest: digest,
        rootId: input.root.rootId,
        locationRevision: input.root.locationRevision,
        expectedSelectionRevision: input.expectedSelectionRevision ?? null,
        selectionRevision: revision,
        expectedGeneration: input.expectedGeneration ?? null,
        fromGeneration: generation,
        creationOperationId: input.creationOperationId ?? null,
        runId,
        status: 'pending',
      },
      unit,
    );
    if (row.payloadDigest !== digest) return { kind: 'replay', row };
    return { kind: 'active', runId, fromGeneration: generation, revision: SelectionRevision.make(revision) };
  });

  const replay = Effect.fn('ThreadTargets.replay')(function* (
    caller: ThreadTargetCaller,
    row: ThreadTargetOperation,
    digest: string,
    ports: Pick<TargetEffects, 'kernel'>,
  ): Effect.fn.Return<ThreadTargetChange, ThreadTargetFailure> {
    yield* checkThread(caller, row.threadId);
    yield* units.read((unit) => checkActor(caller, row.threadId, unit));
    if (row.payloadDigest !== digest) {
      return yield* new GateRefusal(
        'changed-payload',
        `Operation ${row.operationKey} already decided a move of thread ${row.threadId}; carrying anything else under it refuses.`,
        ['Mint a fresh operation key for the changed move.'],
      );
    }
    const key = yield* keyOf(row.operationKey);
    if (row.status === 'selected') {
      return {
        status: 'selected',
        operationKey: key,
        revision: SelectionRevision.make(row.selectionRevision),
      };
    }
    if (row.status === 'failed') {
      return { status: 'failed', operationKey: key, detail: row.detail ?? 'The move was refused.' };
    }
    if (row.status === 'applied') {
      if (row.generation === null) {
        return yield* new ThreadTargetStorageFailed({
          key: `${row.threadId}/${row.operationKey}`,
          cause: new Error('The applied move stands without the generation it was published at.'),
        });
      }
      return { status: 'applied', operationKey: key, generation: WorkspaceGeneration.make(row.generation) };
    }

    const live = yield* units.read(
      Effect.fnUntraced(function* (unit) {
        const active = yield* snapshots.readActive(row.threadId, unit);
        if (active.state === 'unavailable' || active.target.runId !== row.runId) {
          return { kind: 'settled-gone' as const };
        }
        const assignment = yield* assignments.read(unit, ThreadId.make(row.threadId)).pipe(refusing);
        if (!crossed(row) && assignment.selection.revision !== row.selectionRevision) {
          return { kind: 'overtaken' as const };
        }
        return { kind: 'standing' as const, runId: active.target.runId };
      }),
    );
    if (live.kind === 'settled-gone') {
      return yield* fail(row.threadId, key, 'The run this move was asked of ended before another step boundary.');
    }
    if (live.kind === 'overtaken') {
      return yield* fail(row.threadId, key, 'The placement this move was prepared from has been overtaken by a newer selection.');
    }
    const asked = yield* Effect.result(
      ports.kernel.request(live.runId, {
        requestId: row.operationKey,
        sourceKey: targetSourceKey(RootId.make(row.rootId)),
      }),
    );
    return yield* resolveAsk(row.threadId, key, live.runId, asked);
  });

  const replayRead = Effect.fn('ThreadTargets.replayRead')(function* (
    row: ThreadTargetOperation,
    ports: Pick<TargetEffects, 'kernel'>,
  ): Effect.fn.Return<ThreadTargetRead, ThreadTargetFailure> {
    if (row.status === 'selected') {
      return {
        state: 'selected',
        revision: SelectionRevision.make(row.selectionRevision),
        rootId: RootId.make(row.rootId),
      };
    }
    const key = yield* keyOf(row.operationKey);
    if (row.status === 'failed') {
      return { state: 'failed', operationKey: key, detail: row.detail ?? 'The move was refused.' };
    }
    if (row.status === 'applied') {
      const target = yield* units.read((unit) =>
        snapshots.at(
          {
            threadId: row.threadId,
            runId: row.runId ?? row.threadId,
            generation: WorkspaceGeneration.make(row.generation ?? 0),
          },
          unit,
        ),
      );
      if (target === undefined) {
        return {
          state: 'failed',
          operationKey: key,
          detail: 'The boundary published this move, and no destination was recorded for its generation.',
        };
      }
      return { state: 'effective', target };
    }

    const live = yield* units.read(
      Effect.fnUntraced(function* (unit) {
        const active = yield* snapshots.readActive(row.threadId, unit);
        if (active.state === 'unavailable' || active.target.runId !== row.runId) {
          return { kind: 'settled-gone' as const };
        }
        return { kind: 'standing' as const, runId: active.target.runId, generation: active.target.generation };
      }),
    );
    if (live.kind === 'settled-gone') {
      return { state: 'failed', operationKey: key, detail: 'The run this move was asked of ended before another step boundary.' };
    }
    const outcome = yield* ports.kernel
      .request(live.runId, {
        requestId: row.operationKey,
        sourceKey: targetSourceKey(RootId.make(row.rootId)),
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === 'ThreadCallBroke' || cause._tag === 'ThreadStorageFailed' ? cause : new ThreadCallBroke({ cause }),
        ),
      );
    if (outcome.status === 'published') {
      const target = yield* units.read((unit) =>
        snapshots.at({ threadId: row.threadId, runId: live.runId, generation: WorkspaceGeneration.make(outcome.generation) }, unit),
      );
      return target === undefined
        ? {
            state: 'failed',
            operationKey: key,
            detail: 'The boundary published this move, and no destination was recorded for its generation.',
          }
        : { state: 'effective', target };
    }
    if (outcome.status === 'denied') {
      return { state: 'failed', operationKey: key, detail: outcome.detail };
    }
    return { state: 'pending', operationKey: key, requestId: key, fromGeneration: live.generation };
  });

  const resolveAsk = Effect.fn('ThreadTargets.resolveAsk')(function* (
    threadId: string,
    operationKey: ThreadTargetOperationKey,
    runId: string,
    asked:
      | { readonly _tag: 'Success'; readonly success: ThreadContextAnswer }
      | { readonly _tag: 'Failure'; readonly failure: ThreadBorderFailed },
  ): Effect.fn.Return<ThreadTargetChange, ThreadTargetFailure> {
    if (asked._tag === 'Failure') {
      const failure = asked.failure;
      if (failure._tag === 'ThreadCallBroke' && failure.cause instanceof ThreadContextConflictError) {
        return yield* fail(threadId, operationKey, failure.cause.message);
      }
      if (failure._tag === 'ThreadCallBroke' && failure.cause instanceof Error) {
        return yield* fail(threadId, operationKey, failure.cause.message);
      }
      if (failure._tag === 'ThreadCallBroke' || failure._tag === 'ThreadStorageFailed') return yield* failure;
      return yield* fail(threadId, operationKey, failure.message);
    }
    const outcome = asked.success;
    if (outcome.status === 'denied') {
      return yield* fail(threadId, operationKey, outcome.detail);
    }
    if (outcome.status === 'published') {
      const settled = yield* units.write(writes('ThreadTargets.settled', [threadTargetOperation]), (unit) =>
        operations.settle(threadId, operationKey, { status: 'applied', generation: outcome.generation }, unit),
      );
      if (settled.won) {
        return { status: 'applied', operationKey, generation: WorkspaceGeneration.make(outcome.generation) };
      }
      return yield* outcomeOf(settled.row, threadId, operationKey);
    }
    return {
      status: 'pending',
      operationKey,
      requestId: outcome.requestId,
      fromGeneration: WorkspaceGeneration.make(outcome.fromGeneration),
    };
  });

  const fail = Effect.fn('ThreadTargets.fail')(function* (
    threadId: string,
    operationKey: ThreadTargetOperationKey,
    detail: string,
  ): Effect.fn.Return<ThreadTargetChange, ThreadTargetFailure> {
    const settled = yield* units.write(writes('ThreadTargets.settled', [threadTargetOperation]), (unit) =>
      operations.settle(threadId, operationKey, { status: 'failed', detail }, unit),
    );
    if (settled.won) return { status: 'failed', operationKey, detail };
    return yield* outcomeOf(settled.row, threadId, operationKey);
  });

  const outcomeOf = Effect.fn('ThreadTargets.outcomeOf')(function* (
    row: ThreadTargetOperation | undefined,
    threadId: string,
    operationKey: ThreadTargetOperationKey,
  ): Effect.fn.Return<ThreadTargetChange, ThreadTargetFailure> {
    if (row === undefined || row.status === 'pending') {
      return yield* new ThreadTargetStorageFailed({
        key: `${threadId}/${operationKey}`,
        cause: new Error('The settled move stands unsettled: its row was removed or never decided under it.'),
      });
    }
    if (row.status === 'selected') {
      return {
        status: 'selected',
        operationKey,
        revision: SelectionRevision.make(row.selectionRevision),
      };
    }
    if (row.status === 'applied') {
      if (row.generation === null) {
        return yield* new ThreadTargetStorageFailed({
          key: `${row.threadId}/${row.operationKey}`,
          cause: new Error('The applied move stands without the generation it was published at.'),
        });
      }
      return { status: 'applied', operationKey, generation: WorkspaceGeneration.make(row.generation) };
    }
    return { status: 'failed', operationKey, detail: row.detail ?? 'The move was refused.' };
  });

  const select = Effect.fn('ThreadTargets.select')(function* (
    actor: AssignmentActor,
    input: ThreadTargetChangeInput,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<Assignment, ThreadTargetFailure> {
    return yield* assignments.select(unit, { actor, threadId: input.threadId, root: input.root }).pipe(refusing);
  });

  const checkThread = Effect.fn('ThreadTargets.checkThread')(function* (
    caller: ThreadTargetCaller,
    threadId: string,
  ): Effect.fn.Return<{ readonly projectId: number; readonly hostKind: string | null }, ThreadTargetFailure> {
    const facet = yield* threads.facetOf(threadId);
    if (facet === undefined) {
      return yield* new GateRefusal('not-found', `This surface holds no thread ${threadId}.`, [
        'Open the thread through the project thread door.',
      ]);
    }
    if (facet.projectId !== caller.projectId) {
      return yield* new GateRefusal(
        'foreign-project',
        `Thread ${threadId} answers to another project: an id travels, and a move is not a thing another project's caller may see.`,
        ['Call under the project the thread was opened in.'],
      );
    }
    return facet;
  });

  const checkActor = Effect.fn('ThreadTargets.checkActor')(function* (
    caller: ThreadTargetCaller,
    threadId: string,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<void, ThreadTargetFailure> {
    yield* assignments.mayAct(caller.actor, ThreadId.make(threadId), unit).pipe(refusing);
  });
  return { change, read };
});

const keyOf = (operationKey: string): Effect.Effect<ThreadTargetOperationKey, ThreadTargetOperationFailure> =>
  Schema.decodeUnknownEffect(ThreadTargetOperationKey)(operationKey).pipe(
    Effect.mapError((cause) => new ThreadTargetStorageFailed({ key: operationKey, cause })),
  );

const digestOf = (input: ThreadTargetChangeInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        rootId: input.root.rootId,
        locationRevision: input.root.locationRevision,
        expectedSelectionRevision: input.expectedSelectionRevision ?? null,
        expectedGeneration: input.expectedGeneration ?? null,
        creationOperationId: input.creationOperationId ?? null,
        ...(input.home === undefined ? {} : { home: input.home }),
      }),
    )
    .digest('hex');

const crossed = (row: ThreadTargetOperation): boolean => row.homeId !== null && row.homeId !== row.projectId;

type HomeShift = { readonly homes: ThreadHomes['Service']; readonly move: HomeMove };

const refusedPlacement = (failure: PlacementFailure): GateRefusal => {
  if (failure instanceof AssignmentRefused) {
    if (failure.reason === 'unknown-thread') {
      return new GateRefusal('not-found', failure.message, ['Open the thread through the project thread door.']);
    }
    if (failure.reason === 'out-of-reach') {
      return new GateRefusal('denied', failure.message, ['act as the operator, or as the thread itself or one of its ancestors']);
    }
  }
  if (
    failure instanceof RootMissing ||
    failure instanceof RootUnavailable ||
    (failure instanceof RootConflict && failure.reason === 'replaced')
  ) {
    return new GateRefusal('target-root-unavailable', failure.message, [
      'Select a registered root for this thread, or register the tree it should work in.',
    ]);
  }
  if (failure instanceof RootInvalid || failure instanceof RootConflict || failure instanceof RootRefused) {
    return new GateRefusal('stale-revision', failure.message, ["Read the thread's placement and decide the move against what stands."]);
  }
  return new GateRefusal('target-placement-unreadable', failure.message, [
    "Read the thread's assignment, and try the move again once storage answers.",
  ]);
};

const refusing = placementRefusal(refusedPlacement);
