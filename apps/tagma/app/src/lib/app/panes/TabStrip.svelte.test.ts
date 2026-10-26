// @vitest-environment jsdom

import X from '@lucide/svelte/icons/x';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import type { LinkKind, LinkPlace } from '$lib/features/opening/Link.js';
import { LinkRegistry } from '$lib/features/opening/LinkRegistry.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SidePanes } from './SidePanes.svelte.js';
import TabStrip from './TabStrip.svelte';
import { testArea, testKind } from './testing.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('the strip opens the active tab’s thing in the full place of its link, and a tab that moves there leaves the strip', async () => {
  const opened: string[] = [];
  const place = (words: string): LinkPlace<string> => ({ words, icon: X, open: (_app, link) => void opened.push(link.target) });
  const kind = (name: string): LinkKind<string> => ({
    kind: name,
    what: () => name,
    beside: place('Open beside'),
    full: place(`Open in ${name}`),
    tab: { kind: name, link: (_app, id) => (id === null ? null : { kind: name, target: id }) },
  });
  const notices = { refusal: vi.fn() } as unknown as Notices;
  const opening = new Opening(
    new LinkRegistry([{ links: [kind('note'), kind('talk')] as never }]),
    {} as never,
    {} as never,
    notices,
    new Host('desktop', 'macos'),
  );
  const area = testArea([testKind('note'), { ...testKind('talk'), moves: true }, testKind('changes')]);
  const note = area.panes.open({ kind: 'note', id: 'n-1' });
  const changes = area.panes.open({ kind: 'changes', id: null });
  const talk = area.panes.open({ kind: 'talk', id: 't-1' });
  if (note.kind === 'refused' || changes.kind === 'refused' || talk.kind === 'refused') throw new Error('The test tabs did not open.');
  app = mountShell(Layer.mergeAll(Layer.of(SidePanes, area.panes), Layer.of(Opening, opening), Layer.of(Notices, notices), Keymap));
  const root = app.draw(TabStrip);
  const full = () => root.querySelector<HTMLButtonElement>('[data-pane-full]');

  area.panes.activate(note.key);
  flushSync();
  expect(full()?.getAttribute('aria-label')).toBe('Open in note');
  full()?.click();

  area.panes.activate(changes.key);
  flushSync();
  expect(full()).toBeNull();

  area.panes.activate(talk.key);
  flushSync();
  full()?.click();
  flushSync();

  await vi.waitFor(() => expect(opened).toEqual(['n-1', 't-1']));
  expect(area.panes.panes.map((tab) => tab.kind)).toEqual(['note', 'changes']);
});
