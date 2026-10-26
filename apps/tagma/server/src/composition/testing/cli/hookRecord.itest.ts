import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer } from 'effect';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { workspaceChange } from '../../../change-record/testing/doubles.js';
import { workspaceChangeText } from '../../../change-record/store/tables.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantFor, grantEnvironment } from '../../../platform/testing/grants.js';
import { HARNESSES } from '../../../external-harnesses/contract/service/table.js';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { contentDigest } from '@runlith/files/content';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { makeTerminalWorld } from '../fixture.js';
import { suiteGit } from '../suiteGit.js';

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const shared = yield* world.checkout();
  yield* suiteGit(shared.root, 'init', '-q', '-b', 'main');
  yield* suiteGit(shared.root, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'recording base');
  return { world, shared };
});

class Records extends Context.Service<Records, Effect.Success<typeof setup>>()('testing/HookRecords') {}

const bare = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { [GRANT_VARIABLE]: undefined };
  for (const { variable } of HARNESSES) if (variable !== undefined) env[variable] = undefined;
  return env;
};

const hook = Effect.fnUntraced(function* (
  event: 'pre-tool-use' | 'post-tool-use',
  root: string,
  payload: Record<string, unknown>,
  granted: string | null,
  server?: string,
  harness?: HarnessName,
) {
  const { world } = yield* Records;
  return yield* world.tagma(['hook', event, ...(harness === undefined ? [] : ['--harness', harness])], {
    cwd: root,
    server,
    stdin: JSON.stringify(payload),
    env: { ...bare(), ...(granted === null ? {} : grantEnvironment(granted, sessionIdentity)) },
  });
});

const vendorCut = Effect.fnUntraced(function* <A, E, R>(running: (server: string) => Effect.Effect<A, E, R>) {
  const arrived = yield* Deferred.make<void>();
  const blocked = Promise.withResolvers<Response>();
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => {
          Deferred.doneUnsafe(arrived, Exit.void);
          return blocked.promise;
        },
      }),
    ),
    (server) =>
      Effect.promise(async () => {
        blocked.resolve(new Response(null, { status: 503 }));
        await server.stop(true);
      }),
  );
  const vendor = yield* Effect.forkChild(running(`http://127.0.0.1:${server.port}`));
  yield* Deferred.await(arrived);
  yield* Fiber.interrupt(vendor);
}, Effect.scoped);

const edit = (session: string, filePath: string, oldString: string, newString: string) => ({
  tool_name: 'edit',
  tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  session_id: session,
});

const cursorWrite = (session: string, filePath: string, content: string) => ({
  tool_name: 'Write',
  tool_input: { file_path: filePath, content },
  tool_use_id: 'call-cursor-0\nfc_cursor_0',
  session_id: session,
});

const owned = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.flatMap(Records, ({ world }) => Effect.provide(work, world.runtime.owners));

const namedThread = Effect.fnUntraced(function* (id: string, projectId: number) {
  const { world } = yield* Records;
  const store = Context.get(world.runtime.graph, MachineStore);
  yield* owned(
    bornThread(store.db, {
      id,
      ownerId: 'owner',
      agentId: 'tagma',
      provider: 'openai-oauth',
      model: 'gpt-test',
      reasoning: 'high',
      authority: { mode: 'trust', bypassFrom: null },
      status: 'idle',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      spawnRootId: id,
      cacheGroup: id,
      name: id,
    }),
  );
  yield* owned(scopeRecord(store.db, id, { projectId, title: id, readerOrderAt: new Date(0) }));
  return id;
});

const rowsOf = Effect.fnUntraced(function* (projectId: number, path: string) {
  const { world } = yield* Records;
  const store = Context.get(world.runtime.graph, MachineStore);
  return yield* owned(
    store.db
      .select({ ...getTableColumns(workspaceChange()), oldText: workspaceChangeText.oldText, newText: workspaceChangeText.newText })
      .from(workspaceChange())
      .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange().id))
      .where(and(eq(workspaceChange().projectId, projectId), eq(workspaceChange().path, path))),
  );
});

const initialFile = Effect.fnUntraced(function* (file: string) {
  const { shared: project } = yield* Records;
  const files = yield* FileSystem.FileSystem;
  const owner = join(project.root, file);
  yield* files.writeFileString(owner, 'export const gamma = 1;\n');
  return { project, owner };
});

