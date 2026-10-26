// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Condition, type Fact } from '@runlith/layer/condition';
import { Scope } from '@runlith/layer/Scope';

import { specOf, type OverlayAs, type OverlayPolicy } from './overlay-policy.js';
import { OverlayQueue, type Materialized } from './OverlayQueue.svelte.js';
import { createOverlaySignals } from './overlay-signals.js';

function transport() {
  const showings: { present: () => void; end: (result?: unknown) => void; closedByQueue: boolean }[] = [];

  const materialize = (): Materialized => {
    const signals = createOverlaySignals<unknown>();
    const showing = {
      present: () => signals.present(),
      end: (result?: unknown) => signals.end(result),
      closedByQueue: false,
    };
    showings.push(showing);

    return {
      close: (result?: unknown) => {
        showing.closedByQueue = true;
        signals.end(result);
      },
      presented: signals.presented,
      closed: signals.closed,
    };
  };

  return { showings, materialize, count: () => showings.length };
}

function flag(initial = false): { fact: Fact; set: (value: boolean) => void } {
  let raised = initial;
  return { fact: Condition.of(() => raised), set: (value) => (raised = value) };
}

function queue(): { queue: OverlayQueue; scope: Scope; failures: unknown[] } {
  const scope = Scope.make();
  const failures: unknown[] = [];
  return { queue: new OverlayQueue(scope, (reason) => failures.push(reason)), scope, failures };
}

function request(id: string, as: OverlayAs, policy: OverlayPolicy | undefined) {
  const tr = transport();
  return { tr, spec: specOf(id, as, policy), materialize: tr.materialize };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function scene() {
  const { queue: q, scope, failures } = queue();
  type Part = ReturnType<typeof request> & { prepare?: () => Promise<void> };
  const parts = new Map<string, { part: Part; as: OverlayAs }>();

  const partOf = (id: string) => {
    const found = parts.get(id);
    if (!found) throw new Error(`scene: nothing named ${id}`);
    return found;
  };

  const scene = {
    q,
    scope,
    failures,
    add(id: string, as: OverlayAs, policy?: OverlayPolicy, prepare?: () => Promise<void>) {
      const part = request(id, as, policy);
      parts.set(id, { part: prepare ? { ...part, prepare } : part, as });
      return scene;
    },
    open(...ids: readonly string[]) {
      for (const id of ids) q.open(partOf(id).part);
      return scene;
    },
    present(id: string) {
      partOf(id).part.tr.showings.at(-1)?.present();
      return scene;
    },
    dismiss(id: string, result?: unknown) {
      partOf(id).part.tr.showings.at(-1)?.end(result);
      return scene;
    },
    showings: (id: string) => partOf(id).part.tr.count(),
    screen: () => [...parts.keys()].filter((id) => q.stateOf(id) === 'active').sort(),
    states: () => Object.fromEntries([...parts.keys()].map((id) => [id, q.stateOf(id)])),
    crowded() {
      return [...parts.entries()].filter(([id, { as }]) => as === 'dialog' && q.stateOf(id) === 'active').length > 1;
    },
  };

  return scene;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlayQueue: what reaches the screen', () => {
  it('raises a overlay without a policy at once and weighs it against nothing', () => {
    const { queue: q } = queue();
    const first = request('search', 'dialog', undefined);
    const second = request('profile', 'dialog', undefined);

    q.open(first);
    q.open(second);

    expect(first.tr.count()).toBe(1);
    expect(second.tr.count()).toBe(1);
    expect(q.stateOf('search')).toBe('active');
    expect(q.stateOf('profile')).toBe('active');
  });

  it('makes a policy wait for a overlay the visitor opened, never push it aside', async () => {
    const { queue: q } = queue();
    const pressed = request('search', 'dialog', undefined);
    const ambient = request('promo', 'dialog', { priority: 3 });

    q.open(pressed);
    pressed.tr.showings[0]!.present();
    q.open(ambient);

    expect(q.stateOf('search')).toBe('active');
    expect(q.stateOf('promo')).toBe('queued');
    expect(ambient.tr.count()).toBe(0);

    pressed.tr.showings[0]!.end();
    await settle();
    expect(q.stateOf('promo')).toBe('active');
  });

  it('takes the screen from an ambient overlay when the visitor opens one of their own', async () => {
    const { queue: q } = queue();
    const ambient = request('promo', 'dialog', { priority: 3 });
    const pressed = request('search', 'dialog', undefined);

    q.open(ambient);
    ambient.tr.showings[0]!.present();
    expect(q.stateOf('promo')).toBe('active');

    q.open(pressed);

    expect(q.stateOf('search')).toBe('active');
    expect(ambient.tr.showings[0]!.closedByQueue).toBe(true);

    await settle();
    expect(q.stateOf('promo')).toBe('suspended');
  });

  it('leaves an ambient overlay of another kind where it is', () => {
    const { queue: q } = queue();
    const ambient = request('notice', 'launcher', { priority: 1 });
    const pressed = request('search', 'dialog', undefined);

    q.open(ambient);
    ambient.tr.showings[0]!.present();
    q.open(pressed);

    expect(q.stateOf('notice')).toBe('active');
    expect(q.stateOf('search')).toBe('active');
    expect(ambient.tr.showings[0]!.closedByQueue).toBe(false);
  });

  it('brings an unarbitrated overlay back when it is reopened during its own outro', async () => {
    const { queue: q } = queue();
    const search = request('search', 'dialog', undefined);

    q.open(search);
    search.tr.showings[0]!.present();

    q.close('search');
    expect(q.stateOf('search')).toBe('closing');

    q.open(search);
    search.tr.showings[0]!.end();
    await settle();

    expect(q.stateOf('search')).toBe('active');
    expect(search.tr.count()).toBe(2);
  });

  it('answers a repeat open with the same handle and one showing', () => {
    const { queue: q } = queue();
    const promo = request('promo', 'dialog', { priority: 1 });

    const first = q.open(promo);
    const again = q.open(promo);

    expect(promo.tr.count()).toBe(1);
    expect(again.closed).toBe(first.closed);
  });

  it('lets the higher priority through and holds the lower one behind it', async () => {
    const { queue: q } = queue();
    const low = request('low', 'dialog', { priority: 1 });
    const high = request('high', 'dialog', { priority: 5 });

    q.open(low);
    expect(q.stateOf('low')).toBe('active');

    q.open(high);
    expect(q.stateOf('low')).toBe('closing');
    expect(high.tr.count()).toBe(0);

    await settle();
    expect(q.stateOf('high')).toBe('active');
    expect(q.stateOf('low')).toBe('suspended');
    expect(high.tr.count()).toBe(1);
  });

  it('brings a suspended overlay back when the screen frees up', async () => {
    const { queue: q } = queue();
    const low = request('low', 'dialog', { priority: 1, unblockDelayMs: 0 });
    const high = request('high', 'dialog', { priority: 5 });

    q.open(low);
    q.open(high);
    await settle();

    high.tr.showings[0]!.present();
    high.tr.showings[0]!.end('closed-by-visitor');
    await settle();

    expect(q.stateOf('high')).toBeUndefined();
    expect(q.stateOf('low')).toBe('active');
    expect(low.tr.count()).toBe(2);
  });
});

