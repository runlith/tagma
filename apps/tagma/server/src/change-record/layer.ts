import { Effect, Layer } from 'effect';
import { and, eq } from 'drizzle-orm';
import { RootHoldings } from '../workspace/contract/service/roots.js';
import { standing, workspaceChange } from './store/tables.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { CheckoutPaths, CheckoutUnknown, type PlaceUnread } from '../workspace/contract/service/checkoutPaths.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import type { WorkingRoot } from '../workspace/contract/wire/place.js';
import { type CommandLife, IntakeRefused, type Reached, type Unplaced } from '@runlith/agent-tools/WorkspaceChanges';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { CommandWrites } from './record/commands.js';
import { Rewrites } from './record/rewrites.js';
import {
  type ChangePaths,
  ChangeRecord,
  type ChangeWork,
  type HeldChanges,
  type ThreadChangePath,
  OutcomeUnread,
} from './contract/service/record.js';
import { heldPathsOfProject, movedTo, pathsOfThread } from './record/reads.js';
import { turnsOf } from './changes/turns.js';
import { Git } from '@runlith/git/Git';
import { columnsOf, outcomesOf } from './record/outcomes.js';
import { evidenceOfPath, heldOfThread, versionTexts } from './record/evidence.js';
import type { RowIntake } from './record/intake.js';
import type { IntakeWork } from './contract/service/intake.js';
import { runFilesOver } from './record/runFiles.js';
import { sweepRetained } from './record/retained.js';
import { reshapeOver } from './record/reshape.js';
import { makeRetireStore } from './retire/store.js';
import type { Walks } from './lines/walks.js';
import { checkoutAt } from '../workspace/roots/proof.js';

export const changeRecordInstallationLayer = Layer.mergeAll(
  Layer.effect(
    RootHoldings,
    Effect.map(MachineStore, (store) => ({
      has: (unit, rootId) =>
        Effect.map(
          unit.run(
            store.db
              .select({ id: workspaceChange.id })
              .from(workspaceChange)
              .where(and(eq(workspaceChange.checkout, rootId), standing))
              .limit(1),
          ),
          (rows) => rows.length > 0,
        ),
    })),
  ),
);

const workOf = (work: ChangeWork): IntakeWork => ({
  projectId: work.work.projectId,
  holder: { kind: 'thread', thread: work.work.threadId },
});

