// @vitest-environment jsdom
import { tick } from 'svelte';
import { expect, test } from 'vitest';
import { draftHolder, threadHolder } from '$lib/shared/panes/holder.js';
import { terminalPane } from '../kind.js';
import { paneNode, splitNode } from '../terminal/paneLayout.js';
import type { StoredLayout } from './layout.js';
import { FEATURE, MAIN, listingFor, reportFor, stand, until } from './testing/fixture.svelte.js';

type Written = { value: { places: Record<string, StoredLayout> } };

test('the roster’s terminals, pipes alike, stand in the places their records name; a harness CLI and an unplaced row stand nowhere', async () => {
  const listings = [
    listingFor('main-shell:0'),
    listingFor('feature-shell:0', { rootId: FEATURE }),
    listingFor('agent:0', { rootId: FEATURE, holder: 'thread:t-1', heldBy: 't-1', label: 'Tagma app dev server' }),
    listingFor('claude:0', { launchedFor: 't-2' }),
    listingFor('pipe:0', { transport: 'pipes' }),
    listingFor('lost:0', { rootId: null }),
    listingFor('done:0', { phase: 'exited' }),
  ];
  const owned = await stand(listings);
  owned.feed(listings);
  await tick();

  expect(owned.worktree(MAIN).tabs.map((tab) => tab.key)).toEqual(['main-shell:0', 'pipe:0']);
  expect(owned.worktree(MAIN).held.get('pipe:0')?.current?.watching).toBe(true);
  expect(owned.worktree(FEATURE).tabs.map((tab) => tab.key)).toEqual(['feature-shell:0', 'agent:0']);
  expect(owned.terminals.rootOf('claude:0')).toBe(null);
  expect(owned.terminals.rootOf('lost:0')).toBe(null);
  expect(owned.terminals.rootOf('done:0')).toBe(null);
  expect(owned.worktree(FEATURE).held.get('agent:0')?.title).toBe('Tagma app dev server');
  expect(owned.worktree(FEATURE).holderOf('agent:0')).toBe('t-1');
  expect(owned.worktree(FEATURE).panel.map((tab) => tab.key)).toEqual(['feature-shell:0']);
  expect(owned.terminals.count(owned.worktree(FEATURE))).toBe(1);
  owned.stop();
});

test('a reload births each place’s stored tabs once with every live leaf they hold, in stored order', async () => {
  const stored = {
    places: {
      [MAIN]: {
        order: ['t:0', 'solo:0'],
        tabs: {
          't:0': { title: 'pair', tree: splitNode('row', paneNode('t:0'), paneNode('u:0')), labels: { 't:0': 'left' } },
        },
        closed: [],
      },
    },
  };
  const owned = await stand([listingFor('solo:0'), listingFor('t:0'), listingFor('u:0')], { stored });

  const worktree = owned.worktree(MAIN);
  expect(worktree.tabs.map((tab) => tab.key)).toEqual(['t:0', 'solo:0']);
  expect(worktree.held.get('t:0')?.count).toBe(2);
  expect(worktree.titles.get('t:0')).toBe('pair');
  owned.stop();
});

test('every place’s arrangement is written as one document, and the last write carries the latest pane title', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE })]);
  const tab = owned.worktree(FEATURE).tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  const last = (): Written => owned.writes.at(-1) as unknown as Written;

  tab.retitle(tab.active, 'build');
  await until(() => last().value.places[FEATURE]?.tabs['f:0']?.labels['f:0'] === 'build', 'the title written');
  expect(Object.keys(last().value.places).sort()).toEqual([FEATURE, MAIN].sort());
  expect(last().value.places[MAIN]?.order).toEqual(['m:0']);

  tab.retitle(tab.active, null);
  await until(() => last().value.places[FEATURE]?.tabs['f:0']?.labels['f:0'] === undefined, 'the title cleared');
  owned.stop();
});

