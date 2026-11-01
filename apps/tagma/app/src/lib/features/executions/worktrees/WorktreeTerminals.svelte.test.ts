// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { terminalPane } from '../kind.js';
import type { StoredLayout } from './layout.js';
import { sectionHolder } from '$lib/shared/panes/holder.js';
import {
  FEATURE,
  FEATURE_FOLDER,
  MAIN,
  addressOf,
  frames,
  listingFor,
  reportFor,
  stageFor,
  stand,
  standPane,
  until,
} from './testing/fixture.svelte.js';

test('a close with a live shell asks first, and confirming ends it after it left the place', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const worktree = owned.worktree();
  const key = worktree.tabs[0]?.key;
  expect(key).toBe('e1:0');
  if (key === undefined) throw new Error('no tab adopted');

  worktree.requestClose(key);
  await until(() => worktree.closing !== null, 'the ask over the running command');
  expect(worktree.closing?.key).toBe(key);
  expect(worktree.held.has(key)).toBe(true);
  expect(owned.stops).toEqual([]);

  worktree.confirmClose();
  expect(worktree.held.has(key)).toBe(false);
  expect(worktree.closing).toBe(null);
  expect(owned.stops.length).toBe(1);
  expect(owned.stops[0]?.cause).toBe('explicit-stop');
  expect(owned.stops[0]?.heldAtStop).toBe(false);
  owned.stop();
});

test('dismissing the ask keeps every shell where it stood', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const worktree = owned.worktree();
  const key = worktree.tabs[0]?.key;
  if (key === undefined) throw new Error('no tab adopted');
  worktree.requestClose(key);
  await until(() => worktree.closing !== null, 'the ask over the running command');
  worktree.cancelClose();
  expect(worktree.closing).toBe(null);
  expect(worktree.held.has(key)).toBe(true);
  expect(owned.stops).toEqual([]);
  owned.stop();
});

test('closes asked one by one while an ask stands wait their turn, each asking in order', async () => {
  const owned = await stand([listingFor('e1:0'), listingFor('e2:0')]);
  const worktree = owned.worktree();

  worktree.requestClose('e1:0');
  worktree.requestClose('e2:0');
  await until(() => worktree.closing !== null, 'the first ask');
  expect(worktree.closing?.key).toBe('e1:0');

  worktree.confirmClose();
  await until(() => worktree.closing?.key === 'e2:0', 'the second ask');
  worktree.confirmClose();
  expect(owned.stops.map((stop) => stop.key)).toEqual(['e1:0', 'e2:0']);
  owned.stop();
});

test('a close with nothing running and a close under the skip setting never ask', async () => {
  const idle = await stand([listingFor('e1:0')]);
  const idlePlace = idle.worktree();
  const tab = idlePlace.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  for (const pane of tab.panes.values()) pane.ending = { _tag: 'Exited' } as never;
  idlePlace.requestClose(tab.key);
  await until(() => !idlePlace.held.has(tab.key), 'the exited tab to close');
  expect(idlePlace.closing).toBe(null);
  expect(idle.stops).toEqual([]);
  idle.stop();

  const skipped = await stand([listingFor('e1:0')], { entries: [{ id: 'terminal.skipCloseConfirm', value: true }] });
  const skippedStrip = skipped.worktree();
  const live = skippedStrip.tabs[0]?.key;
  if (live === undefined) throw new Error('no tab adopted');
  skippedStrip.requestClose(live);
  await until(() => !skippedStrip.held.has(live), 'the tab the setting closes without asking');
  expect(skippedStrip.closing).toBe(null);
  expect(skipped.stops.length).toBe(1);
  skipped.stop();
});

test('a shell hosting an adopted CLI always asks naming its thread, even under the skip setting and when idle', async () => {
  const owned = await stand([listingFor('e1:0')], {
    entries: [{ id: 'terminal.skipCloseConfirm', value: true }],
    processesOf: (at) => reportFor(at, false),
    adoptedBy: (execution) => (execution === 'e1' ? 'thread-adopted' : undefined),
    threads: (thread) => (thread === 'thread-adopted' ? { label: 'Claude Code', archived: false, harness: true } : null),
  });
  const worktree = owned.worktree();
  worktree.requestClose('e1:0');
  await until(() => worktree.closing !== null, 'the ask over the adopted CLI');
  expect(worktree.closing?.thread).toEqual({ thread: 'thread-adopted', label: 'Claude Code' });
  expect(owned.stops).toEqual([]);
  worktree.confirmClose(true);
  expect(owned.stops.map((stop) => stop.key)).toEqual(['e1:0']);
  expect(owned.writes.some((write) => write.key === 'terminal.skipCloseConfirm')).toBe(false);
  owned.stop();
});

