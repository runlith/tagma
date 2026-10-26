import { describe, expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { it } from '@runlith/effect-test';
import {
  type PageFamily,
  type PageKey,
  type PageQuestion,
  type PageWalk,
  heldRows,
  keyOrder,
  mintCursor,
  page,
  pageCeiling,
  pageRows,
  pastKey,
  readCursor,
  recallSelection,
  walking,
} from './pages';

const question = (selection: Record<string, unknown>, order = 1): PageQuestion => ({
  operation: 'read_findings',
  selection,
  order,
});

describe('a cursor belongs to its own walk', () => {
  test('a cursor reads back the position it was minted at', () => {
    const asked = question({ check: 'drift' });
    const read = readCursor(mintCursor(asked, ['high', 1700, 42]), asked);
    expect(read).toEqual({ at: ['high', 1700, 42] });
  });

  test('the same selection spelled in another field order is the same walk', () => {
    const cursor = mintCursor(question({ check: 'drift', path: 'src' }), ['a', 1]);
    expect(readCursor(cursor, question({ path: 'src', check: 'drift' }))).toEqual({ at: ['a', 1] });
  });

  test('a key the caller left undefined is not a narrowing', () => {
    const cursor = mintCursor(question({ check: 'drift', path: undefined }), ['a', 1]);
    expect(readCursor(cursor, question({ check: 'drift' }))).toEqual({ at: ['a', 1] });
  });

  test('a changed narrowing is stale, not bad — the caller asked a different question', () => {
    const cursor = mintCursor(question({ check: 'drift' }), ['a', 1]);
    expect(readCursor(cursor, question({ check: 'comments-standing' }))).toEqual({ refused: 'cursor-stale' });
  });

  test('a family that changed what "after" means makes every older cursor stale', () => {
    const cursor = mintCursor(question({ check: 'drift' }, 1), ['a', 1]);
    expect(readCursor(cursor, question({ check: 'drift' }, 2))).toEqual({ refused: 'cursor-stale' });
  });

  test('a cursor of another read is stale even under an identical selection', () => {
    const cursor = mintCursor({ operation: 'ready_work', selection: {}, order: 1 }, ['a']);
    expect(readCursor(cursor, { operation: 'read_findings', selection: {}, order: 1 })).toEqual({
      refused: 'cursor-stale',
    });
  });

  test('a word this door never minted is bad, whatever it looks like', () => {
    for (const forged of ['', 'not-a-cursor', 'AAAA', '!!!!', 'eyJhIjoxfQ']) {
      expect(readCursor(forged, question({}))).toEqual({ refused: 'bad-cursor' });
    }
  });

  test('a caller handing something that is not a cursor at all is refused, never thrown at', () => {
    for (const nothing of [null, undefined, 0, 42, true, {}, [], { cursor: 'x' }]) {
      expect(readCursor(nothing, question({}))).toEqual({ refused: 'bad-cursor' });
    }
  });

  test('a cursor survives the alphabet a selection can hold', () => {
    const asked = question({ query: 'граф · "quoted" / \\ 🙂', path: 'apps/tagma' });
    const cursor = mintCursor(asked, ['граф 🙂', 12, null, true]);
    expect(cursor).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(readCursor(cursor, asked)).toEqual({ at: ['граф 🙂', 12, null, true] });
  });

  test('asking for a different page size continues the same walk', () => {
    const cursor = mintCursor(question({ check: 'drift' }), ['a', 1]);
    expect(readCursor(cursor, question({ check: 'drift' }))).toEqual({ at: ['a', 1] });
  });
});

describe('the one constructor', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, at) => ({ id: at }));
  const built = (fetched: number, asked: number, total: number | null = 99) =>
    page({
      rows: rows(fetched),
      asked,
      keyOf: (row) => [row.id],
      question: question({}),
      total,
    });

  test('the probe row decides the continuation and never rides the answer', () => {
    const answered = built(11, 10);
    expect(answered.rows).toHaveLength(10);
    expect(answered.shown).toBe(10);
    expect(answered.next).not.toBeNull();
  });

  test('a page the set did not fill ends the walk', () => {
    const answered = built(7, 10);
    expect(answered.shown).toBe(7);
    expect(answered.next).toBeNull();
  });

  test('the continuation names the last row carried, not the probe', () => {
    const answered = built(11, 10);
    expect(readCursor(answered.next ?? '', question({}))).toEqual({ at: [9] });
  });

  test('an empty answer continues nowhere', () => {
    const answered = built(0, 10);
    expect(answered.rows).toHaveLength(0);
    expect(answered.next).toBeNull();
  });

  test('a total nobody counted stays null rather than reading as an empty collection', () => {
    expect(built(3, 10, null).total).toBeNull();
  });

  test('a walk something cut is not complete, and says which bound cut it', () => {
    const answered = page({
      rows: rows(3),
      asked: 10,
      keyOf: (row) => [row.id],
      question: question({}),
      total: null,
      complete: false,
      reason: 'read-ceiling',
    });
    expect(answered.complete).toBe(false);
    expect(answered.reason).toBe('read-ceiling');
  });

  test('a page nothing cut carries no reason at all', () => {
    expect(built(3, 10).reason).toBeUndefined();
    expect(built(3, 10).complete).toBe(true);
  });
});

