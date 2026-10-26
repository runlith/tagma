import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Clock, Context, Deferred, Effect, Exit, FileSystem, Queue, Scope } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { Enforcements, enforceFixture, withEnforcement, bodies, operator, type EnforcementFixture } from './enforceFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { PLACE } from '../checkoutFixture.js';
import { landingServices } from '../landingServices.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import { landingAdmission } from '../../preparedChanges.js';
import {
  recordWrite,
  intakeOf,
  makePreparedChanges,
  quietCommands,
  pathsOfThread,
  evidenceInGroups,
  claimPreparedInstance,
  preparedBase,
  judgingFns,
} from '../../../change-record/testing/doubles.js';
import { fixedCoverage, gitCheckoutPaths, TEST_CHECKOUT, testPlace } from '../../../workspace/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { perform } from '../../../invocation/testing/performing.js';
import type { LawEnforcement, Strictness, Trigger } from '../../../graph/contract/wire/enforcement.js';
import { GraphFeed, GraphJournal, type GraphFrame } from '../../../graph/contract/service/journal.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { QUIET_DRIVER } from '../../../enforcement/testing/doubles.js';
import type { SubmitReceipt } from '../../../landing/contract/wire/receipt.js';
import type { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import { checksOver, driverOver, journalOver, type Lanes, withLanes } from '../../../enforcement/testing/wiring.js';
import type { LandingJournal } from '../../../enforcement/contract/service/remeasure.js';
import type { EscapeNotice, LandedTree } from '../../../enforcement/contract/wire/checks.js';
import { Remeasure } from '../../../enforcement/contract/service/remeasure.js';
import { gitEffect } from '../graphFixture.js';
import { fileReady } from '../change-record/commandWorld.js';

const MINE = 'mirror-git';
const THEIRS = 'amber-fox';
const UPWARD = "import { main } from '../app/main';\nexport const boot = main;\n";
type EnforcementOptions = { readonly on?: readonly Trigger[]; readonly driver?: Remeasure['Service'] };
type DriveOptions = { readonly memory?: string; readonly delayMs?: number; readonly lanes?: Lanes };

const makeCase = Effect.fnUntraced(function* (fixture: EnforcementFixture) {
  const { demo } = fixture;
  const { workers } = yield* Enforcements;
  const files = yield* FileSystem.FileSystem;
  const at = (path: string) => join(demo.demoRoot, path);
  const put = Effect.fnUntraced(function* (path: string, text: string) {
    yield* files.makeDirectory(dirname(at(path)), { recursive: true });
    yield* files.writeFileString(at(path), text);
  });
  const context = withLanes(demo.context, workers);
  const originFor = (threadId: string) => ({ ...PLACE, generation: 0, work: { projectId: demo.projectId, threadId } }) as WorkingOrigin;
  const wrote = Effect.fnUntraced(function* (threadId: string, path: string, text: string | null) {
    const before = (yield* files.exists(at(path))) ? yield* files.readFileString(at(path)) : '';
    if (text === null) yield* files.remove(at(path));
    else yield* put(path, text);
    yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, threadId, testPlace(path), {
      before,
      after: text,
      mode: '100644',
    });
  });
  const enforced = Effect.fnUntraced(function* (strictness: Strictness, asked: EnforcementOptions = {}) {
    const rule = yield* fixture.created(['rule'], 'Import only downward');
    const owner = yield* fixture.created(['task'], 'Move the view off the panel');
    yield* fixture.working(
      perform(
        bodies.enforce_rule,
        {
          blockId: rule,
          base: null,
          strictness,
          inspection: LAYERED_KEY,
          owners: { 'app order core/view.ts -> ui/': owner },
          on: asked.on ?? TRIGGERS.landing,
        },
        operator,
      ).pipe(Effect.provideService(Remeasure, asked.driver ?? QUIET_DRIVER)),
    );
    return { rule, id: yield* demo.graph.blockNames.idOfName(rule) };
  });
  const submit = Effect.fnUntraced(function* (threadId: string, whole = false) {
    const services = yield* landingServices;
    return yield* Effect.acquireUseRelease(
      claimPreparedInstance(preparedBase(demo.graph.store)),
      (inst) =>
        Effect.gen(function* () {
          const producer = makePreparedChanges(
            { commands: quietCommands, pathsOfThread, evidenceInGroups },
            landingAdmission(makeLandingHolds()),
            judgingFns(CHECKOUT_DIRECTORY),
            inst.dir,
          );
          const receipt = yield* submitOver(
            demo.graph.git,
            demo.demoRoot,
            demo.graph.store,
            demo.graph.units,
            originFor(threadId),
            { projectId: demo.projectId, tasks: [], taking: [], whole: whole ? ['.'] : undefined },
            actChecks(checksOver({ graphOf: () => Effect.succeed(context) }), 'submit_work'),
            producer,
          ).pipe(Effect.provide(services));
          if (receipt.status !== 'landed') return yield* Effect.die(new Error(`expected a landing, got ${JSON.stringify(receipt)}`));
          return receipt;
        }),
      (inst) => inst.release,
    );
  });
  const commitTree = Effect.fnUntraced(function* (paths: readonly string[], message: string) {
    yield* fixture.committed(message);
    return {
      kind: 'tree',
      projectId: demo.projectId,
      root: demo.demoRoot,
      commit: yield* fixture.head(),
      paths,
    } satisfies LandedTree;
  });
  const documentOf = Effect.fnUntraced(function* (id: number) {
    return (yield* demo.graph.blocks.blockById(id)).fields.enforcement as LawEnforcement | undefined;
  });
  const frames = yield* Queue.unbounded<GraphFrame>();
  const feed = yield* GraphFeed;
  yield* Effect.acquireRelease(
    feed.subscribe(demo.projectId, (frame) => {
      Queue.offerUnsafe(frames, frame);
    }),
    (stop) => Effect.sync(stop),
  );
  const measured = Effect.fn('testing.remeasured')(function* (id: number) {
    const name = yield* demo.nameOf(id);
    for (;;) {
      const frame = yield* Queue.take(frames);
      if (frame.type === 'change' && frame.events.some((event) => event.op === 'remeasure' && event.blockName === name)) return;
    }
  });
  const entries = (id: number) =>
    GraphJournal.use((journal) => journal.events({ projectId: demo.projectId, blockId: id, ops: ['remeasure'], limit: 10 }));
  const driven = Effect.fnUntraced(function* (options: DriveOptions = {}) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const completed = yield* Queue.unbounded<void>();
    const journal = journalOver(demo.graph.store.db, demo.graph.units);
    const observed: LandingJournal = {
      ...journal,
      remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(completed, undefined))),
    };
    const driver = yield* Scope.provide(
      driverOver({
        graphOf: () => Effect.succeed(withLanes(demo.context, options.lanes ?? workers)),
        memory: options.memory ?? null,
        delayMs: options.delayMs ?? 0,
        journal: observed,
        coverage: fixedCoverage(demo.projectId, [{ checkout: 'demo', root: demo.demoRoot }]),
      }),
      scope,
    );
    const told: EscapeNotice[] = [];
    const notices = yield* Queue.unbounded<EscapeNotice>();
    yield* Scope.provide(
      Effect.acquireRelease(
        Effect.sync(() =>
          driver.telling((notice) =>
            Effect.gen(function* () {
              told.push(notice);
              yield* Queue.offer(notices, notice);
              return { _tag: 'Accepted' };
            }),
          ),
        ),
        (stop) => Effect.sync(stop),
      ),
      scope,
    );
    const landed = (receipt: SubmitReceipt, op = 'submit_work') =>
      receipt.status !== 'landed'
        ? Effect.die('the fixture expected a landed receipt')
        : driver.landed(op, {
            kind: 'tree',
            projectId: demo.projectId,
            root: demo.demoRoot,
            commit: receipt.commit,
            paths: receipt.committed,
            carried: receipt.carriedViolations ?? [],
          });
    return {
      driver,
      journal,
      landed,
      told,
      notice: Queue.take(notices),
      settled: Queue.take(completed),
      close: Scope.close(scope, Exit.void),
    };
  });
  return {
    demo,
    files,
    workers,
    at,
    put,
    wrote,
    enforced,
    submit,
    documentOf,
    measured,
    entries,
    driven,
    head: fixture.head,
    committed: fixture.committed,
    commitTree,
  };
});
type Case = Effect.Success<ReturnType<typeof makeCase>>;
const withCase = <A, E, R>(body: (scene: Case) => Effect.Effect<A, E, R>) =>
  withEnforcement((fixture) => Effect.flatMap(makeCase(fixture), body));

