import { describe, expect, it } from 'vitest';

import { Condition, type Fact } from '@runlith/layer/condition';

import { EMPTY_PLAN_HISTORY, plan, type PlanEntry, type PlanHistory, type OverlayState } from './overlay-plan.js';
import { specOf, type OverlayPolicy } from './overlay-policy.js';

type World = {
  entries: PlanEntry[];
  history: PlanHistory;
};

function entry(
  id: string,
  policy: OverlayPolicy | undefined,
  state: OverlayState,
  order: number,
  extra: Partial<Pick<PlanEntry, 'ready' | 'preloading'>> = {},
): PlanEntry {
  return {
    spec: specOf(id, 'dialog', policy),
    state,
    order,
    ready: extra.ready ?? true,
    preloading: extra.preloading ?? false,
  };
}

const read = (fact: Fact): boolean => fact.current;

function apply(world: World, nowMs: number): { commands: string[]; world: World } {
  const result = plan(world.entries, read, world.history, nowMs);
  const entries = world.entries.map((item) => {
    const command = result.commands.find((c) => c.id === item.spec.id);
    if (!command) return item;
    if (command.kind === 'suspend') return { ...item, state: 'suspended' as const };
    if (command.kind === 'activate') return { ...item, state: 'active' as const };
    return { ...item, preloading: true };
  });

  return {
    commands: result.commands.map((c) => `${c.kind} ${c.id}`),
    world: { entries, history: result.history },
  };
}

function settle(world: World, maxRounds = 20): { rounds: string[][]; world: World } {
  const rounds: string[][] = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const step = apply(world, 0);
    world = step.world;
    if (step.commands.length === 0) return { rounds, world };
    rounds.push(step.commands);
  }
  throw new Error(`no fixpoint after ${maxRounds} rounds: ${JSON.stringify(rounds)}`);
}

describe('plan: the ring that used to trade the screen forever', () => {
  it('settles a three-way suspend ring instead of rotating it', () => {
    const world: World = {
      entries: [
        entry('a', { priority: 1, suspends: [{ id: 'b' }] }, 'active', 1),
        entry('b', { priority: 1, suspends: [{ id: 'c' }] }, 'suspended', 2),
        entry('c', { priority: 1, suspends: [{ id: 'a' }] }, 'suspended', 3),
      ],
      history: EMPTY_PLAN_HISTORY,
    };

    const settled = settle(world);

    const active = settled.world.entries.filter((item) => item.state === 'active');
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(settled.rounds.length).toBeLessThanOrEqual(4);
  });

  it('lets the ring move again once a request leaves, because the driver clears the memory', () => {
    const world: World = {
      entries: [
        entry('a', { priority: 2, suspends: [{ id: 'b' }] }, 'suspended', 1),
        entry('b', { priority: 1, suspends: [{ id: 'a' }] }, 'active', 2),
      ],
      history: { ...EMPTY_PLAN_HISTORY, steppedAside: new Set(['a']) },
    };

    const held = plan(world.entries, read, world.history, 0);
    expect(held.commands).toEqual([]);

    const cleared = plan(world.entries, read, { ...world.history, steppedAside: new Set() }, 0);
    expect(cleared.commands).toEqual([{ kind: 'suspend', id: 'b' }]);
  });
});

describe('plan: blockers and the cooldown', () => {
  it('takes a blocked overlay off screen and arms its wait', () => {
    const open = Condition.of(() => true);
    const world: World = {
      entries: [entry('promo', { priority: 1, blockedBy: [open], unblockDelayMs: 500 }, 'active', 1)],
      history: EMPTY_PLAN_HISTORY,
    };

    const result = plan(world.entries, read, world.history, 1_000);

    expect(result.commands).toEqual([{ kind: 'suspend', id: 'promo' }]);
    expect(result.history.cooling.get('promo')).toEqual({ readyAtMs: undefined });
  });

  it('books the cooldown from the pass that finds the blocker down, and wakes the driver for it', () => {
    let isOpen = true;
    const open = Condition.of(() => isOpen);
    const history: PlanHistory = {
      ...EMPTY_PLAN_HISTORY,
      cooling: new Map([['promo', { readyAtMs: undefined }]]),
    };
    const entries = [entry('promo', { priority: 1, blockedBy: [open], unblockDelayMs: 500 }, 'suspended', 1)];

    isOpen = false;
    const booked = plan(entries, read, history, 2_000);
    expect(booked.commands).toEqual([]);
    expect(booked.history.cooling.get('promo')).toEqual({ readyAtMs: 2_500 });
    expect(booked.wakeAtMs).toBe(2_500);

    const due = plan(entries, read, booked.history, 2_500);
    expect(due.commands).toEqual([{ kind: 'activate', id: 'promo' }]);
    expect(due.history.cooling.has('promo')).toBe(false);
  });

  it('holds a overlay whose heldBy is up without booking its cooldown twice', () => {
    const held = Condition.of(() => true);
    const entries = [entry('promo', { priority: 1, heldBy: [held] }, 'queued', 1)];

    const result = plan(entries, read, EMPTY_PLAN_HISTORY, 0);

    expect(result.commands).toEqual([]);
  });
});

