// @vitest-environment node

import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Dialogs } from './DialogRegistry.svelte.js';

const DummyComponent = {} as Component<Record<string, unknown>>;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe('Dialogs presence and finalization', () => {
  it('finalizes a close that lands before the host has painted the entry', async () => {
    const dialogs = new Dialogs();
    const handle = dialogs.open(DummyComponent, {});

    let closedWith: unknown = 'never';
    void handle.closed.then((result) => {
      closedWith = result;
    });

    handle.close('dismissed');
    await settle();

    expect(dialogs.stack).toHaveLength(0);
    expect(closedWith).toBe('dismissed');
  });

  it('leaves a presented entry to the host to finalize', async () => {
    const dialogs = new Dialogs();
    const handle = dialogs.open(DummyComponent, {});
    dialogs.markPresented(handle);

    handle.close();
    await settle();
    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.stack[0]?.open).toBe(false);

    dialogs.finalizeClose(handle);
    expect(dialogs.stack).toHaveLength(0);
  });

  it('rejects presented when the entry is closed before it reaches the document', async () => {
    const dialogs = new Dialogs();
    const handle = dialogs.open(DummyComponent, {});

    const outcome = handle.presented.then(
      () => 'presented',
      (error: unknown) => (error as Error).name,
    );

    handle.close();
    await expect(outcome).resolves.toBe('NeverPresented');
  });
});

describe('Dialogs.anyOpen', () => {
  it('reflects whether any tracked root is open', () => {
    const dialogs = new Dialogs();
    const rootId = Symbol('dialog-root');

    expect(dialogs.anyOpen).toBe(false);

    dialogs.trackRoot(rootId, true);
    expect(dialogs.anyOpen).toBe(true);

    dialogs.trackRoot(rootId, false);
    expect(dialogs.anyOpen).toBe(false);
  });

  it('stays open until every tracked root closes', () => {
    const dialogs = new Dialogs();
    const first = Symbol('first');
    const second = Symbol('second');

    dialogs.trackRoot(first, true);
    dialogs.trackRoot(second, true);
    dialogs.trackRoot(first, false);
    expect(dialogs.anyOpen).toBe(true);

    dialogs.untrackRoot(second);
    expect(dialogs.anyOpen).toBe(false);
  });

  it('does not count repeated open updates twice', () => {
    const dialogs = new Dialogs();
    const rootId = Symbol('dialog-root');

    dialogs.trackRoot(rootId, true);
    dialogs.trackRoot(rootId, true);
    dialogs.trackRoot(rootId, false);

    expect(dialogs.anyOpen).toBe(false);
  });
});

describe('Dialogs.anyOpenExcept', () => {
  it('ignores the keys it was told belong to the asker', () => {
    const dialogs = new Dialogs();
    dialogs.trackRoot(Symbol('promo'), true, 'promo');

    expect(dialogs.anyOpen).toBe(true);
    expect(dialogs.anyOpenExcept(new Set(['promo']))).toBe(false);
  });

  it('counts a root written in markup, which carries no key at all', () => {
    const dialogs = new Dialogs();
    dialogs.trackRoot(Symbol('declarative'), true);

    expect(dialogs.anyOpenExcept(new Set(['promo']))).toBe(true);
  });

  it('counts another overlay even while the asker has one of its own on screen', () => {
    const dialogs = new Dialogs();
    dialogs.trackRoot(Symbol('promo'), true, 'promo');
    dialogs.trackRoot(Symbol('profile'), true, 'profile');

    expect(dialogs.anyOpenExcept(new Set(['promo']))).toBe(true);
  });
});

