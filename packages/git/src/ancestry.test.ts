import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Git } from './Git.js';
import { ancestryOrderAt } from './history.js';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const d = 'd'.repeat(40);

const graph = (rows: string, common: string | null = a): Git['Service'] => ({
  run: (args) =>
    Effect.succeed({
      status: args.includes('merge-base') && common === null ? 1 : 0,
      stdout: args.includes('merge-base') ? (common === null ? '' : `${common}\n`) : rows,
      stderr: '',
      overflow: false,
      messageOverflow: false,
    }),
});

it.effect('an ancestry reading ranks merged commits while unrelated siblings keep admission order', () =>
  Effect.gen(function* () {
    const ranks = yield* ancestryOrderAt(graph(`${b} ${a}\n${c} ${a}\n${d} ${b} ${c}\n`), '/repo', [c, d, a, b], { max: 4, capture: 1024 });
    expect([c, d, a, b].sort((left, right) => ranks.get(left)! - ranks.get(right)!)).toEqual([a, c, b, d]);
    const weighted = yield* ancestryOrderAt(graph(`${b} ${a}\n${c} ${a}\n${d} ${b} ${c}\n`), '/repo', [a, b, b, c, d], {
      max: 4,
      capture: 1024,
    });
    expect(weighted.get(d)).toBe(4);
  }),
);

it.effect('unrelated histories retain their stable input order while descendants follow their ancestors', () =>
  Effect.gen(function* () {
    const ranks = yield* ancestryOrderAt(graph(`${a}\n${b} ${a}\n${d}\n${c} ${b}\n`, null), '/repo', [c, d, b], { max: 4, capture: 1024 });
    expect([c, d, b].sort((left, right) => ranks.get(left)! - ranks.get(right)!)).toEqual([d, b, c]);
  }),
);

it.effect('a bounded reading that omits a requested commit fails rather than guessing ancestry', () =>
  Effect.gen(function* () {
    const result = yield* Effect.flip(ancestryOrderAt(graph(`${b} ${a}\n${c} ${a}\n`), '/repo', [b, c, d], { max: 2, capture: 1024 }));
    expect(result._tag).toBe('GitUnreadable');
  }),
);