test('closing one pane of a split whose shell hosts an adopted CLI asks before ending that shell', async () => {
  const owned = await stand([listingFor('e1:0'), listingFor('e2:0')], {
    adoptedBy: (execution) => (execution === 'e2' ? 'thread-adopted' : undefined),
    stored: {
      places: {
        [MAIN]: {
          order: ['e1:0'],
          tabs: {
            'e1:0': {
              tree: {
                kind: 'split',
                direction: 'row',
                ratio: 0.5,
                children: [
                  { kind: 'pane', id: 'e1:0' },
                  { kind: 'pane', id: 'e2:0' },
                ],
              },
              labels: {},
              title: null,
            },
          },
          closed: [],
        },
      },
    },
  });
  const worktree = owned.worktree();
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  const pane = [...tab.panes.values()].find((held) => held.address?.execution === 'e2');
  if (pane === undefined) throw new Error('the adopted shell has no pane');
  tab.close(pane.id);
  await until(() => worktree.closing !== null, 'the ask over the adopted pane');
  expect(worktree.closing).toMatchObject({ key: tab.key, pane: pane.id, thread: { thread: 'thread-adopted', label: 'thread-adopted' } });
  expect(owned.stops).toEqual([]);
  worktree.confirmClose();
  expect(owned.stops.map((stop) => stop.key)).toEqual(['e2:0']);
  expect(worktree.held.has(tab.key)).toBe(true);

  const other = [...tab.panes.values()].find((held) => held.address?.execution === 'e1');
  if (other === undefined) throw new Error('the plain shell has no pane');
  expect(worktree.adopterOf(tab)).toBe(null);
  owned.stop();
});

test('a shell adopted by a thread the list does not hold still marks its tab and asks, naming the thread by its id', async () => {
  const owned = await stand([listingFor('e1:0')], {
    processesOf: (at) => reportFor(at, false),
    adoptedBy: (execution) => (execution === 'e1' ? 'thread-outside' : undefined),
  });
  const worktree = owned.worktree();
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  worktree.requestClose(tab.key);
  await until(() => worktree.closing !== null, 'the ask over a thread outside the list');
  expect(worktree.closing?.thread).toEqual({ thread: 'thread-outside', label: 'thread-outside' });
  expect(worktree.adopterOf(tab)).toEqual({ thread: 'thread-outside', label: 'thread-outside' });
  expect(owned.stops).toEqual([]);
  owned.stop();
});

test('an idle shell closes without asking, and one running a command asks', async () => {
  const idle = await stand([listingFor('e1:0')], { processesOf: (at) => reportFor(at, false) });
  const idlePlace = idle.worktree();
  idlePlace.requestClose('e1:0');
  await until(() => !idlePlace.held.has('e1:0'), 'the idle tab to close');
  expect(idlePlace.closing).toBe(null);
  expect(idle.stops.map((stop) => stop.key)).toEqual(['e1:0']);
  idle.stop();

  const busy = await stand([listingFor('e2:0')], { processesOf: (at) => reportFor(at, true) });
  const busyStrip = busy.worktree();
  busyStrip.requestClose('e2:0');
  await until(() => busyStrip.closing !== null, 'the ask over the running command');
  expect(busyStrip.closing?.key).toBe('e2:0');
  expect(busy.stops).toEqual([]);
  expect(busyStrip.held.has('e2:0')).toBe(true);
  busy.stop();
});

