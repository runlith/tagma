// @vitest-environment jsdom
import { App, MountedApp } from '@runlith/layer/App';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { TEST_ORIGIN } from '$lib/wire/testing.js';
import { appLayers, LADDER } from './composition.js';

test('the root page’s load reads the project list before the window mounts its app', async () => {
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(new Request(input, init).url);
    if (pathname === '/api/op/list_projects') return Response.json({ status: 'ok', projects: [] });
    if (pathname === '/api/op/list_groups') return Response.json({ status: 'ok', groups: [] });
    return Response.json({ code: 'not-found', reason: `${pathname} is not served here`, unblock: [] }, { status: 404 });
  };
  const failures: unknown[] = [];
  const app = new MountedApp(
    App.define(
      Layer.mergeAll(
        appLayers(undefined),
        Layer.of(Platform, makePlatform({ fetch })),
        Layer.of(Router, makeRouter()),
        Host.tab(),
        ServerOrigin.of(TEST_ORIGIN),
        Layer.of(ExternalLinks, { open: () => undefined }),
        Layer.of(FileSaver, { save: () => undefined }),
      ) as never,
      { ladder: LADDER },
    ),
    Layer.mergeAll(),
    { effectRoot: (build) => $effect.root(build), start: 'mount' },
  );
  const workspace = app.run(
    (function* () {
      return yield* Workspace;
    })(),
  );
  workspace.ready.catch((error: unknown) => void failures.push(error));
  await workspace.ready;
  expect(failures).toEqual([]);
  expect(workspace.empty).toBe(true);
  await app.close();
});