test.each(['feed', 'connection'] as const)(
  'a failed roster recovers from %s without another read and preserves its layout',
  async (source) => {
    const owned = await stand([listingFor('e1:0')], { refuseInventory: true });
    try {
      expect(owned.terminals.ready).toBe(false);
      expect(owned.writes.filter((write) => write.key === 'terminal.placeLayouts')).toEqual([]);
      if (source === 'feed') owned.feed([listingFor('e1:0')]);
      else owned.reconnect();
      await until(() => owned.terminals.ready, 'the inventory recovered from the live connection');
      expect(owned.terminals.ready).toBe(true);
      expect(owned.worktree(MAIN).tabs.map((tab) => tab.key)).toContain('e1:0');
    } finally {
      owned.stop();
    }
  },
);

test('every settings road the places take is keyed by their own project, never the frame they are drawn in', async () => {
  const owned = await stand([listingFor('e1:0')], { project: 7 });
  const tab = owned.worktree().tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');

  tab.retitle(tab.active, 'build');

  expect([...new Set(owned.catalogKeys)]).toEqual([7]);
  expect(owned.writes.length).toBeGreaterThan(0);
  expect([...new Set(owned.writes.map((write) => write.projectId))]).toEqual([7]);
  owned.stop();
});

test('what the floor says about itself lands beside the roster and is dismissed by the person', async () => {
  const said = 'Terminals here open at 160×60: this installation declares 320×100.';
  const owned = await stand([listingFor('n1:0')], { notice: said });
  expect(owned.terminals.floorNotice).toBe(said);
  owned.terminals.dismissFloorNotice();
  expect(owned.terminals.floorNotice).toBe(null);
  owned.stop();

  const quiet = await stand([listingFor('n2:0')]);
  expect(quiet.terminals.floorNotice).toBe(null);
  quiet.stop();
});

test('a terminal started after the reading, by a thread or in another window, appears in its worktree, and one the operator closed is not adopted again', async () => {
  const owned = await stand([listingFor('shell:0')], { processesOf: (at) => reportFor(at, false) });
  const agent = listingFor('agent:0', { rootId: FEATURE, holder: 'thread:t-1', heldBy: 't-1', label: 'dev server' });
  const operator = listingFor('elsewhere:0');
  const harness = listingFor('claude:0', { holder: 'thread:t-2', heldBy: 't-2', launchedFor: 't-2' });

  owned.feed([listingFor('shell:0'), agent, operator, harness]);
  await until(() => owned.terminals.rootOf('agent:0') === FEATURE, 'the agent terminal adopted into its place');
  expect(owned.worktree(MAIN).panel.map((tab) => tab.key)).toEqual(['shell:0', 'elsewhere:0']);
  expect(owned.terminals.rootOf('claude:0')).toBe(null);

  owned.worktree(FEATURE).requestClose('agent:0');
  await until(() => owned.terminals.rootOf('agent:0') === null, 'the operator closed the agent tab');
  owned.feed([listingFor('shell:0'), agent, operator, harness, listingFor('fresh:0', { holder: 'thread:t-1', heldBy: 't-1' })]);
  await until(() => owned.terminals.rootOf('fresh:0') === MAIN, 'the next agent terminal adopted');
  expect(owned.terminals.rootOf('agent:0')).toBe(null);
  owned.stop();
});

test('a thread taking a shell’s CLI marks its tab from the live roster alone, and the mark leaves with the adoption', async () => {
  const owned = await stand([listingFor('shell:0')]);
  const tab = owned.worktree(MAIN).tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');

  owned.feed([listingFor('shell:0', { adoptedBy: 'thread-9' })]);
  await until(() => owned.worktree(MAIN).adopterOf(tab) !== null, 'the adopter marked');
  expect(owned.worktree(MAIN).adopterOf(tab)?.thread).toBe('thread-9');

  owned.feed([listingFor('shell:0')]);
  await until(() => owned.worktree(MAIN).adopterOf(tab) === null, 'the adoption ended');
  owned.stop();
});

