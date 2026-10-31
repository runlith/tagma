// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { afterEach, expect, test } from 'vitest';
import { SectionContributions, SettingSections } from '$lib/features/settings/section.js';
import { Columns } from '$lib/features/workspace/column.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { TEST_ORIGIN } from '$lib/wire/testing.js';
import { appLayers, LADDER } from './composition.js';

const PROJECT = '/src/routes/[project]/';

const directories = [
  ...new Set(
    Object.keys(import.meta.glob('/src/routes/**/+page.svelte'))
      .filter((path) => path.startsWith(PROJECT))
      .map((path) => path.slice(PROJECT.length).split('/')[0] as string)
      .map((first) => (first === '+page.svelte' ? '' : first)),
  ),
];

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

function core() {
  const failures: unknown[] = [];
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
    { ladder: LADDER, data: 'lazy', onFailure: (error) => void failures.push(error) },
  );
  unmount = () => graph.unmount();
  return { get: graph.get, failures };
}

test('the core composition declares a surface for every project route directory and a route directory for every surface it declares', () => {
  const surfaces = core().get(SurfaceRegistry);

  expect(directories).toContain('');
  expect(directories.filter((directory) => surfaces.owner(directory) === undefined)).toEqual([]);
  expect(surfaces.routes.filter((route) => !directories.includes(route))).toEqual([]);
});

test('every reference the core makes between its contributions resolves, and no contribution of the core clashes', () => {
  const { get, failures } = core();
  const surfaces = get(SurfaceRegistry);
  const columns = new Set(get(Columns).items.map((column) => column.id));
  const sections = new Set(get(SettingSections).items.map((section) => section.id));

  expect(surfaces.all.filter((one) => one.under !== undefined && surfaces.find(one.under) === undefined)).toEqual([]);
  expect(surfaces.all.filter((one) => one.column !== undefined && !columns.has(one.column))).toEqual([]);
  expect(get(SectionContributions).items.filter((one) => !sections.has(one.section))).toEqual([]);
  expect(surfaces.home).not.toBe('');
  expect(failures).toEqual([]);
});
