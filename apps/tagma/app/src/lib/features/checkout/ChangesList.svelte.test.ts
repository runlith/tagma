// @vitest-environment jsdom
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import type { TurnPath } from '@tagma/server/change-record/contract/wire/changes';
import type { CommitReading } from '@tagma/server/workspace/contract/wire/history';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type {
  ChangeCommit,
  ThreadChangesFrame,
  ThreadCheckout,
  ThreadEntry,
} from '@tagma/server/change-record/contract/wire/threadChanges';
import { Layer } from '@runlith/layer/Layer';
import { stubAll, stubSingle } from '@runlith/query/testing';
import { waitUntil } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { liveFeed, mountShell, screen, type TestApp, testPlaces } from '$lib/app/testing.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { type CommitKey, CheckoutRepo } from './Repo.js';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';
import { ThreadHistory } from './ThreadHistory.svelte.js';
import ChangesList from './ChangesList.svelte';
import { Host } from '@runlith/layer/Host';
import { DECLARED_LINKS } from '$lib/app/opening/declaredLinks.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { besideOf } from '$lib/app/opening/beside.js';
import { Beside } from '$lib/features/opening/Beside.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import { CHANGES_PANE } from './paneContent.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import Changes from './Changes.svelte';
import { testDoor } from '$lib/wire/testing.js';
import { Documents } from './files/Documents.svelte.js';
import { Outside } from './files/Outside.svelte.js';
import { Tabs } from './files/Tabs.svelte.js';

const MAIN = 'root-1' as RootId;
const WORKTREE = 'root-2' as RootId;

const held = (path: string): ThreadEntry => ({
  section: 'uncommitted',
  path,
  from: null,
  git: 'modified',
  lines: { added: 1, removed: 0 },
  writing: false,
  others: [],
  nobody: false,
});

const unproven = (path: string): ThreadEntry => ({
  section: 'unproven',
  path,
  from: null,
  git: 'modified',
  reason: { kind: 'worker', cause: 'unpack worker missing' },
  writers: [{ kind: 'thread', thread: 'thread-1' }],
});

const checkout = (entries: readonly ThreadEntry[], over: Partial<ThreadCheckout> = {}): ThreadCheckout => ({
  checkout: MAIN,
  projectId: 1,
  root: '/repo',
  branch: 'main',
  revision: 1,
  state: { kind: 'current' },
  uncommitted: { added: 0, removed: 0 },
  entries,
  ...over,
});

const COMMIT: ChangeCommit = {
  checkout: MAIN,
  projectId: 1,
  sha: 'a'.repeat(40),
  subject: 'Delegation switch: kernel gate',
  author: 'architect',
  date: '2026-09-23T10:00:00Z',
  files: 1,
};

const whole = (checkouts: readonly ThreadCheckout[], commits: readonly ChangeCommit[] = []): ThreadChangesFrame => ({
  kind: 'whole',
  threadId: 'thread-1',
  held: { paths: 0, unproven: 0 },
  uncommitted: { added: 0, removed: 0 },
  checkouts,
  commits,
  moreCommits: false,
  ends: [],
});

const reading: CommitReading = {
  rootId: MAIN,
  sha: COMMIT.sha,
  parents: [],
  author: 'architect',
  date: COMMIT.date,
  subject: COMMIT.subject,
  files: [{ path: 'src/gate.ts', status: 'added', lines: { added: 40, removed: 0 } }],
  marks: 'unrequested',
  added: 40,
  removed: 0,
  changed: 3,
  shown: 1,
  total: 1,
  next: null,
  complete: true,
} as CommitReading;

let feed = liveFeed();
let asked: CommitKey[] = [];
let app: TestApp | undefined;
let history: TurnPath[] = [];
let historyReads = 0;
let browsed: string[] = [];

beforeEach(() => {
  feed = liveFeed();
  browsed = [];
  asked = [];
  history = [];
  historyReads = 0;
});

async function until(holds: () => boolean): Promise<void> {
  await waitUntil(() => {
    flushSync();
    return holds();
  });
}

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
});

let area = testArea([testKind(CHANGES_PANE)]);

