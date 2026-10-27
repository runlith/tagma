import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Option, Path, Scope, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { Intake } from '../../../change-record/contract/service/intake.js';
import { Renames } from '../../../checkout-files/contract/service/renames.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { CheckoutWatch } from '../../../workspace/contract/service/watch.js';
import { NamespaceId } from '@runlith/files/namespace';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { execute, prepare } from '../../../invocation/testing/performing.js';
import { lineWrites } from '../../lineWrites.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { forProject, inWorkspace } from '../../../invocation/testing/call.js';
import { commitOverlay } from '../../../change-record/record/overlay.js';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { changesChannel, retirerOver, servedOver, threadChangesOver } from '../../../change-record/testing/doubles.js';
import { Documents } from '../../../checkout-files/contract/service/documents.js';
import { makeFolderWatches } from '../../../checkout-files/documents/folders.js';
import { makeOpenDocuments } from '../../../checkout-files/documents/open.js';
import { filesChannel } from '../../../checkout-files/feed.js';
import { FILE_PAIRS } from '../../../checkout-files/operations/pairs.js';
import { makeTargets } from '../../../checkout-files/tree/target.js';
import { makeFilesWorker } from '../../../checkout-files/worker/client.js';
import { makeDocumentSaves } from '../../../checkout-files/writing/document.js';
import { CheckoutPlaces } from '../../../workspace/contract/service/checkouts.js';
import type { RootReservations } from '../../../workspace/contract/service/roots.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import {
  assignmentStore,
  checkoutPaths,
  checkoutWatches,
  coverageLedger,
  coverageStore,
  fileRootStore,
  gitCheckoutReads,
  gitCheckoutRows,
  repositoryRegistry,
  repositoryStore,
  rootRegistry,
  rootUseLedger,
  rootUseStore,
} from '../../../workspace/testing/doubles.js';

const WRITER = 'writer-a';
const unreserved: RootReservations['Service'] = { holding: () => Effect.succeed(new Map()) };