describe('plan: the outro barrier', () => {
  it('promotes nothing while any showing is still on its way out', () => {
    const world: World = {
      entries: [entry('leaving', { priority: 1 }, 'closing', 1), entry('next', { priority: 5 }, 'queued', 2)],
      history: EMPTY_PLAN_HISTORY,
    };

    expect(plan(world.entries, read, world.history, 0).commands).toEqual([]);
  });

  it('stops after suspending for a promotion, and the promoted one goes first on the next pass', () => {
    const first: World = {
      entries: [
        entry('occupant', { priority: 1 }, 'active', 1),
        entry('urgent', { priority: 9, suspends: [{ id: 'occupant' }] }, 'queued', 2),
      ],
      history: EMPTY_PLAN_HISTORY,
    };

    const suspended = plan(first.entries, read, first.history, 0);
    expect(suspended.commands).toEqual([{ kind: 'suspend', id: 'occupant' }]);
    expect(suspended.history.promotingId).toBe('urgent');
    expect(suspended.history.steppedAside.has('occupant')).toBe(true);

    const second = plan(
      [entry('occupant', { priority: 1 }, 'suspended', 1), entry('urgent', { priority: 9, suspends: [{ id: 'occupant' }] }, 'queued', 2)],
      read,
      suspended.history,
      0,
    );
    expect(second.commands).toEqual([{ kind: 'activate', id: 'urgent' }]);
    expect(second.history.promotingId).toBeUndefined();
  });
});

describe('plan: lanes for a view that is not here yet', () => {
  it('asks for the chunk once and holds the lane against the weaker conflicting request', () => {
    const world: World = {
      entries: [
        entry('lazy', { priority: 5 }, 'queued', 1, { ready: false }),
        entry('weaker', { priority: 1 }, 'queued', 2),
        entry('toastLike', undefined, 'queued', 3),
      ],
      history: EMPTY_PLAN_HISTORY,
    };

    const result = plan(world.entries, read, world.history, 0);

    expect(result.commands).toEqual([{ kind: 'prepare', id: 'lazy' }]);

    const while_loading = plan(
      [entry('lazy', { priority: 5 }, 'queued', 1, { ready: false, preloading: true }), entry('weaker', { priority: 1 }, 'queued', 2)],
      read,
      result.history,
      0,
    );
    expect(while_loading.commands).toEqual([]);
  });

  it('lets a stronger ready request displace the reserved lane of a weaker loading one', () => {
    const world: World = {
      entries: [
        entry('weakLazy', { priority: 1 }, 'queued', 1, { ready: false, preloading: true }),
        entry('strong', { priority: 9 }, 'queued', 2),
      ],
      history: EMPTY_PLAN_HISTORY,
    };

    const result = plan(world.entries, read, world.history, 0);

    expect(result.commands).toEqual([{ kind: 'activate', id: 'strong' }]);
  });

  it('activates coexisting requests through a reserved lane in one pass', () => {
    const world: World = {
      entries: [
        entry('lazy', { priority: 5, allowCoexistWith: [{ id: 'friend' }] }, 'queued', 1, {
          ready: false,
          preloading: true,
        }),
        entry('friend', { priority: 1, allowCoexistWith: [{ id: 'lazy' }] }, 'queued', 2),
      ],
      history: EMPTY_PLAN_HISTORY,
    };

    expect(plan(world.entries, read, world.history, 0).commands).toEqual([{ kind: 'activate', id: 'friend' }]);
  });
});

describe('plan: purity', () => {
  it('answers the same commands for the same world, and never edits the history it was given', () => {
    const open = Condition.of(() => false);
    const history: PlanHistory = {
      steppedAside: new Set(['x']),
      promotingId: undefined,
      cooling: new Map([['promo', { readyAtMs: undefined }]]),
    };
    const entries = [
      entry('promo', { priority: 2, blockedBy: [open], unblockDelayMs: 500 }, 'queued', 1),
      entry('x', { priority: 1 }, 'suspended', 2),
    ];

    const first = plan(entries, read, history, 3_000);
    const second = plan(entries, read, history, 3_000);

    expect(second.commands).toEqual(first.commands);
    expect(second.history).toEqual(first.history);
    expect(history.cooling.get('promo')).toEqual({ readyAtMs: undefined });
    expect([...history.steppedAside]).toEqual(['x']);
  });
});