layer(Layer.effect(Records, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('hook records', (it) => {
  it.effect('a Devin edit under a grant leaves one typed row with both hunk sides on the path', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { project, owner } = yield* initialFile('granted.ts');
      const session = 'dv-record';
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b1', project.id);
      const event = edit(session, owner, 'export const gamma = 1;', 'export const gamma = 2;');

      expect((yield* hook('pre-tool-use', project.root, event, threadId)).out).toBe('');
      yield* files.writeFileString(owner, 'export const gamma = 2;\n');
      expect((yield* hook('post-tool-use', project.root, event, threadId)).code).toBe(0);
      const rows = yield* rowsOf(project.id, 'granted.ts');
      expect(rows.map((row) => [row.holder, row.origin])).toEqual([[threadId, 'write']]);
      expect(rows[0]?.oldText).toBe('export const gamma = 1;\n');
      expect(rows[0]?.newText).toBe('export const gamma = 2;\n');
    }),
  );

  it.effect('an ungranted edit records nothing and answers nothing', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { project, owner } = yield* initialFile('ungranted.ts');
      const event = edit('dv-ungranted', owner, 'export const gamma = 1;', 'export const gamma = 2;');

      expect((yield* hook('pre-tool-use', project.root, event, null)).out).toBe('');
      yield* files.writeFileString(owner, 'export const gamma = 2;\n');
      expect((yield* hook('post-tool-use', project.root, event, null)).out).toBe('');

      expect(yield* rowsOf(project.id, 'ungranted.ts')).toEqual([]);
    }),
  );

  it.effect('a file the harness created records a creation, with nothing on the old side', () =>
    Effect.gen(function* () {
      const { shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const made = join(project.root, 'fresh.ts');
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b2', project.id);
      const event = edit('dv-creation', made, '', 'export const fresh = 1;');

      expect((yield* hook('pre-tool-use', project.root, event, threadId)).out).toBe('');
      yield* files.writeFileString(made, 'export const fresh = 1;\n');
      yield* hook('post-tool-use', project.root, event, threadId);

      const rows = yield* rowsOf(project.id, 'fresh.ts');
      expect(rows.map((row) => row.holder)).toEqual([threadId]);
      expect(rows[0]?.oldText).toBe('');
      expect(rows[0]?.newText).toBe('export const fresh = 1;\n');
    }),
  );

  it.effect('a Cursor Write leaves one typed row, and the same event with no base kept leaves none', () =>
    Effect.gen(function* () {
      const { shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const at = join(project.root, 'cursor.ts');
      yield* files.writeFileString(at, 'export const cursor = 1;\n');
      const session = 'cu-record';
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b3', project.id);
      const written = 'export const cursor = 2;\n';
      const event = cursorWrite(session, at, written);

      expect((yield* hook('pre-tool-use', project.root, { ...event, hook_event_name: 'preToolUse' }, threadId)).out).toBe('');
      yield* files.writeFileString(at, written);
      yield* hook('post-tool-use', project.root, { ...event, hook_event_name: 'postToolUse' }, threadId);

      const rows = yield* rowsOf(project.id, 'cursor.ts');
      expect(rows.map((row) => [row.holder, row.origin])).toEqual([[threadId, 'write']]);
      expect(rows[0]?.oldText).toBe('export const cursor = 1;\n');
      expect(rows[0]?.newText).toBe(written);

      yield* files.writeFileString(at, 'export const cursor = 3;\n');
      yield* hook('post-tool-use', project.root, cursorWrite(session, at, 'export const cursor = 3;\n'), threadId);
      expect(yield* rowsOf(project.id, 'cursor.ts')).toHaveLength(1);
    }),
  );

  it.effect(
    'a write whose hooks the vendor cut while the server held them is recorded whole by the next hook, and never spans a peer’s edit',
    () =>
      Effect.gen(function* () {
        const { world, shared: project } = yield* Records;
        const files = yield* FileSystem.FileSystem;
        const at = join(project.root, 'exhausted.ts');
        yield* files.writeFileString(at, 'export const held = 1;\n');
        const session = 'dv-exhausted';
        const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b5', project.id);
        const first = edit(session, at, 'export const held = 1;', 'export const held = 2;');

        yield* vendorCut((server) => hook('pre-tool-use', project.root, first, threadId, server));
        yield* files.writeFileString(at, 'export const held = 2;\n');

        yield* vendorCut((server) => hook('post-tool-use', project.root, first, threadId, server));
        expect(yield* rowsOf(project.id, 'exhausted.ts')).toHaveLength(0);

        yield* hook('post-tool-use', project.root, first, threadId);
        const retried = yield* rowsOf(project.id, 'exhausted.ts');
        expect(retried.map((row) => [row.oldText, row.newText])).toEqual([['export const held = 1;\n', 'export const held = 2;\n']]);

        const second = edit(session, at, 'export const held = 2;', 'export const held = 3;');
        yield* hook('pre-tool-use', project.root, second, threadId);
        yield* files.writeFileString(at, 'export const held = 3;\n');
        yield* vendorCut((server) => hook('post-tool-use', project.root, second, threadId, server));
        yield* files.writeFileString(at, 'export const peer = 1;\n');
        const third = edit(session, at, 'export const peer = 1;', 'export const peer = 2;');
        yield* hook('pre-tool-use', project.root, third, threadId);
        yield* files.writeFileString(at, 'export const peer = 2;\n');
        yield* hook('post-tool-use', project.root, third, threadId);

        const rows = yield* rowsOf(project.id, 'exhausted.ts');
        const spans = rows.map((row) => [row.oldText, row.newText]);
        expect(spans).toContainEqual(['export const held = 1;\n', 'export const held = 2;\n']);
        expect(spans).toContainEqual(['export const held = 2;\n', 'export const held = 3;\n']);
        expect(spans).toContainEqual(['export const peer = 1;\n', 'export const peer = 2;\n']);
        expect(spans).not.toContainEqual(['export const held = 2;\n', 'export const peer = 2;\n']);
        expect(spans).toHaveLength(3);
        const pendingDir = join(yield* world.directory('tmp'), `tagma-pending-${session}`);
        const pending = (yield* files.exists(pendingDir)) ? yield* files.readDirectory(pendingDir) : [];
        expect(pending.filter((name) => name.endsWith('.json'))).toEqual([]);
      }),
  );

  it.effect('two concurrent post-tool-use events of one session record both files once', () =>
    Effect.gen(function* () {
      const { shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const first = join(project.root, 'alpha.ts');
      const second = join(project.root, 'beta.ts');
      yield* files.writeFileString(first, 'export const alpha = 1;\n');
      yield* files.writeFileString(second, 'export const beta = 1;\n');
      const session = `dv-touch-race-${crypto.randomUUID()}`;
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b7', project.id);
      const one = edit(session, first, 'export const alpha = 1;', 'export const alpha = 2;');
      const two = edit(session, second, 'export const beta = 1;', 'export const beta = 2;');

      yield* hook('pre-tool-use', project.root, one, threadId);
      yield* files.writeFileString(first, 'export const alpha = 2;\n');
      yield* hook('pre-tool-use', project.root, two, threadId);
      yield* files.writeFileString(second, 'export const beta = 2;\n');

      const [answeredOne, answeredTwo] = yield* Effect.all(
        [hook('post-tool-use', project.root, one, threadId), hook('post-tool-use', project.root, two, threadId)],
        { concurrency: 'unbounded' },
      );

      expect(answeredOne.code).toBe(0);
      expect(answeredTwo.code).toBe(0);
      expect(yield* rowsOf(project.id, 'alpha.ts')).toHaveLength(1);
      expect(yield* rowsOf(project.id, 'beta.ts')).toHaveLength(1);
    }),
  );

  it.effect("a terminal CLI's shell call writes the thread's lines between its hooks, and a write outside a call stays nobody's", () =>
    Effect.gen(function* () {
      const { world, shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const threadId = (yield* birthsOf(world.runtime.owners).create({
        projectId: project.id,
        createdBySessionId: null,
        type: 'harness:claude-code',
      })).thread.id;
      const call = {
        session_id: 'cc-shell',
        cwd: project.root,
        tool_name: 'Bash',
        tool_use_id: 'call-shell',
        tool_input: { command: 'printf one > shell.txt' },
      };

      const held = (name: string) =>
        owned(
          Effect.gen(function* () {
            const place = yield* (yield* CheckoutPaths).placeAcross(join(project.root, name));
            if (place === null) return yield* Effect.die(new Error(`${name} stands in no checkout`));
            const rows = yield* (yield* ChangeRecord).held({ kind: 'path', projectId: project.id, place });
            return rows.map((row) => [row.threadId, row.afterHash]);
          }),
        );

      yield* hook('pre-tool-use', project.root, { ...call, hook_event_name: 'PreToolUse' }, threadId, undefined, 'claude-code');
      yield* files.writeFileString(join(project.root, 'shell.txt'), 'one');
      yield* hook('post-tool-use', project.root, { ...call, hook_event_name: 'PostToolUse' }, threadId, undefined, 'claude-code');
      yield* files.writeFileString(join(project.root, 'stray.txt'), 'two');

      expect(yield* held('shell.txt')).toEqual([[threadId, contentDigest('one')]]);
      expect(yield* held('stray.txt')).toEqual([]);
    }),
  );

  it.effect('a Claude Code edit whose hook event carries the whole file still records its write', () =>
    Effect.gen(function* () {
      const { shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const at = join(project.root, 'large.ts');
      const filler = `export const filler = '${'x'.repeat(64 * 1024)}';\n`;
      yield* files.writeFileString(at, `${filler}export const large = 1;\n`);
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000ba', project.id);
      const call = {
        hook_event_name: 'PreToolUse',
        session_id: 'cc-large',
        cwd: project.root,
        tool_name: 'Edit',
        tool_use_id: 'call-large',
        tool_input: { file_path: at, old_string: 'export const large = 1;', new_string: 'export const large = 2;' },
      };

      yield* hook('pre-tool-use', project.root, call, threadId, undefined, 'claude-code');
      yield* files.writeFileString(at, `${filler}export const large = 2;\n`);
      const response = { filePath: at, originalFile: `${filler}export const large = 1;\n`, structuredPatch: [] };
      yield* hook(
        'post-tool-use',
        project.root,
        { ...call, hook_event_name: 'PostToolUse', tool_response: response },
        threadId,
        undefined,
        'claude-code',
      );

      const rows = yield* rowsOf(project.id, 'large.ts');
      expect(rows.map((row) => [row.holder, row.origin])).toEqual([[threadId, 'write']]);
      expect(rows[0]?.newText?.endsWith('export const large = 2;\n')).toBe(true);
    }),
  );

  it.effect('a file the harness removed records a deletion with no after-text', () =>
    Effect.gen(function* () {
      const { shared: project } = yield* Records;
      const files = yield* FileSystem.FileSystem;
      const at = join(project.root, 'doomed.ts');
      yield* files.writeFileString(at, 'export const doomed = 1;\n');
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b8', project.id);
      const event = edit('dv-delete', at, 'export const doomed = 1;', '');

      expect((yield* hook('pre-tool-use', project.root, event, threadId)).out).toBe('');
      yield* files.remove(at);
      yield* hook('post-tool-use', project.root, event, threadId);

      const rows = yield* rowsOf(project.id, 'doomed.ts');
      expect(rows.map((row) => row.origin)).toEqual(['delete']);
      expect(rows[0]?.oldText).toBe('export const doomed = 1;\n');
      expect(rows[0]?.newText).toBeNull();
      expect(rows[0]?.afterHash).toBeNull();
    }),
  );

  it.effect('a write retried under one key lands once', () =>
    Effect.gen(function* () {
      const { world, shared: project } = yield* Records;
      const threadId = yield* namedThread('01a07200-0000-7000-8000-0000000000b9', project.id);
      const key = crypto.randomUUID();
      for (let at = 0; at < 2; at += 1) {
        const answered = yield* Effect.promise(() =>
          fetch(`${world.url}/api/op/record_write?cwd=${encodeURIComponent(project.root)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(threadId) },
            body: JSON.stringify({ cwd: project.root, path: 'keyed.ts', before: 'a\n', after: 'b\n', key }),
          }),
        );
        expect(answered.ok).toBe(true);
      }
      const rows = yield* rowsOf(project.id, 'keyed.ts');
      expect(rows.map((row) => [row.oldText, row.newText])).toEqual([['a\n', 'b\n']]);
    }),
  );
});
