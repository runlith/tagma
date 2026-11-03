import { expect, test } from 'bun:test';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import { foldPath, type FoldInput } from './fold.js';
import { contentOf, type FoldRow } from './folding.js';

function shortest(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const text of a) {
    const next = [0];
    for (let at = 0; at < b.length; at += 1)
      next.push(text === b[at] ? (previous[at] as number) + 1 : Math.max(previous[at + 1] as number, next[at] as number));
    previous = next;
  }
  return previous[b.length] as number;
}

for (const seed of [1, 3, 29, 97])
  test(`three-writer ownership conserves minimal diffs, seed ${seed}`, () => {
    let state = seed;
    const random = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    const pick = <A>(values: readonly A[]): A => values[Math.floor(random() * values.length)] as A;
    const alphabet = ['a\n', 'b\n', 'c\n', '}\n', '\n', 'x\n'];
    const mutate = (lines: readonly string[]): string[] => {
      const next = [...lines];
      for (let i = 0, edits = 1 + Math.floor(random() * 2); i < edits; i += 1) {
        const at = Math.floor(random() * (next.length + 1));
        const operation = random();
        if (operation < 0.4) next.splice(at, 0, pick(alphabet));
        else if (operation < 0.7 && next.length > 0) next.splice(Math.min(at, next.length - 1), 1);
        else if (next.length > 0) next[Math.min(at, next.length - 1)] = pick(alphabet);
      }
      return next;
    };
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const base = Array.from({ length: Math.floor(random() * 6) }, () => pick(alphabet));
      let work = base;
      const rows: FoldRow[] = [];
      for (let at = 0, count = 2 + Math.floor(random() * 3); at < count; at += 1) {
        const after = mutate(work);
        const beforeText = work.join('');
        const afterText = after.join('');
        rows.push({
          id: `row-${at}`,
          holder: pick(['A', 'B', 'C']),
          before: contentOf(beforeText),
          after: contentOf(afterText),
          hunk: workspaceChangeHunk(beforeText, afterText),
        });
        work = after;
      }
      const value: FoldInput = {
        base: contentOf(base.join('')),
        head: contentOf(base.join('')),
        working: contentOf(work.join('')),
        rows,
        normalized: false,
      };
      const context = JSON.stringify({
        seed,
        iteration,
        base,
        rows: rows.map((row) => [row.holder, row.after.kind === 'text' ? row.after.text : null]),
      });
      const check = (input: FoldInput, folded = foldPath(input, stepsIn(100_000))) => {
        if (folded.result.verdict !== 'proven' || folded.result.counts === 'unweighed' || folded.result.lines === 'unweighed')
          throw new Error(`${context}: ${JSON.stringify(folded.result)}`);
        const a = input.head.kind === 'text' ? input.head.lines : [];
        const b = input.working.kind === 'text' ? input.working.lines : [];
        const equal = shortest(a, b);
        expect(folded.result.counts, context).toEqual({ added: b.length - equal, removed: a.length - equal });
        expect(
          folded.result.hands.reduce((sum, hand) => sum + hand.added, folded.result.nobody.added),
          context,
        ).toBe(b.length - equal);
        expect(
          folded.result.hands.reduce((sum, hand) => sum + hand.removed, folded.result.nobody.removed),
          context,
        ).toBe(a.length - equal);
        return { ...folded, result: folded.result, lines: folded.result.lines };
      };
      const answer = check(value);
      expect(answer.result.nobody, context).toEqual({ added: 0, removed: 0 });
    }
  });
