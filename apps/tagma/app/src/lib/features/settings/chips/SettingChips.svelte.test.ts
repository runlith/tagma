// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { Platform } from '@runlith/layer/Platform';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { mount, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';
import { Overlays } from '$lib/app/overlays.js';
import { testAddressing } from '$lib/app/testing.js';
import TestHost from '$lib/app/TestHost.svelte';
import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { loadOperations } from '$lib/wire/operation.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
import { testDoor } from '$lib/wire/testing.js';
import { SettingsRepo } from '../SettingsRepo.js';
import { SettingChips } from './SettingChips.svelte.js';

await loadOperations();

function json(body: unknown): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { status: 200, headers: { 'content-type': 'application/json' } }), {
    arrayBuffer: async () => buffer,
  });
}

function catalog(on: boolean | undefined) {
  return {
    sections: [{ id: 'telemetry', title: 'Telemetry', description: '' }],
    entries: [
      {
        id: 'telemetry.cpuSampler',
        section: 'telemetry',
        title: 'Standing CPU sampler',
        description: 'Keep a CPU profile running.',
        shape: 'boolean',
        scopes: ['user'],
        merge: 'replace',
        value: on ?? false,
        from: on === undefined ? 'default' : 'user',
        fallback: false,
        layers: on === undefined ? {} : { user: { value: on, declined: false } },
      },
    ],
    rejections: [],
  };
}

function world(writes: unknown[]) {
  const door = testDoor(async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const project = { id: 7, name: 'demo' };
    if (path === '/api/op/list_projects') {
      const row = { ...project, repoKey: 'demo', rootPath: '/projects/demo', strictProvenance: false, private: false, global: false };
      return json({
        status: 'ok',
        projects: [{ ...row, storage: 'stealth', graphRemote: null, servesFrom: 'rows', createdAt: '2026-10-18T00:00:00Z' }],
      });
    }
    if (path === '/api/op/read_settings') return json({ status: 'ok', project, settings: catalog(undefined) });
    if (path !== '/api/op/write_setting_layer') throw new Error(`Unexpected request: ${path}`);
    const body = (await request.json()) as { value: boolean };
    writes.push(body);
    return json({ status: 'ok', project, settings: catalog(body.value) });
  });
  return mountApp(
    Layer.mergeAll(Overlays, testAddressing, SettingsRepo, ProjectsRepo, Workspace, SessionNaming, Cache.of({})),
    Layer.mergeAll(
      Layer.of(Door, door),
      Layer.of(Platform, makePlatform()),
      ServerOrigin.of('http://localhost'),
      Layer.of(Router, makeRouter({ params: { project: 'demo' }, url: new URL('http://localhost/demo') })),
      Layer.of(Opening, { knows: () => true, tip: () => ({ text: null }) } as never),
    ),
  );
}

test('a catalog key in a settled message switches in place on the machine layer while at its default; other code and file-link labels stay as they are', async () => {
  const writes: unknown[] = [];
  const app = world(writes);
  const target = document.createElement('div');
  const host = mount(TestHost, {
    target,
    props: {
      app: app.app,
      view: MarkdownBody as never,
      props: {
        text: 'Turn on `telemetry.cpuSampler`, not `telemetry.missing` or `Effect.fn`; see [`telemetry.cpuSampler`](README.md).',
        settings: new SettingChips(app.get(SettingsRepo), 7),
      },
    },
  });
  try {
    await vi.waitFor(() => expect(target.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false'));
    expect([...target.querySelectorAll('[data-setting]')].map((chip) => chip.getAttribute('data-setting'))).toEqual([
      'telemetry.cpuSampler',
    ]);
    expect(target.querySelector('[data-setting]')?.textContent?.trim()).toBe('telemetry.cpuSampler');
    expect([...target.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      'telemetry.missing',
      'Effect.fn',
      'telemetry.cpuSampler',
    ]);

    const chip = target.querySelector('[data-setting]');
    target.querySelector<HTMLElement>('[role="switch"]')!.click();

    await vi.waitFor(() => expect(target.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true'));
    expect(writes).toEqual([{ scope: 'user', key: 'telemetry.cpuSampler', value: true }]);
    expect(target.querySelector('[data-setting]')).toBe(chip);
  } finally {
    await unmount(host);
    await app.unmount();
  }
});

test('a key in a finished block of a streaming answer is a chip at once, the live tail gets none, and the chip survives the end of the stream', async () => {
  const app = world([]);
  const props = $state({ text: 'Turn on `telemetry.cpuSampler`.\n\nThen `telemetry.cpuSampler', streaming: true });
  const target = document.createElement('div');
  const host = mount(TestHost, {
    target,
    props: {
      app: app.app,
      view: MarkdownBody as never,
      props: {
        get text() {
          return props.text;
        },
        get streaming() {
          return props.streaming;
        },
        cacheKey: 'streamed-chips',
        settings: new SettingChips(app.get(SettingsRepo), 7),
      },
    },
  });
  try {
    await vi.waitFor(() => expect(target.querySelectorAll('[data-setting]')).toHaveLength(1));
    const chip = target.querySelector('[data-setting]');
    expect([...target.querySelectorAll('p')].at(-1)?.querySelector('code')?.textContent).toBe('telemetry.cpuSampler');

    props.text = 'Turn on `telemetry.cpuSampler`.\n\nThen `telemetry.cpuSampler` again.';
    props.streaming = false;

    await vi.waitFor(() => expect(target.querySelectorAll('[data-setting]')).toHaveLength(2));
    expect(target.querySelector('[data-setting]')).toBe(chip);
  } finally {
    await unmount(host);
    await app.unmount();
  }
});