function draw(view: unknown = ChangesList): HTMLElement {
  area = testArea([testKind(CHANGES_PANE)]);
  const { panes } = area;
  const seats = new ThreadSeats(panes);
  const opening = new Opening(
    DECLARED_LINKS,
    {} as never,
    {} as never,
    { refusal: () => undefined } as never,
    new Host('desktop', 'macos'),
  );
  app = mountShell(
    Layer.mergeAll(
      screen(),
      Layer.of(Opening, opening),
      Layer.of(SidePanes, panes),
      Layer.of(ThreadSeats, seats),
      Layer.of(Beside, besideOf(panes, seats)),
      ThreadChanges,
      ThreadHistory,
      Layer.of(ProjectDoor, {
        perform: async () => {
          historyReads += 1;
          return { status: 'ok', turns: history, total: history.length, next: null };
        },
      } as never),
      Layer.of(
        FileOpener,
        new FileOpener(
          Object.assign(testDoor(), {
            perform: async (_id: string, input: { path: string }) => ({
              entry: {
                kind: 'file',
                path: input.path,
                bytes: 1,
                mediaType: input.path.endsWith('.pdf') ? 'application/pdf' : 'text/markdown',
              },
              place: null,
            }),
          }) as never,
          () => ({ projectId: 1, branch: null }),
          {} as never,
          {} as never,
          {} as never,
          { refusal: () => undefined } as never,
          { open: (url) => void browsed.push(url) },
          besideOf(panes, seats),
        ),
      ),
      Layer.of(Tabs, { projectId: 1 } as never),
      Layer.of(Outside, {
        chosen: null,
        editors: [],
        local: false,
        hold: () => ({ front: () => undefined, release: () => undefined }),
      } as never),
      Layer.of(Documents, {
        hold: () => ({ document: { body: { kind: 'loading' }, revision: 0, leave: async () => undefined }, release: () => undefined }),
      } as never),
      ReaderMarks,
      Seams,
      Keymap,
      Notices,
      ThreadNames,
      Layer.of(Worktrees, testPlaces() as never),
      Layer.of(Workspace, { find: (id: number) => ({ name: id === 1 ? 'runlith' : 'billing' }) } as never),
      Layer.of(CheckoutRepo, {
        commitReading: {
          name: 'commitReading',
          key: (key: CommitKey) => {
            asked.push(key);
            return stubSingle({ data: reading });
          },
          all: stubAll,
          reset: () => undefined,
        },
        authorship: { name: 'authorship', key: () => stubSingle({}), all: stubAll, reset: () => undefined },
      } as never),
    ),
    Layer.mergeAll(Layer.of(Live, feed.live)),
    { thread: { id: 'thread-1' } },
  );
  const mounted = app.draw(view as never);
  flushSync();
  return mounted;
}

function sent(next: ThreadChangesFrame): void {
  const frame = feed.routes.get('thread.changes');
  if (frame === undefined) throw new Error('The thread changes store holds no subscription.');
  frame(next);
  flushSync();
}

const listed = (page: HTMLElement, section = 'thread-uncommitted'): string[] =>
  [...page.querySelectorAll(`[data-change-section="${section}"] [data-change-path]`)].map(
    (node) => node.getAttribute('data-change-path') ?? '',
  );

const press = (node: Element | null | undefined): void => {
  (node as HTMLElement | null | undefined)?.click();
  flushSync();
};

test('nothing is said before the first verdict, and a re-judgement keeps the verdict standing', () => {
  const page = draw();
  expect(page.querySelector('[data-files-empty]')).toBeNull();
  expect(listed(page)).toEqual([]);

  sent(whole([checkout([], { state: { kind: 'opening', paths: 3 } })]));
  expect(page.querySelector('[data-files-empty]')).toBeNull();

  sent(whole([checkout([])]));
  expect(page.querySelector('[data-files-empty]')).not.toBeNull();

  sent(whole([checkout([], { state: { kind: 'judging', paths: 1 } })]));
  expect(page.querySelector('[data-files-empty]')).not.toBeNull();
});

test('a stale checkout keeps its last list beside the reason and never reads as empty', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts')])]));

  sent({
    kind: 'change',
    threadId: 'thread-1',
    held: { paths: 1, unproven: 0 },
    uncommitted: { added: 0, removed: 0 },
    checkouts: [
      {
        checkout: MAIN,
        projectId: 1,
        root: '/repo',
        branch: 'main',
        revision: 2,
        state: { kind: 'stale', reason: 'git status failed' },
        uncommitted: { added: 0, removed: 0 },
        changed: [],
        gone: [],
      },
    ],
    gone: [],
  });

  expect(listed(page)).toEqual(['src/a.ts']);
  expect(page.querySelector(`[data-files-stale="${MAIN}"]`)?.textContent).toContain('git status failed');
  expect(page.querySelector('[data-files-empty]')).toBeNull();
});

