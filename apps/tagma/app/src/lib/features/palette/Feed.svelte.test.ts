import type { BaseQuery } from '@runlith/query/types';
import { expect, test } from 'vitest';
import { Feed } from './Feed.svelte.js';
import type { Page } from './Repo.js';

type Asked = {
  readonly query: BaseQuery<Page<string>>;
  release(page: Page<string>): void;
  fail(error: Error): void;
  cancelled(): boolean;
};

function pending(): Asked {
  let release: (page: Page<string>) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  let cancelled = false;
  const answer = new Promise<Page<string>>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const query = {
    loadOrThrow: () => answer,
    cancel: () => {
      cancelled = true;
      return Promise.resolve();
    },
  } as unknown as BaseQuery<Page<string>>;
  return { query, release, fail, cancelled: () => cancelled };
}

const page = (...rows: string[]): Page<string> => ({
  rows,
  total: rows.length,
  atLeast: null,
  next: null,
  approximate: false,
  extra: null,
});

const settle = async (): Promise<void> => {
  for (let step = 0; step < 4; step += 1) await Promise.resolve();
};

function feed(): { feed: Feed<string, null, true>; asked: Map<string, Asked> } {
  const asked = new Map<string, Asked>();
  const made = new Feed<string, null, true>((text) => {
    const entry = pending();
    asked.set(text, entry);
    return entry.query;
  });
  return { feed: made, asked };
}

test('an answer to a superseded ask never replaces the rows of the current one', async () => {
  const { feed: search, asked } = feed();

  search.ask('a', true);
  search.ask('ab', true);
  expect(asked.get('a')?.cancelled()).toBe(true);

  asked.get('ab')?.release(page('current'));
  await settle();
  asked.get('a')?.release(page('stale'));
  await settle();

  expect(search.rows).toEqual(['current']);
  expect(search.loading).toBe(false);
});

test('a new ask keeps the previous answer until its own arrives, and a failed ask leaves nothing of it', async () => {
  const { feed: search, asked } = feed();

  search.ask('a', true);
  asked.get('a')?.release(page('first'));
  await settle();
  expect(search.rows).toEqual(['first']);

  search.ask('ab', true);
  expect(search.rows).toEqual(['first']);
  expect(search.loading).toBe(true);

  asked.get('ab')?.fail(new Error('refused'));
  await settle();
  expect(search.rows).toEqual([]);
  expect(search.failure).toBeInstanceOf(Error);
  expect(search.loading).toBe(false);
});

test('a failure belongs to the ask it answered: the next ask drops it while its own answer loads', async () => {
  const { feed: search, asked } = feed();

  search.ask('pr', true);
  asked.get('pr')?.fail(new Error('too short'));
  await settle();
  expect(search.failure).toBeInstanceOf(Error);

  search.ask('privet', true);
  expect(search.failure).toBeNull();
  expect(search.loading).toBe(true);
});
