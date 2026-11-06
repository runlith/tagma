import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { callerInThread } from '../callers.js';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { Retirement } from '../../../change-record/contract/service/retirement.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { call } from '../checkoutFixture.js';
import { git } from '../threadDoors.js';
import { nativeLanding } from './native.js';

const HOST = 'export interface Host {\n  firstEnded(): void;\n}\n';
const SUCCESSION = 'export interface Succession {\n  ready: boolean;\n}\n';
const SERVER = [
  'import type { Host } from "./host.js";',
  'import type { Succession } from "./succession.js";',
  'import type { ScrollBehavior, VirtualItem } from "@tanstack/virtual-core";',
  'export const phase = (value: number) => value;',
  'export const read = (host: any, refused: any) => {',
  '  host.firstEnded();',
  '  return refused.detail;',
  '};',
  '',
].join('\n');
const BOUND =
  '\nexport const doorBound = phase(1);\nexport const scroll = (item: VirtualItem, behavior: ScrollBehavior) => `${item.key}:${behavior}`;\n';
const INSTALLED = 'node_modules/.bun/@tanstack+virtual-core@3.19.8/node_modules/@tanstack/virtual-core';
const DECLARATIONS = 'export type ScrollBehavior = "auto" | "smooth";\nexport interface VirtualItem {\n  key: string | number;\n}\n';
const PATCH = 'patches/@tanstack%2Fvirtual-core@3.19.8.patch';
const PATCH_TEXT =
  'diff --git a/dist/esm/index.d.ts b/dist/esm/index.d.ts\n--- a/dist/esm/index.d.ts\n+++ b/dist/esm/index.d.ts\n@@ -1,1 +1,2 @@\n export type ScrollBehavior = "auto" | "smooth";\n+export declare const isScrollWriteBlocked: boolean;\n';
const MEMBERS = 'export interface Input { readonly value: number }\nexport class Batch {}\nexport const resumed = 1;\n';
const LOCAL = 'import { resumed, type Input } from "./declarations.js";\n\nexport const marker = 0;\n';

const callAs = Effect.fnUntraced(function* (tool: Tool, thread: string, input: unknown) {
  const invocation = { toolCallId: crypto.randomUUID(), caller: callerInThread(thread, 'run'), messages: [] };
  const prepared = yield* toolPrepare(tool)!(input, invocation);
  const answer = yield* toolExecute(tool)!(input, { ...invocation, prepared: prepared.prepared });
  tool.settled?.(invocation);
  return answer instanceof ToolAnswer ? answer.value : answer;
});

