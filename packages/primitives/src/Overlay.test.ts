// @vitest-environment jsdom

import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Layer } from '@runlith/layer/Layer';
import { Visitor } from '@runlith/layer/testing';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flush } from '@runlith/testing/flush';

import { trackRootsLikeTheHost } from './test-utils/host-roots.svelte.js';
import { opener } from './test-utils/opener.svelte.js';
import { watch } from './test-utils/watch.svelte.js';

import { Dialogs } from './DialogRegistry.svelte.js';
import { Launchers } from './Launchers.svelte.js';
import { Overlay, OverlayNotBound } from './Overlay.svelte.js';
import { Profile } from './test-utils/profile.svelte.js';

type PromoProps = { bonus: number };

const PromoView = {} as Component<PromoProps>;
const NoticeView = {} as Component<Record<string, never>>;

const PromoDialog = Overlay.define<PromoProps>()('overlay-test/promo', {
  as: 'dialog',
  dialog: { interactOutsideBehavior: 'ignore' },
});
const Notice = Overlay.define()('overlay-test/notice', { as: 'launcher' });
const Card = Overlay.define()('overlay-test/card', { as: 'dialog' });
const CardView = {} as Component<Record<string, never>>;
const Unbound = Overlay.define()('overlay-test/unbound', { as: 'dialog' });
const Cheer = Overlay.define()('overlay-test/cheer', { as: 'launcher' });
const CheerView = {} as Component<Record<string, never>>;
const Hint = Overlay.define()('overlay-test/hint', { as: 'launcher' });
const HintView = {} as Component<Record<string, never>>;
const Aside = Overlay.define()('overlay-test/aside', { as: 'launcher' });
const AsideView = {} as Component<Record<string, never>>;
const Chunked = Overlay.define()('overlay-test/chunked', { as: 'dialog' });
const ChunkedView = {} as Component<Record<string, never>>;
const Standing = Overlay.define()('overlay-test/standing', { as: 'launcher' });
const StandingView = {} as Component<Record<string, never>>;
const PerVisitor = Overlay.define()('overlay-test/per-visitor', { as: 'launcher', tier: 'visitor' });
const PerVisitorView = {} as Component<Record<string, never>>;
const Panel = Overlay.define()('overlay-test/panel', { as: 'dialog', dialog: { scrim: false } });
const PanelView = {} as Component<Record<string, never>>;
const PanelStep = Overlay.define()('overlay-test/panel-step', { as: 'dialog', dialog: { scrim: false } });
const PanelStepView = {} as Component<Record<string, never>>;

function mount(...extra: Layer<never, never>[]) {
  return mountApp(Layer.mergeAll(Dialogs, Launchers, Overlay, Profile, PromoDialog.present(PromoView), ...extra), Layer.mergeAll(), {
    ladder: [Visitor],
    at: { visitor: Visitor.guest() },
  });
}

describe('Overlay: the key', () => {
  it('carries what was declared and nothing about pixels', () => {
    expect(PromoDialog.id).toBe('overlay-test/promo');
    expect(PromoDialog.as).toBe('dialog');
    expect(Overlay.declared).toContain(PromoDialog);
    expect(Overlay.declared).toContain(Unbound);
  });
});

describe('Overlay: the door', () => {
  it('opens through the transport the key names, addressed by the key itself', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    overlay.open(PromoDialog, { bonus: 1 });

    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.stack[0]!.key).toBe('overlay-test/promo');
    expect(dialogs.stack[0]!.props).toEqual({ bonus: 1 });

    await app.unmount();
  });

  it('carries the transport settings the key declared, not ones the caller passed', async () => {
    const app = mount();
    app.get(Overlay).open(PromoDialog, { bonus: 1 });

    expect(app.get(Dialogs).stack[0]!.resolvedInteractOutsideBehavior).toBe('ignore');

    await app.unmount();
  });

  it('answers a repeat open with one showing and fresh props', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    const first = overlay.open(PromoDialog, { bonus: 1 });
    const again = overlay.open(PromoDialog, { bonus: 2 });

    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.stack[0]!.props).toEqual({ bonus: 2 });
    expect(again.closed).toBe(first.closed);

    await app.unmount();
  });

  it('refuses a key this manifest never bound', async () => {
    const app = mount();

    expect(() => app.get(Overlay).open(Unbound, {})).toThrow(OverlayNotBound);

    await app.unmount();
  });

  it('stops waiting when the opener’s scope closes', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const scope = app.app.scopeOf('visitor').child('opener');

    const handle = overlay.open(PromoDialog, { bonus: 1 }, { scope });
    const settled = handle.closed.then(
      () => 'resolved',
      (error: unknown) => (error as Error).name,
    );

    await scope.close();
    await expect(settled).resolves.toBe('ScopeAbort');

    await app.unmount();
  });

  it('ends a overlay addressed by its key, for a view that holds no handle', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    const handle = overlay.open(PromoDialog, { bonus: 1 });
    dialogs.markPresented(dialogs.stack[0]!.handle);
    overlay.close(PromoDialog, 'by-key');
    dialogs.finalizeClose(dialogs.stack[0]!.handle);

    await expect(handle.closed).resolves.toBe('by-key');

    await app.unmount();
  });
});

