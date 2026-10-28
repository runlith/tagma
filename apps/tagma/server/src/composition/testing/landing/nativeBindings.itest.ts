import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect, Stream } from 'effect';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { Usage } from '@runlith/llm/schema/events';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { Retirement } from '../../../change-record/contract/service/retirement.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { call } from '../checkoutFixture.js';
import { git } from '../threadDoors.js';
import { nativeLanding } from './native.js';

const HOST = 'export interface Host {\n  firstEnded(): void;\n}\n';
const SUCCESSION = 'export interface Succession {\n  ready: boolean;\n}\n';
const SERVER = [
  'import type { Host } from "./host.js";',
  'import type { Succession } from "./succession.js";',
  'export const phase = (value: number) => value;',
  'export const read = (host: any, refused: any) => {',
  '  host.firstEnded();',
  '  return refused.detail;',
  '};',
  '',
].join('\n');
const BOUND = '\nexport const doorBound = phase(1);\n';
const EXISTING = 'export type Existing = string;\nexport type Other = number;\n';
const IMPORTER =
  'import type {\n  Existing as Imported\n} from "./clean.js";\nimport type * as API\n  from "./clean.js";\nexport type Shape = Imported | API.Other;\n';
const PEER = 'export const marker = 0;\n';

it.live('native change checks and landing judge selected references while HEAD and peer member names remain outside the slice', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      { 'host.ts': HOST, 'succession.ts': SUCCESSION, 'server.ts': SERVER, 'clean.ts': EXISTING, 'peer.ts': PEER, 'importer.ts': IMPORTER },
      { tools: ['check_rules', 'submit_work'] },
    );
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'host.ts', HOST.replace('firstEnded', 'hostEnded'));
    yield* write(peer.threadId, 'succession.ts', SUCCESSION.replace('  ready', '  detail: string;\n  refused: boolean;\n  ready'));
    const foreign = SERVER.replace('firstEnded', 'hostEnded');
    yield* write(peer.threadId, 'server.ts', foreign);
    yield* write(caller.threadId, 'server.ts', foreign + BOUND);

    expect(yield* doors.atNative('check_rules', { over: 'change' }, caller)).toMatchObject({
      class: 'answer',
      value: { refuses: false },
    });
    expect(yield* doors.atNative('submit_work', { subject: 'bind an independent door' }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['server.ts'], carried: [] } },
    });
    expect(yield* read('server.ts')).toBe(SERVER + BOUND);
    expect(yield* read('host.ts')).toBe(HOST);
    expect(yield* read('succession.ts')).toBe(SUCCESSION);
    expect(yield* files.readFileString(join(root, 'server.ts'))).toBe(foreign + BOUND);

    yield* write(caller.threadId, 'server.ts', foreign + BOUND + 'export const use = (host: any) => host.hostEnded();\n');
    yield* write(peer.threadId, 'peer.ts', PEER + EXISTING);
    const shared = IMPORTER + 'export const peerMarker = 1;\n';
    yield* write(peer.threadId, 'importer.ts', shared);
    yield* write(caller.threadId, 'importer.ts', shared.replaceAll('./clean.js', './peer.js'));
    for (const id of ['check_rules', 'submit_work']) {
      const refused = yield* doors.atNative(id, id === 'check_rules' ? { over: 'change' } : { subject: 'use a peer member' }, caller);
      expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
      if (refused.class === 'refusal') {
        expect(refused.reason).toContain(`hostEnded in host.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Existing in peer.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Other in peer.ts:3, held by ${peer.threadId}`);
      }
    }
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

