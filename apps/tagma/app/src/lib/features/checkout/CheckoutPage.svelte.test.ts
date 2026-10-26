// @vitest-environment jsdom
import type { Holding, HoldingsFrame } from '@tagma/server/change-record/contract/wire/holdings';
import type { CheckoutArea, CheckoutEntry, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import { Layer } from '@runlith/layer/Layer';
import { stubAll, stubMutation, stubSingle } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { keyedBy, liveFeed, mountShell, screen, type TestApp, testPlaces } from '$lib/app/testing.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { untrackedCache } from '@tagma/server/workspace/contract/wire/settings';
import { Live } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { BY_THREAD } from './grouping.js';
import { Holdings } from './Holdings.svelte.js';
import { Checkout } from './Selection.svelte.js';
import { CheckoutRepo, type AuthorshipKey } from './Repo.js';
import CheckoutPage from './CheckoutPage.svelte';
import { Column } from './files/Column.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Door } from '$lib/wire/Door.js';
import { AutoSave } from './files/AutoSave.svelte.js';
import { Documents } from './files/Documents.svelte.js';
import { Tabs } from './files/Tabs.svelte.js';
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { GitLists } from './GitLists.svelte.js';
import { makeStorage } from '@runlith/layer/testing';
import { Host } from '@runlith/layer/Host';
import { DECLARED_LINKS } from '$lib/app/opening/declaredLinks.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';

const area = (entries: readonly CheckoutEntry[]): CheckoutArea => ({ entries, added: 0, removed: 0 });

const changed = (path: string): CheckoutEntry => ({
  path,
  status: 'modified',
  lines: { added: 1, removed: 1 },
});

function checkoutRow(over: Partial<CheckoutState['entries']> = {}): CheckoutState {
  return {
    rootId: 'root-1',
    path: '/repo',
    revision: 1,
    head: 'f1e2d3c4b5a6',
    ref: 'main',
    upstream: 'origin/main',
    publishTo: null,
    ahead: 0,
    behind: 0,
    operation: 'none',
    entries: { staged: area([]), unstaged: area([]), untracked: area([]), unmerged: area([]), ...over },
    compare: null,
    coverage: { untracked: 'all', paths: null },
    repository: true,
    incomplete: false,
    stale: false,
    unwatched: false,
    slowStatus: false,
  } as CheckoutState;
}

let feed = liveFeed();
let committed = vi.fn();
let app: TestApp | undefined;

beforeEach(() => {
  feed = liveFeed();
  committed = vi.fn(async () => ({ commit: 'c0ffee', ahead: 1, paths: [], writing: [] }));
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function draw(): HTMLElement {
  app = mountShell(
    Layer.mergeAll(
      screen(),
      Checkout,
      Holdings,
      GitLists,
      Column,
      Tabs,
      Documents,
      Layer.of(AutoSave, { policyOf: () => ({ mode: 'afterDelay', delay: 1000 }) } as never),
      Layer.of(Door, { perform: () => Promise.reject(new Error('no door')) } as never),
      Layer.of(GraphDoor, { aim: { projectId: 1, branch: null } } as never),
      Layer.of(FileOpener, { open: () => Promise.resolve(), stand: () => () => undefined } as never),
      Layer.of(Workspace, { find: () => undefined } as never),
      Layer.of(Worktrees, testPlaces() as never),
      Notices,
      Seams,
      ReaderMarks,
      Keymap,
      ThreadNames,
      Layer.of(ThreadList, { homeOf: () => 1 } as never),
      Layer.of(
        Opening,
        new Opening(DECLARED_LINKS, {} as never, {} as never, { refusal: () => undefined } as never, new Host('desktop', 'macos')),
      ),
      Layer.of(CheckoutRepo, {
        authorship: {
          name: 'authorship',
          key: (_key: AuthorshipKey) => stubSingle({}),
          all: stubAll,
          reset: () => undefined,
        },
        history: keyedBy(async () => undefined),
        commitReading: keyedBy(async () => undefined),
        stage: stubMutation(),
        unstage: stubMutation(),
        discard: stubMutation(),
        commit: stubMutation(committed as never),
        abort: stubMutation(),
        push: stubMutation(),
        pull: stubMutation(),
        fetch: stubMutation(),
        sync: stubMutation(),
      } as never),
    ),
    Layer.mergeAll(
      Layer.of(Live, feed.live),
      Layer.of(ProjectsRepo, { branches: keyedBy(async () => []) } as never),
      Layer.of(SettingsRepo, {
        catalog: {
          name: 'stub',
          key: () => stubSingle({ data: { entries: [{ id: untrackedCache.id, value: false }] } }),
          all: stubAll,
          reset: () => undefined,
        },
        write: stubMutation(),
      } as never),
    ),
    { storage: makeStorage({ 'tagma.checkoutColumn': 'git' }) },
  );
  const mounted = app.draw(CheckoutPage as never);
  flushSync();
  return mounted;
}

function sent(row: CheckoutState): void {
  const frame = feed.routes.get('checkout.subscribe');
  if (frame === undefined) throw new Error('The checkout store holds no subscription.');
  frame(row);
  flushSync();
}

const pathsUnder = (page: HTMLElement, section: string): string[] =>
  [...(page.querySelector(`[data-change-section="${section}"]`)?.querySelectorAll('[data-change-path]') ?? [])].map(
    (node) => node.getAttribute('data-change-path') ?? '',
  );

test('checkout sides stay distinct, then holder groups and counts follow the judged frame', () => {
  const page = draw();

  sent(
    checkoutRow({
      staged: area([changed('src/a.ts')]),
      unstaged: area([changed('src/a.ts'), changed('src/b.ts'), changed('.tagma/blocks/one.md')]),
      untracked: area([{ ...changed('src/new.ts'), status: 'untracked' }]),
    }),
  );

  expect(pathsUnder(page, 'git-staged')).toEqual(['src/a.ts']);
  expect(pathsUnder(page, 'git-changes')).toEqual(['src/a.ts', 'src/b.ts', 'src/new.ts']);

  page.querySelector<HTMLButtonElement>('[data-change-section="git-graph"] button[aria-expanded]')?.click();
  flushSync();
  expect(pathsUnder(page, 'git-graph')).toEqual(['.tagma/blocks/one.md']);

  const tabs = app?.app.resolve(Tabs);
  page.querySelector<HTMLButtonElement>('[data-change-section="git-staged"] button[data-change-path="src/a.ts"]')?.click();
  flushSync();
  expect(tabs?.active?.diff).toEqual({ commit: null, side: 'staged' });
  page.querySelector<HTMLButtonElement>('[data-change-section="git-changes"] button[data-change-path="src/a.ts"]')?.click();
  flushSync();
  expect(tabs?.active?.diff).toEqual({ commit: null, side: 'unstaged' });
  sent({ ...checkoutRow({ unstaged: area([changed('src/a.ts'), changed('src/b.ts')]) }), revision: 2 });
  page.querySelector<HTMLButtonElement>('[data-change-section="git-changes"] button[data-change-path="src/a.ts"]')?.click();
  flushSync();
  expect(page.querySelector('[data-diff-pane] header')?.textContent).not.toContain('+');
  app?.app.resolve(ReaderMarks).grouping.set(BY_THREAD, 'thread');
  flushSync();
  expect(page.querySelector('[data-checkout-holders-updating]')).not.toBeNull();

  const holding = (path: string, hands: readonly string[]): Holding => ({
    path,
    from: null,
    git: 'modified',
    verdict: {
      verdict: 'proven',
      hands: hands.map((thread) => ({ holder: { kind: 'thread' as const, thread }, added: 1, removed: 1, writing: false, retired: false })),
      nobody: hands.length === 0 ? [{ added: 1, removed: 1, why: { kind: 'external' } }] : [],
    },
    lines: { added: 1, removed: 1 },
  });
  feed.routes.get('holdings.subscribe')?.({
    kind: 'whole',
    checkout: 'root-1' as HoldingsFrame['checkout'],
    revision: 2,
    head: 'f1e2d3c4b5a6',
    row: 2,
    state: { kind: 'current' },
    totals: { paths: 2, held: 1, operator: 0, nobody: 1, unproven: 0 },
    paths: [{ ...holding('src/a.ts', ['thread-1']), lines: { added: 7, removed: 2 } }, holding('src/b.ts', [])],
  } satisfies HoldingsFrame);
  flushSync();

  expect(page.querySelector('[data-checkout-holders-updating]')).toBeNull();
  expect(pathsUnder(page, 'git-thread:holder:thread-1')).toEqual(['src/a.ts']);
  expect(pathsUnder(page, 'git-thread:nobody')).toEqual(['src/b.ts']);
  const head = page.querySelector('[data-diff-pane] header')?.textContent ?? '';
  expect(head).toContain('+7');
  expect(head).toContain('−2');
});

test('a refused format offers the same commit once more without formatting, until the message is edited', async () => {
  const stepFailed = () => refusalOf({ code: 'format-failed', reason: 'prettier failed on a.ts', unblock: [] });
  committed = vi
    .fn()
    .mockRejectedValueOnce(stepFailed())
    .mockRejectedValueOnce(stepFailed())
    .mockResolvedValue({ commit: 'c0ffee', ahead: 1, paths: [], writing: [], formatSkipped: true });
  const page = draw();
  sent(checkoutRow({ staged: area([changed('src/a.ts')]) }));
  const box = page.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]');
  if (box === null) throw new Error('No commit box drawn.');
  const typed = (message: string) => {
    box.value = message;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  };
  const commit = async () => {
    [...page.querySelectorAll('button')].find((button) => button.textContent?.includes('Commit 1 file'))?.click();
    await settle();
  };
  const without = () => page.querySelector<HTMLButtonElement>('[data-checkout-without-format]');

  typed('tighten the rows');
  expect(without()).toBeNull();
  await commit();
  expect(without()).not.toBeNull();
  typed('tighten the rows again');
  expect(without()).toBeNull();

  await commit();
  without()?.click();
  await settle();

  expect(committed.mock.calls.map((call) => call[0])).toEqual([
    { rootId: 'root-1', message: 'tighten the rows' },
    { rootId: 'root-1', message: 'tighten the rows again' },
    { rootId: 'root-1', message: 'tighten the rows again', withoutFormat: true },
  ]);
  expect(without()).toBeNull();
});

test('the branch state selects publish, pull before push when both sides moved, or push when only ahead', () => {
  const page = draw();
  const offered = (): string | null => page.querySelector('[data-checkout-sync]')?.getAttribute('data-checkout-sync') ?? null;

  sent(checkoutRow());
  expect(offered()).toBeNull();

  sent({ ...checkoutRow(), revision: 2, ref: 'feature', upstream: null, publishTo: 'origin', ahead: null, behind: null });
  expect(offered()).toBe('publish');

  sent({ ...checkoutRow(), revision: 3, ref: 'feature', upstream: null, publishTo: null, ahead: null, behind: null });
  expect(offered()).toBeNull();

  sent({ ...checkoutRow(), revision: 4, head: null, ref: 'fresh', upstream: null, publishTo: 'origin', ahead: null, behind: null });
  expect(offered()).toBeNull();

  sent({ ...checkoutRow(), revision: 5, ahead: 2, behind: 1 });
  expect(offered()).toBe('pull');

  sent({ ...checkoutRow(), revision: 6, ahead: 2, behind: 0 });
  expect(offered()).toBe('push');

  sent({ ...checkoutRow(), revision: 7, ahead: null, behind: null });
  expect(offered()).toBe('push');
});