test('a thread’s terminal first listed before it stands is adopted once it stands', async () => {
  const owned = await stand([]);
  const shape = { holder: 'thread:t-1', heldBy: 't-1' };
  owned.feed([listingFor('late:0', { ...shape, phase: 'queued' })]);
  await new Promise((done) => setTimeout(done, 0));
  expect(owned.terminals.rootOf('late:0')).toBe(null);

  owned.feed([listingFor('late:0', { ...shape, phase: 'running' })]);
  await until(() => owned.terminals.rootOf('late:0') === MAIN, 'the terminal adopted once it stands');
  owned.stop();
});

test('a panel tab is on screen only while its view is mounted, the panel shown and the tab in front', async () => {
  const owned = await stand([listingFor('a:0'), listingFor('b:0')]);
  const worktree = owned.worktree(MAIN);
  const [first, second] = worktree.tabs;
  if (first === undefined || second === undefined) throw new Error('tabs missing');
  first.mount();
  second.mount();
  worktree.select(second.key);
  expect(second.visible()).toBe(false);

  worktree.show();
  expect(second.visible()).toBe(true);
  expect(first.visible()).toBe(false);
  second.unmount();
  expect(second.visible()).toBe(false);
  owned.stop();
});

test('the toggle shows the aimed place’s panel with its terminals and hides it again, the shells running on and no tab opening beside', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE })]);
  const unmount = owned.terminals.mountPanel();
  owned.aim(FEATURE);
  await tick();

  owned.terminals.toggle();
  expect(owned.terminals.shown).toBe(true);
  expect(owned.worktree(FEATURE).active).toBe('f:0');
  expect(owned.worktree(MAIN).shown).toBe(false);

  owned.terminals.toggle();
  expect(owned.terminals.shown).toBe(false);
  expect(owned.terminals.rootOf('f:0')).toBe(FEATURE);
  expect(owned.panes.panes).toEqual([]);
  expect(owned.stops).toEqual([]);
  unmount();
  owned.stop();
});

test('an address a place’s panel holds is revealed there: the frame aims at the place, the panel shows it in front', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE }), listingFor('g:0', { rootId: FEATURE })]);

  await owned.terminals.reveal('f:0');

  expect(owned.addresses.at(-1)).toBe('/proj/chat?branch=feature');
  expect(owned.worktree(FEATURE).shown).toBe(true);
  expect(owned.worktree(FEATURE).active).toBe('f:0');
  owned.stop();
});

test('a terminal started beside a thread is that thread’s: it stands in its tabs and never in the place’s panel, and closing it ends its shell', async () => {
  const owned = await stand([listingFor('m:0')], { processesOf: (at) => reportFor(at, false) });

  await owned.terminals.openBeside();
  const worktree = owned.worktree(MAIN);
  const mine = worktree.tabs.find((tab) => tab.key !== 'm:0');
  if (mine === undefined) throw new Error('no terminal started beside');
  expect(worktree.holderOf(mine.key)).toBe(owned.panes.holder);
  expect(owned.panes.shows(terminalPane(mine.key))).toBe(true);
  expect(worktree.panel.map((tab) => tab.key)).toEqual(['m:0']);

  expect(owned.terminals.requestClose(mine.key)).toBe(true);
  await until(() => !worktree.holds(mine.key), 'the closed terminal gone');
  expect(owned.stops.map((stop) => stop.key)).toContain(mine.key);
  expect(worktree.panel.map((tab) => tab.key)).toEqual(['m:0']);
  owned.stop();
});

test('a terminal its thread holds stands in that thread’s tabs wherever the layout was lost, and one whose thread is gone returns to its worktree’s panel', async () => {
  const held = (holder: string) => ({ title: null, tree: paneNode(holder === 't-live' ? 'a:0' : 'g:0'), labels: {}, holder });
  const stored = { places: { [MAIN]: { order: ['a:0', 'g:0'], tabs: { 'a:0': held('t-live'), 'g:0': held('t-gone') }, closed: [] } } };
  const owned = await stand([listingFor('a:0'), listingFor('g:0')], {
    stored,
    threads: (thread) => (thread === 't-live' ? ({ label: 'live', archived: false } as never) : null),
  });

  expect(owned.layouts.layout(threadHolder('t-live')).tabs).toMatchObject([{ kind: 'terminal', id: 'a:0' }]);
  expect(owned.worktree(MAIN).panel.map((tab) => tab.key)).toEqual(['g:0']);
  owned.stop();
});