describe('OverlayQueue: blockedBy takes the screen back, heldBy never does', () => {
  it('suspends what is on screen when a blocker comes up, and returns it when it falls', async () => {
    vi.useFakeTimers();
    const { queue: q } = queue();
    const profileOpen = flag();
    const promo = request('promo', 'dialog', { priority: 1, blockedBy: [profileOpen.fact] });

    q.open(promo);
    promo.tr.showings[0]!.present();
    expect(q.stateOf('promo')).toBe('active');

    profileOpen.set(true);
    q.pass();
    await settle();
    expect(q.stateOf('promo')).toBe('suspended');
    expect(promo.tr.showings[0]!.closedByQueue).toBe(true);

    profileOpen.set(false);
    q.pass();
    expect(q.stateOf('promo')).toBe('suspended');

    await vi.advanceTimersByTimeAsync(500);
    expect(q.stateOf('promo')).toBe('active');
    expect(promo.tr.count()).toBe(2);
  });

  it('gives a launcher no unblock pause, because no gesture of the visitor’s closes one', async () => {
    const { queue: q } = queue();
    const blocked = flag(true);
    const launcher = request('launcher', 'launcher', { priority: 1, blockedBy: [blocked.fact] });

    q.open(launcher);
    blocked.set(false);
    q.pass();

    expect(q.stateOf('launcher')).toBe('active');
  });

  it('leaves an active overlay alone when a hold comes up, and only stops a waiting one', async () => {
    const { queue: q } = queue();
    const held = flag();
    const promo = request('promo', 'dialog', { priority: 1, heldBy: [held.fact] });
    const later = request('later', 'dialog', { priority: 1, heldBy: [held.fact] });

    q.open(promo);
    promo.tr.showings[0]!.present();
    held.set(true);
    q.pass();
    await settle();

    expect(q.stateOf('promo')).toBe('active');

    q.open(later);
    expect(q.stateOf('later')).toBe('queued');

    held.set(false);
    promo.tr.showings[0]!.end();
    await settle();
    expect(q.stateOf('later')).toBe('active');
  });

  it('keeps an active overlay through a repeat open while a hold is up', async () => {
    const { queue: q } = queue();
    const held = flag();
    const promo = request('promo', 'dialog', { priority: 1, heldBy: [held.fact] });

    q.open(promo);
    promo.tr.showings[0]!.present();
    held.set(true);
    q.open(promo);
    await settle();

    expect(q.stateOf('promo')).toBe('active');
    expect(promo.tr.showings[0]!.closedByQueue).toBe(false);
  });

  it('waits out the unblock pause before showing again, so the visitor’s own gesture does not raise it', async () => {
    vi.useFakeTimers();
    const { queue: q } = queue();
    const blocked = flag(true);
    const promo = request('promo', 'dialog', { priority: 1, blockedBy: [blocked.fact], unblockDelayMs: 500 });

    q.open(promo);
    expect(q.stateOf('promo')).toBe('queued');

    blocked.set(false);
    q.pass();
    expect(q.stateOf('promo')).toBe('queued');

    await vi.advanceTimersByTimeAsync(500);
    expect(q.stateOf('promo')).toBe('active');
  });
});

