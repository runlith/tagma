import { GraphUnits, MachineUnits } from '../../platform/contract/service/units.js';
import { CurrentCost } from '@runlith/performance/CostLedger';
import { Handover } from '@runlith/sqlite-process/SqliteProcess';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Clock, Context, Effect, FiberSet, FileSystem, Layer, ManagedRuntime, Scope, Semaphore, Tracer } from 'effect';
import { unmergedTracker } from '../../platform/git/unmerged.js';
import { treeCommitter } from './committer.js';
import { STAGING_PATHSPEC } from '../tree/atomicFile.js';
import { eq } from 'drizzle-orm';
import { GraphStore, MachineStore } from '../../platform/contract/service/store.js';
import { unitsLayer } from '../../platform/store/units.js';
import { identityOf, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { AGENT_PERSON } from '../../platform/contract/wire/commits.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { mirrorStoreLayer } from '../storage/baseline.js';
import { identifyMirror } from '../storage/identity.js';
import { Mirrors } from '../contract/service/mirrors.js';
import { block, meta } from '../store/tables.js';
import { mirrorGraphLayer } from '../layer.js';
import type { GraphServices } from '../contract/service/services.js';
import { Act, BlockProjection, TreeGuard } from '../contract/service/acts.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { OtherGraphs } from './policy.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting } from '../store/actWrites.js';

const rooting = writes('Projects.open', [block], projecting);
const retiring = writes('Projects.open.retireRows', [meta]);
import { ensureVocabulary } from './birth.js';
import { advanceTree } from './advance.js';
import { syncTopology, type TopologySync } from '../tree/topology.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ManagedWrite } from '../../settings/contract/service/managed.js';
import { DeclaredSettings, SettingDeclarations } from '../../settings/contract/service/declarations.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { CatalogGraph, catalogWriter } from '../vocabulary/install.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { Tags } from '../contract/service/vocabulary.js';
import { projectToTree } from '../tree/projection.js';
import { rebuildMirror } from '../tree/mirror.js';
import { treeHeadStamp } from '../tree/stamp.js';
import { treeLedger } from '../tree/ledger.js';
import type { ShadowGit } from '../tree/shadow.js';
import { treeConflicts } from '../tree/conflicts.js';
import { TreeCommits } from '../tree/commits.js';
import { treeCommits } from '../tree/commits.js';
import { commitJournal, startCommitJournals, type TreeScope } from '../tree/message.js';
import { blocksRetiredKey, CHECKOUT_DIRECTORY, FORMAT_FILE } from '../contract/wire/storage.js';
import { graphCommit } from '../settings.js';
import { type StealthLayout, type StorageLayout, stealthBeside, storageHomes } from '../storage/layout.js';
import { scanTree, type TreeScan } from '../tree/scan.js';
import { Git } from '@runlith/git/Git';
import { overMirror, overRepository, overTree } from './permits.js';
import {
  MeasuredCheckout,
  CurrentGraph,
  ServedTree,
  MirrorBuilder,
  VocabularyFormat,
  type GraphContext,
  type MirrorBuildInput,
  type MirrorBuilt,
  type TwinLevelInput,
  type GraphLevelInput,
  type PreparedGraph,
  type StealthHold,
  type StealthTree,
} from '../contract/service/serving.js';
import { openFormat } from './format.js';
import { adoptIdentities } from './identities.js';
import { GraphMigrations, GraphSource } from '../contract/service/source.js';
import { GraphSteps } from '../contract/service/steps.js';
import type { GraphSide } from '../contract/service/exchange.js';
import { HolderStandings } from '../contract/service/holders.js';
import { refusal, refused } from './refusal.js';
import {
  attachShadowTree,
  attachTree,
  forgetRegistry,
  registrySynced,
  switchIfDue,
  syncRegistry,
  travelMirror,
  treeHoldsBlocks,
  type RegistryStamp,
} from './attach.js';
import { throughWrites, writeThrough } from './writeThrough.js';
import { Background } from '../../platform/contract/service/background.js';

