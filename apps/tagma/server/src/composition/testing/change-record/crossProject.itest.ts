import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Deferred, Effect, Exit, Fiber, FileSystem, Path, Schema, Scope } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { Git } from '@runlith/git/Git';
import { bornThread } from '../../../native-harness/testing/born.js';
import { threadRecord } from '../../../thread-record/store/table.js';
import { forProject, inWorkspace, withChangeScope } from '../../../invocation/testing/call.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { CommandChanges } from '../../../change-record/contract/service/commands.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { ThreadChanges } from '../../../change-record/contract/service/threadChanges.js';
import { naming, retirerOver, servedOver } from '../../../change-record/testing/doubles.js';
import { readChangeRows } from '../../../change-record/operations/changes.js';
import { readThreadHistory } from '../../../change-record/operations/history.js';
import { recordReported } from '../../../change-record/operations/record.js';
import { commitOverlay } from '../../../change-record/record/overlay.js';
import { namesOfHolders, resolveHandover } from '../../../change-record/record/sessions.js';
import { threadChangesOver } from '../../../change-record/changes/stream.js';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import type { Holder } from '../../../workspace/contract/wire/checkout.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import type { Coverage } from '../../../workspace/contract/service/roots.js';
import { checkoutPaths, coveredWorkspace, gitCheckoutRows } from '../../../workspace/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';

const ACTOR = 'writer-a';
const PEER = 'builder-b';
const BASE = 'one\ntwo\nthree\n';

