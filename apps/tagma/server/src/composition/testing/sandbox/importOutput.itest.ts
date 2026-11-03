import { expect } from 'bun:test';
import { world } from '@runlith/testbed/worlds';
import { SandboxResources, sandboxResources } from '../sandboxFixture.js';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { Git } from '@runlith/git/Git';
import { contentDigest } from '@runlith/files/content';
import { toolOptions } from '@runlith/agent-tools/testing/options';
import { importFile, IMPORT_BASE_ABSENT, type ImportRequest } from '@runlith/agent-tools/importFile';
import { ToolAnswer, toolExecute } from '@runlith/agent/tool';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { unthreadedCaller } from '../callers.js';
import { fixtureMigrations } from '../migrations.js';
import { sessionIdentityLayer, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow, projectsLayer } from '../../../projects/testing/doubles.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import { landingServices } from '../landingServices.js';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { UNSHAPED } from '../../../change-record/contract/service/shape.js';
import { preparedChangesOver } from '../../../change-record/serving.js';
import {
  quietCommands,
  claimPreparedInstance,
  preparedBase,
  intakeOf,
  reporterOf,
  recordOfPath,
} from '../../../change-record/testing/doubles.js';
import { noRuleInPlay } from '../checkoutFixture.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { threadResourceStore, sandboxHolds } from '../../../threads/testing/doubles.js';
import { threadStore } from '../../../native-harness/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { gitCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { tagsOfCatalogs } from '../../../catalogs/contract/wire/registry.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
import { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import {
  dockerSuite,
  dockerPreparation,
  dockerGuests,
  dockerSaid,
  guestImports,
  preparedTreeStore,
  preparedTreesService,
  sandboxStore,
  sandboxServices,
} from '../../../sandbox/testing/doubles.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { NO_RULES } from '../../../enforcement/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { GuestFileReader, ImportDestination } from '../../../sandbox/contract/service/imports.js';
import { SandboxFiles } from '../../../sandbox/contract/service/files.js';
import { Sandboxes } from '../../../sandbox/contract/service/sandboxes.js';
import { PreparedTrees } from '../../../sandbox/contract/service/preparedTrees.js';
import { SandboxHolds } from '../../../sandbox/contract/service/holds.js';
import { BEHAVIOUR_REGISTRY, ENTRY_KINDS } from '../composed.js';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { rootFixture } from '../graphFixture.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import type { SANDBOX_OPERATIONS } from '../../../sandbox/contract/wire/operations/catalog.js';

const MINE = 'thread-importer';
const THEIRS = 'thread-neighbour';
const VOCABULARY = tagIndex(tagsOfCatalogs(['core', 'software-development']), BEHAVIOUR_REGISTRY);

const makeImportWorld = Effect.gen(function* () {
  const { context: platform, files: hostFiles, processes, checkout: sourceTree } = yield* SandboxResources;
  const roots = yield* Effect.acquireRelease(Effect.sync(rootFixture), (root) => Effect.orDie(root.releaseEffect));
  const fixture = yield* roots.openEffect.pipe(Effect.provide(platform));
  const checkout = yield* fixture.directory('checkout');
  const exports = yield* fixture.directory('exports');
  yield* hostFiles.copy(sourceTree, checkout, { overwrite: true });
  const git = Effect.fnUntraced(function* (...args: string[]) {
    const ran = yield* spawnedEffect(['git', '-C', checkout, ...args], { env: process.env });
    if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`));
    return ran.stdout.toString();
  });
  const graph = yield* Layer.build(
    Layer.mergeAll(
      fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer())),
      unitsLayer(MachineUnits, MachineStore),
    ).pipe(
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(fixture.root, 'db.sqlite'), fixtureMigrations, { durable: false }, processes))),
      Layer.provideMerge(sessionIdentityLayer),
    ),
  );
  const base = Context.merge(platform, graph);
  const store = Context.get(base, MachineStore);
  const units = Context.get(base, MachineUnits);
  const faces = Context.get(base, Git);
  const installation = `import-${crypto.randomUUID()}`;
  const backend = dockerGuests({ installation, closure: undefined });
  const preparedTrees = preparedTreesService({
    store: yield* preparedTreeStore().pipe(Effect.provide(base)),
    preparation: dockerPreparation({ installation, closure: undefined }),
    checkoutOf: () => Effect.succeed(checkout),
    storageRoot: join(exports, 'artifacts'),
  });
  const ledger = yield* threadResourceStore().pipe(Effect.provide(base));
  const owners = yield* sandboxServices({
    store: yield* sandboxStore().pipe(Effect.provide(base)),
    runtime: backend,
    checkoutOf: () => Effect.succeed(checkout),
    exportsRoot: exports,
  }).pipe(
    Effect.provideService(PreparedTrees, preparedTrees),
    Effect.provideService(SandboxHolds, sandboxHolds(ledger)),
    Effect.provide(base),
  );
  const sandboxes = Context.get(owners, Sandboxes);
  const files = Context.get(owners, SandboxFiles);
  const created = yield* store.db
    .insert(projectRow())
    .values({ name: 'import-fixture', repoKey: checkout, rootPath: checkout, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: projectRow().id })
    .get();
  if (created === undefined) return yield* Effect.die('the import fixture project was not inserted');
  const projectId = created.id;
  const made: string[] = [];
  yield* fixture.producer(
    'Docker workloads',
    Effect.gen(function* () {
      if (made.length === 0) return;
      yield* dockerSaid(['rm', '--force', '--volumes', ...made], 'remove the test guests');
      yield* dockerSaid(['volume', 'rm', '--force', ...made], 'remove the test volumes');
    }).pipe(Effect.provide(base)),
  );
  const prepared = yield* sandboxes
    .prepare({
      ownerId: 'operator',
      source: { kind: 'project', projectId, commit: (yield* git('rev-parse', 'HEAD')).trim() },
      limits: { pids: 128, memory: '512m', cpus: '1' },
      exclude: [':(exclude).tagma'],
      setup: [['/bin/sh', '-c', 'printf "lock = 1\\n" > generated.lock && printf "export const made = 1;\\n" > src/made.ts']],
    })
    .pipe(Effect.provide(base));
  expect(prepared.state).toBe('prepared');
  made.push(prepared.runtime.container);
  yield* hostFiles.writeFileString(join(checkout, 'src', 'somebody-else.ts'), 'export const theirs = 1;\n');
  const landing = yield* landingServices.pipe(Effect.provide(base));
  const context = Context.mergeAll(base, owners, landing);
  const record = Context.get(landing, ChangeRecord);
  const holds = makeLandingHolds();
  const source = { kind: 'sandbox' as const, id: prepared.id };
  const imports = (threadId: string) => guestImports({ files, machine: store, admission: holds, projectId, ownerId: 'operator', threadId });
  const importing = (threadId: string, request: ImportRequest) =>
    importFile(toolOptions({ cwd: checkout, changes: record.changes({ work: { projectId, threadId } }) }), imports(threadId), request);
  const intake = yield* intakeOf(store, units, faces, gitCheckoutPaths('repo-root', projectId)).pipe(Effect.provide(base));
  const rig = yield* holdingsOver(store, units, faces, checkout).pipe(Effect.provide(base));
  const instance = yield* Effect.acquireRelease(claimPreparedInstance(preparedBase(store)), (instance) => instance.release);
  const walks = yield* Effect.acquireRelease(Effect.sync(makeWalks), (owned) => owned.close);
  const producer = preparedChangesOver(quietCommands, instance.dir, CHECKOUT_DIRECTORY, rig.holdings, walks, UNSHAPED);
  const threads = yield* Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)).pipe(Effect.provide(base));
  const origin = yield* Schema.decodeUnknownEffect(WorkingOrigin)({
    environment: {
      environmentId: 'host',
      kind: 'host',
      namespaceId: 'host',
      identityWitness: { provider: 'test', format: 'namespace', token: 'host' },
    },
    root: { namespaceId: 'host', path: checkout },
    witness: { provider: 'test', format: 'namespace', token: 'import-fixture' },
    registration: null,
    generation: 0,
    work: { projectId, threadId: MINE },
  });
  return {
    context,
    home: fixture.root,
    hostFiles,
    checkout,
    git,
    store,
    units,
    faces,
    sandboxes,
    files,
    backend,
    projectId,
    prepared,
    source,
    imports,
    importing,
    intake,
    producer,
    threads,
    origin,
  };
});
class ImportFixture extends Context.Service<ImportFixture, Effect.Success<typeof makeImportWorld>>()('testing/ImportFixture') {}

dockerSuite('imported output', () => {
  const fixture = Layer.effect(ImportFixture, makeImportWorld).pipe(Layer.provide(world(sandboxResources, { source: 'import' })));
  layer(fixture, { excludeTestServices: true })('resources', (it) => {
    it.effect('a produced tree imports through its native door and change record, seals unbound reads and admits bound output', () =>
      ImportFixture.use((world) =>
        Effect.gen(function* () {
          {
            const landed = yield* world.importing(MINE, {
              source: world.source,
              from: 'generated.lock',
              to: 'generated.lock',
              expect: IMPORT_BASE_ABSENT,
            });
            expect(landed.created).toBe(true);
            expect(landed.digest).toBe(contentDigest('lock = 1\n'));
            expect(yield* world.hostFiles.readFileString(join(world.checkout, 'generated.lock'))).toBe('lock = 1\n');
            yield* world.importing(MINE, { source: world.source, from: 'src/made.ts', to: 'src/made.ts', expect: IMPORT_BASE_ABSENT });
            const rows = yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'generated.lock' });
            expect(rows.map((row) => [row.holder, row.origin, row.lines])).toEqual([[MINE, 'write', 1]]);
            const receipt = yield* submitOver(
              world.faces,
              world.checkout,
              world.store,
              world.units,
              world.origin,
              { projectId: world.projectId, tasks: [], coAuthored: true, subject: 'the produced files', everything: false },
              noRuleInPlay,
              world.producer,
            );
            expect(receipt.status).toBe('landed');
            if (receipt.status !== 'landed') return yield* Effect.die('the produced files did not land');
            expect([...receipt.committed].sort()).toEqual(['generated.lock', 'src/made.ts']);
            expect((yield* world.git('show', '--name-only', '--format=', 'HEAD')).trim().split('\n').sort()).toEqual([
              'generated.lock',
              'src/made.ts',
            ]);
            expect(yield* world.git('show', 'HEAD:generated.lock')).toBe('lock = 1\n');
            expect(yield* world.git('status', '--porcelain')).toContain('src/somebody-else.ts');
            expect(yield* world.hostFiles.readFileString(join(world.checkout, 'src', 'somebody-else.ts'))).toBe(
              'export const theirs = 1;\n',
            );
            yield* world.hostFiles.writeFileString(join(world.checkout, 'generated.lock'), 'somebody rewrote it\n');
            const before = yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'generated.lock' });
            const refused = yield* world
              .importing(MINE, {
                source: world.source,
                from: 'generated.lock',
                to: 'generated.lock',
                expect: contentDigest('lock = 1\n'),
              })
              .pipe(Effect.flip);
            expect(refused._tag).toBe('ImportRefused');
            expect(refused.message).toContain(contentDigest('somebody rewrote it\n'));
            expect(yield* world.hostFiles.readFileString(join(world.checkout, 'generated.lock'))).toBe('somebody rewrote it\n');
            expect((yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'generated.lock' })).map((row) => row.id)).toEqual(
              before.map((row) => row.id),
            );
          }
          {
            const record = Context.get(world.context, ChangeRecord);
            const destination = toolOptions({
              cwd: world.checkout,
              allowOutsideCwd: true,
              changes: record.changes({ work: { projectId: world.projectId, threadId: MINE } }),
              comments: () => Effect.succeed('allowed' as const),
              unowned: [CHECKOUT_DIRECTORY],
            });
            const tools = yield* fixtureNativeCatalog(
              {
                place: { root: world.checkout, origin: null },
                caller: {
                  actor: {
                    kind: 'thread',
                    threadId: MINE,
                    projectId: world.projectId,
                    principalId: 'operator',
                    session: { harness: 'tagma', key: MINE },
                  },
                  files: { path: join(world.home, 'scratch'), resolve: (candidate) => join(world.home, 'scratch', candidate) },
                },
                project: { id: world.projectId, name: 'import-fixture' },
                vocabulary: () => VOCABULARY,
                identity: sessionIdentity,
                world: 'checkout',
                graphRoot: world.checkout,
                owners: world.context.pipe(
                  Context.add(ImportDestination, destination),
                  Context.add(GuestFileReader, world.imports(MINE)),
                  Context.add(RuleChecks, NO_RULES),
                  Context.add(OperationChecks, operationChecks(NO_RULES)),
                ),
              },
              ['import_output'],
            );
            const tool = tools.import_output;
            if (tool === undefined) return yield* Effect.die('the composed catalog offers no import_output');
            const execute = toolExecute(tool);
            if (execute === null) return yield* Effect.die('the composed import_output has no body');
            const door = (input: InputOf<typeof SANDBOX_OPERATIONS.import_output>) =>
              Effect.map(execute(input, { toolCallId: 'call-door', caller: unthreadedCaller, messages: [] }), (answered) =>
                answered instanceof ToolAnswer ? answered.value : answered,
              );
            const input = { sandbox: world.prepared.id, from: 'src/made.ts', to: 'src/made-by-door.ts', expect: IMPORT_BASE_ABSENT };
            expect(yield* door(input)).toMatchObject({ status: 'imported', created: true });
            expect(yield* world.hostFiles.readFileString(join(world.checkout, 'src', 'made-by-door.ts'))).toBe('export const made = 1;\n');
            expect(
              (yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'src/made-by-door.ts' })).map((row) => [
                row.holder,
                row.origin,
                row.lines,
              ]),
            ).toEqual([[MINE, 'write', 1]]);
            expect(yield* door(input)).toMatchObject({ status: 'refused', code: 'expected-base' });
          }
          {
            for (const from of ['../etc/hostname', '/etc/hostname']) {
              const refused = yield* world
                .importing(MINE, { source: world.source, from, to: 'stolen.txt', expect: IMPORT_BASE_ABSENT })
                .pipe(Effect.flip);
              expect(refused.message).toContain("inside the guest's tree");
            }
            expect(yield* world.hostFiles.exists(join(world.checkout, 'stolen.txt'))).toBe(false);
          }
          {
            yield* world.backend.start(world.prepared.runtime);
            yield* world.backend.run(world.prepared.runtime, [
              '/bin/sh',
              '-c',
              'date +%s%N > churn.txt; nohup sh -c "while :; do date +%s%N > churn.tmp; mv churn.tmp churn.txt; done" >/dev/null 2>&1 & echo started',
            ]);
            const read = Effect.scoped(
              world.files.read(world.prepared.id, 'churn.txt', { ownerId: 'operator', projectId: world.projectId }),
            );
            const first = yield* read;
            expect((yield* read).text).toBe(first.text);
            expect(first.text.trim()).toMatch(/^\d+$/);
            expect((yield* world.backend.inspect(world.prepared.runtime)).status).toBe('stopped');
          }
          {
            const refused = yield* Effect.scoped(
              world.files.read(world.prepared.id, 'generated.lock', {
                ownerId: 'somebody-else',
                projectId: world.projectId,
              }),
            ).pipe(Effect.flip);
            expect(refused.message).toContain('another owner');
            const child = yield* world.threads.insert({
              ownerId: 'operator',
              agentId: 'tagma',
              hostKind: 'sandbox',
              hostId: world.prepared.id,
            });
            yield* scopeRecord(world.store.db, child.id, { projectId: world.projectId });
            yield* world.units.write('importOutput.born', (tx) =>
              world.sandboxes.admit(
                { host: { kind: 'sandbox', id: world.prepared.id }, child, projectId: world.projectId, carried: 'fresh' },
                tx,
              ),
            );
            expect((yield* world.sandboxes.ofThread(child.id))?.id).toBe(world.prepared.id);
            yield* world.backend.start(world.prepared.runtime);
            yield* world.backend.run(world.prepared.runtime, ['/bin/sh', '-c', 'printf "export const theirs = 3;\\n" > src/child.ts']);
            const landed = yield* world.importing(MINE, {
              source: world.source,
              from: 'src/child.ts',
              to: 'src/child.ts',
              expect: IMPORT_BASE_ABSENT,
            });
            expect(yield* world.hostFiles.readFileString(join(world.checkout, 'src', 'child.ts'))).toBe('export const theirs = 3;\n');
            expect(landed.from).toContain(child.id);
            expect((yield* world.backend.inspect(world.prepared.runtime)).status).toBe('running');
            expect(
              (yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'src/child.ts' })).map((row) => [row.holder, row.origin]),
            ).toEqual([[MINE, 'write']]);
          }
          {
            const contested = join(world.checkout, 'src', 'contested.ts');
            const text = 'export const theirs = 2;\n';
            yield* world.hostFiles.writeFileString(contested, text);
            yield* reporterOf(world.intake, world.projectId, THEIRS).record({
              origin: 'write',
              path: contested,
              at: new Date(yield* Clock.currentTimeMillis),
              before: contentDigest(''),
              after: contentDigest(text),
            });
            yield* world.importing(MINE, {
              source: world.source,
              from: 'src/made.ts',
              to: 'src/contested.ts',
              expect: contentDigest(text),
            });
            expect(
              (yield* recordOfPath(world.store, { checkout: 'repo-root', path: 'src/contested.ts' })).map((row) => [
                row.holder,
                row.origin,
                row.lines,
              ]),
            ).toEqual([
              [MINE, 'write', 1],
              [THEIRS, 'write', null],
            ]);
            expect(yield* world.hostFiles.readFileString(contested)).toBe(
              yield* world.hostFiles.readFileString(join(world.checkout, 'src', 'made.ts')),
            );
          }
        }).pipe(Effect.provide(world.context)),
      ),
    );
  });
});
