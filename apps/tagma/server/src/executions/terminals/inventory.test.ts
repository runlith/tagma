import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { StallRecords } from '@runlith/held/holding';
import { Deferred, Effect, Fiber, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { WireUnavailable, type ExecutionFeedItem } from '@runlith/executions/Executions';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InventoryChanges, InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { makeTerminalInventory, type TerminalInventory } from './inventory.js';

const refOf = (id: string): ExecutionRef => ({ installation: 'i', execution: id, incarnation: 1 }) as ExecutionRef;
const summaryOf = (id: string): ExecutionSummary => ({ state: { ref: refOf(id), phase: 'running' } }) as unknown as ExecutionSummary;
const idOf = (n: number): string => `e-${String(n).padStart(6, '0')}`;

const hostOver = Effect.fnUntraced(function* () {
  const asked = { subscriptions: 0, changes: 0, pages: 0 };
  const host = { failing: false, silent: false, sockets: 0, revision: 0 };
  const held = new Map<string, { readonly summary: ExecutionSummary; readonly stamp: number }>();
  const left: Array<{ readonly ref: ExecutionRef; readonly stamp: number }> = [];
  let sorted: string[] | undefined;
  const deliveries = yield* Queue.unbounded<ExecutionFeedItem, WireUnavailable>();
  const unanswered = yield* Deferred.make<void>();
  const unreachable = () => Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the host is gone', sent: false }));
  const port = {
    generation: () => Effect.succeed(1),
    served: () => Effect.succeed(new Set<never>()),
    subscribe: () => {
      asked.subscriptions += 1;
      return Stream.fromQueue(deliveries);
    },
    changes: (since: number, limit: number) =>
      Effect.suspend(() => {
        asked.changes += 1;
        if (host.silent) return Effect.andThen(Deferred.succeed(unanswered, undefined), Effect.never);
        if (host.failing) return unreachable();
        const executions = [...held.values()].filter((entry) => entry.stamp > since).map((entry) => entry.summary);
        const gone = left.filter((entry) => entry.stamp > since).map((entry) => entry.ref);
        const answer: InventoryChanges =
          executions.length + gone.length > limit
            ? { _tag: 'Reset', revision: host.revision, reason: 'overflow', detail: 'more moved than asked for' }
            : { _tag: 'Changed', revision: host.revision, executions, left: gone };
        return Effect.succeed(answer);
      }),
    list: (options?: { readonly after?: ExecutionRef; readonly limit?: number }) =>
      Effect.suspend(() => {
        asked.pages += 1;
        if (host.failing) return unreachable();
        sorted ??= [...held.keys()].sort();
        const ids = sorted;
        const from = options?.after === undefined ? 0 : ids.findIndex((id) => id > options.after!.execution);
        const start = from === -1 ? ids.length : from;
        const page = ids.slice(start, start + (options?.limit ?? ids.length));
        const last = page[page.length - 1];
        return Effect.succeed({
          executions: page.map((id) => held.get(id)!.summary),
          after: start + page.length < ids.length && last !== undefined ? refOf(last) : undefined,
        });
      }),
    hostListeners: () => Effect.sync(() => ({ listeners: Array.from({ length: host.sockets }, () => ({})) })),
  } as unknown as Executions['Service'] & ExecutionFeed['Service'] & ExecutionEvidence['Service'] & HostLifecycle['Service'];
  const inventory = yield* makeTerminalInventory({ executions: port });
  const hold = (id: string) => {
    host.revision += 1;
    sorted = undefined;
    held.set(id, { summary: summaryOf(id), stamp: host.revision });
  };
  const release = (id: string) => {
    host.revision += 1;
    sorted = undefined;
    held.delete(id);
    left.push({ ref: refOf(id), stamp: host.revision });
  };
  const push = (update: InventoryFeedItem) => Queue.offer(deliveries, { _tag: 'Inventory', update });
  const lose = Queue.fail(deliveries, new WireUnavailable({ kind: 'unreachable', reason: 'lost', sent: false }));
  return { asked, host, inventory, hold, release, push, lose, unanswered };
});

const moved = (revision: number): InventoryFeedItem => ({ _tag: 'Moved', revision, usage: [] });

const reader = Effect.fnUntraced(function* (inventory: TerminalInventory) {
  const seen = yield* Queue.unbounded<InventoryFeedItem>();
  const fiber = yield* Effect.forkScoped(Stream.runForEach(inventory.changes(), (update) => Queue.offer(seen, update)));
  const next = Queue.take(seen);
  return {
    next,
    until: Effect.fnUntraced(function* (found: (update: InventoryFeedItem) => boolean) {
      for (;;) {
        const update = yield* next;
        if (found(update)) return update;
      }
    }),
    stop: Fiber.interrupt(fiber),
  };
});

const at = (revision: number) => (update: InventoryFeedItem) => update._tag === 'Moved' && update.revision === revision;

const cellRead = Effect.fnUntraced(function* (inventory: TerminalInventory) {
  for (;;) {
    const cell = yield* inventory.of(1);
    if (!cell.stale) return cell;
    yield* Effect.sleep(1);
  }
});

const following = Effect.fnUntraced(function* (inventory: TerminalInventory) {
  const follower = yield* Effect.forkScoped(inventory.follow());
  const feed = yield* reader(inventory);
  return { feed, stop: Effect.andThen(feed.stop, Fiber.interrupt(follower)) };
});

it.live('a reader that arrives before the host was read is told to read, and one that arrives later is handed where things stand', () =>
  Effect.gen(function* () {
    const { asked, inventory, push } = yield* hostOver();
    const early = yield* reader(inventory);
    const told = yield* early.next;
    const follower = yield* Effect.forkScoped(inventory.follow());
    const first = yield* reader(inventory);
    yield* push(moved(3));
    yield* first.until(at(3));
    yield* early.until(at(3));
    const late = yield* reader(inventory);
    const handed = yield* late.next;
    yield* Effect.all([early.stop, first.stop, late.stop, Fiber.interrupt(follower)]);

    expect(told._tag).toBe('Gap');
    expect(asked.subscriptions).toBe(1);
    expect(handed).toEqual(moved(3));
  }),
);

it.live('a transition reads only what moved, and a round at the same revision reads no inventory at all', () =>
  Effect.gen(function* () {
    const { asked, host, inventory, hold, push } = yield* hostOver();
    for (let n = 0; n < 150; n += 1) hold(idOf(n));
    yield* inventory.of(1);
    yield* inventory.refresh();
    const { feed, stop } = yield* following(inventory);
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const opened = { ...asked };
    host.sockets = 2;
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const round = { ...asked, listeners: (yield* inventory.of(1)).listeners?.listeners.length };
    hold(idOf(900));
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const transition = { ...asked };
    const cell = yield* inventory.of(1);
    yield* stop;

    expect(opened.pages).toBe(0);
    expect(round).toMatchObject({ changes: opened.changes, pages: 0, listeners: 2 });
    expect(transition).toMatchObject({ changes: opened.changes + 1, pages: 0 });
    expect(cell.stateOf(refOf(idOf(900)))?.ref).toEqual(refOf(idOf(900)));
    expect(cell.stateOf(refOf(idOf(0)))).toBeDefined();
  }),
);

it.live(
  'a reading past what one answer carries reads the whole listing to its end, and a mirror past ten thousand holds every execution',
  () =>
    Effect.gen(function* () {
      const { asked, inventory, hold, release } = yield* hostOver();
      for (let n = 0; n < 12_000; n += 1) hold(idOf(n));

      const first = yield* inventory.held(true);
      const pages = asked.pages;
      release(idOf(11_999));
      hold(idOf(12_000));
      const next = yield* inventory.held(true);

      expect(first.whole).toBe(true);
      expect(pages).toBe(60);
      expect(first.stateOf(refOf(idOf(11_998)))).toBeDefined();
      expect(asked.pages).toBe(pages);
      expect(next.stateOf(refOf(idOf(11_999)))).toBeUndefined();
      expect(next.stateOf(refOf(idOf(12_000)))).toBeDefined();
    }),
);

it.live('the disposition reads nothing from a host that has not moved since its last reading', () =>
  Effect.gen(function* () {
    const { asked, host, inventory, hold, push } = yield* hostOver();
    hold(idOf(1));
    yield* cellRead(inventory);
    const { feed, stop } = yield* following(inventory);
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const settled = { ...asked };
    for (let round = 0; round < 5; round += 1) {
      yield* push(moved(host.revision));
      yield* feed.until(at(host.revision));
      yield* inventory.held(false);
    }
    yield* stop;

    expect(asked).toEqual(settled);
  }),
);

it.live('a round naming a revision the mirror already read past reads no inventory, however many readers ask for moves', () =>
  Effect.gen(function* () {
    const { asked, host, inventory, hold, push } = yield* hostOver();
    hold(idOf(1));
    yield* cellRead(inventory);
    const { feed, stop } = yield* following(inventory);
    const announced = host.revision + 1;
    hold(idOf(2));
    hold(idOf(3));
    yield* push(moved(announced));
    yield* feed.until(at(announced));
    const caught = { ...asked };
    for (let one = 0; one < 5; one += 1) yield* inventory.moves();
    yield* stop;

    expect(asked).toEqual(caught);
  }),
);

it.live('a reading the host did not answer is taken again at the next round, not left until a transition', () =>
  Effect.gen(function* () {
    const { host, inventory, hold, push } = yield* hostOver();
    hold(idOf(1));
    yield* inventory.of(1);
    const { feed, stop } = yield* following(inventory);
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    host.failing = true;
    yield* inventory.refresh();
    const lost = yield* inventory.of(1);
    host.failing = false;
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const recovered = yield* inventory.of(1);
    yield* stop;

    expect({ stale: lost.stale, whole: lost.whole }).toEqual({ stale: true, whole: false });
    expect({ stale: recovered.stale, whole: recovered.whole }).toEqual({ stale: false, whole: true });
    expect(recovered.stateOf(refOf(idOf(1)))).toBeDefined();
  }),
);

it.effect(
  'a reading the host leaves unanswered past its ceiling is refused as unavailable and unsyncs the mirror, so the next reading asks the host',
  () =>
    Effect.gen(function* () {
      const { host, inventory, hold, push, unanswered } = yield* hostOver();
      hold(idOf(1));
      yield* inventory.held(false);
      const { feed, stop } = yield* following(inventory);
      yield* push(moved(host.revision));
      yield* feed.until(at(host.revision));
      host.silent = true;
      const reading = yield* Effect.forkScoped(Effect.flip(inventory.held(true)));
      yield* Deferred.await(unanswered);
      yield* TestClock.adjust('2 minutes');
      const refused = yield* Fiber.join(reading);
      host.silent = false;
      hold(idOf(2));
      const next = yield* inventory.held(false);
      yield* stop;

      expect(refused).toMatchObject({ _tag: 'TerminalUnavailable', owner: 'host' });
      expect(next.stateOf(refOf(idOf(2)))).toBeDefined();
    }).pipe(Effect.provideService(StallRecords, () => Effect.void)),
);

it.live(
  'moves name what the host stamped after a revision, even while no project holds a cell, and a reading that cannot say what moved starts another epoch',
  () =>
    Effect.gen(function* () {
      const { host, inventory, hold, release, push } = yield* hostOver();
      for (let n = 0; n < 3; n += 1) hold(idOf(n));
      const { feed, stop } = yield* following(inventory);
      yield* push(moved(host.revision));
      yield* feed.until(at(host.revision));
      const first = yield* inventory.moves();
      const since = first.revision as number;
      hold(idOf(1));
      release(idOf(2));
      yield* push(moved(host.revision));
      yield* feed.until(at(host.revision));
      const second = yield* inventory.moves();
      const stamped = [0, 1, 2].map((n) => second.movedAfter(idOf(n), since));
      const holds = [second.holds(refOf(idOf(0))), second.holds(refOf(idOf(2)))];
      for (let n = 10; n < 310; n += 1) hold(idOf(n));
      yield* push(moved(host.revision));
      yield* feed.until(at(host.revision));
      const third = yield* inventory.moves();
      yield* stop;

      expect(since).toBe(3);
      expect(second.epoch).toBe(first.epoch);
      expect(stamped).toEqual([false, true, true]);
      expect(holds).toEqual([true, false]);
      expect(third.epoch).not.toBe(first.epoch);
      expect(second.movedAfter(idOf(0), since)).toBe(true);
      expect(third.holds(refOf(idOf(309)))).toBe(true);
    }),
);

it.live('a feed lost after it delivered tells every reader to read again, and the cell reads stale until one does', () =>
  Effect.gen(function* () {
    const { host, inventory, hold, push, lose } = yield* hostOver();
    hold(idOf(1));
    yield* cellRead(inventory);
    const { feed, stop } = yield* following(inventory);
    yield* push(moved(host.revision));
    yield* feed.until(at(host.revision));
    const standing = yield* inventory.of(1);
    yield* lose;
    const told = yield* feed.until((update) => update._tag === 'Gap');
    const lost = yield* inventory.of(1);
    yield* stop;

    expect(standing.stale).toBe(false);
    expect(told._tag).toBe('Gap');
    expect({ stale: lost.stale, whole: lost.whole }).toEqual({ stale: true, whole: false });
  }),
);
