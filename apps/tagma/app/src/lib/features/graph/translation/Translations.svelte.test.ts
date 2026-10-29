// @vitest-environment jsdom
import type { Projection } from '@tagma/server/translations/contract/wire/projection';
import { mountRepo } from '@runlith/query/testing';
import { observe } from '@runlith/query/test-utils/observe.svelte';
import { waitUntil } from '@runlith/testing/flush';
import { QueryClient } from '@tanstack/query-core';
import { afterEach, expect, test } from 'vitest';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import { TranslationLens } from './Lens.svelte.js';
import { TranslationsRepo } from './Repo.js';
import { Translations } from './Translations.svelte.js';

await loadOperations();

const close: (() => unknown)[] = [];
afterEach(async () => {
  for (const done of close.splice(0).reverse()) await done();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const projection: Projection = {
  language: 'ru',
  state: 'translating',
  model: 'anthropic:claude-haiku',
  rung: null,
  at: '2026-10-29T18:00:00.000Z',
  reason: null,
  failed: 0,
  translated: 0,
  changed: 0,
  pending: 1,
  total: 1,
  parts: [{ kind: 'title', source: 'Title', state: 'pending', text: null }],
  titles: [],
};

test('a refused first act holds the lens on its refusal, and a retry with a model holds it until the new act reads', async () => {
  let started = false;
  const answered = Promise.withResolvers<void>();
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const operation = new URL(request.url).pathname.split('/').at(-1);
    if (operation === 'read_block_translation')
      return json({
        status: 'read',
        block: 'abcd1234',
        preferred: 'ru',
        languages: started ? [{ language: 'ru', state: 'translating', translated: 0, changed: 0, pending: 1, total: 1 }] : [],
        projection: started ? projection : null,
      });
    if (operation === 'stop_block_translation') return json({ status: 'idle', block: 'abcd1234', language: 'ru' });
    const { model } = JSON.parse(await request.text()) as { model?: string };
    if (model === undefined)
      return json({ code: 'translation-model-missing', reason: 'no model translates', unblock: ['set translation.model'] }, 409);
    await answered.promise;
    started = true;
    return json({ status: 'translating', block: 'abcd1234', language: 'ru', joined: false, model, rung: null, sending: 1 });
  };
  const aim = { projectId: 1, branch: null };
  const mounted = mountRepo(TranslationsRepo, {
    door: new GraphDoor(testDoor(fetch), aim),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    ladder: [ProjectRung, GraphRung],
    at: { project: { projectId: 1 }, graph: aim },
  });
  close.push(mounted.unmount);
  const translations = new Translations(
    mounted.repo,
    { hold: () => ({ unsubscribe: () => undefined }) } as never,
    { frames: () => () => undefined } as never,
    aim,
    { languages: ['en'] } as never,
    { report: (error: unknown) => void error } as never,
    { defer: () => undefined } as never,
  );
  const lens = new TranslationLens(
    translations,
    mounted.repo,
    () => 'abcd1234',
    () => 'ru',
    () => undefined,
  );
  close.push(observe(() => [lens.absent, lens.refusal, lens.projection]));

  await translations.translate('abcd1234', 'ru');
  await waitUntil(() => lens.read !== undefined);
  expect(lens.refusal?.code).toBe('translation-model-missing');
  expect(lens.absent).toBe(false);

  const retry = lens.update({ model: 'anthropic:claude-haiku' });
  expect(lens.absent).toBe(false);
  answered.resolve();
  await retry;
  await waitUntil(() => lens.projection !== null);
  expect(lens.refusal).toBeUndefined();
  expect(lens.absent).toBe(false);
  expect(lens.phase).toBe('translating');
});
