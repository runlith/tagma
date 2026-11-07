// @vitest-environment jsdom
import type { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { mountRepo } from '@runlith/query/testing';
import { QueryClient } from '@tanstack/query-core';
import { expect, test } from 'vitest';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { Catalog } from './Catalog.js';
import { SpeechRepo } from './Repo.js';

test('a catalog change during the first status read leaves Settings on the newer catalog, whatever answer lands last', async () => {
  const answers: Array<(speech: string) => void> = [];
  const door = {
    perform: () => new Promise((resolve) => answers.push((speech) => resolve({ status: 'read', speech }))),
  } as unknown as Door;
  const { repo, unmount } = mountRepo(SpeechRepo, { door, queryClient: new QueryClient() });
  let moved: (event: { readonly providers: readonly string[] }) => void = () => undefined;
  const live = {
    hold: (_open: unknown, onItem: typeof moved) => {
      moved = onItem;
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  new Catalog(live, repo, Scope.make(), { report: () => undefined } as unknown as Failure);

  const first = repo.status.load();
  moved({ providers: ['openai', 'echo'] });
  expect(answers).toHaveLength(2);
  answers[1]!('with echo');
  answers[0]!('before echo');
  await first;
  await Promise.resolve();

  expect(repo.status.watch()).toBe('with echo');
  await unmount();
});