test('a thread born from its draft inherits the terminals started beside the draft, even when this window lost the draft’s tabs', async () => {
  const owned = await stand([listingFor('m:0')]);
  const draft = draftHolder(owned.layouts.projectId);
  owned.panes.seatMain({ activeId: null, projectId: owned.layouts.projectId } as unknown as NonNullable<typeof owned.panes.main>);
  await owned.terminals.openBeside();
  const worktree = owned.worktree(MAIN);
  const mine = worktree.tabs.find((tab) => tab.key !== 'm:0');
  if (mine === undefined) throw new Error('no terminal started beside');
  for (const tab of owned.layouts.layout(draft).tabs) owned.layouts.close(draft, tab.key);

  owned.panes.carry('born');

  expect(worktree.holderOf(mine.key)).toBe('born');
  owned.stop();
});

test('a terminal tab stands only in the layout of the holder that owns it', async () => {
  const owned = await stand([listingFor('m:0')]);
  const here = owned.panes.holder;
  if (here === null) throw new Error('no holder on screen');

  owned.layouts.open(here, terminalPane('m:0'));

  expect(owned.panes.holds(terminalPane('m:0'))).toBe(false);
  expect(owned.worktree(MAIN).panel.map((tab) => tab.key)).toEqual(['m:0']);
  owned.stop();
});

test('a reload restores each place’s active tab and each tab’s active pane; a place stored without them reads on its last tab', async () => {
  const stored = {
    places: {
      [MAIN]: {
        order: ['a:0', 't:0', 'c:0'],
        tabs: {
          't:0': { title: null, tree: splitNode('row', paneNode('t:0'), paneNode('u:0')), labels: {}, active: 'u:0' },
        },
        closed: [],
        active: 't:0',
      },
      [FEATURE]: { order: ['f:0', 'g:0'], tabs: {}, closed: [] },
    },
  };
  const owned = await stand(
    [
      listingFor('a:0'),
      listingFor('t:0'),
      listingFor('u:0'),
      listingFor('c:0'),
      listingFor('f:0', { rootId: FEATURE }),
      listingFor('g:0', { rootId: FEATURE }),
    ],
    { stored },
  );

  const main = owned.worktree(MAIN);
  expect(main.active).toBe('t:0');
  const split = main.held.get('t:0');
  const pane = split?.panes.get(split.active);
  expect(pane?.address).toEqual({ execution: 'u', incarnation: 0 });
  expect(owned.worktree(FEATURE).active).toBe('g:0');

  expect(owned.writes).toEqual([]);
  if (split === undefined) throw new Error('no split restored');
  split.retitle(split.active, 'build');
  await tick();
  const written = owned.writes.at(-1) as unknown as Written;
  expect(written.value.places[MAIN]).toMatchObject({ active: 't:0' });
  expect(written.value.places[MAIN]?.tabs['t:0']).toMatchObject({ active: 'u:0', labels: { 'u:0': 'build' } });
  split.retitle(split.active, 'build');
  await tick();
  expect(owned.writes).toHaveLength(1);
  owned.stop();
});

test('showing the panel of a place that holds no terminal starts one shell there in front', async () => {
  const owned = await stand([]);
  const unmount = owned.terminals.mountPanel();
  expect(owned.starts).toEqual([]);

  owned.terminals.toggle();
  await until(() => owned.worktree(MAIN).panel.length === 1, 'the shell opened');
  expect(owned.starts.map((start) => start.cwd)).toEqual(['/root']);
  expect(owned.worktree(MAIN).active).toBe(owned.worktree(MAIN).panel[0]?.key);
  unmount();
  owned.stop();
});