layer(demoGraphLayer({ repos: ['target'] }), { excludeTestServices: true })('foreign changes', (it) => {
  it.effect('a thread owns its edits and commands in another project across restoration, reads and retirement', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { store, units, projects } = demo.graph;
        const liveGit = yield* Git;
        const files = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const target = demo.project('target');
        const root = realpathSync(target.root);
        const home = demo.projectId;
        const shared = join(root, 'shared.txt');
        yield* files.writeFileString(shared, BASE);
        yield* gitEffect(root, ['add', 'shared.txt']);
        yield* gitEffect(root, ['commit', '-q', '-m', 'shared base']);
        for (const [id, projectId, name, parent] of [
          [ACTOR, home, 'writer', null],
          [PEER, target.id, 'builder', ACTOR],
        ] as const) {
          yield* bornThread(
            store.db,
            {
              id,
              ownerId: 'owner',
              agentId: 'tagma',
              spawnRootId: ACTOR,
              cacheGroup: ACTOR,
              name,
              parentThreadId: parent ?? undefined,
              status: 'idle',
              provider: 'openai-oauth',
              model: 'gpt-test',
              reasoning: 'high',
              authority: { mode: 'trust', bypassFrom: null },
              createdAt: new Date(0),
              updatedAt: new Date(0),
            },
            { projectId, title: name, readerOrderAt: new Date(0) },
          );
        }
        const { roots, coverage } = yield* coveredWorkspace({
          namespaceId: NamespaceId.make('cross-project'),
          projects,
          git: liveGit,
        });
        const paths = yield* checkoutPaths(coverage, projects);
        const scope = yield* Effect.scope;
        const checkouts = yield* gitCheckoutRows(liveGit, roots, files, scope);
        const absentRoot = yield* files.makeTempDirectoryScoped({ prefix: 'missing-project-' });
        const absent = yield* demo.graph.projectLifecycle.create({ name: 'absent', rootPath: absentRoot });
        yield* files.remove(absentRoot, { recursive: true });
        const placed = yield* paths.placeAcross(shared);
        expect((yield* Effect.flip(paths.placeAcross(join(absentRoot, 'file.txt'))))._tag).toBe('PlaceUnread');
        yield* files.makeDirectory(absentRoot, { recursive: true });
        expect((yield* paths.placeAcross(join(absentRoot, 'file.txt')))?.projectId).toBe(absent.id);
        if (placed === null) return yield* Effect.die('the target checkout was not registered');
        expect(placed.projectId).toBe(target.id);
        expect(yield* paths.placeOf(home, shared)).toBeNull();
        const building = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let delayed = false;
        const slowCoverage: Coverage['Service'] = {
          cover: (id) => coverage.cover(id),
          adopt: (id, at) => coverage.adopt(id, at),
          covered: (id) =>
            coverage.covered(id).pipe(
              Effect.flatMap((snapshot) => {
                if (id !== target.id || delayed) return Effect.succeed(snapshot);
                delayed = true;
                return Effect.andThen(Deferred.succeed(building, undefined), Effect.as(Deferred.await(release), snapshot));
              }),
            ),
          survey: (id) => coverage.survey(id),
          admit: (request) => coverage.admit(request),
          follow: (id, at) => coverage.follow(id, at),
          followAcross: (at) => coverage.followAcross(at),
          onCovered: (listener) => coverage.onCovered(listener),
          recorded: (id) => coverage.recorded(id),
        };
        const nestedPath = join(realpathSync(demo.demoRoot), 'nested');
        yield* files.makeDirectory(nestedPath, { recursive: true });
        const racingPaths = yield* checkoutPaths(slowCoverage, projects);
        const lookup = yield* Effect.forkChild(racingPaths.placeAcross(join(nestedPath, 'file.txt')));
        yield* Deferred.await(building);
        const nested = yield* coverage.adopt(home, nestedPath);
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(lookup))?.checkout).toBe(nested.rootId);
        const open = Effect.gen(function* () {
          const lifetime = yield* Scope.fork(yield* Effect.scope);
          const ports = { store, units, git: liveGit, checkouts, paths, roots, coverage };
          const served = yield* Scope.provide(servedOver(ports), lifetime);
          const retirement = yield* Scope.provide(retirerOver(served, ports, lineWrites), lifetime);
          yield* retirement.start;
          const changes = threadChangesOver(
            served.judges,
            served.held,
            { store, units, git: liveGit, roots, checkouts, paths },
            { described: new Map(), reaching: new Map() },
          );
          const caller: Caller = {
            actor: {
              kind: 'thread',
              threadId: ACTOR,
              projectId: home,
              principalId: 'owner',
              session: { harness: 'tagma', key: ACTOR },
            },
            files: null,
          };
          const read = (asked: { readonly agent?: string; readonly path?: string } = {}, by: Caller = caller) =>
            readChangeRows({ ...asked, limit: 10 }, by).pipe(
              withChangeScope(home),
              inWorkspace(null),
              Effect.provideService(ChangeRecord, served.changes),
              Effect.provideService(CommandChanges, served.commands),
              Effect.provideService(Holdings, served.judges),
              Effect.provideService(ThreadChanges, changes),
              Effect.provideService(CheckoutPaths, paths),
            );
          const history = readThreadHistory.body
            .execute({ threadId: ACTOR, limit: 10 }, undefined, { actor: { kind: 'operator' }, files: null })
            .pipe(
              withChangeScope(home),
              Effect.provideService(ChangeRecord, served.changes),
              Effect.provideService(Holdings, served.judges),
            );
          return { served, retirement, read, history, caller, close: Scope.close(lifetime, Exit.void) };
        });
        const first = yield* open;
        const reach = first.served.changes.changes({ work: { projectId: home, threadId: ACTOR } }).checkouts;
        expect(yield* reach?.([join(root, 'fresh', 'made.txt'), shared]) ?? Effect.die('the record places no command paths')).toEqual({
          trees: [root],
          unplaced: [],
        });
        const save = Effect.fnUntraced(function* (
          holder: Holder,
          projectId: number,
          before: string | null,
          after: string,
          at = 'shared.txt',
        ) {
          return yield* first.served.intake.turn(
            projectId,
            [join(root, at)],
            first.served.intake.land(
              { projectId, holder },
              [
                {
                  origin: before === null ? 'write' : 'edit',
                  path: join(root, at),
                  at: new Date(yield* Clock.currentTimeMillis),
                  before: contentDigest(before ?? ''),
                  after: contentDigest(after),
                  beforeText: before ?? '',
                  afterText: after,
                  hunk: workspaceChangeHunk(before ?? '', after),
                  mode: '100644',
                },
              ],
              lineWrites.replace({ root, path: at, before, after }, Effect.succeed(true)),
            ),
          );
        });
        const mine = 'agent\ntwo\nthree\n';
        const operator = 'agent\noperator\nthree\n';
        const mixed = 'agent\noperator\npeer\n';
        expect(yield* save({ kind: 'thread', thread: ACTOR }, home, BASE, mine)).toEqual({ _tag: 'written', kept: true });
        yield* save({ kind: 'operator' }, target.id, mine, operator);
        yield* save({ kind: 'thread', thread: PEER }, target.id, operator, mixed);
        yield* save({ kind: 'operator' }, target.id, null, 'operator-only\n', 'operator-only.txt');
        yield* save({ kind: 'thread', thread: PEER }, target.id, null, 'peer-only\n', 'peer-only.txt');
        const command = yield* (
          first.served.changes.changes({ work: { projectId: home, threadId: ACTOR } }).command?.(root, naming(root)) ?? Effect.succeed(null)
        );
        if (command === null) return yield* Effect.die('the foreign checkout opened no command window');
        yield* command.based({ head: null, at: yield* Clock.currentTimeMillis, dirty: new Map(), contents: new Map() });
        command.opened();
        const started = yield* Clock.currentTimeMillis;
        yield* files.writeFileString(join(root, 'command.txt'), 'command\n');
        command.ended();
        yield* command.settle({
          base: null,
          window: { from: started, to: yield* Clock.currentTimeMillis },
          moves: [
            {
              name: 'command.txt',
              before: contentDigest(''),
              after: contentDigest('command\n'),
              present: true,
              existed: false,
              written: { from: started, to: started },
              bytes: new TextEncoder().encode('command\n'),
              link: false,
              mode: null,
            },
          ],
        });
        expect((yield* first.read()).checkouts.flatMap((checkout) => checkout.entries.map((entry) => entry.path))).toContain('command.txt');
        yield* files.writeFileString(join(root, 'command.txt'), 'reported\n');
        expect(
          yield* recordReported.body
            .execute({ cwd: root, path: 'command.txt', before: 'command\n', after: 'reported\n' }, undefined, first.caller)
            .pipe(
              forProject(Effect.succeed({ project: { id: target.id, name: 'target' } })),
              Effect.provideService(ChangeRecord, first.served.changes),
            ),
        ).toEqual({ status: 'recorded', path: 'command.txt' });
        yield* first.close;
        const second = yield* open;
        const rows = yield* store.db.select().from(workspaceChange).where(eq(workspaceChange.checkout, placed.checkout));
        expect(rows.map((row) => [row.projectId, row.holderProjectId, row.holder, row.state]).sort()).toEqual(
          [
            [target.id, home, ACTOR, 'held'],
            [target.id, home, ACTOR, 'held'],
            [target.id, home, ACTOR, 'held'],
            [target.id, null, 'operator', 'held'],
            [target.id, null, 'operator', 'held'],
            [target.id, target.id, PEER, 'held'],
            [target.id, target.id, PEER, 'held'],
          ].sort(),
        );
        const read = yield* second.read();
        expect(read.checkouts.flatMap((checkout) => checkout.entries.map((entry) => entry.path)).sort()).toEqual([
          'command.txt',
          'shared.txt',
        ]);
        expect(read.turns.map((turn) => [turn.checkout, turn.state])).toEqual([
          [placed.checkout, 'held'],
          [placed.checkout, 'held'],
        ]);
        expect((yield* second.read({ agent: ACTOR }, { actor: { kind: 'operator' }, files: null })).turns).toEqual(read.turns);
        expect((yield* second.history).turns).toEqual(read.turns);
        const sharedEntry = read.checkouts.flatMap((checkout) => checkout.entries).find((entry) => entry.path === 'shared.txt');
        expect(sharedEntry?.section === 'uncommitted' ? sharedEntry.others.map((other) => other.holder) : []).toEqual([
          { kind: 'operator' },
          { kind: 'thread', thread: PEER },
        ]);
        expect(
          (yield* second.read({ agent: 'builder' })).checkouts.flatMap((checkout) => checkout.entries.map((entry) => entry.path)).sort(),
        ).toEqual(['peer-only.txt', 'shared.txt']);
        expect((yield* namesOfHolders(store, [ACTOR, PEER])).get(ACTOR)?.name).toBe('writer');
        expect(yield* resolveHandover(store, home, ACTOR, ['builder', PEER])).toEqual([
          { projectId: target.id, threadId: PEER, label: 'builder', running: false },
        ]);
        const bound = yield* roots.read(RootId.make(placed.checkout));
        const origin = yield* Schema.decodeUnknownEffect(WorkingOrigin)({
          environment: {
            environmentId: 'host',
            kind: 'host',
            namespaceId: roots.namespaceId,
            identityWitness: { provider: 'test', format: 'namespace', token: roots.namespaceId },
          },
          root: { namespaceId: roots.namespaceId, path: root },
          witness: bound.witness,
          registration: { rootId: bound.rootId, locationRevision: bound.locationRevision },
          generation: 0,
          work: { projectId: home, threadId: ACTOR },
        });
        const taken = yield* resolveHandover(store, home, ACTOR, ['operator', 'builder']);
        const prepared = yield* second.served.prepared.changes.prepare({
          projectId: target.id,
          git: liveGit,
          root,
          store,
          units,
          origin,
          checkout: placed.checkout,
          input: { taking: taken, paths: ['operator-only.txt', 'peer-only.txt'] },
          job: 'taking-foreign',
          caller: second.caller,
          act: { kind: 'thread', ...origin.work },
        });
        if (prepared.prepared === null) return yield* Effect.die('taking produced no change');
        expect(prepared.prepared.built.changed).toContain('operator-only.txt');
        expect(prepared.prepared.built.changed).toContain('peer-only.txt');
        const tree = prepared.prepared.subject.built;
        expect((yield* liveGit.run(['show', `${tree}:operator-only.txt`], { cwd: root })).stdout).toBe('operator-only\n');
        expect((yield* liveGit.run(['show', `${tree}:peer-only.txt`], { cwd: root })).stdout).toBe('peer-only\n');
        yield* second.served.prepared.changes.release(prepared.prepared);
        const byPath = yield* second.read({ path: shared });
        expect(byPath.holdings[0]?.holding.verdict.verdict).toBe('proven');
        expect(yield* files.readFileString(shared)).toBe(mixed);
        yield* store.db.delete(threadRecord).where(and(eq(threadRecord.id, PEER), eq(threadRecord.projectId, target.id)));
        yield* second.retirement.deleted(target.id, PEER);
        const afterDelete = yield* store.db.select().from(workspaceChange).where(eq(workspaceChange.checkout, placed.checkout));
        expect(afterDelete.find((row) => row.holder === PEER)?.reason).toBe('thread-deleted');
        expect(afterDelete.filter((row) => row.holder !== PEER).every((row) => row.state === 'held')).toBe(true);
        yield* gitEffect(root, ['add', 'shared.txt', 'command.txt', 'operator-only.txt', 'peer-only.txt']);
        yield* gitEffect(root, ['commit', '-q', '-m', 'foreign work']);
        yield* second.retirement.pass(RootId.make(placed.checkout));
        const third = yield* open;
        const landed = yield* third.read();
        expect(landed.commits.map((commit) => [commit.checkout, commit.subject, commit.files])).toEqual([
          [placed.checkout, 'foreign work', 2],
        ]);
        expect(landed.turns.every((turn) => turn.state === 'committed')).toBe(true);
        expect((yield* third.history).turns).toEqual(landed.turns);
        const commit = landed.commits[0]?.sha;
        if (commit === undefined) return yield* Effect.die('the foreign commit was not listed');
        expect([...(yield* commitOverlay(store, units).pathsOf(RootId.make(placed.checkout), target.id, ACTOR, commit))].sort()).toEqual([
          'command.txt',
          'shared.txt',
        ]);
        const moved = join(path.dirname(root), 'moved-target');
        const movedAgain = join(path.dirname(root), 'moved-again');
        yield* files.rename(root, moved);
        yield* files.makeDirectory(root);
        expect((yield* paths.placeAcross(join(moved, 'shared.txt')))?.checkout).toBe(placed.checkout);
        yield* files.rename(moved, movedAgain);
        expect(yield* roots.removed(RootId.make(placed.checkout))).toBe(false);
        expect((yield* paths.placeAcross(join(movedAgain, 'shared.txt')))?.checkout).toBe(placed.checkout);
        yield* coverage.adopt(home, movedAgain);
        expect((yield* Effect.flip(paths.placeAcross(join(movedAgain, 'shared.txt'))))._tag).toBe('PlaceUnread');
      }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(Path.layer)),
    ),
  );
});