describe('Overlay: the policy a brand binds', () => {
  it('takes its dependencies from the graph and arbitrates on their facts', async () => {
    const app = mount(
      Notice.present(NoticeView, function* () {
        const profile = yield* Profile;
        return { priority: 1, blockedBy: [profile.open] };
      }),
    );
    const overlay = app.get(Overlay);
    const launchers = app.get(Launchers);

    app.get(Profile).isOpen = true;
    overlay.open(Notice, {});
    expect(launchers.elements).toHaveLength(0);
    expect(overlay.stateOf(Notice.id)).toBe('queued');

    app.get(Profile).isOpen = false;
    await Promise.resolve();
    expect(overlay.stateOf(Notice.id)).toBe('active');
    expect(launchers.elements).toHaveLength(1);

    await app.unmount();
  });

  it('carries a panel with no dim straight from the key', async () => {
    const app = mount(Panel.present(PanelView));
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    overlay.open(Panel, {});

    const entry = dialogs.stack.at(-1);
    expect(entry?.scrim).toBe(false);

    await app.unmount();
  });

  it('takes a step inside a showing with it: the parent leaving ends the step, and neither waits for the other', async () => {
    const app = mount(Panel.present(PanelView), PanelStep.present(PanelStepView));
    const overlay = app.get(Overlay);

    overlay.open(Panel, {});
    overlay.open(PanelStep, {}, { within: Panel });

    expect(overlay.stateOf(Panel.id)).toBe('active');
    expect(overlay.stateOf(PanelStep.id)).toBe('active');

    overlay.close(Panel);
    expect(overlay.stateOf(Panel.id)).toBe('closing');
    expect(overlay.stateOf(PanelStep.id)).toBe('closing');

    await app.unmount();
  });

  it('opens a overlay with no policy at once, whatever else is on screen', async () => {
    const app = mount(Notice.present(NoticeView));
    const overlay = app.get(Overlay);

    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});

    expect(overlay.stateOf(Notice.id)).toBe('active');
    expect(app.get(Launchers).elements).toHaveLength(1);

    await app.unmount();
  });
});

describe('Overlay: the condition the transport owns', () => {
  it('counts a dialog somebody else opened and subtracts its own', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    expect(overlay.foreignDialogOpen.current).toBe(false);

    dialogs.trackRoot(Symbol('markup'), true);
    expect(overlay.foreignDialogOpen.current).toBe(true);

    await app.unmount();
  });

  it('signs its facts with the owner and the field they sit on', async () => {
    const app = mount();

    expect(app.get(Overlay).foreignDialogOpen.name).toBe('Overlay.foreignDialogOpen');
    expect(app.get(Profile).open.name).toBe('Profile.open');

    await app.unmount();
  });
});