it.live(
  'native landing carries dependency patches, excludes ignored declarations, and carries the peer file a selected reference needs',
  () =>
    Effect.gen(function* () {
      const { born, doors, write, read, files, root, world, projectId } = yield* nativeLanding(
        {
          '.gitignore': 'node_modules/\n',
          'declarations.ts': MEMBERS,
          'local.ts': LOCAL,
          'host.ts': HOST,
          'succession.ts': SUCCESSION,
          'server.ts': SERVER,
        },
        { tools: ['submit_work'] },
      );
      yield* files.makeDirectory(join(root, INSTALLED, 'dist/esm'), { recursive: true });
      yield* files.writeFileString(
        join(root, INSTALLED, 'package.json'),
        JSON.stringify({ name: '@tanstack/virtual-core', types: 'dist/esm/index.d.ts' }),
      );
      yield* files.writeFileString(join(root, INSTALLED, 'dist/esm/index.d.ts'), DECLARATIONS);
      yield* files.makeDirectory(join(root, 'node_modules/@tanstack'), { recursive: true });
      yield* files.symlink(join(root, INSTALLED), join(root, 'node_modules/@tanstack/virtual-core'));
      const peer = yield* born();
      const caller = yield* born();
      yield* write(
        peer.threadId,
        `${INSTALLED}/dist/esm/index.d.ts`,
        `${DECLARATIONS}export declare const isScrollWriteBlocked: boolean;\n`,
      );
      yield* write(caller.threadId, PATCH, PATCH_TEXT);
      yield* write(peer.threadId, 'host.ts', HOST.replace('firstEnded', 'hostEnded'));
      yield* write(peer.threadId, 'succession.ts', SUCCESSION.replace('  ready', '  detail: string;\n  refused: boolean;\n  ready'));
      yield* write(caller.threadId, 'server.ts', SERVER + BOUND);

      expect(
        yield* doors.atNative('submit_work', { subject: 'bind an independent door', paths: ['server.ts', PATCH] }, caller),
      ).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: [PATCH, 'server.ts'], carried: [] } },
      });
      expect(yield* read(PATCH)).toBe(PATCH_TEXT);
      expect(yield* read('server.ts')).toBe(SERVER + BOUND);
      expect(yield* read('host.ts')).toBe(HOST);
      expect(yield* read('succession.ts')).toBe(SUCCESSION);

      const used = SERVER + BOUND + 'export const use = (host: import("./host.js").Host) => host.hostEnded();\n';
      yield* write(caller.threadId, 'server.ts', used);
      expect(yield* doors.atNative('submit_work', { subject: 'use a peer member', paths: ['server.ts'] }, caller)).toMatchObject({
        class: 'answer',
        value: {
          submitted: {
            status: 'landed',
            committed: ['host.ts', 'server.ts'],
            carried: [{ path: 'host.ts', holders: [peer.threadId] }],
          },
        },
      });
      expect(yield* read('server.ts')).toBe(used);

      const record = Context.get(world.runtime.owners, ChangeRecord);
      const tools = createTools({
        cwd: root,
        world: makeMachineWorld(() => null),
        commandTimes: unruledTimes,
        searchMs: LONGEST_ACT_MS,
        unowned: ['.tagma'],
        changesOf: (actor) => record.changes({ work: { projectId, threadId: actor.thread!.threadId } }),
      });
      const members = MEMBERS.replace(
        'readonly value',
        'readonly scope: string; readonly address: string; readonly host: string; readonly value',
      ).replace('class Batch {}', 'class Batch { private map = new Map(); }');
      yield* callAs(tools.edit, peer.threadId, { path: join(root, 'declarations.ts'), oldString: MEMBERS, newString: members });
      const localUse =
        'export function read(thunks: readonly (() => unknown)[]) {\n  const scope = { address: 1 };\n  const host = { connection: scope };\n  const address = host.connection.address;\n  return [resumed, scope, host, address, thunks.map((thunk) => thunk())];\n}\n';
      yield* callAs(tools.edit, caller.threadId, { path: join(root, 'local.ts'), oldString: LOCAL, newString: LOCAL + localUse });
      expect(
        yield* doors.atNative('submit_work', { subject: 'land independently bound local names', paths: ['local.ts'] }, caller),
      ).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['local.ts'], carried: [] } },
      });
      expect(yield* read('local.ts')).toBe(LOCAL + localUse);
      expect(yield* read('declarations.ts')).toBe(MEMBERS);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work preserves a replacement after write-from-file restores its HEAD and owned versions', () =>
  Effect.gen(function* () {
    const path = 'TranscriptViewport.svelte.ts';
    const oldMethod = `  currentMessageId(activeId: string | undefined): string | undefined {\n    return resolveCurrentMessageId({\n      activeId,\n      cursorId: this.cursorId,\n      following: this.following,\n      pinnedId: this.pinnedId,\n    });\n  }`;
    const newMethod = `  get currentMessageId(): string | undefined {\n    return this.pinnedId ?? this.cursorId;\n  }\n\n  syncClearance(clearance: number): void {\n    if (clearance === this.clearance) return;\n    this.clearance = clearance;\n    const root = this.viewport;\n    if (root) this.followingViewport.scheduleState(root);\n  }`;
    const imports =
      "import { transcriptCursorMessageId } from './transcriptCursor';\nimport { TRANSCRIPT_END_THRESHOLD_PX, TranscriptVirtualizer } from './TranscriptVirtualizer.svelte';\nimport { messageOffsetTarget, resolveCurrentMessageId } from './transcriptMessageNavigation';\n\nconst CURSOR_LINE_OFFSET_PX = 100;\n";
    const navigate =
      '  navigate(offset: number, ids: readonly string[], activeId: string | undefined): void {\n    const target = messageOffsetTarget({ currentId: this.currentMessageId(activeId), ids, offset });';
    const cursor =
      '  private readCursor(root: HTMLElement): string | undefined {\n    const row = this.window.rowAt(root.scrollTop + CURSOR_LINE_OFFSET_PX);\n    if (row === undefined) return undefined;\n    return transcriptCursorMessageId({ messages: this.messages(), rowOf: (id) => this.window.rowOf(id), row });\n  }\n';
    const base = `${imports}\nexport class TranscriptViewport {\n  private gestureAt = Number.NEGATIVE_INFINITY;\n  private inputAt = Number.NEGATIVE_INFINITY;\n${navigate}\n  }\n\n${oldMethod}\n\n${cursor}}\n`;
    const replacements = [
      [
        imports,
        imports
          .replace('transcriptCursorMessageId }', 'readingLine, transcriptCursorMessageId }')
          .replace(', resolveCurrentMessageId', '')
          .replace('const CURSOR_LINE_OFFSET_PX = 100;\n', ''),
      ],
      ['  private gestureAt', '  private clearance = 0;\n  private gestureAt'],
      [
        navigate,
        navigate.replace(', activeId: string | undefined', '').replace('this.currentMessageId(activeId)', 'this.currentMessageId'),
      ],
      [oldMethod, newMethod],
      [
        '    const row = this.window.rowAt(root.scrollTop + CURSOR_LINE_OFFSET_PX);',
        '    const line = readingLine({\n      scrollTop: root.scrollTop,\n      scrollHeight: root.scrollHeight,\n      clientHeight: root.clientHeight,\n      clearance: this.clearance,\n    });\n    const row = this.window.rowAt(line);',
      ],
    ] as const;
    const owned = replacements.reduce((text, [before, after]) => text.replace(before, after), base);
    const { born, doors, read, files, root, world, projectId } = yield* nativeLanding({ [path]: base });
    const writer = yield* born();
    const versions = join(root, 'versions');
    yield* files.makeDirectory(versions);
    const before = join(versions, 'before.ts');
    const after = join(versions, 'after.ts');
    yield* files.writeFileString(before, base);
    yield* files.writeFileString(after, owned);
    const tools = createTools({
      cwd: root,
      world: makeMachineWorld(() => null),
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      unowned: ['.tagma'],
      changes: Context.get(world.runtime.owners, ChangeRecord).changes({ work: { projectId, threadId: writer.threadId } }),
    });
    for (const [oldString, newString] of replacements) yield* call(tools.edit, { path: join(root, path), oldString, newString });
    yield* call(tools.write, { path: join(root, path), fromFile: before });
    expect(yield* files.readFileString(join(root, path))).toBe(base);
    yield* call(tools.write, { path: join(root, path), fromFile: after });
    expect(yield* files.readFileString(join(root, path))).toBe(owned);
    const place = yield* Context.get(world.runtime.workspace, CheckoutPaths).placeOf(projectId, join(root, path));
    if (place === null) return yield* Effect.die('the restored file has no checkout');
    yield* git(root, 'commit', '--allow-empty', '-qm', 'peer advances HEAD');
    yield* Context.get(world.runtime.owners, Retirement).pass(RootId.make(place.checkout));
    expect(yield* doors.atNative('submit_work', { subject: 'land the restored owned replacement' }, writer)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: [path] } },
    });
    expect(yield* read(path)).toBe(owned);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a parent’s bare submit_work lands a file its rested child’s command formatted, as the formatter left it', () =>
  Effect.gen(function* () {
    const path = 'src/middleware/timeout/index.test.ts';
    const base = 'export const marker = 0;\n';
    const raw = `${base}\n  it('keeps a timeout response after a late downstream rejection', async () => {\n    const errorHandler = vi.fn((error: Error) =>\n      error instanceof HTTPException ? error.getResponse() : new Response('late error', { status: 500 })\n    )\n  })\n`;
    const formed = raw.replace(
      "      error instanceof HTTPException ? error.getResponse() : new Response('late error', { status: 500 })",
      "      error instanceof HTTPException\n        ? error.getResponse()\n        : new Response('late error', { status: 500 })",
    );
    const { born, doors, write, read, files, root, world, projectId } = yield* nativeLanding({ [path]: base });
    const caller = yield* born();
    const writer = yield* born(caller.threadId);
    const bin = join(root, 'node_modules/.bin');
    yield* files.makeDirectory(bin, { recursive: true });
    yield* files.writeFileString(join(bin, 'vp'), '#!/bin/sh\nif [ "$1" = fmt ]; then cp "$2.formed" "$2"; fi\n');
    yield* files.chmod(join(bin, 'vp'), 0o755);
    yield* files.writeFileString(join(root, `${path}.formed`), formed);
    yield* write(writer.threadId, path, raw);
    const tools = createTools({
      cwd: root,
      world: makeMachineWorld(() => null),
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      unowned: ['.tagma'],
      changes: Context.get(world.runtime.owners, ChangeRecord).changes({ work: { projectId, threadId: writer.threadId } }),
    });
    yield* call(tools.bash, { command: `./node_modules/.bin/vp fmt ${path} && ./node_modules/.bin/vp test --run ${path}` });
    expect(
      yield* world.op('stop_agent', { threadId: writer.threadId }, `project=${projectId}`, { [GRANT_HEADER]: caller.grant }),
    ).toMatchObject({ status: 200 });
    const statusOf = Effect.map(
      world.op('list_threads', { limit: 10 }, `project=${projectId}`),
      (listed) => (listed.body as { threads: { id: string; status: string }[] }).threads.find((one) => one.id === writer.threadId)?.status,
    );
    while ((yield* statusOf) === 'running') yield* Effect.sleep('20 millis');
    const landed = yield* doors.atNative('submit_work', { subject: 'land the formatted test' }, caller);
    expect(landed).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: [path], carried: [] } },
    });
    expect(yield* read(path)).toBe(formed);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