test('a change frame replaces and removes only the paths it names', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts'), held('src/b.ts')])]));

  sent({
    kind: 'change',
    threadId: 'thread-1',
    held: { paths: 2, unproven: 0 },
    uncommitted: { added: 0, removed: 0 },
    checkouts: [
      {
        checkout: MAIN,
        projectId: 1,
        root: '/repo',
        branch: 'main',
        revision: 2,
        state: { kind: 'current' },
        uncommitted: { added: 0, removed: 0 },
        changed: [held('src/c.ts')],
        gone: ['src/a.ts'],
      },
    ],
    gone: [],
  });

  expect(listed(page)).toEqual(['src/b.ts', 'src/c.ts']);
});

test('an unproven path lists under not verified with its reason, apart from the held ones', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts'), unproven('src/big.ts')])]));

  expect(listed(page)).toEqual(['src/a.ts']);
  expect(listed(page, 'thread-unproven')).toEqual(['src/big.ts']);
  expect(page.querySelector('[data-files-unproven-reason]')?.textContent).toContain('unpack worker missing');
});

test('paths in two checkouts list in two groups, and a row opens in its own checkout', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts')]), checkout([held('src/b.ts')], { checkout: WORKTREE, root: '/repo-wt', branch: 'wt' })]));

  expect(
    [...page.querySelectorAll('[data-change-section="thread-uncommitted"] [data-change-checkout]')].map((node) =>
      node.getAttribute('data-change-checkout'),
    ),
  ).toEqual([MAIN, WORKTREE]);

  press(page.querySelector('[data-change-path="src/b.ts"]'));
  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: WORKTREE, path: 'src/b.ts', commit: null });
});

test('a row clicked again keeps its diff open in the one Changes tab of its thread', async () => {
  const page = draw();
  area.panes.seatMain({ projectId: 1, activeId: 'thread-1' });
  sent(whole([checkout([held('src/a.ts')])]));

  press(page.querySelector('[data-change-path="src/a.ts"]'));
  await until(() => area.panes.shows({ kind: CHANGES_PANE, id: null }));
  press(page.querySelector('[data-change-path="src/a.ts"]'));
  await until(() => area.layouts.layout(threadHolder('thread-1')).tabs.length > 0);

  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: MAIN, path: 'src/a.ts', commit: null });
  expect(area.layouts.layout(threadHolder('thread-1')).tabs.map((tab) => tab.kind)).toEqual([CHANGES_PANE]);
});

test('a Scratch file opens in the view of the thread’s Changes tab, not in a tab of its own', async () => {
  const page = draw(Changes);
  area.panes.seatMain({ projectId: 1, activeId: 'thread-1' });
  sent(whole([checkout([])]));
  feed.routes.get('scratch.subscribe')?.({
    directory: '/scratch/thread-1',
    entries: [{ name: 'notes.md', kind: 'file', bytes: 12, modifiedAt: 0 }],
    total: 1,
  });
  flushSync();

  press(page.querySelector('[data-change-path="notes.md"]'));
  await until(() => area.layouts.layout(threadHolder('thread-1')).tabs.length > 0);

  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: null, path: '/scratch/thread-1/notes.md', commit: null });
  expect(area.layouts.layout(threadHolder('thread-1')).tabs.map((tab) => tab.kind)).toEqual([CHANGES_PANE]);
  expect(page.querySelector('[data-change-path="notes.md"]')?.getAttribute('aria-current')).toBe('true');
  expect(page.querySelector('[data-changes-diff] [data-file-tab]')?.getAttribute('data-file-tab')).toBe('/scratch/thread-1/notes.md');
});

test('a Scratch PDF goes to the browser by the file opener’s rule, never into the view as a binary file', async () => {
  const page = draw(Changes);
  area.panes.seatMain({ projectId: 1, activeId: 'thread-1' });
  sent(whole([checkout([held('src/a.ts')])]));
  feed.routes.get('scratch.subscribe')?.({
    directory: '/scratch/thread-1',
    entries: [{ name: 'report.pdf', kind: 'file', bytes: 12, modifiedAt: 0 }],
    total: 1,
  });
  flushSync();

  press(page.querySelector('[data-change-path="report.pdf"]'));
  await until(() => browsed.length > 0);

  expect(browsed[0]).toContain('report.pdf');
  expect(app?.app.resolve(ThreadChanges).open).toBeNull();
  expect(page.querySelector('[data-changes-diff] [data-file-tab]')).toBeNull();
});