export const makeChangeRecord = Effect.fnUntraced(function* ({
  intake,
  commands,
  walks,
  rewrites = new Rewrites(),
}: {
  readonly intake: RowIntake;
  readonly commands: CommandWrites;
  readonly walks: Walks;
  readonly rewrites?: Rewrites;
}) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const paths = yield* CheckoutPaths;
  const graphDirectory = yield* GraphDirectory;
  const git = yield* Git;

  const reached = (at: readonly string[]): Effect.Effect<Reached> =>
    Effect.map(
      Effect.forEach(at, (path) => Effect.result(paths.resourceAcross(path)), { concurrency: 8 }),
      (placed) => {
        const trees = new Set<string>();
        const unplaced: Unplaced[] = [];
        for (const [index, one] of placed.entries()) {
          if (one._tag === 'Failure') unplaced.push({ path: at[index] as string, reason: one.failure.reason });
          else if (one.success !== null) trees.add(one.success.root);
        }
        return { trees: [...trees], unplaced };
      },
    ).pipe(Effect.withSpan('ChangeRecord.checkouts'));

  const changes = (work: ChangeWork): ReturnType<ChangeRecord['Service']['changes']> => ({
    land: (facts, write) => intake.land(workOf(work), facts, write),
    landEach: (facts, write) => intake.landEach(workOf(work), facts, write),
    turn: (paths, run, target) => intake.turn(work.work.projectId, paths, run, target),
    basis: (paths, run) => intake.basis(work.work.projectId, paths, run),
    normalized: (path) => intake.normalized(work.work.projectId, path),
    records: (paths, target) => intake.records(work.work.projectId, paths, target),
    checkouts: reached,
    command: (tree, facts) =>
      Effect.flatMap(
        Effect.mapError(paths.resourceAcross(tree), (failure) => new IntakeRefused({ path: tree, reason: failure.reason })),
        (place): Effect.Effect<CommandLife | null> => {
          if (place === null || place.path !== '') return Effect.succeed(null);
          const opening = {
            projectId: work.work.projectId,
            threadId: work.work.threadId,
            runHint: work.runHint ?? null,
            spelling: place.root,
            key: place.checkout,
          };
          return facts.readsOnly ? Effect.succeed(commands.reading(opening)) : commands.open(opening, facts, tree);
        },
      ),
    rewrittenBy: Effect.fnUntraced(function* (path, text) {
      const place = yield* Effect.result(paths.resourceAcross(path));
      if (place._tag === 'Failure') {
        yield* Effect.logWarning('no rewrite is named for a path whose checkout could not be read', { path, reason: place.failure.reason });
        return null;
      }
      return place.success === null ? null : rewrites.by(place.success.checkout, place.success.path, text);
    }),
  });

  function held(request: Extract<HeldChanges, { readonly kind: 'thread' }>): ReturnType<typeof heldOfThread>;
  function held(request: Extract<HeldChanges, { readonly kind: 'path' }>): ReturnType<typeof evidenceOfPath>;
  function held(request: HeldChanges) {
    return request.kind === 'thread'
      ? Effect.andThen(commands.settled(request), heldOfThread(units, store, request.projectId, request.threadId))
      : Effect.andThen(
          commands.settled({ checkout: request.place.checkout, paths: [request.place.path] }),
          evidenceOfPath(units, store, request.place),
        );
  }

  const checkoutOf = (projectId: number, origin: WorkingRoot | null): Effect.Effect<string, PlaceUnread | CheckoutUnknown> =>
    origin === null
      ? Effect.fail(
          new CheckoutUnknown({ path: '', reason: 'the session stands in no proved checkout, so whose paths it holds is unknown' }),
        )
      : Effect.flatMap(paths.placeAcross(origin.root.path), (place) =>
          place === null || place.path !== ''
            ? Effect.fail(new CheckoutUnknown({ path: origin.root.path, reason: 'the root is not a registered checkout' }))
            : Effect.succeed(place.checkout),
        );

  function heldPaths(
    request: Extract<ChangePaths, { readonly kind: 'thread' }>,
  ): Effect.Effect<readonly ThreadChangePath[], StoreFailure | PlaceUnread | CheckoutUnknown>;
  function heldPaths(
    request: Extract<ChangePaths, { readonly kind: 'project' }>,
  ): Effect.Effect<readonly string[], StoreFailure | PlaceUnread | CheckoutUnknown>;
  function heldPaths(request: ChangePaths): Effect.Effect<unknown, StoreFailure | PlaceUnread | CheckoutUnknown> {
    return Effect.flatMap(checkoutOf(request.projectId, request.origin), (checkout): Effect.Effect<unknown, StoreFailure> =>
      request.kind === 'thread'
        ? Effect.andThen(commands.settled(request), pathsOfThread(units, store, request.projectId, request.threadId, checkout))
        : Effect.andThen(commands.settled({ checkout }), heldPathsOfProject(units, store, checkout)),
    );
  }

  const record = ChangeRecord.of({
    changes,
    land: (work, facts, write) => intake.land(workOf(work), facts, write),
    turn: intake.turn,
    report: (work, facts) => intake.report(workOf(work), facts),
    versions: (digests) => versionTexts(units, store, digests),
    checkout: (projectId, root) => checkoutAt(paths, projectId, root),
    turns: Effect.fnUntraced(function* (request) {
      yield* commands.settled(request);
      const outcome =
        request.outcomes === undefined
          ? yield* outcomesOf(units, store, git, paths, request.projectId, request.threadId)
          : columnsOf(request.outcomes);
      if (request.outcomes === undefined && outcome.known.unread.length > 0)
        return yield* new OutcomeUnread({ message: outcome.known.unread.map((one) => `${one.checkout}: ${one.reason}`).join('; ') });
      return yield* turnsOf(units, store, request.projectId, request.threadId, request.limit, request.after, outcome);
    }),
    held,
    paths: heldPaths,
    movedTo: (from) => movedTo(units, store, from),
    unattributed: commands.unattributed,
    sweep: (git, root, checkout) => sweepRetained(commands, units, store, git, root, checkout),
    runFiles: (checkout, selection, page) => runs.runFiles(checkout, selection, page),
    revertLines: (checkout, selection) => runs.revertLines(checkout, selection),
    reshapeRead: (checkout, reshaped) => reshaping.reshapeRead(checkout, reshaped),
    reshape: (checkout, inputs, holder, owing) => reshaping.reshape(checkout, inputs, holder, owing),
  });
  const runs = runFilesOver(units, store, record, paths, graphDirectory, walks);
  const reshaping = reshapeOver(record, commands, rewrites, paths, graphDirectory, walks, yield* makeRetireStore);
  return record;
});