describe('the ceiling is the family’s, derived', () => {
  const family = (rowBytes: number): PageFamily => ({
    id: 'probe',
    order: 1,
    rowBytes: { text: rowBytes, json: rowBytes },
    road: 'text',
    defaultRows: 100,
    sample: () => ({}),
  });

  test('a heavy row earns a smaller ceiling than a light one, from the same carrier', () => {
    const light = pageCeiling(family(155), 50 * 1024, 2000);
    const heavy = pageCeiling(family(1251), 50 * 1024, 2000);
    expect(light).toBeGreaterThan(heavy);
    expect(heavy).toBeLessThan(50);
  });

  test('a ceiling never promises more bytes than the carrier holds', () => {
    for (const weight of [90, 155, 250, 669, 1251, 2855]) {
      expect(pageCeiling(family(weight), 50 * 1024, 2000) * weight).toBeLessThanOrEqual(50 * 1024);
    }
  });

  test('a row light enough is bound by the carrier’s lines instead of its bytes', () => {
    expect(pageCeiling(family(8), 50 * 1024, 2000)).toBe(2000 - 4);
  });

  test('a row heavier than the whole carrier still answers one row rather than none', () => {
    expect(pageCeiling(family(200_000), 50 * 1024, 2000)).toBe(1);
  });

  test('the caller’s figure is honoured between one and the ceiling, and the default is the agent’s', () => {
    expect(pageRows(undefined, family(155), 320)).toBe(100);
    expect(pageRows(30, family(155), 320)).toBe(30);
    expect(pageRows(900, family(155), 320)).toBe(320);
    expect(pageRows(0, family(155), 320)).toBe(1);
  });

  test('a family whose ceiling is under the default answers its ceiling, never the default', () => {
    expect(pageRows(undefined, family(155), 17)).toBe(17);
    expect(pageRows(undefined, { ...family(155), defaultRows: 'ceiling' }, 17)).toBe(17);
  });

  test('a family reserving a shared trailer gives its rows only what the trailer leaves', () => {
    const family: PageFamily = {
      id: 'f',
      order: 1,
      rowBytes: { text: 100, json: 100 },
      road: 'text',
      defaultRows: 100,
      sample: () => ({}),
    };
    expect(pageCeiling({ ...family, reserveBytes: 10_000 }, 50 * 1024, 2000)).toBe(pageCeiling(family, 50 * 1024, 2000) - 100);
  });
});