const BATCH = 'export interface Batch {\n  flush(): void;\n}\n';
const LIST = 'import type { Batch } from "./batch.js";\nexport const drain = (batch: Batch) => batch.flush();\n';
const ASK = 'export const choose = () => 1;\n';
const HOLDER = 'export interface Holder {\n  projectId: number;\n}\n';
const SERVICE = 'import type { Holder } from "./holder.js";\nexport const holder = (): Holder => ({ projectId: 1 });\n';
const CONSUMER =
  'import { choose } from "./ask.js";\nimport { holder } from "./service.js";\nexport const base = () => choose() + holder().projectId;\n';
const ROWS = 'export interface NativeRows {\n  size: number;\n}\n';
const WORLD = 'export interface WorldRequest {\n  thread: string;\n  at: number;\n  root: string;\n}\n';
const OF =
  'import type { WorldRequest } from "./world.js";\nexport const request = (): WorldRequest => ({ thread: "t", at: 1, root: "/" });\n';
const CONTEXT =
  'import type { NativeRows } from "./rows.js";\nimport { request } from "./of.js";\nexport const read = (rows: NativeRows) => rows.size + request().root.length;\n';

it.live(
  'native landing places member spellings on library and indirectly imported types, and carries the peer files a member read needs',
  () =>
    Effect.gen(function* () {
      const { born, doors, write, read } = yield* nativeLanding({
        'batch.ts': BATCH,
        'list.ts': LIST,
        'ask.ts': ASK,
        'holder.ts': HOLDER,
        'service.ts': SERVICE,
        'consumer.ts': CONSUMER,
        'rows.ts': ROWS,
        'world.ts': WORLD,
        'of.ts': OF,
        'context.ts': CONTEXT,
      });
      const peer = yield* born();
      const caller = yield* born();
      yield* write(peer.threadId, 'batch.ts', BATCH.replace('  flush(): void;', '  flush(): void;\n  map: Map<string, unknown> | null;'));
      yield* write(peer.threadId, 'ask.ts', ASK + 'export interface RoadAsk {\n  projectId: number;\n}\n');
      yield* write(peer.threadId, 'rows.ts', ROWS + 'export interface ForkOrigin {\n  thread: string;\n  at: number;\n}\n');

      const list = LIST + 'export const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key);\n';
      yield* write(caller.threadId, 'list.ts', list);
      expect(yield* doors.atNative('submit_work', { subject: 'map over a local array', paths: ['list.ts'] }, caller)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['list.ts'] } },
      });
      expect(yield* read('list.ts')).toBe(list);
      expect(yield* read('batch.ts')).toBe(BATCH);

      const consumer = CONSUMER + 'export const again = () => holder().projectId * 2;\n';
      yield* write(caller.threadId, 'consumer.ts', consumer);
      expect(
        yield* doors.atNative('submit_work', { subject: 'read a project id off a holder', paths: ['consumer.ts'] }, caller),
      ).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['consumer.ts'] } },
      });
      expect(yield* read('consumer.ts')).toBe(consumer);
      expect(yield* read('ask.ts')).toBe(ASK);

      const context = CONTEXT + 'export const origin = () => {\n  const { thread, at } = request();\n  return thread + at;\n};\n';
      yield* write(caller.threadId, 'context.ts', context);
      expect(yield* doors.atNative('submit_work', { subject: 'destructure a world request', paths: ['context.ts'] }, caller)).toMatchObject(
        {
          class: 'answer',
          value: { submitted: { status: 'landed', committed: ['context.ts'] } },
        },
      );
      expect(yield* read('context.ts')).toBe(context);
      expect(yield* read('rows.ts')).toBe(ROWS);

      yield* write(caller.threadId, 'list.ts', list + 'export const peek = (batch: Batch) => batch.map;\n');
      expect(yield* doors.atNative('submit_work', { subject: 'read a peer member', paths: ['list.ts'] }, caller)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['batch.ts', 'list.ts'] } },
      });
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
