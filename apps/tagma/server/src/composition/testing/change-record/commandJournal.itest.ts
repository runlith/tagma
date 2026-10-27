import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { readFileSync, writeFileSync } from 'node:fs';
import { Clock, Deferred, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { contentDigest } from '@runlith/files/content';
import type { CommandContent } from '@runlith/agent-tools/WorkspaceChanges';
import { type Role, WRITER } from '../../../change-record/record/roles.js';
import { changeRecordOf, commandLives, commandRig, journalOf, naming } from '../../../change-record/testing/doubles.js';
import { RESTART_REASON, recoverCommands } from '../../../change-record/record/recovery.js';
import { OVERLAP_REASON } from '../../../change-record/record/commands.js';
import { WRITE_GAP_MS } from '../../../change-record/record/lives.js';
import { CommandWalks, commandWalksLayer } from './commandWorld.js';
import { gitCheckoutPaths, testPlace } from '../../../workspace/testing/doubles.js';
import { MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { sweepVersions } from '../../../change-record/record/versions.js';
import { workspaceChangeContent } from '../../../change-record/store/tables.js';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';

const TREE: Role = { kind: 'named', paths: [''], implicit: [] };

const server = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof makeCheckout>>) {
  const walks = yield* CommandWalks;
  const files = yield* FileSystem.FileSystem;
  const paths = gitCheckoutPaths('repo-root', w.projectId);
  const lives = commandLives();
  const { commands, intake } = yield* commandRig({ store: w.store, units: w.units, git: w.git, walks, lives, paths });
  const record = yield* changeRecordOf(w.store, w.units, paths, intake, commands, walks);
  const journal = yield* journalOf(w.store, w.units, walks);
  const restart = Effect.fnUntraced(function* (at?: number) {
    return yield* recoverCommands(w.store, w.units, files, journal, lives, commands, at ?? (yield* Clock.currentTimeMillis));
  });
  const opened = Effect.fnUntraced(function* () {
    const life = yield* (
      record.changes({ work: { projectId: w.projectId, threadId: MINE } }).command?.(w.root, naming(w.root)) ?? Effect.succeed(null)
    );
    if (life === null || life === undefined) return yield* Effect.die('the checkout opened no command window');
    return life;
  });
  return { commands, record, restart, opened };
});
layer(Layer.mergeAll(commandWalksLayer, BunFileSystem.layer, checkoutFixture), { excludeTestServices: true })(
  'command journal recovery',
  (it) => {
    it.effect(
      'observed command versions are deduplicated, survive collection while any window holds them, and leave with the last window',
      () =>
        withCheckout((checkout) =>
          Effect.gen(function* () {
            const w = checkout;
            const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
            const text = 'observed, not authored\n';
            const digest = contentDigest(text);
            const moved = contentDigest('bytes no longer on disk\n');
            const base = {
              head: null,
              at: yield* Clock.currentTimeMillis,
              dirty: new Map([
                ['observed.txt', { digest, present: true }],
                ['src/a.ts', { digest: moved, present: true }],
              ]),
              contents: new Map<string, CommandContent>([
                [digest, { bytes: new TextEncoder().encode(text) }],
                [moved, { file: w.file }],
              ]),
            };
            for (const id of ['one', 'two']) {
              yield* journal.opened({
                id,
                projectId: w.projectId,
                threadId: MINE,
                runHint: null,
                checkout: 'repo-root',
                spelling: w.root,
                openedAt: yield* Clock.currentTimeMillis,
                role: WRITER,
                signatures: [],
                team: null,
              });
              yield* journal.based(id, base);
            }
            const kept = () => w.store.db.select({ digest: workspaceChangeContent.digest }).from(workspaceChangeContent);
            yield* sweepVersions(w.units, w.store);
            expect(yield* kept()).toEqual([{ digest }]);
            expect(yield* w.rows()).toEqual([]);
            yield* journal.closed(['one']);
            expect(yield* kept()).toEqual([{ digest }]);
            yield* journal.closed(['two']);
            expect(yield* kept()).toEqual([]);
          }),
        ),
    );
    it.effect('a command a restart cut off leaves the dirty path it changed unattributed for its thread, not held', () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          const dirty = 'export const dirty = 1;\n';
          writeFileSync(w.file, dirty);
          const before = yield* server(w);
          const life = yield* before.opened();
          yield* life.based({
            head: null,
            at: yield* Clock.currentTimeMillis,
            dirty: new Map([['src/a.ts', { digest: contentDigest(dirty), present: true }]]),
            contents: new Map(),
          });
          life.opened();
          writeFileSync(w.file, 'export const dirty = 2;\n');
          const after = yield* server(w);
          const recovered = yield* after.restart();
          expect(recovered.restarted).toBe(1);
          expect(after.record.unattributed({ projectId: w.projectId, threadId: MINE })).toMatchObject([
            { checkout: 'repo-root', path: 'src/a.ts', reason: RESTART_REASON },
          ]);
          expect(yield* after.record.held({ kind: 'path', projectId: w.projectId, place: testPlace('src/a.ts') })).toEqual([]);
          expect(readFileSync(w.file, 'utf8')).toBe('export const dirty = 2;\n');
        }),
      ),
    );
    it.effect('a command settled before a restart and not yet written is decided again from the journal and held by its thread', () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          const base = 'export const outside = 1;\n';
          writeFileSync(w.file, base);
          const before = yield* server(w);
          const life = yield* before.opened();
          const start = yield* Clock.currentTimeMillis;
          yield* life.based({
            head: yield* w.run(['rev-parse', 'HEAD']),
            at: start,
            dirty: new Map([['src/a.ts', { digest: contentDigest(base), present: true }]]),
            contents: new Map([[contentDigest(base), { file: w.file }]]),
          });
          life.opened();
          const after = 'export const settled = 1;\n';
          writeFileSync(w.file, after);
          life.ended();
          const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
          const window = (yield* journal.windows())[0];
          expect(window).toBeDefined();
          if (window === undefined) return;
          const move = {
            name: 'src/a.ts',
            before: contentDigest(base),
            after: contentDigest(after),
            present: true,
            existed: true,
            written: { from: start + 1, to: start + 1 },
            bytes: null,
            link: false,
            mode: 0o100644,
          };
          const end = yield* Clock.currentTimeMillis;
          yield* journal.settled(window.id, { start, end }, { from: start, to: end }, [move]);
          const restarted = yield* server(w);
          const closed = yield* Deferred.make<string>();
          const deaf = restarted.commands.onClose((checkout) => Deferred.succeed(closed, checkout));
          const recovered = yield* restarted.restart();
          yield* restarted.commands.decided({ projectId: w.projectId, threadId: MINE });
          expect(recovered.replayed).toBe(1);
          const held = yield* restarted.record.held({ kind: 'path', projectId: w.projectId, place: testPlace('src/a.ts') });
          expect(held.map((row) => [row.threadId, row.beforeHash, row.afterHash])).toEqual([
            [MINE, contentDigest(base), contentDigest(after)],
          ]);
          expect(yield* Deferred.await(closed)).toBe('repo-root');
          deaf();
          expect(yield* journal.windows()).toEqual([]);
          const rig = yield* holdingsOver(w.store, w.units, w.git, w.root, yield* CommandWalks);
          const judged = yield* rig.holdings.judged(RootId.make('repo-root'), ['src/a.ts']);
          expect(judged.get('src/a.ts')?.holding.verdict).toMatchObject({
            verdict: 'proven',
            hands: [{ holder: { kind: 'thread', thread: MINE } }],
          });
        }),
      ),
    );
    it.effect(
      'a write held by nobody inside a command window stays nobody’s when the window is decided again after a restart that came later than the write gap',
      () =>
        withCheckout((checkout) =>
          Effect.gen(function* () {
            const w = checkout;
            yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
            const base = readFileSync(w.file, 'utf8');
            const before = yield* server(w);
            const life = yield* before.opened();
            const start = yield* Clock.currentTimeMillis;
            yield* life.based({ head: null, at: start, dirty: new Map(), contents: new Map() });
            life.opened();
            const after = 'export const reshaped = 1;\n';
            writeFileSync(w.file, after);
            before.commands.unowned('repo-root', 'src/a.ts', contentDigest(after), start + 1);
            life.ended();
            const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
            while ((yield* journal.unownedSince(0)).length === 0) yield* Effect.sleep(10);
            const window = (yield* journal.windows())[0];
            if (window === undefined) return yield* Effect.die('no window was journaled');
            const move = {
              name: 'src/a.ts',
              before: contentDigest(base),
              after: contentDigest(after),
              present: true,
              existed: true,
              written: { from: start + 1, to: start + 1 },
              bytes: null,
              link: false,
              mode: 0o100644,
            };
            const end = yield* Clock.currentTimeMillis;
            yield* journal.settled(window.id, { start, end }, { from: start, to: end }, [move]);
            const restarted = yield* server(w);
            yield* restarted.restart(end + WRITE_GAP_MS * 3);
            yield* restarted.commands.decided({ projectId: w.projectId, threadId: MINE });
            expect(yield* restarted.record.held({ kind: 'path', projectId: w.projectId, place: testPlace('src/a.ts') })).toEqual([]);
          }),
        ),
    );
    it.effect('a command whose measuring outlasted its process is decided after a restart by the process life, as it was before', () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          yield* w.namedAgent(THEIRS, { name: THEIRS, task: 'their lines' });
          const base = readFileSync(w.file, 'utf8');
          const after = 'export const measured = 1;\n';
          writeFileSync(w.file, after);
          const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
          const at = (yield* Clock.currentTimeMillis) - 10000;
          const window = (thread: string) => ({
            id: `window-${thread}`,
            projectId: w.projectId,
            threadId: thread,
            runHint: null,
            checkout: 'repo-root',
            spelling: w.root,
            openedAt: at,
            role: TREE,
            signatures: [],
            team: null,
          });
          const move = {
            name: 'src/a.ts',
            before: contentDigest(base),
            after: contentDigest(after),
            present: true,
            existed: true,
            written: { from: at + 550, to: at + 550 },
            bytes: null,
            link: false,
            mode: 0o100644,
          };
          yield* Effect.all([
            journal.opened(window(MINE)),
            journal.settled(`window-${MINE}`, { start: at + 500, end: at + 600 }, { from: at, to: at + 650 }, [move]),
            journal.opened(window(THEIRS)),
            journal.settled(`window-${THEIRS}`, { start: at + 610, end: at + 700 }, { from: at + 400, to: at + 700 }, []),
          ]);
          const restarted = yield* server(w);
          yield* restarted.restart();
          yield* restarted.commands.decided({ projectId: w.projectId, threadId: MINE });
          const held = yield* restarted.record.held({ kind: 'path', projectId: w.projectId, place: testPlace('src/a.ts') });
          expect(held.map((row) => row.threadId)).toEqual([MINE]);
        }),
      ),
    );
    it.effect('a command’s glob role survives a restart and names its write beside another session’s opaque writer', () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          yield* w.namedAgent(THEIRS, { name: THEIRS, task: 'their lines' });
          const base = readFileSync(w.file, 'utf8');
          const after = 'export const generated = 1;\n';
          writeFileSync(w.file, after);
          const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
          const at = (yield* Clock.currentTimeMillis) - 10000;
          const window = (thread: string, role: Role) => ({
            id: `window-${thread}`,
            projectId: w.projectId,
            threadId: thread,
            runHint: null,
            checkout: 'repo-root',
            spelling: w.root,
            openedAt: at,
            role,
            signatures: [],
            team: null,
          });
          const move = {
            name: 'src/a.ts',
            before: contentDigest(base),
            after: contentDigest(after),
            present: true,
            existed: true,
            written: { from: at + 550, to: at + 550 },
            bytes: null,
            link: false,
            mode: 0o100644,
          };
          yield* Effect.all([
            journal.opened(window(MINE, { kind: 'named', paths: [{ glob: 'src/*.ts' }], implicit: [] })),
            journal.settled(`window-${MINE}`, { start: at + 500, end: at + 600 }, { from: at + 450, to: at + 650 }, [move]),
            journal.opened(window(THEIRS, WRITER)),
            journal.settled(`window-${THEIRS}`, { start: at + 100, end: at + 5_000 }, { from: at + 50, to: at + 5_050 }, [move]),
          ]);
          const restarted = yield* server(w);
          yield* restarted.restart();
          yield* restarted.commands.decided({ projectId: w.projectId, threadId: MINE });
          const held = yield* restarted.record.held({ kind: 'path', projectId: w.projectId, place: testPlace('src/a.ts') });
          expect(held.map((row) => row.threadId)).toEqual([MINE]);
          expect(restarted.record.unattributed({ projectId: w.projectId, threadId: THEIRS })).toEqual([]);
        }),
      ),
    );
    it.effect('a command’s team survives a restart: two writers of one thread tree leave the write to that tree again', () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          yield* w.namedAgent(THEIRS, { name: THEIRS, task: 'their lines' });
          const base = readFileSync(w.file, 'utf8');
          const after = 'export const teamed = 1;\n';
          writeFileSync(w.file, after);
          const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
          const at = (yield* Clock.currentTimeMillis) - 10000;
          const window = (thread: string) => ({
            id: `window-${thread}`,
            projectId: w.projectId,
            threadId: thread,
            runHint: null,
            checkout: 'repo-root',
            spelling: w.root,
            openedAt: at,
            role: WRITER,
            signatures: [],
            team: 'tree',
          });
          const move = {
            name: 'src/a.ts',
            before: contentDigest(base),
            after: contentDigest(after),
            present: true,
            existed: true,
            written: { from: at + 550, to: at + 550 },
            bytes: null,
            link: false,
            mode: 0o100644,
          };
          yield* Effect.all([
            journal.opened(window(MINE)),
            journal.settled(`window-${MINE}`, { start: at + 500, end: at + 600 }, { from: at + 450, to: at + 650 }, [move]),
            journal.opened(window(THEIRS)),
            journal.settled(`window-${THEIRS}`, { start: at + 100, end: at + 5_000 }, { from: at + 50, to: at + 5_050 }, [move]),
          ]);
          const restarted = yield* server(w);
          yield* restarted.restart();
          yield* restarted.commands.decided({ projectId: w.projectId, threadId: THEIRS });
          expect(restarted.record.unattributed({ projectId: w.projectId, threadId: THEIRS })).toMatchObject([
            { path: 'src/a.ts', reason: 'team', team: 'tree' },
          ]);
        }),
      ),
    );
    it.effect(
      'every unattributed path of a command too large for one statement survives a restart, and an ended session’s paths retire at start',
      () =>
        withCheckout((checkout) =>
          Effect.gen(function* () {
            const w = checkout;
            yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
            const journal = yield* journalOf(w.store, w.units, yield* CommandWalks);
            const at = yield* Clock.currentTimeMillis;
            const row = (threadId: string, path: string) => ({
              projectId: w.projectId,
              threadId,
              checkout: 'repo-root',
              path,
              reason: OVERLAP_REASON,
              team: null,
              at,
            });
            const names = Array.from({ length: 5000 }, (_, at) => `gen/${at}.ts`);
            yield* journal.unattribute([...names.map((path) => row(MINE, path)), row('ended', 'gen/ended.ts')]);
            const restarted = yield* server(w);
            yield* restarted.restart();
            const retained = restarted.commands.retained({ projectId: w.projectId, threadId: MINE }, 'repo-root');
            expect(names.filter((name) => !retained.has(name))).toEqual([]);
            expect(restarted.commands.unattributed({ projectId: w.projectId, threadId: 'ended' })).toEqual([]);
          }),
        ),
    );
  },
);