test('a shell an agent starts lands as a background tab in its thread’s layout, whether the first reading or a later roster finds it, with no terminal on screen asking', async () => {
  const agent = { holder: 'thread:t-1', heldBy: 't-1' };
  const owned = await stand([listingFor('early:0', agent)]);
  owned.feed([listingFor('early:0', agent), listingFor('agent:0', agent)]);
  await until(() => owned.terminals.rootOf('agent:0') === MAIN, 'the agent terminal adopted');

  expect(owned.layouts.layout(threadHolder('t-1')).tabs).toMatchObject([
    { kind: 'terminal', id: 'early:0', agent: true },
    { kind: 'terminal', id: 'agent:0', agent: true },
  ]);
  expect(owned.panes.holds(terminalPane('agent:0'))).toBe(false);
  owned.stop();
});

test('an address revealed before the worktree listing arrives aims the frame once the listing is read', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE })], { unlisted: true });

  const revealed = owned.terminals.reveal('f:0');
  await new Promise((done) => setTimeout(done, 0));
  expect(owned.addresses).toEqual([]);

  owned.list();
  await revealed;
  expect(owned.addresses.at(-1)).toBe('/proj/chat?branch=feature');
  expect(owned.worktree(FEATURE).active).toBe('f:0');
  owned.stop();
});

test('a terminal asked for before the worktree listing arrives opens once the listing is read', async () => {
  const owned = await stand([], { unlisted: true });
  owned.aim(null);

  const started = owned.terminals.openBeside();
  owned.aim(MAIN);
  owned.list();
  await started;

  expect(owned.worktree(MAIN).tabs).toHaveLength(1);
  expect(owned.panes.active?.kind).toBe('terminal');
  owned.stop();
});

test('a reveal still waiting when its project leaves the window writes no address, and its place still shows the tab', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE })], { unlisted: true });

  const revealed = owned.terminals.reveal('f:0');
  owned.background();
  owned.list();
  await revealed;

  expect(owned.addresses).toEqual([]);
  expect(owned.worktree(FEATURE).active).toBe('f:0');
  owned.stop();
});

test('an address no tab holds is born from its record in its place under its agent’s words; a harness pty leads to its thread', async () => {
  const outside = listingFor('agent:0', {
    holder: 'thread:t-1',
    heldBy: 't-1',
    label: 'Tagma app dev server',
    commandLine: 'bun run --bun vite --port 6111',
  });
  const harness = listingFor('claude:0', { holder: 'operator', launchedFor: 't-9' });
  const owned = await stand([listingFor('e1:0')], { records: [outside, harness] });

  await owned.terminals.reveal('agent:0');
  const worktree = owned.worktree(MAIN);
  expect(worktree.held.get('agent:0')?.title).toBe('Tagma app dev server');
  expect(worktree.active).toBe('agent:0');
  expect(owned.addresses.at(-1)).toBe('/proj/chat/thread-1');

  await owned.terminals.reveal('agent:0');
  expect(worktree.tabs.filter((held) => held.key === 'agent:0').length).toBe(1);

  await owned.terminals.reveal('claude:0');
  expect(owned.terminals.rootOf('claude:0')).toBe(null);
  expect(owned.addresses.at(-1)).toBe('/proj/chat/t-9');
  owned.stop();
});

test('a place that left the listing keeps its place while it holds a tab, and its arrangement goes once it holds none', async () => {
  const owned = await stand([listingFor('m:0'), listingFor('f:0', { rootId: FEATURE })], {
    processesOf: (at) => reportFor(at, false),
  });
  owned.leave(FEATURE);
  await tick();
  expect(owned.terminals.worktrees.has(FEATURE)).toBe(true);

  owned.worktree(FEATURE).requestClose('f:0');
  await until(() => owned.terminals.rootOf('f:0') === null, 'the last tab of the gone place closed');
  const written = owned.writes.at(-1) as unknown as Written;
  expect(Object.keys(written.value.places)).toEqual([MAIN]);
  await until(() => !owned.terminals.worktrees.has(FEATURE), 'the emptied place of the gone place dropped');
  owned.stop();
});
