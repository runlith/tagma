// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { tick } from 'svelte';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Dictation } from '$lib/features/speech/dictation/Dictation.svelte.js';
import { SpeechRepo } from '$lib/features/speech/Repo.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Refusal, RETRIES, retriable } from '$lib/wire/refusal.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { SoundChannel } from '$lib/wire/SoundChannel.js';
import { loadCatalog, TestCatalog, testDoor } from '$lib/wire/testing.js';
import { SettingsRepo } from './SettingsRepo.js';

await loadCatalog();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test.each([
  { code: 'demo-unavailable', requests: 1 },
  { code: 'transport', requests: RETRIES + 1 },
])('the dictation reader retains a $code catalog refusal after $requests requests', async ({ code, requests }) => {
  let reads = 0;
  const door = testDoor(async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    if (path === '/api/op/list_projects') {
      return json({
        status: 'ok',
        projects: [
          {
            id: 7,
            name: 'demo',
            repoKey: 'demo',
            rootPath: '/projects/demo',
            strictProvenance: false,
            private: false,
            kind: 'folder',
            storage: 'stealth',
            servesFrom: 'rows',
            createdAt: '2026-10-18T00:00:00Z',
          },
        ],
      });
    }
    if (path === '/api/op/list_groups') return json({ status: 'ok', groups: [] });
    if (path !== '/api/op/read_settings') throw new Error(`Unexpected request: ${path}`);
    reads += 1;
    if (reads > requests) {
      return json({ status: 'ok', project: { id: 7, name: 'demo' }, settings: { sections: [], entries: [], rejections: [] } });
    }
    return json({ status: 'refused', code, reason: 'The catalog is unavailable.', unblock: [] }, 409);
  });
  const mounted = mountApp(
    Layer.mergeAll(
      SettingsRepo,
      ProjectsRepo,
      Workspace,
      Dictation,
      SpeechRepo,
      Notices,
      Live,
      SoundChannel,
      Cache.of({ defaultOptions: { queries: { retry: (count, error) => count < RETRIES && retriable(error), retryDelay: 0 } } }),
    ),
    Layer.mergeAll(
      Layer.of(Door, door),
      TestCatalog,
      Layer.of(Platform, makePlatform()),
      Layer.of(Router, makeRouter()),
      ServerOrigin.of('http://localhost'),
    ),
  );
  try {
    mounted.get(Dictation);
    await mounted.get(Workspace).ready;
    const entry = mounted.get(SettingsRepo).catalog.key(7);
    await waitUntil(() => reads > 0 && !entry.watchFetching());
    await tick();
    expect(reads).toBe(requests);
    expect(entry.watchError()).toBeInstanceOf(Refusal);
    expect(entry.watchError()).toMatchObject({ code });
    expect(entry.watchFetching()).toBe(false);
  } finally {
    await mounted.unmount();
  }
});