describe('OverlayQueue: a showing that never happened is not a close', () => {
  it('rejects presented and resolves closed when a waiting overlay is dismissed', async () => {
    const { queue: q } = queue();
    const blocked = flag(true);
    const promo = request('promo', 'dialog', { priority: 1, blockedBy: [blocked.fact] });

    const handle = q.open(promo);
    const shown = handle.presented.then(
      () => 'presented',
      (error: unknown) => (error as Error).name,
    );

    handle.close('gone');

    await expect(shown).resolves.toBe('NeverPresented');
    await expect(handle.closed).resolves.toBe('gone');
    expect(promo.tr.count()).toBe(0);
  });

  it('rejects both signals when the chunk never arrives, so nothing counts as closed', async () => {
    const { queue: q } = queue();
    const failure = new Error('chunk 404');
    const promo = {
      ...request('promo', 'dialog', { priority: 1 }),
      prepare: () => Promise.reject(failure),
    };

    const handle = q.open(promo);
    await expect(handle.closed).rejects.toBe(failure);
    await expect(handle.presented).rejects.toBe(failure);
    expect(promo.tr.count()).toBe(0);
  });
});

describe('OverlayQueue: a pending chunk holds its lane and lets the rest through', () => {
  it('keeps a conflicting candidate waiting while the stronger one is still loading', async () => {
    const { queue: q } = queue();
    let arrive = (): void => undefined;
    const strong = {
      ...request('strong', 'dialog', { priority: 5 }),
      prepare: () => new Promise<void>((resolve) => (arrive = resolve)),
    };
    const weak = request('weak', 'dialog', { priority: 1 });

    q.open(strong);
    q.open(weak);
    await settle();

    expect(q.stateOf('strong')).toBe('queued');
    expect(q.stateOf('weak')).toBe('queued');
    expect(weak.tr.count()).toBe(0);

    arrive();
    await settle();
    expect(q.stateOf('strong')).toBe('active');
  });

  it('lets an independent transport through while the chunk is in flight', async () => {
    const { queue: q } = queue();
    const strong = {
      ...request('strong', 'dialog', { priority: 5 }),
      prepare: () => new Promise<void>(() => undefined),
    };
    const launcher = request('launcher', 'launcher', { priority: 1 });

    q.open(strong);
    q.open(launcher);
    await settle();

    expect(q.stateOf('launcher')).toBe('active');
    expect(launcher.tr.count()).toBe(1);
  });
});

describe('OverlayQueue: neighbourhood', () => {
  it('lets two kinds share the screen', () => {
    const { queue: q } = queue();
    const dialog = request('dialog', 'dialog', { priority: 1 });
    const launcher = request('launcher', 'launcher', { priority: 1 });

    q.open(dialog);
    q.open(launcher);

    expect(q.stateOf('dialog')).toBe('active');
    expect(q.stateOf('launcher')).toBe('active');
  });

  it('reads a matcher only while its condition holds, which is how one policy serves both screen widths', async () => {
    const narrow = flag(false);
    const secondary: OverlayPolicy = { priority: 1, tags: ['secondary'] };
    const primary: OverlayPolicy = { priority: 2, suspends: [{ tags: ['secondary'], when: narrow.fact }] };

    const wide = queue().queue;
    const wideAside = request('aside', 'launcher', secondary);
    wide.open(wideAside);
    wideAside.tr.showings[0]!.present();
    wide.open(request('dialog', 'dialog', primary));
    await settle();
    expect(wide.stateOf('aside')).toBe('active');

    narrow.set(true);
    const tight = queue().queue;
    const tightAside = request('aside', 'launcher', secondary);
    tight.open(tightAside);
    tightAside.tr.showings[0]!.present();
    tight.open(request('dialog', 'dialog', primary));
    await settle();
    expect(tight.stateOf('aside')).toBe('suspended');
  });

  it('honours an explicit permission to coexist between two of a kind', () => {
    const { queue: q } = queue();
    const stackable: OverlayPolicy = { priority: 1, tags: ['stackable'], allowCoexistWith: [{ tags: ['stackable'] }] };

    q.open(request('one', 'dialog', stackable));
    q.open(request('two', 'dialog', stackable));

    expect(q.stateOf('one')).toBe('active');
    expect(q.stateOf('two')).toBe('active');
  });
});

describe('OverlayQueue: what a reader sees', () => {
  it('reports every overlay with the names the app signed onto the owners’ fields', () => {
    class Profile {
      isOpen = true;
      readonly open = Condition.of(() => this.isOpen);
    }

    const profile = new Profile();
    const { queue: q } = queue();
    q.open(request('promo', 'dialog', { priority: 3, blockedBy: [profile.open] }));

    const report = q.report();
    expect(report.overlays).toHaveLength(1);
    expect(report.overlays[0]).toMatchObject({
      id: 'promo',
      as: 'dialog',
      state: 'queued',
      arbitrated: true,
      priority: 3,
    });
    expect(report.overlays[0]!.blockedBy[0]!.current).toBe(true);
  });

  it('names the arbitrated overlays on screen, and leaves the waiting and the policyless ones out', () => {
    const { queue: q } = queue();
    const blocked = flag(true);

    q.open(request('shown', 'dialog', { priority: 1 }));
    q.open(request('waiting', 'launcher', { priority: 1, blockedBy: [blocked.fact] }));
    q.open(request('policyless', 'launcher', undefined));

    expect(q.stateOf('policyless')).toBe('active');
    expect([...q.onScreen]).toEqual(['shown']);
  });
});

describe('OverlayQueue: a latch books its own wake-up', () => {
  it('promotes on its own once a held condition stops holding', async () => {
    vi.useFakeTimers();
    const { queue: q } = queue();
    let selectOpen = true;
    const settled = Condition.latch(() => selectOpen, 220);
    const launcher = request('launcher', 'launcher', { priority: 1, blockedBy: [settled] });

    q.open(launcher);
    expect(q.stateOf('launcher')).toBe('queued');

    selectOpen = false;
    q.pass();
    expect(q.stateOf('launcher')).toBe('queued');

    await vi.advanceTimersByTimeAsync(220);
    expect(q.stateOf('launcher')).toBe('active');
  });
});