export const makeMirrorBuilder = Effect.fnUntraced(function* ({
  gates,
  side: sideOf,
}: {
  readonly gates: (key: string) => Semaphore.Semaphore;
  readonly side: (projectId: number) => GraphSide;
}) {
  const machine = yield* Effect.context<GraphServices | GraphStore | GraphUnits | MachineStore | MachineUnits>();
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const source = yield* GraphSource;
  const identity = yield* SessionIdentity;
  const migrations = yield* GraphMigrations;
  const steps = yield* GraphSteps;
  const standings = yield* HolderStandings;
  const mirrors = yield* Mirrors;
  const background = yield* Background;
  const syncedRegistry = new Map<string, RegistryStamp>();

  const fill = Effect.fnUntraced(function* (
    context: GraphContext,
    row: ProjectPolicyRow,
    layout: StorageLayout,
    stealthRoot: string | null,
    shadow: ShadowGit | null,
    standing: 'standing' | 'switched' | 'virgin',
    initialScan?: TreeScan,
  ) {
    const store = Context.get(context, GraphStore);
    const { db } = store;
    yield* syncRegistry(machine, syncedRegistry, context);
    const held = yield* db.select({ id: block.id }).from(block).where(eq(block.projectId, row.id)).limit(1);
    if (held.length > 0) return 'rows' as const;
    const stampHead = Effect.fnUntraced(function* (committed: string | null) {
      const read = yield* Effect.result(runGit(git, 'head', ['-C', layout.treeRoot, 'rev-parse', 'HEAD']));
      if (read._tag === 'Failure') {
        yield* Effect.logWarning('the head of the serving tree could not be read, so no stamp is written for it', {
          tree: layout.treeRoot,
          reason: read.failure.message,
        });
      }
      const head = committed ?? (read._tag === 'Success' ? read.success : null);
      if (head !== null) yield* treeHeadStamp().writeStamp(head).pipe(Effect.provideService(GraphStore, store));
    });
    const holdsBlocks = initialScan === undefined ? yield* treeHoldsBlocks(layout.treeRoot) : initialScan.blocks.length > 0;
    if (standing === 'virgin' && !holdsBlocks) {
      const act = Context.get(context, Act);
      const now = new Date(yield* Clock.currentTimeMillis);
      yield* act.unit(
        rooting,
        Effect.gen(function* () {
          const root = yield* db
            .insert(block)
            .values({
              uuid: mintBlockId(),
              projectId: row.id,
              parentId: null,
              ord: 1,
              tags: [],
              fields: {},
              title: row.name,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          if (root) yield* Context.get(context, BlockProjection).syncSearch(root.id);
        }).pipe(Effect.provide(context)),
      );
      yield* projectToTree({
        projectId: row.id,
        treeRoot: layout.treeRoot,
      }).pipe(Effect.provide(context));
      const committed = shadow === null ? null : yield* shadow.commitAct(layout.treeRoot, 'project born');
      const machineStore = Context.get(machine, MachineStore);
      yield* machineStore.transaction(retiring, () =>
        machineStore.db
          .insert(meta)
          .values({ key: blocksRetiredKey(row.id), value: 'files' })
          .onConflictDoUpdate({ target: meta.key, set: { value: 'files' } }),
      );
      yield* stampHead(committed);
      return 'born' as const;
    }
    if (!existsSync(layout.treeRoot)) {
      return yield* new GateRefusal('tree-missing', `project "${row.name}" has no tree at ${layout.treeRoot} and no rows to project from`, [
        'restore the tree from its git remote or a backup, then retry',
      ]);
    }
    const scan = initialScan ?? (yield* scanTree(layout.treeRoot, stealthRoot));
    if (scan.blocks.length === 0) {
      return yield* new GateRefusal(
        'tree-empty',
        `project "${row.name}" holds no block: its tree at ${layout.treeRoot} is empty and no rows remain to project from`,
        [
          'restore the tree from its git remote or a backup, then retry',
          `tagma project remove ${row.name} — a registration that holds nothing`,
        ],
      );
    }
    yield* rebuildMirror(scan, row.id).pipe(Effect.provide(context));
    yield* stampHead(null);
    return 'tree' as const;
  });

  const build = (input: MirrorBuildInput): Effect.Effect<MirrorBuilt, GateRefusal<OpenRefusal>> =>
    Effect.suspend(() => {
      const { row, checkout, layout } = input;
      const side = sideOf(row.id);
      const mirror = ManagedRuntime.make(
        mirrorStoreLayer(layout.mirrorPath, migrations).pipe(
          Layer.provide(
            Layer.succeedContext(
              Context.make(MachineStore, Context.get(machine, MachineStore)).pipe(Context.add(Handover, Context.get(machine, Handover))),
            ),
          ),
        ),
      );
      const openMirror = Effect.map(mirror.contextEffect, (context) => Context.get(context, GraphStore));
      return Context.get(machine, GraphUnits)
        .markWrite(
          Effect.gen(function* () {
            const overShadow = overRepository(gates, layout);
            const temporary = input.temporary === true;
            const opened = temporary
              ? {
                  shadow: null,
                  twinned: false,
                  standing: 'standing' as const,
                }
              : yield* overShadow(
                  Effect.gen(function* () {
                    const attached = yield* refused(attachTree(git, side, checkout, layout, steps));
                    const standing = yield* refused(
                      switchIfDue(
                        machine,
                        git,
                        migrations,
                        row,
                        layout,
                        attached.shadow,
                        input.rowsStep,
                        openMirror,
                        input.scan === undefined ? undefined : input.scan.blocks.length > 0,
                      ).pipe(overMirror(gates, layout.mirrorPath)),
                    );
                    return { ...attached, standing };
                  }),
                );
            const shadow = opened.shadow;
            const stealthLayout =
              layout.mode === 'team' && !temporary
                ? stealthBeside(layout, {
                    projectId: row.id,
                    ...storageHomes(Context.get(machine, MachineStore).path),
                    worktree: checkout,
                  })
                : null;
            const stealthShadow =
              stealthLayout !== null && (existsSync(stealthLayout.gitDir) || side.birth !== null)
                ? yield* overRepository(gates, stealthLayout)(refused(attachShadowTree(git, side, checkout, stealthLayout, steps)))
                : null;
            const stealthRoot = stealthLayout?.treeRoot ?? null;
            const roots = { root: layout.treeRoot, stealth: stealthRoot };
            const runtime = ManagedRuntime.make(
              Layer.mergeAll(
                mirrorGraphLayer(Context.pick(Settings, SettingDeclarations, SettingChanges, ManagedWrite)(machine)),
                unitsLayer(GraphUnits, GraphStore),
              )
                .pipe(
                  Layer.provide(
                    Layer.succeedContext(
                      Context.pick(
                        MachineStore,
                        Projects,
                        ProjectGroups,
                        ProjectChanges,
                        Doctrine,
                        Catalogs,
                        Behaviours,
                        DeclaredSettings,
                      )(machine).pipe(
                        Context.add(GraphSource, source),
                        Context.add(GraphSteps, steps),
                        Context.add(HolderStandings, standings),
                      ),
                    ),
                  ),
                  Layer.provideMerge(Layer.effect(GraphStore, openMirror)),
                )
                .pipe(Layer.provideMerge(Layer.succeed(SessionIdentity, identity))),
            );
            return yield* Effect.gen(function* () {
              const opening = Context.add(
                Context.add(yield* refused(runtime.contextEffect).pipe(overMirror(gates, layout.mirrorPath)), CurrentGraph, null),
                TreeGuard,
                undefined,
              );
              yield* refused(
                identifyMirror({ projectId: row.id, checkout, layout }).pipe(Effect.provide(opening), Effect.provideService(Git, git)),
              );
              const format = yield* refused(openFormat(layout.treeRoot, steps).pipe(Effect.provide(opening)));
              const fork = yield* FiberSet.makeRuntime<never, void, never>().pipe(Effect.provideService(Scope.Scope, runtime.scope));
              const journalOf = (scope: TreeScope) =>
                commitJournal({
                  store: Context.get(opening, GraphStore),
                  tags: Context.get(opening, Tags),
                  identity,
                  projectId: row.id,
                  scope,
                });
              let checkoutCommits: Context.Service.Shape<typeof TreeCommits>;
              const committer = () => {
                const treeRoot = join(checkout, CHECKOUT_DIRECTORY);
                return (checkoutCommits ??= treeCommits({
                  git,
                  checkout,
                  treeRoot,
                  journal: layout.mode === 'team' ? journalOf('team') : null,
                  permit: overTree(gates, treeRoot),
                  policy: Effect.map(Context.get(machine, Settings).read(graphCommit, row.id), (resolved) => resolved.value),
                  fork,
                }));
              };
              const checkoutChanged = Effect.suspend(() => (temporary ? Effect.void : committer().carry([])));
              const commits = layout.mode === 'team' && !temporary ? committer() : undefined;
              const poolContext = Context.add(Context.add(opening, VocabularyFormat, format), TreeCommits, commits);
              const filled = yield* refused(fill(poolContext, row, layout, stealthRoot, shadow, opened.standing, input.scan));
              const advance = (fromTree: boolean) =>
                refused(
                  advanceTree({
                    project: row,
                    treeRoot: layout.treeRoot,
                    stealth: stealthRoot,
                    checkout,
                    shadow,
                    git,
                    format,
                    steps,
                    fromTree,
                    scan: input.scan,
                  }).pipe(Effect.provide(poolContext), Effect.provideService(Background, background)),
                );
              if (filled === 'born') format.reach();
              else yield* advance(filled === 'tree');
              if (opened.standing === 'switched' && commits !== undefined) yield* commits.carry([FORMAT_FILE]);
              let topology: TopologySync | null = null;
              if (opened.twinned && shadow !== null) {
                const synced = yield* overShadow(
                  Effect.gen(function* () {
                    const siblings = yield* input.siblings({ layout, shadow });
                    return yield* refused(
                      syncTopology(shadow, checkout, layout.treeRoot, steps, {
                        blocked: siblings.blocked,
                        retired: mirrors.departed(row.id),
                        treeHold: (tree) => overTree(gates, tree),
                        level: (twin) => level({ row, checkout, shadow, twin, target: layout.treeRoot }),
                      }),
                    );
                  }),
                );
                topology = synced;
                if (synced.merges.some((merge) => merge.merged !== null)) {
                  yield* format.read;
                  yield* refused(
                    Effect.flatMap(scanTree(layout.treeRoot, stealthRoot), (scan) => rebuildMirror(scan, row.id)).pipe(
                      Effect.provide(poolContext),
                    ),
                  );
                  yield* advance(true);
                }
              }
              const stealthTopology =
                stealthShadow === null || stealthLayout === null
                  ? null
                  : yield* overRepository(
                      gates,
                      stealthLayout,
                    )(
                      Effect.gen(function* () {
                        const siblings = yield* input.siblings({ layout: stealthLayout, shadow: stealthShadow });
                        return yield* refused(
                          syncTopology(stealthShadow, checkout, stealthLayout.treeRoot, steps, {
                            blocked: siblings.blocked,
                            retired: mirrors.departed(row.id),
                            treeHold: (tree) => overTree(gates, tree),
                          }),
                        );
                      }),
                    );
              if (stealthTopology?.merges.some((merge) => merge.merged !== null) === true) {
                yield* refused(
                  Effect.flatMap(scanTree(layout.treeRoot, stealthRoot), (scan) => rebuildMirror(scan, row.id)).pipe(
                    Effect.provide(poolContext),
                  ),
                );
              }
              const ledger = yield* treeLedger(roots, row.id);
              const tree = {
                treeRoot: layout.treeRoot,
                ownGit: shadow !== null,
                git,
              };
              const withTree = Context.add(poolContext, ServedTree, {
                treeRoot: tree.treeRoot,
                conflicts: () => treeConflicts(tree),
              });
              const measured = Context.add(withTree, MeasuredCheckout, {
                projectId: row.id,
                path: checkout,
              });
              const store = Context.get(poolContext, GraphStore);
              const unmerged = unmergedTracker(git, layout.treeRoot);
              const batches =
                shadow === null || temporary
                  ? null
                  : treeCommitter({
                      git,
                      checkout,
                      treeRoot: layout.treeRoot,
                      journal: journalOf('whole'),
                      unmerged,
                      overTree: overTree(gates, layout.treeRoot),
                      overRepository: overRepository(gates, layout),
                      fork,
                      committed: input.committed,
                    });
              const stealthTree = (place: StealthLayout, held: ShadowGit, synced: TopologySync | null): StealthTree => {
                const tracked = unmergedTracker(git, place.treeRoot);
                return {
                  layout: place,
                  shadow: held,
                  unmerged: tracked,
                  topology: synced,
                  batches: treeCommitter({
                    git,
                    checkout,
                    treeRoot: place.treeRoot,
                    journal: journalOf('stealth'),
                    unmerged: tracked,
                    overTree: overTree(gates, place.treeRoot),
                    overRepository: overRepository(gates, place),
                    fork,
                    committed: input.committed,
                  }),
                };
              };
              let attached =
                stealthShadow === null || stealthLayout === null ? null : stealthTree(stealthLayout, stealthShadow, stealthTopology);
              const attaching = Semaphore.makeUnsafe(1);
              const stealth: StealthHold | null =
                stealthLayout === null
                  ? null
                  : {
                      root: stealthLayout.treeRoot,
                      tree: () => attached,
                      attach: attaching.withPermits(1)(
                        Effect.suspend(() =>
                          attached !== null
                            ? Effect.succeed(attached)
                            : overRepository(
                                gates,
                                stealthLayout,
                              )(
                                Effect.map(refused(attachShadowTree(git, sideOf(row.id), checkout, stealthLayout, steps)), (held) => {
                                  attached = stealthTree(stealthLayout, held, null);
                                  return attached;
                                }),
                              ),
                        ),
                      ),
                    };
              const stamped = yield* Effect.result(format.stamp);
              if (stamped._tag === 'Failure')
                yield* Effect.logWarning('the tree is served without writes, its format marker could not be written', {
                  tree: layout.treeRoot,
                  reason: stamped.failure.reason,
                });
              else if (stamped.success) {
                ledger.wrote(FORMAT_FILE);
                if (batches !== null) yield* batches.carry([FORMAT_FILE]);
                if (commits !== undefined) yield* commits.carry([FORMAT_FILE]);
              }
              if (!temporary) yield* refused(startCommitJournals(store));
              if (commits !== undefined) yield* commits.carry([]);
              const write = writeThrough({
                projectId: row.id,
                layout,
                stealth,
                ledger,
                commits,
                batches,
                unmerged,
                store,
                tags: Context.get(poolContext, Tags),
                settled: input.settled,
                format,
              });
              const reach = (projectId: number): Effect.Effect<Context.Context<GraphServices | GraphStore>, GateRefusal<OpenRefusal>> =>
                projectId === row.id ? Effect.succeed(served) : input.resolveProject(projectId);
              const served = Context.omit(CurrentGraph)(
                Context.add(
                  Context.add(Context.add(measured, OtherGraphs, reach), TreeGuard, {
                    guard: input.guard,
                    prepare: write,
                    writes: throughWrites,
                  }),
                  CatalogGraph,
                  (projectId) =>
                    Effect.flatMap(reach(projectId), (context) =>
                      Effect.andThen(Context.get(context, VocabularyFormat)?.writable ?? Effect.void, catalogWriter(context, projectId)),
                    ),
                ),
              );
              const servedOpen = Context.add(
                Context.addOrOmit(served, Tracer.ParentSpan, yield* Effect.serviceOption(Tracer.ParentSpan)),
                CurrentCost,
                yield* CurrentCost,
              );
              if (format.holds()) {
                yield* Effect.logWarning(
                  'a graph whose format marker this server cannot write over opens for reads: no catalog is installed and every write refuses',
                  {
                    tree: layout.treeRoot,
                  },
                );
              } else {
                yield* refused(Effect.setContext(Effect.provideService(ensureVocabulary('mirror'), GraphSteps, steps), servedOpen));
                yield* refused(Context.get(poolContext, BlockProjection).completeDerived('types').pipe(Effect.provide(poolContext)));
              }
              return {
                context: served,
                poolContext,
                shadow,
                stealth,
                ledger,
                batches,
                topology,
                checkoutChanged,
                scope: runtime.scope,
                dispose: async () => {
                  try {
                    await runtime.dispose();
                  } finally {
                    await mirror.dispose();
                  }
                },
              };
            }).pipe(Effect.onError(() => Effect.promise(() => runtime.dispose())));
          }),
        )
        .pipe(Effect.onError(() => Effect.promise(() => mirror.dispose())));
    });

  const prepare = Effect.fn('MirrorBuilder.prepare')(function* (
    input: GraphLevelInput,
    previous?: string,
  ): Effect.fn.Return<PreparedGraph, GateRefusal<OpenRefusal>> {
    const home = join(dirname(Context.get(machine, MachineStore).path), 'levelling', crypto.randomUUID());
    const checkout = join(home, 'tree');
    const layout: StorageLayout = {
      mode: 'team',
      treeRoot: join(checkout, input.graphPath),
      mirrorPath: join(home, 'mirror.sqlite'),
    };
    const attached: string[] = [];
    let built: MirrorBuilt | undefined;
    const removed = Effect.gen(function* () {
      for (const tree of attached) {
        const removed = yield* Effect.result(runGit(git, 'level-remove', ['-C', input.repository, 'worktree', 'remove', '--force', tree]));
        if (removed._tag === 'Failure')
          yield* Effect.logWarning('a levelling tree could not be removed', { tree, reason: removed.failure.message });
      }
      yield* Effect.orDie(files.remove(home, { recursive: true, force: true }));
      syncedRegistry.delete(layout.mirrorPath);
    });
    const release = Effect.suspend(() => {
      const opened = built;
      return Effect.ensuring(opened === undefined ? Effect.void : Effect.promise(() => opened.dispose()), removed);
    });
    const materialize = Effect.fn('MirrorBuilder.materialize')(function* (at: string, commit: string) {
      yield* runGit(git, 'level-add', ['-C', input.repository, 'worktree', 'add', '--detach', '--no-checkout', at, commit]);
      attached.push(at);
      yield* runGit(git, 'level-index', ['-C', at, 'read-tree', '--reset', commit]);
      const paths = yield* runGitBytes(git, 'level-paths', [
        '-C',
        at,
        'ls-tree',
        '-rz',
        '--name-only',
        commit,
        '--',
        input.graphPath || '.',
      ]);
      yield* runGit(git, 'level-checkout', ['-C', at, 'checkout-index', '--force', '-z', '--stdin'], { stdin: paths });
      return join(at, input.graphPath);
    }, Effect.uninterruptible);
    return yield* Effect.uninterruptibleMask((restore) =>
      restore(
        Effect.gen(function* () {
          yield* refused(files.makeDirectory(home, { recursive: true }));
          yield* refused(materialize(checkout, input.commit));
          const target =
            input.targetCommit === undefined ? input.target : yield* refused(materialize(join(home, 'target'), input.targetCommit));
          yield* files.makeDirectory(layout.treeRoot, { recursive: true });
          if (input.workingTree !== undefined && (yield* files.exists(input.workingTree))) {
            for (const entry of yield* files.readDirectory(layout.treeRoot)) {
              if (entry !== '.git') yield* files.remove(join(layout.treeRoot, entry), { recursive: true, force: true });
            }
            for (const entry of yield* files.readDirectory(input.workingTree)) {
              if (entry !== '.git') yield* files.copy(join(input.workingTree, entry), join(layout.treeRoot, entry), { overwrite: true });
            }
          }
          const scan = yield* refused(scanTree(layout.treeRoot));
          const known = new Set(scan.blocks.map((block) => block.frontmatter.id));
          built = yield* build({
            scan,
            rowsStep: null,
            row: input.row,
            checkout: input.checkout,
            layout,
            guard: overTree(gates, layout.treeRoot),
            settled: Effect.void,
            resolveProject:
              input.resolveProject ??
              (() =>
                Effect.fail(
                  new GateRefusal('graph-pool', 'a graph being brought to its checkout format reaches no other graph', [
                    'merge the branch first, then act across graphs',
                  ]),
                )),
            siblings: () => Effect.succeed({ blocked: undefined, copyFailures: [] }),
            committed: () => undefined,
            temporary: true,
          });
          if (target !== undefined) {
            yield* refused(
              adoptIdentities({ projectId: input.row.id, treeRoot: layout.treeRoot, target, known }).pipe(
                Effect.provide(built.poolContext),
              ),
            );
          }
          yield* refused(runGit(git, 'level-stage', ['-C', layout.treeRoot, 'add', '-A', '--', '.', STAGING_PATHSPEC]));
          const tree = yield* refused(runGit(git, 'level-tree', ['-C', checkout, 'write-tree']));
          const original = yield* refused(runGit(git, 'level-base', ['-C', checkout, 'rev-parse', `${input.commit}^{tree}`]));
          const head =
            tree === original && previous === undefined
              ? input.commit
              : yield* refused(
                  runGit(
                    git,
                    'level-commit',
                    [
                      '-C',
                      checkout,
                      'commit-tree',
                      tree,
                      '-p',
                      input.commit,
                      ...(previous === undefined ? [] : ['-p', previous]),
                      '-m',
                      `graph brought to the format of ${input.checkout}`,
                    ],
                    { env: identityOf(AGENT_PERSON) },
                  ),
                );
          return { built, layout, checkout, head, release };
        }).pipe(Effect.mapError(refusal)),
      ).pipe(Effect.onError(() => release)),
    );
  });

  const level = Effect.fn('MirrorBuilder.level')(function* (input: TwinLevelInput): Effect.fn.Return<string, GateRefusal<OpenRefusal>> {
    const { shadow, target } = input;
    const base = yield* refused(shadow.quiet('level-base', ['-C', target, 'merge-base', 'HEAD', input.twin]));
    let previous: string | undefined;
    if (base !== null) {
      const adopted = yield* refused(
        shadow.run('level-ancestry', [
          '-C',
          target,
          'log',
          '--ancestry-path',
          '--format=%H %P',
          '--grep=^graph brought to the format of ',
          `${base}..HEAD`,
        ]),
      );
      previous = adopted
        .split('\n')
        .map((line) => line.split(' '))
        .find(([, parent]) => parent === base)?.[0];
    }
    return yield* Effect.acquireUseRelease(
      prepare(
        {
          row: input.row,
          checkout: input.checkout,
          repository: shadow.gitDir,
          commit: input.twin,
          graphPath: '',
          target,
        },
        previous,
      ),
      (prepared) => Effect.succeed(prepared.head),
      (prepared) => prepared.release,
    );
  });

  return MirrorBuilder.of({
    build,
    level,
    prepare,
    writeThrough: (bind) => writeThrough(bind),
    syncRegistry: (context) => syncRegistry(machine, syncedRegistry, context),
    registrySynced: (context) => registrySynced(machine, syncedRegistry, context),
    forgetRegistry: (context) => forgetRegistry(syncedRegistry, context),
    travelMirror: (from, to, treeRoot) =>
      [...new Set([from, to])]
        .sort()
        .reduce(
          (work, path) => overMirror(gates, path)(work),
          travelMirror(git, Context.get(machine, MachineStore), migrations, syncedRegistry, from, to, treeRoot),
        ),
  });
});