test('One column lays the opened diff over the list, and Back returns to the list', () => {
  const page = draw(Changes);
  sent(whole([checkout([held('src/a.ts')])]));
  const list = page.querySelector('[data-files-column]')?.parentElement;

  press(page.querySelector('button[aria-label="View options"]'));
  press([...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim() === 'One column'));
  press(page.querySelector('[data-change-path="src/a.ts"]'));

  expect(list?.inert).toBe(true);
  expect(list?.style.visibility).toBe('hidden');
  press(page.querySelector('[data-changes-diff] button[aria-label="Back"]'));
  expect(app?.app.resolve(ThreadChanges).open).toBeNull();
  expect(list?.inert).toBe(false);
});

test('a lone group is named only when it lies outside the thread’s project, and then by that project', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts')])]));
  expect(page.querySelector('[data-change-checkout]')).toBeNull();

  sent(whole([checkout([held('src/a.ts')], { checkout: WORKTREE, projectId: 2, root: '/billing' })]));
  expect(page.querySelector(`[data-change-checkout="${WORKTREE}"]`)?.textContent).toContain('billing');
});

test('a commit the frame carries opens in History into this thread’s files of it, and a file there opens that commit’s change', () => {
  const page = draw();
  sent(whole([checkout([])], [COMMIT]));
  press(page.querySelector('[data-changes-lens] button:nth-child(2)'));

  press(page.querySelector(`[data-commit="${COMMIT.sha}"]`));

  expect(asked.at(-1)).toMatchObject({ rootId: MAIN, commit: COMMIT.sha, thread: 'thread-1' });
  const commits = '[data-change-section="thread-commits"]';
  expect([...page.querySelectorAll(`${commits} [data-change-path]`)].map((node) => node.getAttribute('data-change-path'))).toEqual([
    'src/gate.ts',
  ]);

  press(page.querySelector(`${commits} [data-change-path="src/gate.ts"]`));
  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: MAIN, path: 'src/gate.ts', commit: COMMIT.sha });
});

test('History lists every path a turn wrote with its fate, opens a committed one at its commit, and reads again when the thread moves', async () => {
  history = [
    { runId: 'run-2', checkout: MAIN, path: 'src/now.ts', at: 2_000, state: 'held', commit: null, reason: null },
    { runId: 'run-1', checkout: MAIN, path: 'src/landed.ts', at: 1_000, state: 'committed', commit: COMMIT.sha, reason: null },
    { runId: 'run-1', checkout: MAIN, path: 'src/lost.ts', at: 1_000, state: 'withdrawn', commit: null, reason: 'overwritten' },
  ];
  const page = draw();
  sent(whole([checkout([held('src/now.ts')])]));
  press(page.querySelector('[data-changes-lens] button:nth-child(2)'));
  await until(() => page.querySelectorAll('[data-history-path]').length === 3);

  expect([...page.querySelectorAll('[data-history-path]')].map((node) => node.getAttribute('data-history-state'))).toEqual([
    'held',
    'committed',
    'withdrawn',
  ]);
  expect(page.querySelector('[data-history-path="src/lost.ts"]')?.textContent).toContain('Overwritten');
  expect(page.querySelector('[data-history-path="src/lost.ts"] button')).toBeNull();

  press(page.querySelector('[data-history-path="src/landed.ts"] button'));
  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: MAIN, path: 'src/landed.ts', commit: COMMIT.sha });

  const reads = historyReads;
  history = [{ ...history[0]!, state: 'committed', commit: COMMIT.sha }, ...history.slice(1)];
  sent(whole([checkout([])], [COMMIT]));
  await until(() => page.querySelector('[data-history-path="src/now.ts"]')?.getAttribute('data-history-state') === 'committed');
  expect(historyReads).toBe(reads + 1);
});

test('ArrowDown on a focused row opens the next row and hands it focus', () => {
  const page = draw();
  sent(whole([checkout([held('src/a.ts'), held('src/b.ts')])]));

  const first = page.querySelector<HTMLButtonElement>('[data-change-path="src/a.ts"]');
  first?.focus();
  first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  flushSync();

  expect(app?.app.resolve(ThreadChanges).open).toEqual({ projectId: 1, rootId: MAIN, path: 'src/b.ts', commit: null });
  expect(document.activeElement?.getAttribute('data-change-path')).toBe('src/b.ts');
});
