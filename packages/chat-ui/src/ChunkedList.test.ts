import { describe, expect, test } from 'vitest';
import { ChunkedList } from './ChunkedList';

type Cell = { id: string; value: number };

function cells(from: number, count: number): Cell[] {
  return Array.from({ length: count }, (_, index) => ({ id: `c${from + index}`, value: from + index }));
}

function agree(list: ChunkedList<Cell>, model: readonly Cell[]): void {
  expect(list.length).toBe(model.length);
  expect(list.slice()).toEqual(model);
  for (const [index, cell] of model.entries()) {
    if (index % 37 !== 0 && index !== model.length - 1) continue;
    expect(list.indexOf(cell.id)).toBe(index);
    expect(list.get(cell.id)).toBe(cell);
    expect(list.at(index)).toBe(cell);
  }
}

describe('ChunkedList', () => {
  test('keeps array semantics under splices at head, middle, tail and across chunks', () => {
    const list = new ChunkedList<Cell>((cell) => cell.id);
    const model: Cell[] = [];
    let next = 0;
    let seed = 7;
    const roll = (below: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % below;
    };
    for (let step = 0; step < 220; step += 1) {
      const from = step % 5 === 0 ? 0 : step % 5 === 1 ? model.length : roll(model.length + 1);
      const removed = step % 7 === 0 ? roll(400) : roll(4);
      const inserted = cells(next, step % 11 === 0 ? 300 : roll(6));
      next += inserted.length;
      const gone = list.splice(from, removed, inserted);
      expect(gone).toEqual(model.splice(from, removed, ...inserted));
      if (model.length > 0 && step % 3 === 0) {
        const at = roll(model.length);
        const replacement = { id: model[at]!.id, value: -step };
        expect(list.set(at, replacement)).toBe(model[at]);
        model[at] = replacement;
      }
      agree(list, model);
    }
    expect(model.length).toBeGreaterThan(300);
  });

  test('a removed item is gone from lookups and a key resolves to its current position after a head splice', () => {
    const list = new ChunkedList<Cell>((cell) => cell.id);
    list.splice(0, 0, cells(0, 1000));
    list.splice(0, 0, cells(1000, 50));
    expect(list.indexOf('c999')).toBe(1049);
    expect(list.indexOf('c1000')).toBe(0);
    list.splice(5, 1, []);
    expect(list.has('c1005')).toBe(false);
    expect(list.indexOf('c1006')).toBe(5);
    list.clear();
    expect(list.length).toBe(0);
    expect(list.indexOf('c0')).toBe(-1);
  });
});
