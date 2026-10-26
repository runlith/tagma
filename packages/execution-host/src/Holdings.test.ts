import { describe, expect, test } from 'bun:test';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import { Holdings } from './Holdings';

const idOf = (n: number): ExecutionId => `${n.toString(16).padStart(8, '0')}-e` as ExecutionId;
const refOf = (id: ExecutionId): ExecutionRef => ({ installation: 'i', execution: id, incarnation: 1 }) as ExecutionRef;

const holding = (count: number, kept = 64): Holdings<ExecutionId> => {
  const holdings = new Holdings<ExecutionId>(kept);
  for (let n = 0; n < count; n += 1) {
    const id = idOf(n);
    holdings.hold(id, id);
    holdings.moved(id);
  }
  return holdings;
};

const walk = (holdings: Holdings<ExecutionId>, limit: number, between?: (last: ExecutionId) => void): ExecutionId[] => {
  const seen: ExecutionId[] = [];
  let after: ExecutionId | undefined;
  for (;;) {
    const page = holdings.page(after, limit);
    seen.push(...page.rows);
    if (!page.more) return seen;
    after = page.rows[page.rows.length - 1];
    if (after !== undefined) between?.(after);
  }
};

const perRead = (read: () => void): number => {
  const rounds: number[] = [];
  for (let round = 0; round < 5; round += 1) {
    const started = performance.now();
    for (let at = 0; at < 200; at += 1) read();
    rounds.push(performance.now() - started);
  }
  return rounds.sort((a, b) => a - b)[2] as number;
};

describe('the listing', () => {
  test('a walk answers every held execution exactly once, in id order, however ids arrived', () => {
    const holdings = new Holdings<ExecutionId>(8);
    const ids = Array.from({ length: 20_000 }, (_, n) => idOf((n * 7919) % 20_000));
    for (const id of ids) holdings.hold(id, id);

    const seen = walk(holdings, 200);

    expect(seen).toEqual([...ids].sort());
  });

  test('a cursor whose row left between two pages resumes after it rather than from the start', () => {
    const holdings = holding(1_000);
    let released = 0;

    const seen = walk(holdings, 100, (last) => {
      holdings.release(refOf(last));
      released += 1;
    });

    expect(released).toBe(9);
    expect(new Set(seen).size).toBe(1_000);
    expect(seen).toEqual([...seen].sort());
  });

  test('a page costs the page, not the executions held beside it', () => {
    const small = holding(100);
    const large = holding(50_000);
    const middle = idOf(50);
    const largeMiddle = idOf(25_000);

    const few = perRead(() => small.page(middle, 20));
    const many = perRead(() => large.page(largeMiddle, 20));

    expect(many).toBeLessThan(Math.max(few, 0.05) * 10);
  });
});

describe('the changes since a revision', () => {
  test('answers what joined, moved and left after the revision a reader stands at', () => {
    const holdings = holding(3);
    const since = holdings.revision;
    const joined = idOf(9);
    holdings.hold(joined, joined);
    holdings.moved(joined);
    holdings.moved(idOf(1));
    holdings.release(refOf(idOf(2)));

    const answer = holdings.changes(since, 50);

    expect(answer).toEqual({
      _tag: 'Changed',
      revision: since + 3,
      moved: [joined, idOf(1)],
      left: [refOf(idOf(2))],
    });
    expect(holdings.changes(answer.revision, 50)).toEqual({ _tag: 'Changed', revision: since + 3, moved: [], left: [] });
  });

  test('work retired after it left the live map moves the revision and is answered as a departure again', () => {
    const holdings = holding(2);
    holdings.release(refOf(idOf(1)));
    const since = holdings.revision;

    const retired = holdings.retired(refOf(idOf(1)));

    expect(retired).toBe(since + 1);
    expect(holdings.changes(since, 50)).toEqual({ _tag: 'Changed', revision: since + 1, moved: [], left: [refOf(idOf(1))] });
  });

  test('a state written without a transition is answered to a reader at the standing revision and after it moves', () => {
    const holdings = holding(2);
    const standing = holdings.revision;
    for (let keystroke = 0; keystroke < 50; keystroke += 1) holdings.touched(idOf(0));

    const before = holdings.changes(standing, 50);
    holdings.moved();
    const after = holdings.changes(standing, 50);
    const past = holdings.changes(holdings.revision, 50);

    expect(before).toEqual({ _tag: 'Changed', revision: standing, moved: [idOf(0)], left: [] });
    expect(after).toEqual({ _tag: 'Changed', revision: standing + 1, moved: [idOf(0)], left: [] });
    expect(past).toEqual({ _tag: 'Changed', revision: standing + 1, moved: [], left: [] });
  });

  test('a reader below the departures still kept is told to read whole, and one above them is answered', () => {
    const holdings = holding(10, 3);
    const early = holdings.revision;
    for (const n of [0, 1, 2]) holdings.release(refOf(idOf(n)));
    const kept = holdings.revision;
    for (const n of [3, 4]) holdings.release(refOf(idOf(n)));

    const below = holdings.changes(early, 50);
    const above = holdings.changes(kept, 50);

    expect(below).toMatchObject({ _tag: 'Reset', reason: 'horizon' });
    expect(above).toEqual({ _tag: 'Changed', revision: kept + 2, moved: [], left: [refOf(idOf(3)), refOf(idOf(4))] });
  });

  test('more moves than the limit, or a revision this host never reached, are answered by a reset', () => {
    const holdings = holding(10);

    expect(holdings.changes(0, 9)).toMatchObject({ _tag: 'Reset', reason: 'overflow' });
    expect(holdings.changes(0, 10)).toMatchObject({ _tag: 'Changed', moved: holding(10).all() });
    expect(holdings.changes(holdings.revision + 1, 10)).toMatchObject({ _tag: 'Reset', reason: 'ahead' });
  });

  test('a reading costs what moved, not what the host holds', () => {
    const small = holding(100);
    const large = holding(50_000);
    for (const holdings of [small, large]) {
      for (const n of [3, 5, 8]) holdings.moved(idOf(n));
      holdings.touched(idOf(13));
    }
    const smallSince = small.revision - 3;
    const largeSince = large.revision - 3;

    const few = perRead(() => small.changes(smallSince, 200));
    const many = perRead(() => large.changes(largeSince, 200));

    expect(large.changes(largeSince, 200)).toMatchObject({ moved: [idOf(3), idOf(5), idOf(8), idOf(13)] });
    expect(many).toBeLessThan(Math.max(few, 0.05) * 10);
  });
});
