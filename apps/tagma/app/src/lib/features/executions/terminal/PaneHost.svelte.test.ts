// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import TerminalPaneHost from './PaneHost.svelte';
import type { TerminalPane } from './Pane.svelte.js';
import type { DroppedPaths } from './fileDrop.js';

class PaneStand {
  readonly id = 'p1';
  label = $state<string | null>(null);
  locating = $state(false);
  searching = $state(false);
  ending = $state<unknown>(null);
  refusal = $state<unknown>(null);
  readonly search = null;
  readonly typable = true;
  readonly typed: string[] = [];
  readonly problems: string[] = [];

  watchPlace(): () => void {
    return () => undefined;
  }
  attach(): void {}
  detach(): void {}
  focus(): void {}
  pastePaths(paths: readonly string[]): void {
    this.typed.push(...paths);
  }
  async pasteDropped(dropped: Promise<DroppedPaths>): Promise<void> {
    const answer = await dropped;
    this.typed.push(...answer.paths);
    this.problems.push(...answer.problems);
  }
  noteProblem(problem: string): void {
    this.problems.push(problem);
  }
  takeFiles(): () => void {
    return () => undefined;
  }
  dismissRefusal(): void {}
}

class StripStand {
  readonly style = {
    activePaneOpacity: 1,
    inactivePaneOpacity: 0.7,
    opacityTransitionMs: 0,
    dividerThicknessPx: 1,
    focusFollowsMouse: false,
    paddingX: 0,
    paddingY: 0,
  };
  readonly activations: { readonly id: string; readonly focus: boolean }[] = [];

  readonly standing = new PaneStand();
  readonly pane = this.standing as unknown as TerminalPane;

  activate(id: string, focus = true): void {
    this.activations.push({ id, focus });
  }
}

let apps: (() => void)[] = [];

afterEach(() => {
  for (const close of apps.splice(0)) close();
  document.body.replaceChildren();
});

function draw(props: ComponentProps<typeof TerminalPaneHost>): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalPaneHost, { target: host, props });
  flushSync();
  apps.push(() => {
    unmount(app);
    host.remove();
  });
  return host;
}

function drawPane(stand: StripStand): HTMLElement {
  return draw({
    pane: stand.pane,
    isMac: true,
    flex: '1 1 0%',
    hidden: false,
    style: stand.style,
    active: true,
    renaming: false,
    dragging: false,
    onActivate: (id: string, focus: boolean) => stand.activate(id, focus),
    onFollowMouse: () => undefined,
    onMenu: () => false,
    onDragStart: () => undefined,
  });
}

function dragging(type: string, types: string[], data: Record<string, string> = {}, files: readonly File[] = []) {
  const transfer = { types, files, dropEffect: 'none', getData: (asked: string) => data[asked] ?? '' };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return { event, transfer };
}

test('a press on the pane takes the keyboard for the engine; a press on a control the pane holds leaves it there', () => {
  const stand = new StripStand();
  const host = drawPane(stand);
  const box = host.querySelector<HTMLElement>('[data-pane-id="p1"]');
  if (box === null) throw new Error('the pane drew no box');

  box.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(stand.activations).toEqual([{ id: 'p1', focus: true }]);

  stand.standing.searching = true;
  flushSync();
  const input = host.querySelector<HTMLElement>('[data-find-search]');
  if (input === null) throw new Error('the open search bar drew no input');
  input.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  expect(stand.activations[1]).toEqual({ id: 'p1', focus: false });
});

test('the whole pane takes a dragged path, and a drag carrying none is left to whatever else wants it', () => {
  const stand = new StripStand();
  const host = drawPane(stand);
  const box = host.querySelector<HTMLElement>('[data-pane-id="p1"]');
  if (box === null) throw new Error('the pane drew no box');

  const carried = dragging('dragover', ['text/uri-list']);
  box.dispatchEvent(carried.event);
  expect(carried.event.defaultPrevented).toBe(true);
  expect(carried.transfer.dropEffect).toBe('copy');

  const foreign = dragging('dragover', ['application/x-pane-drag']);
  box.dispatchEvent(foreign.event);
  expect(foreign.event.defaultPrevented).toBe(false);
  expect(foreign.transfer.dropEffect).toBe('none');
});

test('a path dropped on the pane is typed into that pane, whatever the pane is called', () => {
  const stand = new StripStand();
  const host = drawPane(stand);
  const box = host.querySelector<HTMLElement>('[data-pane-id="p1"]');
  if (box === null) throw new Error('the pane drew no box');

  expect(stand.standing.label).toBe(null);
  const dropped = dragging('drop', ['text/uri-list'], { 'text/uri-list': 'file:///root/a%20b.txt\r\n' });
  box.dispatchEvent(dropped.event);

  expect(dropped.event.defaultPrevented).toBe(true);
  expect(stand.standing.typed).toEqual(['/root/a b.txt']);
  expect(stand.activations.at(-1)).toEqual({ id: 'p1', focus: true });
});

test('files dropped from the system are typed as the paths the mount finds for them, and a file it cannot place is told', async () => {
  const standing = new PaneStand();
  const shot = new File(['png'], 'shot.png', { type: 'image/png' });
  const deck = new File(['pdf'], 'deck.pdf', { type: 'application/pdf' });
  const placed = new Map([[shot, '/Users/ana/Desktop/shot.png']]);
  const host = draw({
    pane: standing as unknown as TerminalPane,
    isMac: true,
    files: async (dropped) => ({
      paths: dropped.flatMap((file) => placed.get(file) ?? []),
      problems: dropped.filter((file) => !placed.has(file)).map((file) => `${file.name} has no path`),
    }),
  });
  const box = host.querySelector<HTMLElement>('[data-pane-id="p1"]');
  if (box === null) throw new Error('the pane drew no box');

  const over = dragging('dragover', ['Files']);
  box.dispatchEvent(over.event);
  expect(over.event.defaultPrevented).toBe(true);

  box.dispatchEvent(dragging('drop', ['Files'], {}, [shot, deck]).event);
  await new Promise((done) => setTimeout(done, 0));

  expect(standing.typed).toEqual(['/Users/ana/Desktop/shot.png']);
  expect(standing.problems).toEqual(['deck.pdf has no path']);
});

test('a mount that passes its own card over the pane takes the ending and leaves the toast', () => {
  const standing = new PaneStand();
  standing.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 3 } };
  standing.refusal = { message: 'the feed was lost' };
  const host = draw({
    pane: standing as unknown as TerminalPane,
    isMac: true,
    overlay: createRawSnippet(() => ({ render: () => '<p data-mount-card>the CLI exited</p>' })),
  });

  expect(host.querySelector('[data-mount-card]')).not.toBe(null);
  expect(host.querySelector('[data-exit-card]')).toBe(null);
  expect(host.querySelector('[data-terminal-toast]')).not.toBe(null);
});

test('a mount that supplies no strip at all still draws its pane and takes a dropped path', () => {
  const standing = new PaneStand();
  const host = draw({ pane: standing as unknown as TerminalPane, isMac: true });
  const box = host.querySelector<HTMLElement>('[data-pane-id="p1"]');
  if (box === null) throw new Error('the pane drew no box');

  expect(box.querySelector('.pane-drag-handle')).toBe(null);

  box.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  box.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));

  const dropped = dragging('drop', ['text/uri-list'], { 'text/uri-list': 'file:///root/a%20b.txt\r\n' });
  box.dispatchEvent(dropped.event);
  expect(dropped.event.defaultPrevented).toBe(true);
  expect(standing.typed).toEqual(['/root/a b.txt']);
});