describe('Overlay: what a reader sees', () => {
  it('never calls its own arbitrated dialog foreign, not even for the outro it takes to leave', async () => {
    const app = mount(
      Card.present(CardView, () => ({ priority: 5 })),
      Notice.present(NoticeView, function* () {
        const overlay = yield* Overlay;
        return { priority: 1, blockedBy: [overlay.foreignDialogOpen] };
      }),
    );
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);
    const host = trackRootsLikeTheHost(dialogs);
    const foreign = watch(() => overlay.foreignDialogOpen.current);

    overlay.open(Notice, {});
    overlay.open(Card, {});
    await flush();

    dialogs.markPresented(dialogs.stack[0]!.handle);
    overlay.close(Card);
    dialogs.finalizeClose(dialogs.stack[0]!.handle);
    await flush();
    await flush();

    expect(foreign.seen).toEqual([false]);
    expect(overlay.stateOf(Notice.id)).toBe('active');

    foreign.stop();
    host.stop();
    await app.unmount();
  });

  it('settles a policy that reads what is on screen', async () => {
    const app = mount(
      Notice.present(NoticeView, function* () {
        const overlay = yield* Overlay;
        return { priority: 1, blockedBy: [overlay.anyOf(PromoDialog)] };
      }),
    );
    const overlay = app.get(Overlay);

    overlay.open(Notice, {});
    await flush();

    overlay.open(PromoDialog, { bonus: 1 });
    await flush();

    overlay.close(PromoDialog);
    await flush();

    expect(overlay.stateOf(Notice.id)).toBe('active');

    await app.unmount();
  });

  it('wakes a reader when a overlay reaches the screen and when it leaves', async () => {
    const app = mount();
    const overlay = app.get(Overlay);

    const watcher = watch(() => overlay.stateOf(PromoDialog.id));
    await flush();

    overlay.open(PromoDialog, { bonus: 1 });
    await flush();

    overlay.close(PromoDialog);
    await flush();

    expect(watcher.seen).toEqual([undefined, 'active', 'closing', undefined]);

    watcher.stop();
    await app.unmount();
  });

  it('reports the queue as plain data, ready for devtools, the e2e bridge and an MCP verb', async () => {
    const app = mount(
      Notice.present(NoticeView, function* () {
        const profile = yield* Profile;
        return { priority: 4, blockedBy: [profile.open] };
      }),
    );
    const overlay = app.get(Overlay);

    app.get(Profile).isOpen = true;
    overlay.open(Notice, {});

    const report = overlay.snapshot();
    expect(report.overlays).toEqual([
      expect.objectContaining({
        id: 'overlay-test/notice',
        as: 'launcher',
        state: 'queued',
        priority: 4,
        blockedBy: [expect.objectContaining({ name: 'Profile.open', current: true })],
      }),
    ]);

    await app.unmount();
  });
});

