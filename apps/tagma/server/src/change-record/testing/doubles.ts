import { and, desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Option } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { RepositoryId } from '../../workspace/contract/wire/repositories.js';
import { type Lessons, makeLessons } from '../record/lessons.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { writes } from '../../platform/contract/service/writes.js';
import { Git } from '@runlith/git/Git';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { CheckoutRows, GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import type { CommandChanges } from '../contract/service/commands.js';
import type { PreparedFns, PreparedPlace, PreparedRow } from '../contract/service/prepared.js';
import { preparedFnsOver, servingChangeRecord } from '../serving.js';
import { CarrierAdmission } from '../contract/service/carriers.js';
import { Holdings } from '../contract/service/holdings.js';
import { LineWrites } from '../contract/service/lineWrites.js';
import { makeRetirer } from '../retire/driver.js';
import { makeBackground } from '../../platform/background.js';
import { Coverage, FileRoots } from '../../workspace/contract/service/roots.js';
import { holdingsOver } from './holdings.js';
import { CommitShape, UNSHAPED } from '../contract/service/shape.js';
import { claimPreparedInstance as claimPreparedInstanceFn, preparedBase as preparedBaseFn } from '../prepared/subject.js';
import {
  makePreparedChanges as makePreparedChangesFn,
  prepareChange as prepareChangeFn,
  releasePrepared as releasePreparedFn,
} from '../prepared/change.js';
import { eligiblePaths as eligiblePathsFn, pathChunks as pathChunksFn } from '../prepared/eligible.js';
import { evidenceInGroups as evidenceInGroupsFn, heldOfThread as heldOfThreadFn } from '../record/evidence.js';
import { changesChannel as changesChannelFn } from '../record/feed.js';
import { commandRows as commandRowsFn, type CommandEntry, type CommandRowsDeps } from '../record/commandRows.js';
import { type CommandJournal, makeCommandJournal } from '../record/journal.js';
import { type CommandWrites, makeCommandWrites } from '../record/commands.js';
import { Lives } from '../record/lives.js';
import { WRITER } from '../record/roles.js';
import type { CommandFacts } from '@runlith/agent-tools/WorkspaceChanges';
import { makeCommandQueue } from '../record/queue.js';
import { pathsOfThread as pathsOfThreadFn } from '../record/reads.js';
import { type RowIntake, insertRow, keepVersions, makeRowIntake } from '../record/intake.js';
import { makeGitMetadata } from '../record/metadata.js';
import { makeHeads } from '../record/heads.js';
import { makeChangeRecord } from '../layer.js';
import { makeRetireStore, type RetireStore } from '../retire/store.js';
import type { Walks } from '../lines/walks.js';
import { testWalks } from './walks.js';
import { HeldFeed } from '../contract/service/held.js';
import type { ChangeRecord } from '../contract/service/record.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { contentDigest, versionContentLimit } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { changeLogWrites } from '../store/tables.js';
import { held as heldRows, workspaceChange as workspaceChangeTable } from '../store/tables.js';
import { threadChangesOver as threadChangesOverFn } from '../changes/stream.js';

export const quietCommands: CommandChanges['Service'] = {
  settled: () => Effect.void,
  decided: () => Effect.succeed(0),
  unattributed: () => [],
  retained: () => new Map(),
  unattributedUnder: () => [],
};

export const commandLives = (): Lives => new Lives();

export const WRITING: CommandFacts = {
  readsOnly: false,
  parts: [{ readsOnly: false, named: null, signature: null, listed: false, implicit: [] }],
};

export const naming = (root: string): CommandFacts => ({
  readsOnly: false,
  parts: [{ readsOnly: false, named: [root], signature: null, listed: false, implicit: [] }],
});

export const WRITER_WINDOW = { role: WRITER, signatures: [], team: null } as const;

const recordContext = (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  paths: CheckoutPaths['Service'],
  graphDirectory = '.tagma',
) =>
  Context.make(MachineStore, store).pipe(
    Context.add(MachineUnits, units),
    Context.add(CheckoutPaths, paths),
    Context.add(GraphDirectory, graphDirectory),
  );

const storeContext = (store: MachineStore['Service'], units: MachineUnits['Service']) =>
  Context.make(MachineStore, store).pipe(Context.add(MachineUnits, units));

export const journalOf = (store: MachineStore['Service'], units: MachineUnits['Service'], walks: Walks) =>
  makeCommandJournal({ walks }).pipe(Effect.provideContext(storeContext(store, units)));

export const retireStoreOf = (store: MachineStore['Service'], units: MachineUnits['Service']) =>
  makeRetireStore.pipe(Effect.provideContext(storeContext(store, units)));

export type ServedPorts = {
  readonly store: MachineStore['Service'];
  readonly units: MachineUnits['Service'];
  readonly git: Git['Service'];
  readonly checkouts: CheckoutRows['Service'];
  readonly paths: CheckoutPaths['Service'];
  readonly roots: FileRoots['Service'];
  readonly coverage: Coverage['Service'];
};

export const servedOver = (ports: ServedPorts) =>
  servingChangeRecord.pipe(
    Effect.provide(
      Layer.mock(ThreadRecords, {
        facts: () => Effect.succeed(undefined),
        writes: writes('served-records', []),
        birthRecorded: () => () => undefined,
        removalRecorded: () => () => undefined,
        titleRecorded: () => () => undefined,
        statusPublished: () => () => undefined,
        shelfRecorded: () => () => undefined,
      }),
    ),
    Effect.provideContext(
      recordContext(ports.store, ports.units, ports.paths).pipe(
        Context.add(Git, ports.git),
        Context.add(CheckoutRows, ports.checkouts),
        Context.add(FileRoots, ports.roots),
        Context.add(Coverage, ports.coverage),
        Context.add(CarrierAdmission, { admit: () => Effect.succeed(() => undefined) }),
        Context.add(CommitShape, UNSHAPED),
      ),
    ),
  );

export const retirerOver = (served: Effect.Success<typeof servingChangeRecord>, ports: ServedPorts, writes: LineWrites['Service']) =>
  Effect.flatMap(makeBackground, (background) => makeRetirer({ walks: served.walks, commands: served.commands, background })).pipe(
    Effect.provideContext(
      storeContext(ports.store, ports.units).pipe(
        Context.add(Git, ports.git),
        Context.add(CheckoutRows, ports.checkouts),
        Context.add(FileRoots, ports.roots),
        Context.add(Holdings, served.judges),
        Context.add(HeldFeed, served.held),
        Context.add(LineWrites, writes),
      ),
    ),
  );

const writesOf = (
  lives: Lives,
  write: (entries: readonly CommandEntry[]) => Effect.Effect<void, StoreFailure>,
  journal: CommandJournal | null,
  graphDirectory = '.tagma',
  lessons: Lessons | null = null,
  records: ThreadRecords['Service'] | null = null,
) =>
  makeCommandWrites({ lives, queue: makeCommandQueue({ write }), journal, lessons, records }).pipe(
    Effect.provideService(GraphDirectory, graphDirectory),
  );

export const idleCommands = (journal: CommandJournal | null = null) => writesOf(new Lives(), () => Effect.void, journal);

export const commandWrites = Effect.fnUntraced(function* (
  deps: CommandRowsDeps,
  graphDirectory = '.tagma',
  lessons: Lessons | null = null,
  records: ThreadRecords['Service'] | null = null,
) {
  return yield* writesOf(
    deps.lives,
    commandRowsFn(deps),
    yield* journalOf(deps.store, deps.units, deps.walks),
    graphDirectory,
    lessons,
    records,
  );
});

export const lessonsOf = (store: MachineStore['Service'], units: MachineUnits['Service'], repository: string) => {
  const namespaceId = NamespaceId.make('lessons');
  return makeLessons.pipe(
    Effect.provideContext(storeContext(store, units)),
    Effect.provide(
      Layer.mock(FileRoots, {
        namespaceId,
        scope: () => {
          throw new Error('FileRoots.scope');
        },
        read: (rootId) =>
          Effect.succeed({
            rootId,
            namespaceId,
            path: '/checkout',
            locationRevision: LocationRevision.make(0),
            witness: { provider: 'test', format: 'test', token: rootId },
            provenance: { kind: 'test', id: rootId },
            git: { repositoryId: RepositoryId.make(repository), gitDirectory: { namespaceId, path: '/checkout/.git' } },
            state: 'active',
          }),
      }),
    ),
  );
};

export type CommandRig = {
  readonly store: MachineStore['Service'];
  readonly units: MachineUnits['Service'];
  readonly git: Git['Service'];
  readonly walks: Walks;
  readonly lives: Lives;
  readonly paths: CheckoutPaths['Service'];
  readonly patience?: CommandRowsDeps['patience'];
  readonly lessons?: Lessons;
  readonly records?: ThreadRecords['Service'];
};

export const commandRig = Effect.fnUntraced(function* (rig: CommandRig) {
  const intake = yield* intakeOf(rig.store, rig.units, rig.git, rig.paths, { lives: rig.lives, walks: rig.walks });
  return { commands: yield* commandWrites({ ...rig, intake }, '.tagma', rig.lessons ?? null, rig.records ?? null), intake };
});

export const workspaceChange = () => workspaceChangeTable;

export type IntakeOptions = {
  readonly checkouts?: CheckoutRows['Service'] | null;
  readonly publish?: HeldFeed['Service']['publish'] | null;
  readonly lives?: Lives;
  readonly graphDirectory?: string;
  readonly walks?: Walks;
};

export const intakeOf = (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  git: Git['Service'],
  paths: CheckoutPaths['Service'],
  options: IntakeOptions = {},
) => {
  const { checkouts, publish } = options;
  return Effect.gen(function* () {
    return yield* makeRowIntake({
      lives: options.lives ?? new Lives(),
      walks: options.walks ?? testWalks,
      heads: yield* Effect.scoped(makeHeads),
      metadata: yield* makeGitMetadata,
    }).pipe(
      checkouts ? Effect.provideService(CheckoutRows, checkouts) : (made) => made,
      publish ? Effect.provideService(HeldFeed, { publish, heldChanged: () => () => undefined }) : (made) => made,
    );
  }).pipe(Effect.provideContext(recordContext(store, units, paths, options.graphDirectory).pipe(Context.add(Git, git))));
};

export const changeRecordOf = Effect.fnUntraced(function* (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  paths: CheckoutPaths['Service'],
  intake: RowIntake,
  commands?: CommandWrites,
  walks: Walks = testWalks,
) {
  return yield* makeChangeRecord({ intake, commands: commands ?? (yield* idleCommands()), walks }).pipe(
    Effect.provideContext(recordContext(store, units, paths).pipe(Context.add(Git, yield* Git))),
  );
});

export const recordWrite = (
  units: MachineUnits['Service'],
  store: MachineStore['Service'],
  projectId: number,
  threadId: string,
  place: PlacedPath,
  write: {
    readonly before: string;
    readonly after: string | null;
    readonly mode: string | null;
    readonly key?: string | null;
    readonly head?: string | null;
  },
) => {
  const after = write.after ?? '';
  const versions =
    Buffer.byteLength(write.before, 'utf8') <= versionContentLimit && Buffer.byteLength(after, 'utf8') <= versionContentLimit
      ? [
          { digest: contentDigest(write.before), text: write.before },
          ...(write.after === null ? [] : [{ digest: contentDigest(after), text: after }]),
        ]
      : [];
  return units.write(changeLogWrites, () =>
    Effect.andThen(
      keepVersions(store.db, versions),
      insertRow(store.db, { projectId, holder: threadId }, null, write.head ?? null, 'held', {
        place,
        projectId,
        origin: write.after === null ? 'delete' : 'write',
        mode: write.mode,
        hunk: workspaceChangeHunk(write.before, after) ?? null,
        beforeHash: contentDigest(write.before),
        afterHash: write.after === null ? null : contentDigest(after),
        at: new Date(),
        key: write.key ?? null,
      }),
    ),
  );
};

export const pathsOfThread = (...input: Parameters<typeof pathsOfThreadFn>) => pathsOfThreadFn(...input);

export const recordOfPath = (store: MachineStore['Service'], place: PlacedPath) =>
  store.db
    .select({
      id: workspaceChangeTable.id,
      holder: workspaceChangeTable.holder,
      origin: workspaceChangeTable.origin,
      lines: workspaceChangeTable.lines,
    })
    .from(workspaceChangeTable)
    .where(and(eq(workspaceChangeTable.checkout, place.checkout), eq(workspaceChangeTable.path, place.path), heldRows))
    .orderBy(desc(workspaceChangeTable.at), desc(workspaceChangeTable.id));

export const makePreparedChanges = <Row extends PreparedRow>(
  reads: Parameters<typeof makePreparedChangesFn<Row>>[0],
  admission: Parameters<typeof makePreparedChangesFn<Row>>[1],
  fns: Parameters<typeof makePreparedChangesFn<Row>>[2],
  instanceDir: string,
  shape: CommitShape['Service'] = UNSHAPED,
) => makePreparedChangesFn<Row>(reads, admission, fns, instanceDir, shape);

export const prepareChange = <Row extends PreparedRow, Caller>(
  reads: Parameters<typeof prepareChangeFn<Row, Caller>>[0],
  fns: Parameters<typeof prepareChangeFn<Row, Caller>>[1],
  instanceDir: string,
  args: Parameters<typeof prepareChangeFn<Row, Caller>>[4],
  shape: CommitShape['Service'] = UNSHAPED,
) => prepareChangeFn<Row, Caller>(reads, fns, instanceDir, shape, args);

export const releasePrepared = (...input: Parameters<typeof releasePreparedFn>) => releasePreparedFn(...input);

export const evidenceInGroups = <A, E>(
  ...input: Parameters<typeof evidenceInGroupsFn<A, E>>
): ReturnType<typeof evidenceInGroupsFn<A, E>> => evidenceInGroupsFn(...input);

export const heldOfThread = (...input: Parameters<typeof heldOfThreadFn>) => heldOfThreadFn(...input);

export const eligiblePaths = (...input: Parameters<typeof eligiblePathsFn>) => eligiblePathsFn(...input);

export const pathChunks = (...input: Parameters<typeof pathChunksFn>) => pathChunksFn(...input);

export const threadChangesOver = (...input: Parameters<typeof threadChangesOverFn>) => threadChangesOverFn(...input);

export const claimPreparedInstance = (...input: Parameters<typeof claimPreparedInstanceFn>) => claimPreparedInstanceFn(...input);

export const preparedBase = (...input: Parameters<typeof preparedBaseFn>) => preparedBaseFn(...input);

export const changesChannel = (...input: Parameters<typeof changesChannelFn>) => changesChannelFn(...input);

export const reporterOf = (intake: RowIntake, projectId: number, threadId: string) => ({
  record: (change: Parameters<RowIntake['report']>[1][number]) =>
    Effect.map(intake.report({ projectId, holder: { kind: 'thread', thread: threadId } }, [change]), (places) => places.length > 0),
});

const judgedBy = <A, E>(place: PreparedPlace, use: (holdings: Holdings['Service']) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.flatMap(Effect.serviceOption(Holdings), (served) =>
    Option.isSome(served)
      ? use(served.value)
      : Effect.scoped(Effect.flatMap(holdingsOver(place.store, place.units, place.git, place.root, testWalks), (rig) => use(rig.holdings))),
  );

export const judgingFns = (graphDirectory = '.tagma'): PreparedFns => ({
  foreignPaths: (place, carriers, unborne) =>
    judgedBy(place, (holdings) => preparedFnsOver(holdings, testWalks, graphDirectory).foreignPaths(place, carriers, unborne)),
  judged: (place, paths) => judgedBy(place, (holdings) => preparedFnsOver(holdings, testWalks, graphDirectory).judged(place, paths)),
  eligiblePaths: eligiblePathsFn(graphDirectory),
  pathChunks: pathChunksFn,
  walks: testWalks,
});