test('reopening brings back the closed tab tree, its title and its pane names, in the place’s folder', async () => {
  const owned = await stand([listingFor('e1:0', { rootId: FEATURE })]);
  owned.aim(FEATURE);
  const worktree = owned.worktree(FEATURE);
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const source = tab.panes.get(tab.active);
  if (source === undefined) throw new Error('no pane to split');
  await tab.split(source, 'row');
  await until(() => tab.count === 2, 'the split bound its shell');
  const [first] = tab.order;
  tab.panes.get(first as string)!.label = 'editor';
  worktree.beginRename();
  worktree.commitRename('mine');

  worktree.requestClose(tab.key);
  await until(() => worktree.closing !== null, 'the ask over the running command');
  worktree.confirmClose();
  await until(() => worktree.tabs.length === 0, 'the confirmed close');
  const lastWrite = owned.writes[owned.writes.length - 1] as { value: { places: Record<string, StoredLayout> } };
  expect(lastWrite.value.places[FEATURE]?.closed.length).toBe(1);
  expect(lastWrite.value.places[FEATURE]?.closed[0]?.title).toBe('mine');

  const before = owned.starts.length;
  await worktree.reopen();
  expect(owned.starts[before]?.cwd).toBe(FEATURE_FOLDER);
  expect(worktree.tabs.length).toBe(1);
  const back = worktree.tabs[0];
  if (back === undefined) throw new Error('no tab reopened');
  expect(worktree.titles.get(back.key)).toBe('mine');
  expect(worktree.active).toBe(back.key);
  await until(() => back.count === 2 && [...back.panes.values()].every((pane) => pane.address !== null), 'the restore bound every leaf');
  expect(back.layout.kind).toBe('split');
  const labels = [...back.panes.values()].map((pane) => pane.label).sort();
  expect(labels).toContain('editor');
  owned.stop();
});

test('moving a tab’s first pane to a new tab gives that shell a tab of its own beside the one it left', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const worktree = owned.worktree();
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const seed = tab.active;
  await tab.split(tab.panes.get(seed)!, 'row');
  await until(() => [...tab.panes.values()].every((pane) => pane.address !== null) && tab.count === 2, 'the split bound its shell');

  await owned.terminals.detach(worktree, tab.key, seed);

  expect(worktree.tabs.length).toBe(2);
  const moved = worktree.tabs.find((held) => held !== tab);
  expect(moved?.holdsExecution('e1:0')).toBe(true);
  expect(tab.holdsExecution('e1:0')).toBe(false);
  expect(worktree.reveal('e1:0')).toBe(moved?.key);
  expect(worktree.active).toBe(moved?.key);
  owned.stop();
});

test('new and detached tabs retain the project of a foreign section holder', async () => {
  const owned = await stand([listingFor('e1:0')]);
  try {
    const worktree = owned.worktree();
    const tab = worktree.tabs[0];
    if (tab === undefined) throw new Error('no terminal adopted');
    const holder = sectionHolder('files');
    worktree.own(tab.key, holder, 2);
    const opened = await worktree.open(holder, tab.key);
    expect(opened === null ? null : worktree.ownerOf(opened)).toEqual({ holder, projectId: 2 });

    tab.mount();
    const seed = tab.active;
    await tab.split(tab.panes.get(seed)!, 'row');
    await until(() => tab.count === 2 && [...tab.panes.values()].every((pane) => pane.address !== null), 'the foreign split bound');
    const detached = await worktree.detach(tab.key, seed);
    expect(detached === null ? null : worktree.ownerOf(detached)).toEqual({ holder, projectId: 2 });
  } finally {
    owned.stop();
  }
});

test('a new shell opens in its place’s folder, whichever place the frame aims', async () => {
  const owned = await stand([]);
  await owned.worktree(MAIN).open();
  expect(owned.starts.at(-1)?.cwd).toBe('/root');

  owned.aim(FEATURE);
  await until(() => owned.terminals.worktrees.has(FEATURE), 'the aimed worktree’s terminals');
  await owned.worktree(FEATURE).open();
  expect(owned.starts.at(-1)?.cwd).toBe(FEATURE_FOLDER);
  expect(owned.worktree(FEATURE).tabs.map((tab) => tab.key)).toEqual(['fresh-2:0']);
  expect(owned.worktree(MAIN).tabs.map((tab) => tab.key)).toEqual(['fresh-1:0']);
  owned.stop();
});

test('a bell in a tab off screen raises the dot until the tab is in front', async () => {
  const owned = await stand([listingFor('e1:0'), listingFor('e2:0')]);
  const worktree = owned.worktree();
  const [first, second] = worktree.tabs;
  if (first === undefined || second === undefined) throw new Error('tabs missing');
  first.mount();
  second.mount();
  worktree.show();
  worktree.select(second.key);
  first.noteBell();
  expect(first.attention).toBe(true);
  second.noteBell();
  expect(second.attention).toBe(false);
  worktree.select(first.key);
  expect(first.attention).toBe(false);
  owned.stop();
});