describe('OverlayQueue: relations the arbitration must not lose', () => {
  it('keeps two launchers on screen together, and parts two dialogs', async () => {
    const { queue: q } = queue();
    const first = request('launcher-a', 'launcher', { priority: 1 });
    const second = request('launcher-b', 'launcher', { priority: 1 });
    const dialog = request('dialog-a', 'dialog', { priority: 1 });
    const rival = request('dialog-b', 'dialog', { priority: 2 });

    q.open(first);
    q.open(second);
    expect(q.stateOf('launcher-a')).toBe('active');
    expect(q.stateOf('launcher-b')).toBe('active');

    q.open(dialog);
    q.open(rival);
    await settle();
    expect(q.stateOf('dialog-b')).toBe('active');
    expect(q.stateOf('dialog-a')).toBe('suspended');
  });

  it('parts two of different kinds when one of them says they cannot share', async () => {
    const { queue: q } = queue();
    const ambient = request('ambient', 'launcher', { priority: 1 });
    const dialog = request('offer', 'dialog', {
      priority: 2,
      disallowCoexistWith: [{ id: 'ambient' }],
    });

    q.open(ambient);
    expect(q.stateOf('ambient')).toBe('active');

    q.open(dialog);
    await settle();
    expect(q.stateOf('offer')).toBe('active');
    expect(q.stateOf('ambient')).toBe('suspended');

    q.close('offer');
    await settle();
    expect(q.stateOf('ambient')).toBe('active');
  });

  it('steps aside for the overlay it named, whatever the priorities say', async () => {
    const { queue: q } = queue();
    const standing = request('standing', 'dialog', { priority: 9, yieldsTo: [{ id: 'urgent' }] });
    const urgent = request('urgent', 'dialog', { priority: 1 });

    q.open(standing);
    expect(q.stateOf('standing')).toBe('active');

    q.open(urgent);
    await settle();
    expect(q.stateOf('urgent')).toBe('active');
    expect(q.stateOf('standing')).toBe('suspended');

    q.close('urgent');
    await settle();
    expect(q.stateOf('standing')).toBe('active');
  });

  it('steps aside for an unarbitrated overlay it named, which no coexistence rule would have caught', async () => {
    const { queue: q } = queue();
    const standing = request('ambient', 'launcher', { priority: 9, yieldsTo: [{ id: 'search' }] });
    const pressed = request('search', 'dialog', undefined);

    q.open(standing);
    expect(q.stateOf('ambient')).toBe('active');

    q.open(pressed);
    await settle();
    expect(q.stateOf('search')).toBe('active');
    expect(q.stateOf('ambient')).toBe('suspended');
  });
});

describe('OverlayQueue: a turn nobody is left waiting for', () => {
  it('gives the waiting candidates their pass once a re-raised unarbitrated overlay is back', async () => {
    const { queue: q } = queue();
    const pressed = request('search', 'dialog', undefined);
    const ambient = request('promo', 'launcher', { priority: 1 });

    const handle = q.open(pressed);
    handle.close();
    q.open(pressed);
    q.open(ambient);
    expect(q.stateOf('promo')).toBe('queued');

    pressed.tr.showings[0]!.end();
    await settle();

    expect(q.stateOf('search')).toBe('active');
    expect(q.stateOf('promo')).toBe('active');
  });

  it('leaves the lane to the stronger candidate even while the weaker one is fetching', async () => {
    const { queue: q } = queue();
    const strong = request('strong', 'dialog', { priority: 5 });
    const weak = {
      ...request('weak', 'dialog', { priority: 1 }),
      prepare: () => new Promise<void>(() => undefined),
    };
    const blocker = flag(true);
    const held = {
      ...strong,
      spec: specOf('strong', 'dialog', { priority: 5, unblockDelayMs: 0, blockedBy: [blocker.fact] }),
    };

    q.open(held);
    q.open(weak);
    await settle();
    expect(q.stateOf('strong')).toBe('queued');

    blocker.set(false);
    q.pass();
    await settle();

    expect(q.stateOf('strong')).toBe('active');
  });

  it('drops a request whose chunk never arrives without taking the new owner of that key with it', async () => {
    const { queue: q, failures } = queue();
    let refuse = (): void => undefined;
    const failing = {
      ...request('lazy', 'dialog', undefined),
      prepare: () => new Promise<void>((_resolve, reject) => (refuse = () => reject(new Error('no chunk')))),
    };

    const first = q.open(failing);
    first.closed.catch(() => undefined);
    q.close('lazy');

    const replacement = request('lazy', 'dialog', undefined);
    q.open(replacement);
    expect(q.stateOf('lazy')).toBe('active');

    refuse();
    await settle();

    expect(q.stateOf('lazy')).toBe('active');
    expect(replacement.tr.count()).toBe(1);
    expect(failures).toHaveLength(1);
  });

  it('gives the screen to the request the occupant was suspended for, not back to the occupant', async () => {
    const { queue: q } = queue();
    const block = flag();
    const older = request('notice', 'launcher', { priority: 1 });
    const stronger = request('offer', 'dialog', {
      priority: 1,
      suspends: [{ id: 'notice' }],
      blockedBy: [block.fact],
      unblockDelayMs: 0,
    });

    q.open(older);
    q.open(stronger);
    await settle();

    block.set(true);
    q.pass();
    await settle();
    block.set(false);
    q.pass();
    await settle();

    expect(q.stateOf('offer')).toBe('active');
    expect(q.stateOf('notice')).toBe('suspended');
    expect(older.tr.count()).toBeLessThanOrEqual(2);
  });

  it('closes a whole session without putting the next request on screen on the way out', async () => {
    const { queue: q } = queue();
    const first = request('offer', 'dialog', { priority: 2, suspends: [{ id: 'notice' }] });
    const waiting = request('notice', 'dialog', { priority: 1, suspends: [{ id: 'offer' }] });

    q.open(first);
    await settle();
    q.open(waiting);
    await settle();
    expect(q.stateOf('notice')).toBe('queued');

    q.closeAll();
    await settle();

    expect(q.stateOf('offer')).toBeUndefined();
    expect(q.stateOf('notice')).toBeUndefined();
    expect(waiting.tr.count()).toBe(0);
  });
});

