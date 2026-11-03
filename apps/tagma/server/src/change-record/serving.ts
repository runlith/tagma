import { Clock, Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Background } from '../platform/contract/service/background.js';
import { CheckoutHoldings, CheckoutRows, CommitOverlay, GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { RootId } from '../workspace/contract/wire/ids.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { WorkingOrigins } from '../workspace/contract/service/places.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { namesOfHolders, teamOf } from './record/sessions.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { makeChangeRecord } from './layer.js';
import { Retirement } from './contract/service/retirement.js';
import { makeRetirer } from './retire/driver.js';
import { HeldFeed } from './contract/service/held.js';
import { makeWalks, type Walks } from './lines/walks.js';
import { CommandChanges } from './contract/service/commands.js';
import { ChangeRecord } from './contract/service/record.js';
import { LinesUnread, PreparedChanges, type PreparedFns } from './contract/service/prepared.js';
import { CommitShape } from './contract/service/shape.js';
import { Authorship } from './contract/service/authorship.js';
import { ThreadChanges } from './contract/service/threadChanges.js';
import { authorshipOver } from './threadFiles/authorship.js';
import { threadChangesOver } from './changes/stream.js';
import { commitOverlay } from './record/overlay.js';
import { makePreparedChanges, sweepPreparedIndexes } from './prepared/change.js';
import { eligiblePaths, pathChunks } from './prepared/eligible.js';
import { evidenceInGroups } from './record/evidence.js';
import { heldFeed } from './record/held.js';
import { makeCommandQueue } from './record/queue.js';
import { commandRows } from './record/commandRows.js';
import { makeCommandWrites } from './record/commands.js';
import { Lives } from './record/lives.js';
import { makeRowIntake } from './record/intake.js';
import { Intake } from './contract/service/intake.js';
import { makeHeads } from './record/heads.js';
import { makeCommandJournal } from './record/journal.js';
import { makeLessons } from './record/lessons.js';
import { recoverCommands } from './record/recovery.js';
import { settleIntents } from './record/intents.js';
import { checkoutsOfHolders, heldPathsOf } from './record/reads.js';
import { collecting, collectionSweep } from './record/collection.js';
import { scheduleSweeps } from '../platform/contract/service/maintenance.js';
import { drive } from '../platform/contract/service/drives.js';
import { claimPreparedInstance, preparedBase } from './prepared/subject.js';
import { Holdings } from './contract/service/holdings.js';
import { judgedChange, makeJudges } from './holdings/judges.js';
import { foldMemoryBudget } from './lines/memory.js';
import { FoldMemory } from './lines/memory.js';
import { makeGitMetadata, pruneMetadata } from './record/metadata.js';
import { formChangeHomes } from './store/homes.js';

export const preparedChangesOver = (
  commands: CommandChanges['Service'],
  instanceDir: string,
  graphDirectory: string,
  holdings: Holdings['Service'],
  walks: Walks,
  shape: CommitShape['Service'],
): PreparedChanges['Service'] =>
  makePreparedChanges(
    { commands, team: teamOf, heldPaths: heldPathsOf, heldCheckouts: checkoutsOfHolders, evidenceInGroups },
    preparedFnsOver(holdings, walks, graphDirectory),
    instanceDir,
    shape,
  );

export const preparedFnsOver = (holdings: Holdings['Service'], walks: Walks, graphDirectory: string): PreparedFns => ({
  judged: (place, paths) =>
    Effect.mapError(
      holdings.judged(RootId.make(place.checkout), paths),
      (failure) => new LinesUnread({ reason: `whose lines stand in ${paths.join(', ')} could not be judged: ${failure.message}` }),
    ),
  eligiblePaths: eligiblePaths(graphDirectory),
  pathChunks,
  walks,
});

export const servingChangeRecord = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const git = yield* Git;
  const paths = yield* CheckoutPaths;
  const roots = yield* FileRoots;
  const graphDirectory = yield* GraphDirectory;
  yield* formChangeHomes(units, store);
  yield* sweepPreparedIndexes(store);
  const metadata = yield* makeGitMetadata;
  const pruned = yield* Effect.result(pruneMetadata(units, store, roots, metadata));
  if (pruned._tag === 'Failure')
    yield* Effect.logWarning('Git metadata cleanup could not finish and will run again at the next start', { failure: pruned.failure });
  else if (pruned.success.removed + pruned.success.unreadCheckouts > 0)
    yield* Effect.logInfo('Git metadata cleanup at start', pruned.success);
  const instance = yield* Effect.acquireRelease(claimPreparedInstance(preparedBase(store)), (claimed) => claimed.release);
  const held = heldFeed();
  const walks = yield* Effect.acquireRelease(
    Effect.sync(() => makeWalks()),
    (opened) => opened.close,
  );
  const clock = yield* Clock.Clock;
  const lives = new Lives(() => clock.currentTimeMillisUnsafe());
  const heads = yield* makeHeads;
  const intake = yield* Effect.provideService(makeRowIntake({ lives, walks, heads, metadata }), HeldFeed, held);
  const journal = yield* makeCommandJournal({ walks });
  const commands = yield* makeCommandWrites({
    lives,
    queue: makeCommandQueue({ write: commandRows({ store, units, git, walks, lives, intake, paths }) }),
    journal,
    lessons: yield* makeLessons,
    records: yield* ThreadRecords,
  });
  const judges = yield* makeJudges({
    folder: (input, cached, alignment, lane) => walks.fold(input, cached, alignment, lane),
    walks,
    memory: new FoldMemory(foldMemoryBudget()),
    metadata,
  });
  const prepared = preparedChangesOver(commands, instance.dir, graphDirectory, judges, walks, yield* CommitShape);
  const changes = yield* makeChangeRecord({ intake, commands, walks });
  const settled = yield* Effect.result(settleIntents(units, store, roots, walks));
  if (settled._tag === 'Failure') {
    yield* Effect.logWarning('write intents stay unsettled until the next start', { reason: settled.failure.message });
  } else if (settled.success.confirmed + settled.success.withdrawn + settled.success.unread > 0) {
    yield* Effect.logInfo('write intents settled at start', settled.success);
  }
  const recovered = yield* recoverCommands(
    store,
    units,
    yield* FileSystem.FileSystem,
    journal,
    lives,
    commands,
    yield* Clock.currentTimeMillis,
  );
  if (recovered.replayed + recovered.restarted > 0) yield* Effect.logInfo('command windows recovered at start', recovered);
  return { held, commands, prepared, changes, walks, intake, judges };
});

