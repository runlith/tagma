// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { BLOCK_PANE, blockPane } from '$lib/features/graph/blockPane.js';
import { panes as graphPanes } from '$lib/features/graph/panes.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import type { PaneKind } from '$lib/shared/panes/pane.js';
import PaneStack from './PaneStack.svelte';
import { SidePanes } from './SidePanes.svelte.js';
import { testArea, testKind } from './testing.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a block tab of another project keeps that copy open while another tab is shown, so coming back reads nothing again', async () => {
  const block = graphPanes.find((kind) => kind.kind === BLOCK_PANE) as PaneKind;
  const note: PaneKind = { ...testKind('note'), view: () => Promise.resolve({ default: (() => undefined) as never }) };
  const area = testArea([block, note]);
  area.panes.open(blockPane({ projectId: 2, branch: null, name: '5940aab8', diff: null, lang: null }), { activate: false });
  area.panes.open({ kind: 'note', id: 'n-1' });
  app = mountShell(Layer.of(SidePanes, area.panes), Layer.mergeAll(), { at: { projectId: 1, branch: null } });
  app.draw(PaneStack);
  await flush();

  expect(app.app.hasScope(ProjectRung, { projectId: 2 })).toBe(true);
  const project = app.app.hold(ProjectRung, { projectId: 2 });
  expect(app.app.hasScope(GraphRung, { projectId: 2, branch: null }, project.scope)).toBe(true);
  project.release();
});