describe('OverlayQueue: a crowded screen', () => {
  it('hands the screen on as five conditions fall one at a time', async () => {
    const game = flag(true);
    const profile = flag(true);
    const bare = flag(true);
    const cashier = flag(true);
    const search = flag(true);

    const s = scene()
      .add('drop', 'launcher', { priority: 1, blockedBy: [game.fact] })
      .add('notice', 'launcher', { priority: 1, blockedBy: [profile.fact] })
      .add('offer', 'dialog', { priority: 2, blockedBy: [bare.fact], unblockDelayMs: 0 })
      .add('bonus', 'dialog', { priority: 5, blockedBy: [cashier.fact], unblockDelayMs: 0 })
      .add('hint', 'launcher', { priority: 1, blockedBy: [search.fact] });

    s.open('drop', 'notice', 'offer', 'bonus', 'hint');
    await settle();
    expect(s.screen()).toEqual([]);

    game.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['drop']);

    profile.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['drop', 'notice']);

    bare.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['drop', 'notice', 'offer']);

    cashier.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['bonus', 'drop', 'notice']);
    expect(s.states().offer).toBe('suspended');

    search.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['bonus', 'drop', 'hint', 'notice']);
    expect(s.crowded()).toBe(false);
  });

  it('walks a ladder of five dialogs from the strongest down as each one leaves', async () => {
    const bare = flag(true);
    const ladder = ['first', 'second', 'third', 'fourth', 'fifth'];
    const s = scene();

    ladder.forEach((id, index) => s.add(id, 'dialog', { priority: index + 1, blockedBy: [bare.fact], unblockDelayMs: 0 }));
    s.open(...ladder);
    await settle();
    expect(s.screen()).toEqual([]);

    bare.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['fifth']);
    expect(s.showings('fourth')).toBe(0);

    const descending = ['fifth', 'fourth', 'third', 'second'];
    const remaining = ['fourth', 'third', 'second', 'first'];
    for (const [step, leaving] of descending.entries()) {
      s.q.close(leaving);
      s.dismiss(leaving);
      await settle();
      expect(s.screen()).toEqual([remaining[step]]);
    }

    expect(s.showings('first')).toBe(1);
    expect(s.crowded()).toBe(false);
  });

  it('unwinds a chain of four suspends back down, not back to the oldest', async () => {
    const s = scene()
      .add('base', 'dialog', { priority: 1, unblockDelayMs: 0 })
      .add('over-base', 'dialog', { priority: 1, suspends: [{ id: 'base' }], unblockDelayMs: 0 })
      .add('over-that', 'dialog', { priority: 1, suspends: [{ id: 'over-base' }], unblockDelayMs: 0 })
      .add('top', 'dialog', { priority: 1, suspends: [{ id: 'over-that' }], unblockDelayMs: 0 });

    s.open('base');
    await settle();
    expect(s.screen()).toEqual(['base']);

    s.open('over-base');
    await settle();
    expect(s.screen()).toEqual(['over-base']);
    expect(s.states().base).toBe('suspended');

    s.open('over-that');
    await settle();
    expect(s.screen()).toEqual(['over-that']);

    s.open('top');
    await settle();
    expect(s.screen()).toEqual(['top']);
    expect(s.states()).toMatchObject({
      base: 'suspended',
      'over-base': 'suspended',
      'over-that': 'suspended',
      top: 'active',
    });

    s.q.close('top');
    s.dismiss('top');
    await settle();
    expect(s.screen()).toEqual(['over-that']);

    s.q.close('over-that');
    s.dismiss('over-that');
    await settle();
    expect(s.screen()).toEqual(['over-base']);

    s.q.close('over-base');
    s.dismiss('over-base');
    await settle();
    expect(s.screen()).toEqual(['base']);
  });

  it('clears a whole tag family for one dialog and gives the screen back to all of it', async () => {
    const stackable: OverlayPolicy = {
      priority: 1,
      tags: ['stackable'],
      allowCoexistWith: [{ tags: ['stackable'] }],
      unblockDelayMs: 0,
    };
    const s = scene()
      .add('one', 'dialog', stackable)
      .add('two', 'dialog', stackable)
      .add('three', 'dialog', stackable)
      .add('offer', 'dialog', { priority: 2, suspends: [{ tags: ['stackable'] }], unblockDelayMs: 0 });

    s.open('one', 'two', 'three');
    await settle();
    expect(s.screen()).toEqual(['one', 'three', 'two']);

    s.open('offer');
    await settle();
    expect(s.screen()).toEqual(['offer']);
    expect(s.states()).toMatchObject({ one: 'suspended', two: 'suspended', three: 'suspended' });

    s.q.close('offer');
    s.dismiss('offer');
    await settle();
    expect(s.screen()).toEqual(['one', 'three', 'two']);
    expect([s.showings('one'), s.showings('two'), s.showings('three')]).toEqual([2, 2, 2]);
  });

  it('lets nothing take the screen from the visitor, and hands it to the strongest the moment they leave', async () => {
    const s = scene()
      .add('search', 'dialog', undefined)
      .add('weak', 'dialog', { priority: 1, unblockDelayMs: 0 })
      .add('middle', 'dialog', { priority: 4, unblockDelayMs: 0 })
      .add('strong', 'dialog', { priority: 9, unblockDelayMs: 0 })
      .add('aside', 'launcher', { priority: 1 });

    s.open('search');
    s.present('search');
    s.open('weak', 'middle', 'strong', 'aside');
    await settle();

    expect(s.screen()).toEqual(['aside', 'search']);
    expect(s.states()).toMatchObject({ weak: 'queued', middle: 'queued', strong: 'queued' });
    expect(s.showings('strong')).toBe(0);

    s.q.close('search');
    s.dismiss('search');
    await settle();

    expect(s.screen()).toEqual(['aside', 'strong']);
    expect(s.states()).toMatchObject({ weak: 'queued', middle: 'queued' });

    s.q.close('strong');
    s.dismiss('strong');
    await settle();
    expect(s.screen()).toEqual(['aside', 'middle']);

    s.q.close('middle');
    s.dismiss('middle');
    await settle();
    expect(s.screen()).toEqual(['aside', 'weak']);
  });

  it('keeps the lane for the strongest chunk even when the weaker ones land first', async () => {
    const arrivals = new Map<string, () => void>();
    const chunk = (id: string) => () => new Promise<void>((resolve) => arrivals.set(id, resolve));

    const s = scene()
      .add('weak', 'dialog', { priority: 1, unblockDelayMs: 0 }, chunk('weak'))
      .add('middle', 'dialog', { priority: 4, unblockDelayMs: 0 }, chunk('middle'))
      .add('strong', 'dialog', { priority: 9, unblockDelayMs: 0 }, chunk('strong'));

    s.open('strong', 'middle', 'weak');
    await settle();
    expect(s.screen()).toEqual([]);

    arrivals.get('weak')?.();
    await settle();
    expect(s.screen()).toEqual([]);
    expect(s.showings('weak')).toBe(0);

    arrivals.get('middle')?.();
    await settle();
    expect(s.screen()).toEqual([]);

    arrivals.get('strong')?.();
    await settle();
    expect(s.screen()).toEqual(['strong']);
    expect(s.showings('weak')).toBe(0);
    expect(s.showings('middle')).toBe(0);
  });

  it('does not raise the promoted overlay when its blocker comes up during the outro it is waiting on', async () => {
    const bare = flag(false);
    const s = scene()
      .add('leaving', 'dialog', { priority: 5, unblockDelayMs: 0 })
      .add('next', 'dialog', { priority: 1, blockedBy: [bare.fact], unblockDelayMs: 0 });

    s.open('leaving', 'next');
    await settle();
    expect(s.screen()).toEqual(['leaving']);

    s.q.close('leaving');
    expect(s.states().leaving).toBe('closing');

    bare.set(true);
    s.q.pass();
    s.dismiss('leaving');
    await settle();

    expect(s.screen()).toEqual([]);
    expect(s.showings('next')).toBe(0);

    bare.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['next']);
  });

  it('lets another transport hold the screen through the unblock pause, then takes it', async () => {
    vi.useFakeTimers();
    const cashier = flag(true);
    const s = scene()
      .add('offer', 'dialog', {
        priority: 5,
        blockedBy: [cashier.fact],
        unblockDelayMs: 500,
        suspends: [{ id: 'notice' }],
      })
      .add('notice', 'launcher', { priority: 1 });

    s.open('offer');
    expect(s.screen()).toEqual([]);

    cashier.set(false);
    s.q.pass();
    expect(s.screen()).toEqual([]);

    s.open('notice');
    await settle();
    expect(s.screen()).toEqual(['notice']);

    await vi.advanceTimersByTimeAsync(500);
    expect(s.states().offer).toBe('active');
    expect(s.states().notice).toBe('suspended');
  });

  it('empties a screen of six in every state without building any of them on the way out', async () => {
    const blocked = flag(true);
    const s = scene()
      .add('shown', 'dialog', { priority: 5, unblockDelayMs: 0 })
      .add('beside', 'launcher', { priority: 1 })
      .add('also-beside', 'launcher', { priority: 1 })
      .add('pushed-off', 'dialog', { priority: 1, unblockDelayMs: 0 })
      .add('waiting', 'launcher', { priority: 1, blockedBy: [blocked.fact] })
      .add('loading', 'launcher', { priority: 2 }, () => new Promise<void>(() => undefined));

    s.open('pushed-off');
    await settle();
    s.open('shown', 'beside', 'also-beside', 'waiting', 'loading');
    await settle();

    expect(s.states()).toMatchObject({
      shown: 'active',
      beside: 'active',
      'also-beside': 'active',
      'pushed-off': 'suspended',
      waiting: 'queued',
      loading: 'queued',
    });

    s.q.closeAll();
    s.dismiss('shown');
    s.dismiss('beside');
    s.dismiss('also-beside');
    await settle();

    expect(Object.values(s.states()).every((state) => state === undefined)).toBe(true);
    expect(s.showings('waiting')).toBe(0);
    expect(s.showings('loading')).toBe(0);
  });

  it('comes to rest on a ring of three that all name each other', async () => {
    const s = scene()
      .add('a', 'dialog', { priority: 1, suspends: [{ id: 'b' }], unblockDelayMs: 0 })
      .add('b', 'dialog', { priority: 1, suspends: [{ id: 'c' }], unblockDelayMs: 0 })
      .add('c', 'dialog', { priority: 1, suspends: [{ id: 'a' }], unblockDelayMs: 0 });

    s.open('a');
    await settle();
    s.open('b');
    await settle();
    s.open('c');
    await settle();

    expect(s.screen()).toHaveLength(1);
    expect(s.crowded()).toBe(false);
  });

  it('never leaves two of a kind on screen through a long run of conditions', async () => {
    const game = flag(false);
    const profile = flag(false);
    const bare = flag(false);
    const cashier = flag(false);
    const narrow = flag(false);

    const s = scene()
      .add('offer', 'dialog', { priority: 2, blockedBy: [game.fact, bare.fact], unblockDelayMs: 0 })
      .add('bonus', 'dialog', { priority: 5, blockedBy: [profile.fact], unblockDelayMs: 0 })
      .add('insurance', 'dialog', { priority: 3, blockedBy: [cashier.fact], unblockDelayMs: 0 })
      .add('notice', 'dialog', { priority: 1, blockedBy: [bare.fact], unblockDelayMs: 0 })
      .add('email', 'dialog', { priority: 2, blockedBy: [profile.fact], unblockDelayMs: 0 })
      .add('drop', 'launcher', { priority: 1, blockedBy: [narrow.fact] });

    s.open('offer', 'bonus', 'insurance', 'notice', 'email', 'drop');
    await settle();
    expect(s.crowded()).toBe(false);

    const script: readonly [ReturnType<typeof flag>, boolean][] = [
      [game, true],
      [profile, true],
      [bare, true],
      [game, false],
      [cashier, true],
      [bare, false],
      [profile, false],
      [narrow, true],
      [cashier, false],
      [narrow, false],
      [profile, true],
      [profile, false],
    ];

    for (const [condition, raised] of script) {
      condition.set(raised);
      s.q.pass();
      await settle();
      expect(s.crowded()).toBe(false);
    }

    expect(s.screen()).toEqual(['bonus', 'drop']);
  });
});