layer(enforceFixture(), { excludeTestServices: true })('remeasurement', (it) => {
  it.effect('a live peer’s carried crossing is journaled, recorded as escaped and delivered to its home project', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        const { demo } = scene;
        yield* scene.put('src/core/shared.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
        yield* scene.committed('shared source');
        const { id } = yield* scene.enforced('gate');
        const foreignRoot = yield* demo.fixture.directory('holder-home');
        const holderHome = yield* demo.graph.projectLifecycle.create({ name: 'holder-home', rootPath: foreignRoot });
        const before = yield* scene.files.readFileString(scene.at('src/core/shared.ts'));
        const after = "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main;\nexport const c = 3;\n";
        const intake = yield* intakeOf(demo.graph.store, demo.graph.units, demo.graph.git, gitCheckoutPaths(TEST_CHECKOUT, demo.projectId));
        expect(
          yield* intake.land(
            { projectId: holderHome.id, holder: { kind: 'thread', thread: THEIRS } },
            [
              {
                path: scene.at('src/core/shared.ts'),
                origin: 'edit',
                before: contentDigest(before),
                after: contentDigest(after),
                beforeText: before,
                afterText: after,
                hunk: workspaceChangeHunk(before, after),
                at: new Date(yield* Clock.currentTimeMillis),
              },
            ],
            lineWrites.replace({ root: demo.demoRoot, path: 'src/core/shared.ts', before, after }, Effect.succeed(true)),
          ),
        ).toEqual({ _tag: 'written', kept: true });
        yield* scene.wrote(MINE, 'src/core/shared.ts', after.replace('b = main;', 'b = main + 1;'));
        const receipt = yield* scene.submit(MINE, true);
        expect(receipt.carriedViolations?.map(({ fingerprint, holders }) => ({ fingerprint, holders }))).toEqual([
          { fingerprint: 'app order core/shared.ts -> app/', holders: [THEIRS] },
        ]);
        const release = yield* Deferred.make<void>();
        const paused: Lanes = {
          ...scene.workers,
          reach: (ask) => Deferred.await(release).pipe(Effect.andThen(scene.workers.reach(ask))),
        };
        const drive = yield* scene.driven({ lanes: paused });
        yield* drive.landed(receipt);
        expect(yield* drive.journal.page(null, 10)).toHaveLength(1);
        yield* Deferred.succeed(release, undefined);
        const notice = yield* drive.notice;
        yield* drive.settled;
        const document = yield* scene.documentOf(id);
        expect(document?.escaped).toEqual([
          {
            fingerprint: 'app order core/shared.ts -> app/',
            path: 'src/core/shared.ts',
            line: 2,
            said: expect.stringContaining('imports `../app/main`'),
            fix: expect.stringContaining('set_module'),
            commit: receipt.commit,
            holder: THEIRS,
          },
        ]);
        expect(yield* drive.journal.page(null, 10)).toEqual([]);
        expect(document?.debt.map((one) => one.fingerprint)).toEqual(['app order core/view.ts -> ui/']);
        expect(document?.strictness).toBe('gate');
        expect({ threadId: notice.threadId, projectId: notice.projectId }).toEqual({ threadId: THEIRS, projectId: holderHome.id });
        expect(notice.text).toContain('src/core/shared.ts:2');
        expect(yield* scene.entries(id)).toHaveLength(1);
      }),
    ),
  );

  it.effect('the driver retires a debt entry and an escape after their last imports land away', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        const { id } = yield* scene.enforced('watch');
        const drive = yield* scene.driven();
        yield* scene.put('src/core/boot.ts', UPWARD);
        const first = yield* scene.commitTree(['src/core/boot.ts'], 'a crossing lands');
        yield* drive.driver.landed('submit_work', first);
        yield* drive.settled;
        expect((yield* scene.documentOf(id))?.escaped).toEqual([
          {
            fingerprint: 'app order core/boot.ts -> app/',
            path: 'src/core/boot.ts',
            line: 1,
            said: expect.any(String),
            fix: expect.any(String),
            commit: first.commit,
          },
        ]);
        yield* scene.put('src/core/view.ts', "import { model } from './model';\nexport const view = model;\n");
        yield* scene.files.remove(scene.at('src/core/boot.ts'));
        const removed = yield* scene.commitTree(['src/core/boot.ts', 'src/core/view.ts'], 'the crossings leave');
        yield* drive.driver.landed('submit_work', removed);
        yield* drive.settled;
        const cleared = yield* scene.documentOf(id);
        expect(cleared?.debt).toEqual([]);
        expect(cleared?.escaped).toEqual([]);
        expect(cleared?.strictness).toBe('watch');
        expect(yield* scene.entries(id)).toHaveLength(2);
      }),
    ),
  );

  it.effect('a carried crossing removed before remeasurement names no holder while another crossing stands', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        const { id, rule } = yield* scene.enforced('watch');
        const drive = yield* scene.driven();
        yield* scene.wrote(
          THEIRS,
          'src/core/shared.ts',
          "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main;\n",
        );
        yield* scene.put('src/core/boot.ts', UPWARD);
        const receipt: LandedTree = {
          ...(yield* scene.commitTree(['src/core/shared.ts', 'src/core/boot.ts'], 'a carried crossing lands')),
          carried: [
            {
              rule,
              title: 'Import only downward',
              strictness: 'watch',
              fingerprint: 'app order core/shared.ts -> app/',
              file: 'src/core/shared.ts',
              line: 2,
              specifier: '../app/main',
              message: 'imports `../app/main`',
              generalFix: 'Move the import downward.',
              holders: [THEIRS],
            },
          ],
        };
        yield* scene.put('src/core/shared.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
        yield* scene.committed('the peer takes its import back outside Tagma');
        yield* drive.driver.landed('submit_work', receipt);
        yield* drive.settled;
        expect((yield* scene.documentOf(id))?.escaped).toEqual([
          {
            fingerprint: 'app order core/boot.ts -> app/',
            path: 'src/core/boot.ts',
            line: 1,
            said: expect.any(String),
            fix: expect.any(String),
            commit: receipt.commit,
          },
        ]);
        expect(drive.told).toEqual([]);
      }),
    ),
  );

  it.effect('only a matching merge on the measured branch records the merge rule’s escape', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        const { demo } = scene;
        const { id } = yield* scene.enforced('gate', { on: TRIGGERS.merge });
        const drive = yield* scene.driven();
        yield* scene.put('src/core/boot.ts', UPWARD);
        yield* scene.committed('a crossing made outside Tagma');
        const landing: LandedTree = {
          kind: 'tree',
          projectId: demo.projectId,
          root: demo.demoRoot,
          commit: yield* scene.head(),
          paths: ['src/core/boot.ts'],
        };
        yield* drive.driver.landed('submit_work', landing);
        yield* drive.settled;
        expect((yield* scene.documentOf(id))?.escaped).toEqual([]);
        yield* gitEffect(demo.demoRoot, ['switch', '-q', '-c', 'aside']);
        yield* scene.put('src/core/aside.ts', UPWARD);
        yield* scene.committed('a commit on another branch');
        const aside = yield* scene.head();
        yield* gitEffect(demo.demoRoot, ['switch', '-q', 'main']);
        yield* drive.driver.landed('merge_worktree', { ...landing, commit: aside, paths: ['src/core/aside.ts'] });
        yield* drive.settled;
        expect((yield* scene.documentOf(id))?.escaped).toEqual([]);
        yield* drive.driver.landed('merge_worktree', landing);
        yield* drive.settled;
        expect((yield* scene.documentOf(id))?.escaped).toEqual([
          {
            fingerprint: 'app order core/boot.ts -> app/',
            path: 'src/core/boot.ts',
            line: 1,
            said: expect.any(String),
            fix: expect.any(String),
            commit: landing.commit,
          },
        ]);
      }),
    ),
  );

  it.effect(
    'enforce_rule remembers the checkout for the driver’s next start, and startup remeasures it and records a crossing committed outside Tagma',
    () =>
      withCase((scene) =>
        Effect.gen(function* () {
          const { demo } = scene;
          const memory = join(yield* demo.fixture.directory('remeasured-memory'), 'enforced.json');
          const first = yield* scene.driven({ memory });
          const { id } = yield* scene.enforced('gate', { driver: first.driver });
          yield* fileReady(memory);
          const remembered = yield* scene.files.readFileString(memory);
          expect(remembered).toContain(`"projectId": ${demo.projectId}`);
          expect(remembered).toContain(demo.demoRoot);
          yield* first.close;
          yield* scene.put('src/core/late.ts', UPWARD);
          yield* scene.committed('a crossing made outside Tagma');
          const commit = yield* scene.head();
          yield* scene.driven({ memory });
          yield* scene.measured(id);
          expect((yield* scene.documentOf(id))?.escaped).toEqual([
            {
              fingerprint: 'app order core/late.ts -> app/',
              path: 'src/core/late.ts',
              line: 1,
              said: expect.any(String),
              fix: expect.any(String),
              commit,
            },
          ]);
        }),
      ),
  );
});