test('switching to a tab puts the keyboard in the pane drawn active, not the first pane of its tree', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const worktree = owned.worktree();
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const source = tab.panes.get(tab.active);
  if (source === undefined) throw new Error('no pane to split');
  await tab.split(source, 'row');
  await until(() => tab.count === 2, 'the split raised its pane');
  const [, second] = tab.order;
  if (second === undefined) throw new Error('the split left one pane');
  expect(tab.active).toBe(second);
  await frames(4);

  const stage = stageFor(tab);
  worktree.select(tab.key);
  await frames(4);
  expect(document.activeElement).toBe(stage.helpers.get(second));

  stage.remove();
  owned.stop();
});

test('the IME rebuild after a switch follows the host platform, not the user agent', async () => {
  const mac = await stand([listingFor('e1:0')], { os: 'macos' });
  const onMac = mac.worktree().tabs[0];
  if (onMac === undefined) throw new Error('no tab adopted');
  await frames(4);
  const macStage = stageFor(onMac);
  const macHelper = macStage.helpers.get(onMac.active);
  let macBlurs = 0;
  macHelper?.addEventListener('blur', () => (macBlurs += 1));

  mac.worktree().select(onMac.key);
  await frames(6);
  expect(macBlurs).toBe(1);
  expect(document.activeElement).toBe(macHelper);
  macStage.remove();
  mac.stop();

  const elsewhere = await stand([listingFor('e2:0')]);
  const offMac = elsewhere.worktree().tabs[0];
  if (offMac === undefined) throw new Error('no tab adopted');
  await frames(4);
  const plain = stageFor(offMac);
  const plainHelper = plain.helpers.get(offMac.active);
  let plainBlurs = 0;
  plainHelper?.addEventListener('blur', () => (plainBlurs += 1));

  elsewhere.worktree().select(offMac.key);
  await frames(6);
  expect(plainBlurs).toBe(0);
  expect(document.activeElement).toBe(plainHelper);
  plain.remove();
  elsewhere.stop();
});

test('focus travel collapses an expanded pane before it steps, so the keyboard never lands behind one', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const source = tab.panes.get(tab.active);
  if (source === undefined) throw new Error('no pane to split');
  await tab.split(source, 'row');
  await until(() => tab.count === 2, 'the split raised its pane');
  const [first, second] = tab.order;
  if (first === undefined || second === undefined) throw new Error('the split left one pane');

  tab.expand(second);
  expect(tab.expanded).toBe(second);

  tab.step(1);
  expect(tab.expanded).toBe(null);
  expect(tab.active).toBe(first);
  owned.stop();
});

test('equalising the splits gives the keyboard back to the active pane', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const source = tab.panes.get(tab.active);
  if (source === undefined) throw new Error('no pane to split');
  await tab.split(source, 'row');
  await until(() => tab.count === 2, 'the split raised its pane');

  let focused = 0;
  tab.panes.set(
    tab.active,
    standPane(tab.active, () => (focused += 1)),
  );
  tab.equalise();
  expect(focused).toBe(1);
  owned.stop();
});

test('the search chord toggles the bar, so the chord that opened it closes it again', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  const pane = tab === undefined ? undefined : tab.panes.get(tab.active);
  if (tab === undefined || pane === undefined) throw new Error('no pane adopted');

  tab.perform({ _tag: 'search' }, pane);
  expect(pane.searching).toBe(true);
  tab.perform({ _tag: 'search' }, pane);
  expect(pane.searching).toBe(false);
  owned.stop();
});

test('the toggle chord typed inside a pane hides the place’s panel and shows it again, the shell living on', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const unmount = owned.terminals.mountPanel();
  const tab = owned.worktree().tabs[0];
  const pane = tab === undefined ? undefined : tab.panes.get(tab.active);
  if (tab === undefined || pane === undefined) throw new Error('no pane adopted');

  tab.perform({ _tag: 'toggle-terminals' }, pane);
  expect(owned.terminals.shown).toBe(true);
  tab.perform({ _tag: 'toggle-terminals' }, pane);
  expect(owned.terminals.shown).toBe(false);
  expect(owned.terminals.rootOf('e1:0')).toBe(MAIN);
  expect(owned.stops).toEqual([]);
  tab.perform({ _tag: 'toggle-terminals' }, pane);
  expect(owned.terminals.shown).toBe(true);
  unmount();
  owned.stop();
});