describe('Dialogs: a stack of dialogs', () => {
  it('keeps four dialogs in the order they were opened, and closing the middle one does not disturb it', async () => {
    const dialogs = new Dialogs();
    const opened = ['first', 'second', 'third', 'fourth'].map((name) => dialogs.open(DummyComponent, { name }, { key: name }));

    expect(dialogs.stack.map((entry) => entry.key)).toEqual(['first', 'second', 'third', 'fourth']);
    expect(dialogs.stack.map((entry) => entry.props)).toEqual([
      { name: 'first' },
      { name: 'second' },
      { name: 'third' },
      { name: 'fourth' },
    ]);

    opened.forEach((handle) => dialogs.markPresented(handle));
    opened[1]!.close('gone');
    dialogs.finalizeClose(opened[1]!);
    await settle();

    expect(dialogs.stack.map((entry) => entry.key)).toEqual(['first', 'third', 'fourth']);
    await expect(opened[1]!.closed).resolves.toBe('gone');
  });

  it('shows a key twice when told to twice, because identity belongs to the door', async () => {
    const dialogs = new Dialogs();
    const first = dialogs.open(DummyComponent, { step: 1 }, { key: 'auth' });
    dialogs.markPresented(first);

    const again = dialogs.open(DummyComponent, { step: 2 }, { key: 'auth' });

    expect(dialogs.stack).toHaveLength(2);
    expect(again.id).not.toBe(first.id);
    expect(dialogs.stack.map((entry) => entry.props)).toEqual([{ step: 1 }, { step: 2 }]);

    first.update({ step: 3 });
    expect(dialogs.stack.map((entry) => entry.props)).toEqual([{ step: 3 }, { step: 2 }]);
  });

  it('puts a dialog back on screen when it is asked for again during its own outro', async () => {
    const dialogs = new Dialogs();
    const handle = dialogs.open(DummyComponent, { step: 1 }, { key: 'auth' });
    dialogs.markPresented(handle);

    handle.close('dismissed');
    await settle();
    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.stack[0]!.open).toBe(false);

    expect(handle.reopen()).toBe(true);
    expect(dialogs.stack[0]!.open).toBe(true);

    let settled: unknown = 'still open';
    void handle.closed.then((result) => (settled = result));
    await settle();
    expect(settled).toBe('still open');
  });

  it('refuses to reopen a showing it has already let go', async () => {
    const dialogs = new Dialogs();
    const handle = dialogs.open(DummyComponent, {}, { key: 'auth' });
    dialogs.markPresented(handle);

    handle.close();
    dialogs.finalizeClose(handle);

    expect(dialogs.stack).toHaveLength(0);
    expect(handle.reopen()).toBe(false);
  });

  it('keeps saying a dialog is open while its root is still mounted after the entry closed', async () => {
    const dialogs = new Dialogs();
    const rootId = Symbol('root');
    const handle = dialogs.open(DummyComponent, {}, { key: 'auth' });
    dialogs.markPresented(handle);
    dialogs.trackRoot(rootId, true, 'auth');

    handle.close();
    await settle();

    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.anyOpen).toBe(true);

    dialogs.finalizeClose(handle);
    expect(dialogs.stack).toHaveLength(0);
    expect(dialogs.anyOpen).toBe(true);

    dialogs.trackRoot(rootId, false);
    expect(dialogs.anyOpen).toBe(false);
  });

  it('gives each entry the dismissal rules its own entrance named', async () => {
    const dialogs = new Dialogs();
    dialogs.open(DummyComponent, {}, { key: 'strict', interactOutsideBehavior: 'ignore' });
    dialogs.open(DummyComponent, {}, { key: 'loose', escapeKeydownBehavior: 'close' });

    expect(dialogs.stack[0]!.resolvedInteractOutsideBehavior).toBe('ignore');
    expect(dialogs.stack[1]!.resolvedInteractOutsideBehavior).toBe('close');
    expect(dialogs.stack[1]!.resolvedEscapeKeydownBehavior).toBe('close');
  });

  it('reads a rule that changes while the dialog is up, not the one it opened with', async () => {
    const dialogs = new Dialogs();
    let saving = true;
    dialogs.open(DummyComponent, {}, { key: 'form', interactOutsideBehavior: () => (saving ? 'ignore' : 'close') });

    expect(dialogs.stack[0]!.resolvedInteractOutsideBehavior).toBe('ignore');

    saving = false;
    expect(dialogs.stack[0]!.resolvedInteractOutsideBehavior).toBe('close');
  });
});
