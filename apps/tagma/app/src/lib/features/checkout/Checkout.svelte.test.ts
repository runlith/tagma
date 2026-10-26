// @vitest-environment jsdom
import type { CheckoutArea, CheckoutEntry, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { makeStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { keyedBy, liveFeed, mountShell, type TestApp } from '$lib/app/testing.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Live } from '$lib/wire/Live.js';
import { Checkout } from './Selection.svelte.js';

const area = (entries: readonly CheckoutEntry[], added = 0, removed = 0): CheckoutArea => ({ entries, added, removed });

const changed = (path: string): CheckoutEntry => ({
  path,
  status: 'modified',
  lines: { added: 1, removed: 1 },
});

function checkoutRow(over: Partial<CheckoutState> = {}): CheckoutState {
  return {
    rootId: 'root-1',
    path: '/repo',
    revision: 1,
    head: 'f1e2d3c4b5a6',
    ref: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    operation: 'none',
    entries: { staged: area([]), unstaged: area([]), untracked: area([]), unmerged: area([]) },
    compare: null,
    coverage: { untracked: 'all', paths: null },
    repository: true,
    incomplete: false,
    stale: false,
    unwatched: false,
    slowStatus: false,
    ...over,
  } as CheckoutState;
}

let feed = liveFeed();
let app: TestApp | undefined;
let failures: unknown[] = [];

beforeEach(() => {
  feed = liveFeed();
  failures = [];
});

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
});

function open(
  branches: readonly { branch: string; worktree: string | null; canonical: boolean }[] = [],
  branch: string | null = null,
  read: () => Promise<unknown> = async () => branches,
  storage = makeStorage(),
): Checkout {
  app = mountShell(
    Layer.mergeAll(Checkout, ReaderMarks),
    Layer.mergeAll(
      Layer.of(Live, feed.live),
      Failure.of((reason) => {
        failures.push(reason);
      }),
      Layer.of(ProjectsRepo, { branches: keyedBy(read as never) } as never),
    ),
    { at: { projectId: 1, branch }, storage },
  );
  return app.app.resolve(Checkout);
}

function sent(row: CheckoutState): void {
  if (feed.frame === null) throw new Error('The checkout store holds no subscription.');
  feed.frame(row);
  flushSync();
}

test('a path standing on two sides is one changed path', () => {
  const checkout = open();

  sent(
    checkoutRow({
      entries: {
        staged: area([changed('a.ts')], 4, 1),
        unstaged: area([changed('a.ts'), changed('b.ts')], 6, 2),
        untracked: area([]),
        unmerged: area([]),
      },
    }),
  );

  expect(checkout.paths).toBe(2);
});

test('a branch that stands in no checkout says so rather than reading as a row on its way', async () => {
  const checkout = open([{ branch: 'shadow', worktree: null, canonical: false }], 'shadow');
  await Promise.resolve();
  await Promise.resolve();
  flushSync();

  expect(checkout.absent).toBe('no-working-copy');
  expect(checkout.row).toBeNull();
  expect(feed.frame).toBeNull();
});

test('a branch list that could not be read says it was not read, never that it is still coming', async () => {
  const checkout = open([], 'shadow', async () => {
    throw new Error('the door refused');
  });
  await Promise.resolve();
  await Promise.resolve();
  flushSync();

  expect(checkout.absent).toBe('unread');
  expect(checkout.row).toBeNull();
  expect(feed.frame).toBeNull();
  expect(failures.map((reason) => (reason as Error).message)).toEqual(['the door refused']);
});

test('a reading the server refuses is the absence it names, in the server’s words, and nobody is told of a failure', () => {
  const checkout = open();
  if (feed.ended === null) throw new Error('The checkout store holds no subscription.');

  feed.ended({
    kind: 'subscription',
    code: 'coverage-unestablished',
    message: 'This project has no established root coverage.',
    unblock: [],
  });
  flushSync();

  expect(checkout.absent).toBe('unread');
  expect(checkout.unreadReason).toBe('This project has no established root coverage.');
  expect(checkout.row).toBeNull();
  expect(failures).toEqual([]);

  feed.ended({ kind: 'subscription', message: 'the socket closed' });
  expect(failures.map((reason) => (reason as Error).message)).toEqual(['the socket closed']);
});

test('the base is part of the reading: a kept one rides the subscription, and a new one opens a new reading', () => {
  const storage = makeStorage();
  storage.setItem('tagma.compareBase', JSON.stringify({ '1:': 'release' }));
  const checkout = open([], null, undefined, storage);

  expect(feed.asked.at(-1)).toEqual({ projectId: 1, base: 'release' });
  sent(checkoutRow());

  checkout.base = 'feature';
  expect(checkout.row).toBeNull();
  expect(feed.asked.at(-1)).toEqual({ projectId: 1, base: 'feature' });

  checkout.base = null;
  expect(feed.asked.at(-1)).toEqual({ projectId: 1 });
});
