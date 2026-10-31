import { layer } from '@runlith/effect-test';
import { holdingsOver, retiredAt } from '../../../change-record/testing/holdings.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { fixedCheckoutPaths, TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { expect } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Effect, FileSystem } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import type { MachineUnits } from '../../../platform/contract/service/units.js';
import { eq, isNotNull } from 'drizzle-orm';
import { createTools } from '@runlith/agent-tools';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { callerInThread } from '../callers.js';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import { changeRecordOf, idleCommands, intakeOf, workspaceChange } from '../../../change-record/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { call, FILE, MINE, THEIRS, makeCheckout, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { testWalks } from '../../../change-record/testing/walks.js';
import { collectReleased, sweepVersions } from '../../../change-record/record/versions.js';
import { collectionSweep } from '../../../change-record/record/collection.js';
const stand = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof makeCheckout>>, outage = false) {
  for (const id of [MINE, THEIRS]) yield* w.namedAgent(id, { name: id, task: 'owned lines' });
  const walks = testWalks;
  const units: MachineUnits['Service'] = {
    read: (work, options) => w.units.read(work, options),
    markReadOnly: (work) => w.units.markReadOnly(work),
    markWrite: (work) => w.units.markWrite(work),
    program: (op, identity, work) => w.units.program(op, identity, work),
    write: (op, work) => {
      if (outage) {
        outage = false;
        return Effect.fail(new SqlError({ reason: new ConnectionError({ cause: new Error('the record store is down') }) }));
      }
      return w.units.write(op, work);
    },
  };
  const paths = yield* fixedCheckoutPaths(w.projectId, [{ checkout: TEST_CHECKOUT, root: w.root }]);
  const intake = yield* intakeOf(w.store, units, w.git, paths);
  const record = yield* changeRecordOf(w.store, units, paths, intake, yield* idleCommands(), walks);
  const world = makeMachineWorld(() => null);
  const files = world.files;
  if (files === undefined) return yield* Effect.die('the test world needs files');
  const tools = (threadId: string) =>
    createTools({
      cwd: w.root,
      world,
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      changes: record.changes({ work: { projectId: w.projectId, threadId }, runHint: 'selected' }),
    });
  const mine = tools(MINE);
  const theirs = tools(THEIRS);
  const edit = Effect.fnUntraced(function* (threadId: string, runId: string, oldString: string, newString: string) {
    yield* w.store.db.update(threadRecord()).set({ runningRunId: runId }).where(eq(threadRecord().id, threadId));
    yield* call((threadId === MINE ? mine : theirs).edit, { path: 'src/a.ts', oldString, newString });
    yield* w.store.db.update(threadRecord()).set({ runningRunId: null }).where(eq(threadRecord().id, threadId));
  });
  const remove = Effect.gen(function* () {
    yield* w.store.db.update(threadRecord()).set({ runningRunId: 'selected' }).where(eq(threadRecord().id, MINE));
    const input = { args: [w.file], glob: false };
    const dispatch = { toolCallId: 'delete', caller: callerInThread(MINE, 'selected') };
    const prepared = (yield* toolPrepare(mine.delete)!(input, dispatch)).prepared;
    const result = yield* toolExecute(mine.delete)!(input, { ...dispatch, prepared, messages: [] });
    expect(result instanceof ToolAnswer && result.verdict).toEqual({ kind: 'answered' });
    mine.delete.settled?.(dispatch);
    yield* w.store.db.update(threadRecord()).set({ runningRunId: null }).where(eq(threadRecord().id, MINE));
  });
  const checkout = { projectId: w.projectId, root: w.root, origin: w.originFor(MINE), git: w.git };
  const execute = <A, E>(effect: Effect.Effect<A, E, LineWrites | import('effect').FileSystem.FileSystem>) =>
    effect.pipe(Effect.provideService(LineWrites, lineWrites), Effect.provide(files));
  const bytes = () => readFileSync(w.file, 'utf8');
  return { w, walks, record, checkout, mine, edit, remove, execute, bytes };
});
const base = `${FILE.join('\n')}\n`;
const selection = { threadId: MINE, runIds: ['selected'] };
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('an ignored file with only withdrawn run evidence still previews and repeats its inverse', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.execute(Effect.flatMap(FileSystem.FileSystem, (files) => files.writeFileString(`${s.w.root}/.gitignore`, '*.log\n')));
        yield* s.w.store.db.update(threadRecord()).set({ runningRunId: 'selected' }).where(eq(threadRecord().id, MINE));
        yield* call(s.mine.write, { path: 'trace.log', content: 'traced\n' });
        yield* s.w.store.db.update(threadRecord()).set({ runningRunId: null }).where(eq(threadRecord().id, MINE));
        const restored = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(restored.reverted.map((one) => one.path)).toEqual(['trace.log']);
        yield* s.w.store.db
          .update(workspaceChange())
          .set({ state: 'withdrawn', withdrawnAt: new Date(0), reason: 'reverted' })
          .where(eq(workspaceChange().path, 'trace.log'));
        const preview = yield* s.execute(s.record.runFiles(s.checkout, selection, { limit: 1 }));
        expect(preview.total).toBe(1);
        expect(preview.files[0]?.unavailable).toBeNull();
        expect(preview.files[0]?.overwritten).toHaveLength(1);
        expect((yield* s.execute(s.record.revertLines(s.checkout, selection))).reverted).toEqual([]);
      }),
    ),
  );
  it.effect('a run inverse preserves another session and a later run in the same real file, and retries do not undo twice', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        yield* s.edit(THEIRS, 'peer', 'const three = 3;', 'const three = 30;');
        yield* s.edit(MINE, 'later', 'const two = 2;', 'const two = 20;');
        const preview = yield* s.execute(s.record.runFiles(s.checkout, selection, { limit: 1 }));
        expect(preview.total).toBe(1);
        expect(preview.files[0]?.own).toEqual({ added: 1, removed: 1 });
        expect(preview.files[0]?.held).toEqual([{ threadId: THEIRS, agentName: null, lines: { added: 1, removed: 1 } }]);
        const attempts = yield* Effect.all(
          [s.execute(s.record.revertLines(s.checkout, selection)), s.execute(s.record.revertLines(s.checkout, selection))],
          { concurrency: 2 },
        );
        expect(attempts.reduce((count, result) => count + result.reverted.length, 0)).toBe(1);
        expect(s.bytes()).toBe(base.replace('const two = 2;', 'const two = 20;').replace('const three = 3;', 'const three = 30;'));
        expect((yield* s.execute(s.record.revertLines(s.checkout, selection))).reverted).toEqual([]);
        expect(s.bytes()).toBe(base.replace('const two = 2;', 'const two = 20;').replace('const three = 3;', 'const three = 30;'));
      }),
    ),
  );
  it.effect('an overwritten row stays with its peer while a separate provable row of that run is restored', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        yield* s.edit(THEIRS, 'peer', 'const one = 10;', 'const one = 99;');
        yield* s.edit(MINE, 'selected', 'const two = 2;', 'const two = 20;');
        const result = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(result.reverted).toHaveLength(1);
        expect(result.skipped.some((row) => row.reason === 'overwritten' && row.changes.length === 1)).toBe(true);
        expect(s.bytes()).toBe(base.replace('const one = 1;', 'const one = 99;'));
      }),
    ),
  );
  it.effect(
    'a peer writing a line back to the version the chain held returns it to its writer, and committed rows are named and never restored',
    () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const s = yield* stand(checkout);
          yield* s.edit(MINE, 'landed', 'const two = 2;', 'const two = 20;');
          expect((yield* s.w.submit(MINE)).status).toBe('landed');
          yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
          yield* s.edit(THEIRS, 'peer', 'const one = 10;', 'const one = 99;');
          yield* s.edit(THEIRS, 'peer', 'const one = 99;', 'const one = 10;');
          const result = yield* s.execute(s.record.revertLines(s.checkout, { threadId: MINE, runIds: ['selected', 'landed'] }));
          expect(result.reverted.map((row) => row.lines)).toEqual([{ added: 1, removed: 1 }]);
          expect(result.skipped.map((row) => row.reason)).toEqual(['committed']);
          expect(s.bytes()).toBe(base.replace('const two = 2;', 'const two = 20;'));
        }),
      ),
  );
  it.effect('after a landing’s versions are collected, a run’s held lines are still restored around a peer’s', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'landed', 'const two = 2;', 'const two = 20;');
        expect((yield* s.w.submit(MINE)).status).toBe('landed');
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        yield* s.edit(THEIRS, 'peer', 'const three = 3;', 'const three = 30;');
        yield* collectReleased(s.w.units, s.w.store);
        yield* sweepVersions(s.w.units, s.w.store);
        const result = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(result.reverted.map((row) => row.path)).toEqual(['src/a.ts']);
        expect(s.bytes()).toBe(base.replace('const two = 2;', 'const two = 20;').replace('const three = 3;', 'const three = 30;'));
      }),
    ),
  );
  it.effect('a landed row and a discharged row both trade their texts for the counts their rewind still reads', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'landed', 'const two = 2;', 'const two = 20;');
        expect((yield* s.w.submit(MINE)).status).toBe('landed');
        yield* s.edit(THEIRS, 'peer', 'const three = 3;', 'const three = 30;');
        yield* s.w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', 'the peer’s line by hand']);
        yield* retiredAt(s.w.store, s.w.units, s.w.git, s.w.root, TEST_CHECKOUT);
        yield* collectionSweep(s.w.units, s.w.store, s.walks)('test');
        const rows = (yield* s.w.rows()).sort((one, two) => one.holder.localeCompare(two.holder));
        expect(rows.map((row) => [row.holder, row.committedAt !== null, row.oldText, row.newText, row.added, row.removed])).toEqual([
          [THEIRS, true, null, null, 1, 1],
          [MINE, true, null, null, 1, 1],
        ]);
        for (const [threadId, run] of [
          [MINE, 'landed'],
          [THEIRS, 'peer'],
        ] as const) {
          const read = yield* s.execute(s.record.runFiles(s.checkout, { threadId, runIds: [run] }, { limit: 1 }));
          expect(read.files[0]?.committed.map((row) => row.counts)).toEqual([{ added: 1, removed: 1 }]);
        }
      }),
    ),
  );
  it.effect('a landed row keeps its hunk while a row written before it on the path still stands, and trades it once that row leaves', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const hunks = Effect.map(s.w.rows(), (rows) =>
          rows
            .sort((one, two) => one.holder.localeCompare(two.holder))
            .map((row) => [row.holder, row.committedAt !== null, row.oldText !== null, row.added]),
        );
        yield* s.edit(THEIRS, 'peer', 'const three = 3;', 'const three = 30;');
        yield* s.edit(MINE, 'landed', 'const two = 2;', 'const two = 20;');
        expect((yield* s.w.submit(MINE)).status).toBe('landed');
        yield* retiredAt(s.w.store, s.w.units, s.w.git, s.w.root, TEST_CHECKOUT);
        yield* collectionSweep(s.w.units, s.w.store, s.walks)('test');
        expect(yield* hunks).toEqual([
          [THEIRS, false, true, null],
          [MINE, true, true, null],
        ]);
        yield* s.w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', 'the peer’s line by hand']);
        yield* retiredAt(s.w.store, s.w.units, s.w.git, s.w.root, TEST_CHECKOUT);
        yield* collectionSweep(s.w.units, s.w.store, s.walks)('test');
        expect(yield* hunks).toEqual([
          [THEIRS, true, false, 1],
          [MINE, true, false, 1],
        ]);
      }),
    ),
  );
  it.effect('a fresh judgement still proves the path when a landed row behind a standing one lost the text after an external change', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        const lines = (...changed: (readonly [number, string])[]) =>
          FILE.map((line, at) => changed.find(([index]) => index === at)?.[1] ?? line);
        yield* s.w.wrote(THEIRS, lines([2, 'const three = 30;']));
        writeFileSync(s.w.file, `${lines([0, 'const one = 10;'], [2, 'const three = 30;']).join('\n')}\n`);
        yield* s.w.wrote(MINE, lines([0, 'const one = 10;'], [2, 'const three = 30;'], [4, 'const five = 50;']));
        expect((yield* s.w.submit(MINE)).status).toBe('landed');
        yield* retiredAt(s.w.store, s.w.units, s.w.git, s.w.root, TEST_CHECKOUT);
        yield* collectionSweep(s.w.units, s.w.store, s.walks)('test');
        const rig = yield* holdingsOver(s.w.store, s.w.units, s.w.git, s.w.root, s.walks);
        const verdict = (yield* rig.holdings.judged(RootId.make(TEST_CHECKOUT), ['src/a.ts'])).get('src/a.ts')?.verdict;
        expect(verdict?.verdict === 'proven' ? verdict.hands.map((hand) => [hand.holder, hand.added, hand.removed]) : verdict).toEqual([
          [THEIRS, 1, 1],
        ]);
        yield* rig.close;
      }),
    ),
  );
  it.effect('selected chained edits and a removed line restore their pre-run bytes', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        yield* s.edit(MINE, 'selected', 'const one = 10;', 'const one = 100;');
        yield* s.edit(MINE, 'selected', 'const four = 4;\n', '');
        const result = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(result.reverted[0]?.changes).toHaveLength(3);
        expect(s.bytes()).toBe(base);
      }),
    ),
  );
  it.effect('under core.autocrlf a one-line edit of a CRLF file is one line of the run, and its rewind restores the bytes', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* Effect.acquireUseRelease(
          s.w.run(['config', 'core.autocrlf', 'true']),
          () =>
            Effect.gen(function* () {
              const crlf = base.replaceAll('\n', '\r\n');
              writeFileSync(s.w.file, crlf);
              yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
              const preview = yield* s.execute(s.record.runFiles(s.checkout, selection, { limit: 1 }));
              expect(preview.files[0]?.own).toEqual({ added: 1, removed: 1 });
              yield* s.execute(s.record.revertLines(s.checkout, selection));
              expect(readFileSync(s.w.file)).toEqual(Buffer.from(crlf));
            }),
          () => Effect.asVoid(s.w.run(['config', '--unset', 'core.autocrlf'])),
        );
      }),
    ),
  );
  it.effect('a deleted file whose permissions are unrecorded is named and never recreated', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.remove;
        const preview = yield* s.execute(s.record.runFiles(s.checkout, selection, { limit: 1 }));
        expect(preview.files[0]?.notRecreated).toHaveLength(1);
        const result = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(result.reverted).toEqual([]);
        expect(result.skipped.map((row) => ({ path: row.path, reason: row.reason }))).toEqual([
          { path: 'src/a.ts', reason: 'deleted-file' },
        ]);
        expect(existsSync(s.w.file)).toBe(false);
      }),
    ),
  );
  it.effect('an edit the record store cannot take is refused before the file moves, and a revert has nothing of it to undo', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout, true);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        expect(s.bytes()).toBe(base);
        const restored = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(restored.reverted).toEqual([]);
        expect(s.bytes()).toBe(base);
      }),
    ),
  );
  it.effect('a revert records its row with the ids of the rows it undoes', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        const undone = (yield* s.w.rows()).map((row) => row.id);
        const restored = yield* s.execute(s.record.revertLines(s.checkout, selection));
        expect(restored.reverted.flatMap((one) => one.changes)).toEqual(undone);
        const rows = yield* s.w.store.db.select().from(workspaceChange()).where(isNotNull(workspaceChange().reverts));
        expect(rows.map((row) => row.reverts)).toEqual([undone]);
      }),
    ),
  );
  it.effect('final byte admission rejects a stale replacement without altering the peer’s bytes', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const s = yield* stand(checkout);
        yield* s.edit(MINE, 'selected', 'const one = 1;', 'const one = 10;');
        const earlier = s.bytes();
        yield* s.edit(THEIRS, 'peer', 'const three = 3;', 'const three = 30;');
        const peer = s.bytes();
        const stale = yield* s.execute(
          lineWrites.replace({ root: s.w.root, path: 'src/a.ts', before: earlier, after: base }, Effect.succeed(true)),
        );
        expect(stale).toBe(false);
        expect(s.bytes()).toBe(peer);
      }),
    ),
  );
});
