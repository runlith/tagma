// @vitest-environment jsdom

import { Layer } from '@runlith/layer/Layer';
import { Handoff } from '@runlith/layer/Handoff';
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { liveFeed, mountShell, screen, threadsRepo, type TestApp } from '$lib/app/testing.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { FolderActs } from '$lib/features/threads/FolderActs.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { recordThreadOpen, type ThreadOpenTiming } from '$lib/features/threads/threadOpenRecord.js';
import { Live } from '$lib/wire/Live.js';
import {
  markProjectSwitch,
  PROJECT_SWITCH,
  PROJECT_SWITCH_TALLY,
  ProjectSwitchWatch,
  projectSwitches,
  projectSwitchTally,
  type ProjectSwitchTiming,
} from '$lib/features/projects/switchRecord.js';

let app: TestApp;
let watch: ProjectSwitchWatch;
let release: () => void;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let time: number;
let feed: ReturnType<typeof liveFeed>;

beforeEach(async () => {
  frames = new Map();
  sequence = 0;
  time = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  performance.clearMeasures(PROJECT_SWITCH);
  performance.clearMarks(PROJECT_SWITCH_TALLY);
  feed = liveFeed();
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(Layer.of(ThreadsRepo, threadsRepo()), Layer.of(Live, feed.live), screen()),
  );
  watch = new ProjectSwitchWatch(app.app);
  release = $effect.root(() => {
    $effect(() => watch.follow());
  });
  flushSync();
  await tick();
});

afterEach(async () => {
  release();
  watch.close();
  await app.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  performance.clearMeasures(PROJECT_SWITCH);
  performance.clearMarks(PROJECT_SWITCH_TALLY);
});

function drawFrame(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const frame of due) frame(time);
}

async function place(projectId: number): Promise<void> {
  app.place({ projectId, branch: null });
  flushSync();
  await app.app.resolve(Handoff).ready(ProjectRung, { projectId });
  await tick();
}

async function list(): Promise<void> {
  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });
  flushSync();
  await tick();
}

function opened(threadId: string, replayed: boolean): ThreadOpenTiming {
  return {
    kind: 'chat',
    host: 1,
    threadId,
    entries: 7,
    replayed,
    reached: 'frame',
    selectToSubscribeMs: 1,
    subscribeWaitMs: 2,
    applyMs: 1,
    applyToFrameMs: 6,
    totalMs: 10,
  };
}

test('a cold switch waits for scope, the first list and the selected thread, then records the following frame', async () => {
  const clear = markProjectSwitch(2, 'thread');
  watch.begin({ projectId: 2, project: 'B', threadId: 'b' }, 'goto');
  clear();
  time = 110;
  watch.navigated('B');
  time = 120;
  await place(2);
  time = 130;
  await list();
  recordThreadOpen(opened('other-pane', false), 120);
  drawFrame();
  expect(projectSwitches()).toHaveLength(0);
  time = 140;
  recordThreadOpen(opened('b', false), 130);
  expect(projectSwitches()).toHaveLength(0);
  time = 150;
  drawFrame();
  const records = projectSwitches();
  expect(records).toHaveLength(1);
  expect(records[0]!.startTime).toBe(100);
  expect(records[0]!.detail).toEqual({
    projectId: 2,
    project: 'B',
    from: { navigation: 'goto', entry: 'thread' },
    warm: false,
    navigationMs: 10,
    scopeMs: 20,
    listMs: 30,
    threadMs: 40,
    thread: opened('b', false),
    frameMs: 50,
    totalMs: 50,
  } satisfies ProjectSwitchTiming);
  expect(projectSwitchTally()).toMatchObject({ measured: 1, declined: 0 });
});

test('a held scope and its existing list make a return warm without another list frame', async () => {
  const held = app.app.hold(ProjectRung, { projectId: 2 });
  await list();
  watch.begin({ projectId: 2, project: 'B', threadId: 'b' }, 'popstate');
  time = 110;
  watch.navigated('B');
  time = 120;
  await place(2);
  time = 130;
  recordThreadOpen(opened('b', true), 120);
  time = 140;
  drawFrame();
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitches()[0]!.detail).toMatchObject({
    warm: true,
    from: { navigation: 'popstate', entry: null },
    navigationMs: 10,
    scopeMs: 20,
    listMs: 20,
    thread: { threadId: 'b', replayed: true, entries: 7 },
    totalMs: 40,
  });
  held.release();
});