describe('OverlayQueue: a crowded screen keeps its promises', () => {
  it('refreshes a suspended request in place and shows it only when its turn comes', async () => {
    const s = scene().add('offer', 'dialog', { priority: 1, unblockDelayMs: 0 }).add('bonus', 'dialog', { priority: 5, unblockDelayMs: 0 });

    s.open('offer');
    await settle();
    s.open('bonus');
    await settle();
    expect(s.states()).toMatchObject({ offer: 'suspended', bonus: 'active' });

    s.open('offer');
    await settle();
    expect(s.states()).toMatchObject({ offer: 'suspended', bonus: 'active' });
    expect(s.showings('offer')).toBe(1);

    s.q.close('bonus');
    s.dismiss('bonus');
    await settle();
    expect(s.screen()).toEqual(['offer']);
    expect(s.showings('offer')).toBe(2);
  });

  it('drops a suspended request for good, and gives its turn to the next in line', async () => {
    const s = scene()
      .add('weak', 'dialog', { priority: 1, unblockDelayMs: 0 })
      .add('middle', 'dialog', { priority: 3, unblockDelayMs: 0 })
      .add('strong', 'dialog', { priority: 9, unblockDelayMs: 0 });

    s.open('strong');
    await settle();
    s.open('middle', 'weak');
    await settle();
    expect(s.screen()).toEqual(['strong']);
    expect(s.states()).toMatchObject({ middle: 'queued', weak: 'queued' });

    s.q.close('middle');
    await settle();
    expect(s.states().middle).toBeUndefined();

    s.q.close('strong');
    s.dismiss('strong');
    await settle();

    expect(s.screen()).toEqual(['weak']);
    expect(s.showings('middle')).toBe(0);
  });

  it('keeps a overlay off the screen until every one of its conditions is down', async () => {
    const game = flag(true);
    const bare = flag(true);
    const s = scene().add('offer', 'dialog', {
      priority: 1,
      blockedBy: [game.fact, bare.fact],
      unblockDelayMs: 0,
    });

    s.open('offer');
    expect(s.screen()).toEqual([]);

    game.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual([]);

    bare.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['offer']);

    game.set(true);
    s.q.pass();
    await settle();
    expect(s.states().offer).toBe('suspended');

    game.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['offer']);
  });

  it('does not bring a suspended overlay back onto a free screen while its own condition is up', async () => {
    const profile = flag(false);
    const s = scene()
      .add('offer', 'dialog', { priority: 1, blockedBy: [profile.fact], unblockDelayMs: 0 })
      .add('bonus', 'dialog', { priority: 5, unblockDelayMs: 0 });

    s.open('offer');
    await settle();
    s.open('bonus');
    await settle();
    expect(s.states()).toMatchObject({ offer: 'suspended', bonus: 'active' });

    profile.set(true);
    s.q.pass();
    s.q.close('bonus');
    s.dismiss('bonus');
    await settle();

    expect(s.screen()).toEqual([]);
    expect(s.states().offer).toBe('suspended');

    profile.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['offer']);
  });

  it('stacks five launchers and lets a dialog stand beside the whole stack', async () => {
    const s = scene();
    const stack = ['first', 'second', 'third', 'fourth', 'fifth'];
    stack.forEach((id) => s.add(id, 'launcher', { priority: 1 }));
    s.add('offer', 'dialog', { priority: 9, unblockDelayMs: 0 });

    s.open(...stack);
    await settle();
    expect(s.screen()).toEqual(['fifth', 'first', 'fourth', 'second', 'third']);

    s.open('offer');
    await settle();
    expect(s.screen()).toEqual(['fifth', 'first', 'fourth', 'offer', 'second', 'third']);
    expect(stack.every((id) => s.showings(id) === 1)).toBe(true);
  });

  it('lets everything that can share the screen through while one chunk never lands', async () => {
    const s = scene()
      .add('stuck', 'dialog', { priority: 9, unblockDelayMs: 0 }, () => new Promise<void>(() => undefined))
      .add('other-dialog', 'dialog', { priority: 1, unblockDelayMs: 0 })
      .add('aside-a', 'launcher', { priority: 1 })
      .add('aside-b', 'launcher', { priority: 1 })
      .add('aside-c', 'launcher', { priority: 1 });

    s.open('stuck', 'other-dialog', 'aside-a', 'aside-b', 'aside-c');
    await settle();

    expect(s.screen()).toEqual(['aside-a', 'aside-b', 'aside-c']);
    expect(s.states()).toMatchObject({ stuck: 'queued', 'other-dialog': 'queued' });
  });

  it('reports one failed chunk and gives its lane straight to the next candidate', async () => {
    let refuse = (): void => undefined;
    const s = scene()
      .add(
        'broken',
        'dialog',
        { priority: 9, unblockDelayMs: 0 },
        () => new Promise<void>((_resolve, reject) => (refuse = () => reject(new Error('no chunk')))),
      )
      .add('next', 'dialog', { priority: 5, unblockDelayMs: 0 })
      .add('beside', 'launcher', { priority: 1 });

    const broken = s.q.open({
      spec: specOf('ignored', 'launcher', undefined),
      materialize: () => ({
        close: () => undefined,
        presented: Promise.resolve(),
        closed: new Promise<never>(() => undefined),
      }),
    });
    void broken;

    s.open('broken', 'next', 'beside');
    await settle();
    expect(s.screen()).toEqual(['beside']);

    refuse();
    await settle();

    expect(s.states().broken).toBeUndefined();
    expect(s.screen()).toEqual(['beside', 'next']);
    expect(s.failures).toHaveLength(1);
  });

  it('holds back only what has not arrived, over a screen that is already busy', async () => {
    const held = flag(false);
    const s = scene()
      .add('shown', 'launcher', { priority: 1, heldBy: [held.fact] })
      .add('beside', 'launcher', { priority: 1, heldBy: [held.fact] })
      .add('waiting', 'dialog', { priority: 1, heldBy: [held.fact], unblockDelayMs: 0 })
      .add('also-waiting', 'dialog', { priority: 5, heldBy: [held.fact], unblockDelayMs: 0 });

    s.open('shown', 'beside');
    await settle();
    expect(s.screen()).toEqual(['beside', 'shown']);

    held.set(true);
    s.q.pass();
    s.open('waiting', 'also-waiting');
    await settle();

    expect(s.screen()).toEqual(['beside', 'shown']);
    expect(s.states()).toMatchObject({ waiting: 'queued', 'also-waiting': 'queued' });

    held.set(false);
    s.q.pass();
    await settle();
    expect(s.screen()).toEqual(['also-waiting', 'beside', 'shown']);
  });

  it('gives four equals the screen in the order they asked for it', async () => {
    const s = scene();
    const equals = ['one', 'two', 'three', 'four'];
    equals.forEach((id) => s.add(id, 'dialog', { priority: 1, unblockDelayMs: 0 }));

    s.open(...equals);
    await settle();
    expect(s.screen()).toEqual(['one']);

    for (const [step, leaving] of equals.slice(0, 3).entries()) {
      s.q.close(leaving);
      s.dismiss(leaving);
      await settle();
      expect(s.screen()).toEqual([equals[step + 1]]);
    }
  });

  it('starts the unblock pause again when the condition returns during it', async () => {
    vi.useFakeTimers();
    const cashier = flag(true);
    const s = scene().add('offer', 'dialog', {
      priority: 1,
      blockedBy: [cashier.fact],
      unblockDelayMs: 500,
    });

    s.open('offer');
    cashier.set(false);
    s.q.pass();

    await vi.advanceTimersByTimeAsync(300);
    expect(s.screen()).toEqual([]);

    cashier.set(true);
    s.q.pass();
    cashier.set(false);
    s.q.pass();

    await vi.advanceTimersByTimeAsync(300);
    expect(s.screen()).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(s.screen()).toEqual(['offer']);
  });

  it('leaves nothing behind when a chunk lands after the session was closed', async () => {
    let arrive = (): void => undefined;
    const s = scene()
      .add('lazy', 'dialog', { priority: 5, unblockDelayMs: 0 }, () => new Promise<void>((resolve) => (arrive = resolve)))
      .add('beside', 'launcher', { priority: 1 });

    s.open('lazy', 'beside');
    await settle();
    expect(s.screen()).toEqual(['beside']);

    s.q.closeAll();
    s.dismiss('beside');
    await settle();
    expect(Object.values(s.states()).every((state) => state === undefined)).toBe(true);

    arrive();
    await settle();
    expect(s.screen()).toEqual([]);
    expect(s.showings('lazy')).toBe(0);
  });
});
