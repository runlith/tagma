// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { ViewCapabilities } from '$lib/features/plugin-views/capabilities.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { TEST_ORIGIN } from '$lib/wire/testing.js';
import { appLayers, LADDER } from './composition.js';

test('the composed window offers every view the speech member, built per mount with the mount’s facts alone', async () => {
  const graph = mountApp(
    appLayers(undefined),
    Layer.mergeAll(
      Layer.of(Platform, makePlatform()),
      Layer.of(Router, makeRouter()),
      Host.tab(),
      ServerOrigin.of(TEST_ORIGIN),
      Layer.of(ExternalLinks, { open: () => undefined }),
      Layer.of(FileSaver, { save: () => undefined }),
    ) as never,
    { ladder: LADDER, data: 'lazy' },
  );
  try {
    const speech = graph.get(ViewCapabilities).find('speech');
    expect(speech?.declaration.id).toBe('speech');
    const ended = new AbortController();
    const member = speech?.make({ projectId: 1, plugin: 'board', view: 'main', ended: ended.signal });
    expect(Object.keys(member ?? {}).sort()).toEqual(['recognize', 'silence', 'speak', 'status']);
  } finally {
    await graph.unmount();
  }
});