export const changeRecordServingLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const checkouts = yield* CheckoutRows;
    const roots = yield* FileRoots;
    const git = yield* Git;
    const served = yield* servingChangeRecord;
    const judges = served.judges;
    const authorship = authorshipOver(
      {
        store,
        units,
        roots,
        origins: yield* WorkingOrigins,
        git,
        files: yield* FileSystem.FileSystem,
        walks: served.walks,
        holdings: judges,
        graphDirectory: yield* GraphDirectory,
        commands: served.commands,
        names: (threadIds) => units.read((unit) => unit.run(namesOfHolders(store, threadIds))),
      },
      checkouts,
    );
    const changes = threadChangesOver(
      judges,
      served.held,
      { store, units, git, roots, checkouts, paths: yield* CheckoutPaths },
      {
        described: new Map(),
        reaching: new Map(),
      },
    );
    const unjudged = served.held.heldChanged((change) => judgedChange(judges, change));
    const unmarked = checkouts.onMark((rootId, paths) => judges.marked(rootId, paths));
    yield* drive(
      'holdings-warm',
      Effect.flatMap(Effect.result(judges.warm), (warmed) =>
        warmed._tag === 'Success' ? Effect.void : Effect.logWarning('holdings did not warm at start', { reason: warmed.failure.message }),
      ),
    );
    const retirer = yield* makeRetirer({ walks: served.walks, commands: served.commands, background: yield* Background }).pipe(
      Effect.provideService(Holdings, judges),
      Effect.provideService(HeldFeed, served.held),
    );
    const retiring = yield* Effect.scope;
    const unretired = served.held.heldChanged((change) =>
      Effect.forEach(
        new Set(change.moved.places.map((place) => place.checkout)),
        (checkout) =>
          retirer.logged(
            Effect.andThen(
              retirer.follow(RootId.make(checkout)),
              Effect.forkIn(retirer.logged(retirer.settle(RootId.make(checkout)), checkout), retiring),
            ),
            checkout,
          ),
        { discard: true },
      ),
    );
    const records = yield* ThreadRecords;
    const unstatused = records.statusPublished((event) =>
      Effect.flatMap(Effect.result(judges.annotate(event.threadId)), (annotated) =>
        annotated._tag === 'Success'
          ? Effect.void
          : Effect.logWarning('holdings could not mark a thread run', { thread: event.threadId, reason: annotated.failure.message }),
      ),
    );
    const undeleted = records.removalRecorded((address) =>
      Effect.andThen(
        Effect.sync(() => served.commands.retire([{ projectId: address.projectId, threadId: address.threadId }])),
        Effect.asVoid(Effect.forkIn(retirer.logged(retirer.deleted(address.projectId, address.threadId), address.threadId), retiring)),
      ),
    );
    yield* Effect.forkScoped(
      Effect.flatMap(Effect.result(retirer.start), (started) =>
        started._tag === 'Success'
          ? Effect.void
          : Effect.logWarning('the retirement driver did not start', { reason: started.failure.message }),
      ),
    );
    const wake = yield* Queue.sliding<void>(1);
    const unreleased = served.held.heldChanged(() => Effect.asVoid(Queue.offer(wake, undefined)));
    yield* drive('text-collection', Effect.asVoid(collecting(units, store, served.walks, wake)));
    yield* scheduleSweeps('text-sweep', [collectionSweep(units, store, served.walks)]);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unreleased();
        authorship.stop();
        unstatused();
        unjudged();
        unmarked();
        unretired();
        undeleted();
      }),
    );
    return Context.make(HeldFeed, served.held).pipe(
      Context.add(Holdings, judges),
      Context.add(CheckoutHoldings, { holdersOf: judges.holdersOf }),
      Context.add(CommandChanges, served.commands),
      Context.add(ChangeRecord, served.changes),
      Context.add(Intake, { turn: served.intake.turn, land: served.intake.land }),
      Context.add(PreparedChanges, served.prepared),
      Context.add(Authorship, authorship.service),
      Context.add(ThreadChanges, changes),
      Context.add(Retirement, retirer),
      Context.add(CommitOverlay, commitOverlay(store, units)),
    );
  }),
);
