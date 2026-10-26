// @vitest-environment jsdom
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import type { AuthoredLine, PathAuthorship } from '@tagma/server/change-record/contract/wire/authorship';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { ThreadChangesFrame, ThreadEntry } from '@tagma/server/change-record/contract/wire/threadChanges';
import { Layer } from '@runlith/layer/Layer';
import { stubAll, stubMutation, stubSingle } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouterWithLog } from '@runlith/layer/testing';

import { AUTHORSHIP_ANSWER_LINES } from '@tagma/server/change-record/contract/wire/operations';
import { PATCH_CONTEXT_LINES } from '@runlith/utils/patch';
import { liveFeed, mountShell, screen, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { Refusal } from '$lib/wire/refusal.js';
import { type AuthorshipKey, CheckoutRepo } from './Repo.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';
import DiffStage from './DiffStage.svelte';

const line = (
  kind: AuthoredLine['kind'],
  text: string,
  before: number | null,
  after: number | null,
  author: AuthoredLine['author'] = null,
  hiddenBefore = 0,
  hiddenAt = 0,
): AuthoredLine => ({ kind, text, before, after, author, spans: [], hiddenBefore, hiddenAt });

const BUILDER = { holder: { kind: 'thread' as const, thread: 'thread-9' }, agentName: 'builder' };
const OPENER = { holder: { kind: 'thread' as const, thread: 'thread-7' }, agentName: 'opener' };
const MINE = { holder: { kind: 'thread' as const, thread: 'thread-1' }, agentName: null };

const reading = (lines: readonly AuthoredLine[], over: Partial<PathAuthorship> = {}): PathAuthorship =>
  ({
    rootId: 'root-1',
    path: 'src/a.ts',
    binary: false,
    timedOut: false,
    sides: { before: 'src/a.ts', after: 'src/a.ts' },
    lines,
    ...over,
  }) as PathAuthorship;

const patch = reading([
  line('added', 'two', null, 1, BUILDER),
  line('context', 'one', 1, 2),
  line('context', 'three', 2, 3, MINE),
  line('context', 'forty', 40, 41, null, 34, 6),
  line('removed', 'gone', 41, null, { holder: { kind: 'thread' as const, thread: 'thread-4' }, agentName: null }),
]);

const opened = reading([
  line('added', 'two', null, 1, BUILDER),
  line('context', 'one', 1, 2),
  line('context', 'three', 2, 3, MINE),
  line('context', 'between', 4, 5, OPENER),
  line('context', 'forty', 40, 41, null, 14, 26),
  line('removed', 'gone', 41, null, { holder: { kind: 'thread' as const, thread: 'thread-4' }, agentName: null }),
]);

const ROOT = 'root-1' as RootId;

const list = (paths: readonly string[]): ThreadChangesFrame => ({
  kind: 'whole',
  threadId: 'thread-1',
  held: { paths: paths.length, unproven: 0 },
  uncommitted: { added: 2 * paths.length, removed: paths.length },
  checkouts: [
    {
      checkout: ROOT,
      projectId: 1,
      root: '/repo',
      branch: 'main',
      revision: 1,
      state: { kind: 'current' },
      uncommitted: { added: 2 * paths.length, removed: paths.length },
      entries: paths.map((path): ThreadEntry => ({
        section: 'uncommitted',
        path,
        from: null,
        git: 'modified',
        lines: { added: 2, removed: 1 },
        writing: true,
        others: [],
        nobody: false,
      })),
    },
  ],
  commits: [],
  moreCommits: false,
  ends: [],
});

let feed = liveFeed();
const boxed = new Map<string, PropertyDescriptor | undefined>();
const entry = $state<{ held: PathAuthorship }>({ held: patch });
let refused: Refusal | undefined;
let unwieldy = false;
let app: TestApp | undefined;

const TOO_WIDE = new Refusal({
  gate: true,
  code: 'context-too-wide',
  reason: `this ask over src/a.ts answers 41203 lines, past the ${AUTHORSHIP_ANSWER_LINES} one reading carries`,
  unblock: ['Ask narrower.'],
});

beforeEach(() => {
  feed = liveFeed();
  entry.held = patch;
  refused = undefined;
  unwieldy = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const [name, value] of [
    ['offsetWidth', 900],
    ['offsetHeight', 600],
  ] as const) {
    boxed.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  for (const [name, descriptor] of boxed) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  boxed.clear();
  vi.unstubAllGlobals();
});

let navigation = makeRouterWithLog();

function draw(): { page: HTMLElement; files: ThreadChanges } {
  navigation = makeRouterWithLog();
  app = mountShell(
    Layer.mergeAll(
      screen(),
      ThreadChanges,
      Layer.of(Opening, { open: () => Promise.resolve() } as never),
      Layer.of(FileOpener, { open: () => Promise.resolve(), stand: () => () => undefined } as never),
      ReaderMarks,
      Notices,
      Keymap,
      Layer.of(CheckoutRepo, {
        authorship: {
          name: 'authorship',
          key: (key: AuthorshipKey) => {
            const beyond = unwieldy && key.context > PATCH_CONTEXT_LINES;
            return stubSingle({
              get data() {
                return refused === undefined && !beyond ? entry.held : undefined;
              },
              get error() {
                return beyond ? TOO_WIDE : refused;
              },
              refresh: async () => entry.held,
              loadOrThrow: async () => entry.held,
              setCache: (next: PathAuthorship) => {
                entry.held = next;
              },
            });
          },
          all: stubAll,
          reset: () => undefined,
        },
        openRuns: stubMutation(async () => opened),
      } as never),
    ),
    Layer.mergeAll(Layer.of(Live, feed.live)),
    { thread: { id: 'thread-1' }, router: navigation.router },
  );
  const page = app.draw(DiffStage as never, { file: { projectId: 1, rootId: ROOT, path: 'src/a.ts', commit: null } });
  flushSync();
  if (feed.frame === null) throw new Error('The thread changes store holds no subscription.');
  feed.frame(list(['src/a.ts']));
  const files = app.app.resolve(ThreadChanges);
  files.open = { projectId: 1, rootId: ROOT, path: 'src/a.ts', commit: null };
  flushSync();
  return { page, files };
}

const strips = (page: HTMLElement): HTMLElement[] => [...page.querySelectorAll<HTMLElement>('.cm-strip-diff[title]')];

test('the diff links other holders, uses the list’s counts, and keeps navigation keys out of menus', () => {
  const { page, files } = draw();

  expect(strips(page)).toHaveLength(2);
  expect([...page.querySelectorAll('[data-diff-hand]')].map((hand) => hand.getAttribute('data-diff-hand'))).toEqual([
    'thread-9',
    'thread-4',
  ]);
  expect(page.querySelector('header')?.textContent).toContain('+2');
  expect(page.querySelector('header')?.textContent).toContain('−1');
  expect(page.querySelectorAll('.cm-diff-added')).toHaveLength(1);

  strips(page)[0]
    ?.closest('.cm-gutterElement')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  expect(navigation.visited).toHaveLength(1);
  expect(navigation.visited[0]?.href).toContain('thread-9');

  feed.frame?.(list(['src/a.ts', 'src/b.ts']));
  flushSync();
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  document.body.append(menu);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  flushSync();
  expect(files.open?.path).toBe('src/a.ts');
  menu.remove();

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  flushSync();
  expect(files.open).toEqual({ projectId: 1, rootId: ROOT, path: 'src/b.ts', commit: null });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
  expect(files.open).toBeNull();
});

test('an oversized whole reading falls back to the patch, whose hidden stretch reveals lines and their authors', async () => {
  unwieldy = true;
  const { page } = draw();

  expect(page.querySelector('[data-diff-refused]')).toBeNull();
  expect(page.textContent).toContain('two');
  expect(page.querySelector('[data-diff-width]')?.hasAttribute('disabled')).toBe(true);

  const press = [...page.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Show 20');
  press?.click();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();

  expect(page.textContent).toContain('between');
  expect(strips(page).map((mark) => mark.title)).toContain('Written by opener');
});

test('a reading the door refused stands in the diff’s place, in the door’s words', () => {
  refused = new Refusal({
    gate: false,
    code: 'not-found',
    reason: 'src/a.ts stands in neither HEAD nor the working tree of this checkout',
    unblock: [],
  });
  const { page } = draw();

  expect(page.querySelector('[data-diff-refused]')?.textContent).toContain('stands in neither HEAD');
});