it.live('native submit_work keeps command formatting attributed and refuses a required nobody replacement before slicing it', () =>
  Effect.gen(function* () {
    const path = 'src/middleware/timeout/index.test.ts';
    const outside = 'src/middleware/timeout/outside.test.ts';
    const stale = 'src/middleware/timeout/stale.test.ts';
    const deleted = 'src/middleware/timeout/deleted.test.ts';
    const base = 'export const marker = 0;\n';
    const raw = `${base}\n  it('keeps a timeout response after a late downstream rejection', async () => {\n    const errorHandler = vi.fn((error: Error) =>\n      error instanceof HTTPException ? error.getResponse() : new Response('late error', { status: 500 })\n    )\n  })\n`;
    const formed = raw.replace(
      "      error instanceof HTTPException ? error.getResponse() : new Response('late error', { status: 500 })",
      "      error instanceof HTTPException\n        ? error.getResponse()\n        : new Response('late error', { status: 500 })",
    );
    const { born, doors, write, read, files, root, world, projectId } = yield* nativeLanding(
      { [path]: base, [outside]: base, [stale]: base, [deleted]: base },
      {
        models: (standing) => ({
          ...standing,
          request: () => ({
            plannedOutputTokens: 1,
            text: () => Effect.die('the landing fixture streams only'),
            object: () => Effect.die('the landing fixture streams only'),
            stream: () =>
              Stream.fromIterable([
                { type: 'text-start', id: 'done' },
                { type: 'text-delta', id: 'done', text: 'done' },
                { type: 'text-end', id: 'done' },
                {
                  type: 'finish',
                  reason: 'stop',
                  usage: new Usage({
                    inputTokens: 0,
                    nonCachedInputTokens: 0,
                    cacheReadInputTokens: 0,
                    cacheWriteInputTokens: 0,
                    outputTokens: 1,
                    reasoningTokens: 0,
                    totalTokens: 1,
                  }),
                },
              ]),
          }),
        }),
      },
    );
    const caller = yield* born();
    const writer = yield* born(caller.threadId);
    const bin = join(root, 'node_modules/.bin');
    yield* files.makeDirectory(bin, { recursive: true });
    yield* files.writeFileString(
      join(bin, 'vp'),
      '#!/bin/sh\nif [ "$1" = fmt ]; then cp "$2.formed" "$2"; elif [ "$1" = delete ]; then rm "$2"; fi\n',
    );
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
    expect(yield* doors.atNative('submit_work', { subject: 'land the formatted test', taking: [writer.threadId] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: [path] } },
    });
    expect(yield* read(path)).toBe(formed);

    yield* call(tools.bash, { command: `./node_modules/.bin/vp delete ${deleted}` });
    yield* files.writeFileString(join(root, deleted), '');
    expect(
      yield* doors.atNative('submit_work', { subject: 'leave the recreated empty file', taking: [writer.threadId] }, caller),
    ).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'nothing' } },
    });
    expect(yield* read(deleted)).toBe(base);

    yield* files.writeFileString(join(root, `${stale}.formed`), formed);
    yield* write(writer.threadId, stale, raw);
    yield* call(tools.bash, { command: `./node_modules/.bin/vp fmt ${stale}` });
    const later = formed.replace('status: 500', 'status: 501');
    yield* files.writeFileString(join(root, stale), later);
    expect(
      yield* doors.atNative('submit_work', { subject: 'leave the later outside edit', taking: [writer.threadId], paths: [stale] }, caller),
    ).toMatchObject({ class: 'refusal', code: 'lines-held', reason: expect.stringContaining('nobody') });
    expect(yield* read(stale)).toBe(base);
    expect(yield* files.readFileString(join(root, stale))).toBe(later);

    yield* write(caller.threadId, outside, raw);
    yield* files.writeFileString(join(root, outside), formed);
    const refused = yield* doors.atNative('submit_work', { subject: 'land beside an outside formatter' }, caller);
    expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
    if (refused.class === 'refusal') {
      expect(refused.reason).toContain(outside);
      expect(refused.reason).toContain('nobody');
      expect(refused.unblock).toContain(`carry ${outside} as it stands (whole: ${JSON.stringify([outside])})`);
    }
    expect(yield* read(outside)).toBe(base);
    expect(yield* doors.atNative('submit_work', { subject: 'carry the outside formatting', whole: [outside] }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: [outside] } },
    });
    expect(yield* read(outside)).toBe(formed);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