describe('Overlay: a crowded screen through the one door', () => {
  it('carries both transports at once, each overlay named only by its key', async () => {
    const app = mount(Notice.present(NoticeView), Cheer.present(CheerView), Hint.present(HintView));
    const overlay = app.get(Overlay);

    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});
    overlay.open(Cheer, {});
    overlay.open(Hint, {});
    await flush();

    expect(app.get(Dialogs).stack.map((entry) => entry.key)).toEqual(['overlay-test/promo']);
    expect(app.get(Launchers).elements.map((entry) => entry.key)).toEqual([
      'overlay-test/notice',
      'overlay-test/cheer',
      'overlay-test/hint',
    ]);
    expect([Cheer, Hint, Notice, PromoDialog].every((key) => overlay.isOpen(key))).toBe(true);

    await app.unmount();
  });

  it('refreshes only the overlay that was asked for again', async () => {
    const app = mount(Notice.present(NoticeView), Cheer.present(CheerView));
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);
    const launchers = app.get(Launchers);

    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});
    overlay.open(Cheer, {});
    await flush();

    overlay.open(PromoDialog, { bonus: 7 });
    await flush();

    expect(dialogs.stack).toHaveLength(1);
    expect(dialogs.stack[0]!.props).toEqual({ bonus: 7 });
    expect(launchers.elements).toHaveLength(2);

    await app.unmount();
  });

  it('answers for the whole life of a request, from the ask to the last frame of the outro', async () => {
    const app = mount();
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    expect(overlay.isOpen(PromoDialog)).toBe(false);

    overlay.open(PromoDialog, { bonus: 1 });
    expect(overlay.isOpen(PromoDialog)).toBe(true);

    dialogs.markPresented(dialogs.stack[0]!.handle);
    overlay.close(PromoDialog);
    expect(overlay.isOpen(PromoDialog)).toBe(true);

    dialogs.finalizeClose(dialogs.stack[0]!.handle);
    await flush();
    expect(overlay.isOpen(PromoDialog)).toBe(false);

    await app.unmount();
  });

  it('answers one fact for three keys, and only falls when the last of them has gone', async () => {
    const app = mount(Notice.present(NoticeView), Aside.present(AsideView));
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);
    const anyOfThem = overlay.anyOf(PromoDialog, Notice, Aside);

    expect(anyOfThem.current).toBe(false);

    overlay.open(Notice, {});
    await flush();
    expect(anyOfThem.current).toBe(true);

    overlay.open(PromoDialog, { bonus: 1 });
    await flush();
    overlay.close(Notice);
    await flush();
    expect(anyOfThem.current).toBe(true);

    dialogs.markPresented(dialogs.stack[0]!.handle);
    overlay.close(PromoDialog);
    dialogs.finalizeClose(dialogs.stack[0]!.handle);
    await flush();
    expect(anyOfThem.current).toBe(false);

    await app.unmount();
  });

  it('stops waiting only for the opener that left, never for the one still there', async () => {
    const app = mount(Notice.present(NoticeView), Cheer.present(CheerView));
    const overlay = app.get(Overlay);
    const leaving = app.app.scopeOf('visitor').child('leaving');
    const staying = app.app.scopeOf('visitor').child('staying');

    const abandoned = overlay.open(Notice, {}, { scope: leaving });
    const kept = overlay.open(Cheer, {}, { scope: staying });
    await flush();

    const abandonedEnd = abandoned.closed.then(
      () => 'resolved',
      (error: unknown) => (error as Error).name,
    );
    let keptSettled = false;
    void kept.closed.then(
      () => (keptSettled = true),
      () => undefined,
    );

    await leaving.close();
    await flush();

    await expect(abandonedEnd).resolves.toBe('ScopeAbort');
    expect(keptSettled).toBe(false);
    expect(overlay.isOpen(Cheer)).toBe(true);

    await staying.close();
    await app.unmount();
  });

  it('delivers each closing answer to the handle it belongs to', async () => {
    const app = mount(Notice.present(NoticeView), Aside.present(AsideView));
    const overlay = app.get(Overlay);
    const dialogs = app.get(Dialogs);

    const promo = overlay.open(PromoDialog, { bonus: 1 });
    const notice = overlay.open(Notice, {});
    const aside = overlay.open(Aside, {});
    await flush();

    dialogs.markPresented(dialogs.stack[0]!.handle);
    overlay.close(PromoDialog, 'promo-answer');
    dialogs.finalizeClose(dialogs.stack[0]!.handle);
    overlay.close(Notice, 'notice-answer');
    overlay.close(Aside, 'aside-answer');

    await expect(promo.closed).resolves.toBe('promo-answer');
    await expect(notice.closed).resolves.toBe('notice-answer');
    await expect(aside.closed).resolves.toBe('aside-answer');

    await app.unmount();
  });

  it('lets the overlays that are already here through while one view is still being fetched', async () => {
    let arrive: (module: { default: Component<Record<string, never>> }) => void = () => undefined;
    const app = mount(
      Notice.present(NoticeView),
      Cheer.present(CheerView),
      Chunked.presentLazy(() => new Promise((resolve) => (arrive = resolve))),
    );
    const overlay = app.get(Overlay);

    overlay.open(Chunked, {});
    overlay.open(Notice, {});
    overlay.open(Cheer, {});
    await flush();

    expect(overlay.stateOf(Chunked.id)).toBe('queued');
    expect(overlay.stateOf(Notice.id)).toBe('active');
    expect(overlay.stateOf(Cheer.id)).toBe('active');

    arrive({ default: ChunkedView });
    await flush();

    expect(overlay.stateOf(Chunked.id)).toBe('active');
    expect(overlay.stateOf(Notice.id)).toBe('active');

    await app.unmount();
  });

  it('empties every transport at the session boundary, waiting requests included', async () => {
    const app = mount(
      Notice.present(NoticeView),
      Aside.present(AsideView),
      Chunked.presentLazy(() => new Promise(() => undefined)),
    );
    const overlay = app.get(Overlay);

    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});
    overlay.open(Aside, {});
    overlay.open(Chunked, {});
    await flush();

    overlay.closeAll();
    await flush();

    expect([PromoDialog, Notice, Aside, Chunked].some((key) => overlay.isOpen(key))).toBe(false);
    expect(app.get(Launchers).elements).toHaveLength(0);

    await app.unmount();
  });

  it('takes the leaving rung’s own overlays off the screen and leaves the app’s standing', async () => {
    const app = mount(Standing.present(StandingView), PerVisitor.present(PerVisitorView));
    const overlay = app.get(Overlay);

    overlay.open(Standing, {});
    overlay.open(PerVisitor, {});
    await flush();

    expect(overlay.isOpen(Standing)).toBe(true);
    expect(overlay.isOpen(PerVisitor)).toBe(true);

    app.place('visitor', Visitor.user('7'));
    await flush();

    expect(overlay.isOpen(PerVisitor)).toBe(false);
    expect(overlay.isOpen(Standing)).toBe(true);

    await app.unmount();
  });

  it('passes over a dialog opened straight through the transport', async () => {
    const app = mount();
    const dialogs = app.get(Dialogs);

    dialogs.open(CardView, {});
    await flush();

    app.place('visitor', Visitor.user('7'));
    await flush();

    expect(dialogs.stack).toHaveLength(1);

    await app.unmount();
  });

  it('ends only the request whose binding left, and leaves the rest of the screen standing', async () => {
    const app = mount(Notice.present(NoticeView), Cheer.present(CheerView));
    const overlay = app.get(Overlay);

    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});
    overlay.open(Cheer, {});
    await flush();

    const binding = { load: undefined, policy: undefined, view: NoticeView } as never;
    overlay.unbind(Notice.id, binding);
    expect(overlay.isOpen(Notice)).toBe(true);

    await app.unmount();
  });

  it('offers only the overlays this manifest can actually raise', async () => {
    const app = mount(Notice.present(NoticeView));
    const overlay = app.get(Overlay);

    const offered = overlay.declaredHere().map((key) => key.id);

    expect(offered).toContain('overlay-test/promo');
    expect(offered).toContain('overlay-test/notice');
    expect(offered).not.toContain('overlay-test/unbound');
    expect(overlay.binds(PromoDialog.id)).toBe(true);
    expect(overlay.binds(Unbound.id)).toBe(false);

    await app.unmount();
  });

  it('reports a crowded screen overlay by overlay, with the transport each one rides', async () => {
    const app = mount(
      Notice.present(NoticeView, function* () {
        const profile = yield* Profile;
        return { priority: 2, blockedBy: [profile.open] };
      }),
      Cheer.present(CheerView),
    );
    const overlay = app.get(Overlay);

    app.get(Profile).isOpen = true;
    overlay.open(PromoDialog, { bonus: 1 });
    overlay.open(Notice, {});
    overlay.open(Cheer, {});
    await flush();

    const report = overlay.snapshot();
    const byId = Object.fromEntries(report.overlays.map((entry) => [entry.id, entry]));

    expect(Object.keys(byId).sort()).toEqual(['overlay-test/cheer', 'overlay-test/notice', 'overlay-test/promo']);
    expect(byId['overlay-test/notice']).toMatchObject({ as: 'launcher', state: 'queued', arbitrated: true });
    expect(byId['overlay-test/promo']).toMatchObject({ as: 'dialog', state: 'active', arbitrated: false });
    expect(byId['overlay-test/cheer']).toMatchObject({ as: 'launcher', state: 'active' });

    await app.unmount();
  });

  it('reports a view that never arrives and leaves the rest of the screen alone', async () => {
    const failures: unknown[] = [];
    let refuse: (reason: unknown) => void = () => undefined;
    const app = mountApp(
      Layer.mergeAll(
        Dialogs,
        Launchers,
        Overlay,
        Profile,
        PromoDialog.present(PromoView),
        Notice.present(NoticeView),
        Chunked.presentLazy(() => new Promise((_resolve, reject) => (refuse = reject))),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, onFailure: (reason) => failures.push(reason) },
    );
    const overlay = app.get(Overlay);

    overlay.open(Notice, {});
    const broken = overlay.open(Chunked, {});
    broken.closed.catch(() => undefined);
    broken.presented.catch(() => undefined);
    await flush();

    refuse(new Error('no chunk'));
    await flush();

    expect(failures).toHaveLength(1);
    expect(overlay.isOpen(Chunked)).toBe(false);
    expect(overlay.isOpen(Notice)).toBe(true);

    await app.unmount();
  });
});