layer(demoGraphLayer({ repos: ['target'] }), { excludeTestServices: true })('foreign checkout', (it) => {
  it.effect(
    "a call from one project names another project's checkout by id or path: it reads, writes and lists under that checkout's own project",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { store, units, projects } = demo.graph;
          const liveGit = yield* Git;
          const files = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const home = demo.projectId;
          const target = demo.project('target');
          const root = realpathSync(target.root);
          yield* bornThread(
            store.db,
            {
              id: WRITER,
              ownerId: 'owner',
              agentId: 'tagma',
              spawnRootId: WRITER,
              name: 'writer',
              status: 'idle',
              provider: 'openai-oauth',
              model: 'gpt-test',
              reasoning: 'high',
              authority: { mode: 'trust', bypassFrom: null },
              createdAt: new Date(0),
              updatedAt: new Date(0),
            },
            { projectId: home, title: 'writer', readerOrderAt: new Date(0) },
          );
          const records = yield* fileRootStore(store.db, units);
          const roots = yield* rootRegistry(records, files, path, NamespaceId.make('foreign-checkout'), unreserved);
          const repositories = yield* repositoryRegistry(yield* repositoryStore(store.db, units), liveGit, files, path, roots.namespaceId);
          const uses = yield* rootUseLedger(rootUseStore(store.db), roots, records, units);
          const coverage = yield* coverageLedger(
            projects,
            roots,
            repositories,
            coverageStore(store.db),
            assignmentStore(store.db),
            units,
            liveGit,
          );
          const paths = yield* checkoutPaths(coverage, projects);
          const scope = yield* Effect.scope;
          const checkouts = yield* gitCheckoutRows(liveGit, roots, files, scope);
          const reads = yield* gitCheckoutReads(coverage, paths, files, path, liveGit);
          const ports = { store, units, git: liveGit, checkouts, paths, roots, coverage };
          const served = yield* servedOver(ports);
          const caller = { projectId: home, cwd: undefined };

          const byId = (yield* paths.placeAcross(root))?.checkout;
          if (byId === undefined) return yield* Effect.die('the target checkout was not covered');
          const checkout = RootId.make(byId);
          const named = yield* reads.placeOf(caller, checkout);
          expect([named.projectId, named.rootId]).toEqual([target.id, checkout]);
          expect(yield* reads.placeOf(caller, join(root, 'src'))).toEqual(named);
          const link = join(yield* files.makeTempDirectoryScoped({ prefix: 'foreign-link-' }), 'target-link');
          yield* files.symlink(root, link);
          expect(yield* reads.placeOf(caller, link)).toEqual(named);
          expect(yield* paths.placeAcross(link)).toBeNull();
          expect((yield* Effect.flip(reads.placeOf(caller, 'no-such-root'))).code).toBe('not-found');

          const thread = join(root, 'thread.txt');
          yield* served.intake.turn(
            home,
            [thread],
            served.intake.land(
              { projectId: home, holder: { kind: 'thread', thread: WRITER } },
              [
                {
                  origin: 'write',
                  path: thread,
                  at: new Date(yield* Clock.currentTimeMillis),
                  before: contentDigest(''),
                  after: contentDigest('thread\n'),
                  beforeText: '',
                  afterText: 'thread\n',
                  hunk: workspaceChangeHunk('', 'thread\n'),
                  mode: '100644',
                },
              ],
              lineWrites.replace({ root, path: 'thread.txt', before: null, after: 'thread\n' }, Effect.succeed(true)),
            ),
          );

          const worker = makeFilesWorker();
          yield* Effect.addFinalizer(() => Effect.sync(() => worker.close()));
          const targets = yield* makeTargets({ graph: '.tagma' }).pipe(Effect.provideService(CheckoutPaths, paths));
          const open = yield* makeOpenDocuments({ targets, worker, folders: makeFolderWatches() }).pipe(
            Effect.provideService(CheckoutWatch, yield* checkoutWatches(liveGit, roots, scope)),
            Effect.provideService(Renames, { movedTo: (from) => served.changes.movedTo(from) }),
            Effect.provideService(Scope.Scope, scope),
          );
          const saves = yield* makeDocumentSaves({ documents: open, targets, worker }).pipe(
            Effect.provideService(Intake, served.intake),
            Effect.provideService(Git, liveGit),
            Effect.provideService(FileSystem.FileSystem, files),
          );
          const documents: Documents['Service'] = {
            subscribe: open.subscribe,
            save: saves.save,
            placeOf: targets.placed,
            subscribeLoose: (projectId, path) =>
              Stream.unwrap(Effect.map(targets.loose(projectId, path), (file) => open.subscribeLoose(file))),
            saveLoose: (projectId, save) => Effect.flatMap(targets.loose(projectId, save.path), (file) => saves.saveLoose(file, save)),
          };
          const request = { root: checkout, path: 'doc.txt', base: null, write: 'w1', text: 'operator\n' };
          const operator: import('../../../platform/contract/wire/caller.js').Caller = { actor: { kind: 'operator' }, files: null };
          const operation = { ...FILE_PAIRS.write_document.body, id: FILE_PAIRS.write_document.id };
          const saved = yield* Effect.gen(function* () {
            const prepared = yield* prepare(operation, request, operator);
            return yield* execute(operation, request, prepared, operator);
          }).pipe(
            forProject(Effect.succeed({ project: { id: home, name: 'demo' } })),
            inWorkspace(null),
            Effect.provideService(Documents, documents),
            Effect.provideService(CheckoutPlaces, reads),
          );
          expect(saved).toMatchObject({ status: 'ok', kept: true });
          const operatorRows = yield* store.db
            .select({ projectId: workspaceChange.projectId, holder: workspaceChange.holder, checkout: workspaceChange.checkout })
            .from(workspaceChange)
            .where(eq(workspaceChange.path, 'doc.txt'));
          expect(operatorRows).toEqual([{ projectId: target.id, holder: 'operator', checkout }]);

          const document = filesChannel(
            reads,
            {
              list: () => Effect.die(new Error('this scenario reads no directory')),
              tree: () => Stream.die(new Error('this scenario watches no directory')),
            },
            { run: () => Stream.die(new Error('this scenario searches no content')) },
            documents,
            { subscribe: () => Stream.die(new Error('this scenario lists no folder')) },
            { of: () => Effect.die(new Error('this scenario reads no scratch')) },
          )['document.subscribe']({ projectId: home, root, path: 'doc.txt' });
          const shown = yield* Stream.runHead(document);
          expect(Option.getOrUndefined(shown)).toMatchObject({ kind: 'whole', text: 'operator\n' });

          yield* gitEffect(root, ['add', 'thread.txt', 'doc.txt']);
          yield* gitEffect(root, ['commit', '-q', '-m', 'foreign work']);
          const retirer = yield* retirerOver(served, ports, lineWrites);
          yield* retirer.pass(checkout);
          const commit = yield* reads.commit(caller, { root: checkout, commit: 'HEAD', thread: WRITER }, commitOverlay(store, units));
          expect([commit.marks, commit.changed, commit.files.map((one) => one.path)]).toEqual(['applied', 2, ['thread.txt']]);

          const changes = threadChangesOver(
            served.judges,
            served.held,
            { store, units, git: liveGit, roots, checkouts, paths },
            { described: new Map(), reaching: new Map() },
          );
          const frame = yield* Stream.runHead(
            changesChannel(reads, served.judges, changes, { rootOf: () => Effect.succeed(null) })['thread.changes']({
              projectId: home,
              threadId: WRITER,
            }),
          );
          const whole = Option.getOrUndefined(frame);
          if (whole?.kind !== 'whole') return yield* Effect.die('thread.changes opened with no whole frame');
          expect(whole.checkouts.find((one) => one.checkout === checkout)?.projectId).toBe(target.id);
          expect(whole.checkouts.find((one) => one.checkout !== checkout)?.projectId).toBe(home);
          expect(whole.commits.map((one) => [one.checkout, one.projectId, one.subject])).toEqual([[checkout, target.id, 'foreign work']]);
          expect(
            yield* store.db
              .select({ projectId: workspaceChange.projectId })
              .from(workspaceChange)
              .where(and(eq(workspaceChange.holder, WRITER), eq(workspaceChange.path, 'thread.txt'))),
          ).toEqual([{ projectId: target.id }]);
        }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(Path.layer)),
      ),
  );
});