describe('a walk over a live order', () => {
  const directions = ['asc', 'desc', 'desc'] as const;
  const keyOf = (row: { life: number; moved: string; id: string }) => [row.life, row.moved, row.id] as const;

  test('ties on every leading part neither repeat nor skip a row across pages', () => {
    const rows = Array.from({ length: 23 }, (_, at) => ({ life: at % 2, moved: `2026-01-0${at % 3}`, id: `t${at}` }));
    const order = keyOrder(directions);
    const sorted = [...rows].sort((left, right) => order(keyOf(left), keyOf(right)));
    const asked = question({});
    const seen: string[] = [];
    let at: PageKey | undefined;
    for (;;) {
      const rest = at === undefined ? sorted : pastKey(sorted, keyOf, directions, at);
      const cut = page({ rows: rest, asked: 4, keyOf, question: asked, total: rows.length });
      seen.push(...cut.rows.map((row) => row.id));
      if (cut.next === null) break;
      const read = readCursor(cut.next, asked);
      if (!('at' in read)) throw new Error('a minted cursor must read back');
      at = read.at;
    }
    expect(seen).toEqual(sorted.map((row) => row.id));
  });
});

describe('a cursor handed back alone continues the walk it names', () => {
  const findings: PageWalk<{ readonly check: string; readonly projectId: number }, readonly [number]> = {
    operation: 'read_findings',
    order: 1,
    selection: Schema.Struct({ check: Schema.String, projectId: Schema.Number }),
    key: Schema.Tuple([Schema.Number]),
  };

  test('the narrowing a cursor was minted under reads back typed for its own walk only', () => {
    const cursor = mintCursor(question({ check: 'drift', projectId: 5 }), ['a', 1]);
    expect(recallSelection(findings, cursor)).toEqual({ selection: { check: 'drift', projectId: 5 } });
    expect(recallSelection({ ...findings, operation: 'ready_work' }, cursor)).toEqual({ refused: 'cursor-stale' });
    expect(recallSelection({ ...findings, order: 2 }, cursor)).toEqual({ refused: 'cursor-stale' });
    expect(recallSelection(findings, 'not-a-cursor')).toEqual({ refused: 'bad-cursor' });
  });

  test('a selection its walk cannot read is bad, and so is a cursor no read could have minted', () => {
    expect(recallSelection(findings, mintCursor(question({ check: 7 }), ['a', 1]))).toEqual({ refused: 'bad-cursor' });
    expect(recallSelection(findings, mintCursor({ ...question({}), operation: 'ready_work' }, []))).toEqual({ refused: 'bad-cursor' });
  });

  it.effect('a walk continued from its cursor answers the rows past it, and a foreign cursor is refused', () =>
    Effect.gen(function* () {
      const walks = walking((refused) => refused);
      const rows = Array.from({ length: 5 }, (_, at) => ({ id: at }));
      const keyOf = (row: { id: number }): readonly [number] => [row.id];
      const walked = (cursor: string | undefined) =>
        walks.page({
          walk: findings,
          selection: { check: 'drift', projectId: 5 },
          cursor,
          asked: 2,
          keyOf,
          read: heldRows(rows, keyOf, ['asc']),
        });
      const first = yield* walked(undefined);
      expect((yield* walked(first.next ?? undefined)).rows).toEqual([{ id: 2 }, { id: 3 }]);
      expect(yield* Effect.flip(walked(mintCursor(question({ check: 'other', projectId: 5 }), [1])))).toBe('cursor-stale');
      expect(yield* Effect.flip(walked(mintCursor(question({ check: 'drift', projectId: 5 }), ['one'])))).toBe('bad-cursor');
    }),
  );
});

describe('the constructor holds its own invariants', () => {
  const rows = Array.from({ length: 5 }, (_, at) => ({ id: at }));
  const keyOf = (row: { id: number }) => [row.id];

  test('a page asked for nothing still answers one row and the way on', () => {
    const cut = page({ rows, asked: 0, keyOf, question: question({}), total: 5 });
    expect(cut.shown).toBe(1);
    expect(cut.next).not.toBeNull();
  });

  test('a page a bound cut is never complete, whatever the caller said', () => {
    const cut = page({ rows, asked: 2, keyOf, question: question({}), total: null, complete: true, reason: 'read-ceiling' });
    expect(cut.complete).toBe(false);
  });

  test('a decodable cursor whose position no row could hold is bad', () => {
    const asked = question({});
    for (const position of [[], [{ nested: 1 }], [[1]]]) {
      expect(readCursor(mintCursor(asked, position as never), asked)).toEqual({ refused: 'bad-cursor' });
    }
  });
});