describe('Overlay: an opener that asks from inside its own effect', () => {
  it('answers an opener that asks on every run, once, instead of feeding its bookkeeping back', async () => {
    const app = mount(Cheer.present(CheerView, () => ({ priority: 1 })));
    const overlay = app.get(Overlay);

    const job = opener(() => overlay.open(Cheer, {}));
    await flush();
    job.settle();

    expect(job.failure).toBeUndefined();
    expect(job.runs).toBe(1);
    expect(overlay.stateOf(Cheer.id)).toBe('active');

    job.stop();
    await app.unmount();
  });

  it('keeps another overlay’s blocker out of the opener’s dependencies', async () => {
    const app = mount(
      Cheer.present(CheerView, () => ({ priority: 1 })),
      Notice.present(NoticeView, function* () {
        const profile = yield* Profile;
        return { priority: 2, blockedBy: [profile.open] };
      }),
    );
    const overlay = app.get(Overlay);

    app.get(Profile).isOpen = true;
    overlay.open(Notice, {});
    await flush();

    let asked = 0;
    const job = opener(() => {
      if (asked > 0) return;
      asked += 1;
      overlay.open(Cheer, {});
    });
    await flush();

    app.get(Profile).isOpen = false;
    await flush();
    job.settle();

    expect(job.failure).toBeUndefined();
    expect(job.runs).toBe(1);
    expect(overlay.stateOf(Notice.id)).toBe('active');
    expect(overlay.stateOf(Cheer.id)).toBe('active');

    job.stop();
    await app.unmount();
  });
});