test('a third navigation declines the previous switch, including an already scheduled frame', async () => {
  watch.begin({ projectId: 2, project: 'B', threadId: 'b' }, 'goto');
  watch.navigated('B');
  await place(2);
  await list();
  recordThreadOpen(opened('b', false), time);
  const stale = [...frames.values()];
  time = 110;
  watch.begin({ projectId: 3, project: 'C', threadId: null }, 'link');
  for (const callback of stale) callback(time);
  expect(projectSwitches()).toHaveLength(0);
  expect(projectSwitchTally()).toMatchObject({ measured: 0, declined: 1, reasons: { superseded: 1 } });
  watch.navigated('C');
  await place(3);
  recordThreadOpen(opened('b', false), time);
  drawFrame();
  expect(projectSwitches()).toHaveLength(0);
  await list();
  time = 120;
  drawFrame();
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitches()[0]!.detail).toMatchObject({ projectId: 3, thread: null, threadMs: null });
});

test('a superseded scope completion cannot advance the next navigation', async () => {
  watch.begin({ projectId: 2, project: 'B', threadId: null }, 'goto');
  app.place({ projectId: 2, branch: null });
  flushSync();
  watch.begin({ projectId: 3, project: 'C', threadId: null }, 'goto');
  watch.navigated('B');
  await place(3);
  await list();
  drawFrame();
  expect(projectSwitches()).toHaveLength(0);
  watch.navigated('C');
  drawFrame();
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitchTally().reasons.superseded).toBe(1);
});

test.each(['chat', 'harness'] as const)('a %s deadline is measured as unfinished, not as a later superseded navigation', async (kind) => {
  watch.begin({ projectId: 2, project: 'B', threadId: 'b' }, 'goto');
  watch.navigated('B');
  await place(2);
  await list();
  time = 10_100;
  const timing: ThreadOpenTiming =
    kind === 'chat'
      ? {
          kind,
          host: 1,
          threadId: 'b',
          entries: 0,
          replayed: false,
          reached: 'subscribe',
          selectToSubscribeMs: 1,
          subscribeWaitMs: null,
          applyMs: null,
          applyToFrameMs: null,
          totalMs: 10_000,
        }
      : { kind, host: 1, threadId: 'b', recordMs: 1, engineMs: 1, attachMs: 1, replayMs: null, paintMs: null, totalMs: 10_000 };
  recordThreadOpen(timing, 100);
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitches()[0]!.detail).toMatchObject({ thread: timing, threadMs: 10_000, frameMs: null, totalMs: 10_000 });
  expect(projectSwitchTally()).toMatchObject({ measured: 1, unfinished: 1, declined: 0 });
  watch.begin({ projectId: 3, project: 'C', threadId: null }, 'goto');
  recordThreadOpen(opened('b', false), 100);
  drawFrame();
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitchTally().reasons.superseded).toBe(0);
});

test('a painted harness thread completes the project measurement without chat-only fields', async () => {
  watch.begin({ projectId: 2, project: 'B', threadId: 'b' }, 'goto');
  watch.navigated('B');
  await place(2);
  await list();
  const timing: ThreadOpenTiming = {
    kind: 'harness',
    host: 2,
    threadId: 'b',
    recordMs: 1,
    engineMs: 1,
    attachMs: 1,
    replayMs: 1,
    paintMs: 1,
    totalMs: 5,
  };
  time = 110;
  recordThreadOpen(timing, 105);
  time = 120;
  drawFrame();
  expect(projectSwitches()).toHaveLength(1);
  expect(projectSwitches()[0]!.detail).toMatchObject({ thread: timing, threadMs: 10, frameMs: 20 });
  expect(projectSwitchTally().unfinished).toBe(0);
});

test('consuming one project entry leaves another pending navigation attributed to its own entry', async () => {
  const clearB = markProjectSwitch(2, 'keys');
  const clearC = markProjectSwitch(3, 'palette');
  watch.begin({ projectId: 2, project: 'B', threadId: null }, 'goto');
  watch.navigated('B');
  await place(2);
  await list();
  drawFrame();
  watch.begin({ projectId: 3, project: 'C', threadId: null }, 'goto');
  watch.navigated('C');
  await place(3);
  await list();
  drawFrame();
  clearB();
  clearC();
  expect(projectSwitches().map((record) => record.detail.from.entry)).toEqual(['keys', 'palette']);
});

test('closing the watcher declines its scheduled frame even if the callback was already dequeued', async () => {
  watch.begin({ projectId: 2, project: 'B', threadId: null }, 'goto');
  watch.navigated('B');
  await place(2);
  await list();
  const due = [...frames.values()];
  watch.close();
  for (const callback of due) callback(time);
  expect(projectSwitches()).toHaveLength(0);
  expect(projectSwitchTally()).toMatchObject({ measured: 0, declined: 1, reasons: { closed: 1 } });
});
