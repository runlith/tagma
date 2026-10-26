// @vitest-environment jsdom
import type { PageState, Video } from '@tagma/server/artifacts/contract/wire/artifacts';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { Layer } from '@runlith/layer/Layer';
import { stubMutation } from '@runlith/query/testing';
import { liveFeed, mountShell, type TestApp } from '$lib/app/testing.js';
import { Links } from '$lib/features/browser/Links.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { PageStates } from './PageStates.svelte.js';
import VideoExport from './VideoExport.svelte';
import { VideosRepo } from './VideosRepo.js';

const PAGE = '338821ed3be0';
const VERSION = '20261025T005003685Z';
const SHELF = 'http://localhost:5634';
const FILE = `${SHELF}/a/${PAGE}/v/${VERSION}/video-30-1x.mp4`;

const drawing = (frames: number): Video => ({
  job: 'a1b2c3d4e5f6',
  version: VERSION,
  fps: 30,
  scale: 1,
  state: 'drawing',
  frames,
  total: 210,
  url: null,
  bytes: null,
  problem: null,
});

const state = (videos: readonly Video[]): PageState => ({ current: null, kept: [VERSION], videos });

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('an export the page feed reports ready offers its video and downloads it, with nothing left to stop', async () => {
  const feed = liveFeed();
  const opened: string[] = [];
  const exported = vi.fn(async () => ({ status: 'exporting' as const, page: PAGE, video: drawing(0) }));
  app = mountShell(
    PageStates,
    Layer.mergeAll(
      Layer.of(Live, feed.live),
      Layer.of(VideosRepo, { export: stubMutation(exported), cancel: stubMutation() } as never),
      Layer.of(Links, { system: (url: string) => void opened.push(url) } as never),
    ),
  );
  app.get(ServerOrigin).declare({ artifactOrigin: SHELF, sandboxOrigin: null });
  const release = app.get(PageStates).hold(PAGE);
  const page = feed.routes.get('artifacts.page')!;
  page(state([]));
  const target = app.draw(VideoExport as never, {
    page: PAGE,
    version: VERSION,
    timeline: { v: 1, duration: 7, fps: 30, width: 1920, height: 1080 },
  });
  flushSync();

  target.querySelector<HTMLButtonElement>('button[aria-label="Export as MP4"]')!.click();
  flushSync();
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((item) => item.textContent?.trim().startsWith('Export MP4 1×'))!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  page(state([drawing(210)]));
  flushSync();
  expect(target.querySelector('[data-video-state="drawing"] button[aria-label^="Stop"]')).not.toBeNull();

  page(state([{ ...drawing(210), state: 'ready', url: FILE, bytes: 1_384_422 }]));
  flushSync();
  await vi.waitFor(() => expect(opened).toEqual([FILE]));
  const ready = target.querySelector('[data-video-state="ready"]')!;
  expect(ready.querySelector('button[aria-label^="Stop"]')).toBeNull();
  ready.querySelector('button')!.click();
  expect(opened).toEqual([FILE, FILE]);
  release();
});