test('a pane activated without the keyboard is drawn active and leaves the engine focus alone', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  let focused = 0;
  tab.panes.set(
    'stand',
    standPane('stand', () => (focused += 1)),
  );

  tab.activate('stand', false);
  expect(tab.active).toBe('stand');
  expect(focused).toBe(0);

  tab.activate('stand');
  expect(focused).toBe(1);
  owned.stop();
});

test('a tab whose active pane cannot serve says so, and an ending outranks it', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  const pane = tab === undefined ? undefined : tab.panes.get(tab.active);
  if (tab === undefined || pane === undefined) throw new Error('no pane adopted');
  expect(tab.status).toBe('live');

  pane.noteProblem('not in control');
  expect(tab.status).toBe('lost');

  pane.ending = { _tag: 'Exited' } as never;
  expect(tab.status).toBe('ended');
  owned.stop();
});

test('a new tab is born at the grid the pane on screen holds, cut to what the floor serves', async () => {
  const owned = await stand([listingFor('e1:0')], { ceiling: { columns: 200, rows: 50 } });
  const worktree = owned.worktree();
  const tab = worktree.tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.panes.set(
    tab.active,
    standPane(tab.active, () => undefined, { cols: 240, rows: 60 }),
  );

  await worktree.open();

  expect(owned.starts.at(-1)?.geometry).toEqual({ columns: 200, rows: 50 });
  owned.stop();
});

test('a place with nothing drawn names no screen at all, and the door births at its own', async () => {
  const owned = await stand([]);

  await owned.worktree().open();

  expect(owned.starts.length).toBe(1);
  expect(owned.starts[0]?.geometry).toBeUndefined();
  owned.stop();
});

test('a split is born at half its source, on the axis the split runs along', async () => {
  const owned = await stand([listingFor('e1:0')]);
  const tab = owned.worktree().tabs[0];
  if (tab === undefined) throw new Error('no tab adopted');
  tab.mount();
  const source = standPane(tab.active, () => undefined, { cols: 200, rows: 50 });
  tab.panes.set(tab.active, source);

  await tab.split(source, 'row');
  await until(() => tab.count === 2, 'the split raised its pane');

  expect(owned.starts.at(-1)?.geometry).toEqual({ columns: 100, rows: 50 });
  owned.stop();
});

test('a start whose reply was lost adopts the shell its key names, and asks for no second one', async () => {
  const owned = await stand([], {
    loseStart: true,
    operationOf: () => ({ _tag: 'Whole', state: { _tag: 'Admitted', key: {}, execution: addressOf('lost:0') } }),
  });

  await owned.worktree().open();

  expect(owned.starts.length).toBe(1);
  expect(owned.worktree().tabs.map((tab) => tab.key)).toEqual(['lost:0']);
  owned.stop();
});

test('a start nobody can answer for is never sent again: the retained key is read back first', async () => {
  const owned = await stand([], {
    loseStart: true,
    operationOf: () => ({ _tag: 'Whole', state: { _tag: 'Uncertain', key: {}, effect: {} } }),
    quiet: true,
  });

  await owned.worktree().open();
  expect(owned.worktree().tabs.length).toBe(0);

  await owned.worktree().open();
  expect(owned.starts.length).toBe(1);
  expect(owned.worktree().tabs.length).toBe(0);
  owned.stop();
});

test('a stop the host took is not reported as a failure because its reply was lost', async () => {
  const owned = await stand([listingFor('e1:0')], {
    loseStop: true,
    operationOf: () => ({ _tag: 'Whole', state: { _tag: 'Settled', key: {} } }),
    quiet: true,
  });
  const worktree = owned.worktree();
  const key = worktree.tabs[0]?.key;
  if (key === undefined) throw new Error('no tab adopted');

  worktree.requestClose(key);
  await until(() => worktree.closing !== null, 'the ask over the running command');
  worktree.confirmClose();
  await until(() => owned.stops.length === 1, 'the stop was sent');
  await new Promise((done) => setTimeout(done, 0));

  expect(owned.said).toEqual([]);
  owned.stop();
});
