import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Trigger } from '../../../graph/contract/wire/enforcement.js';
import type { CheckSubjectKind } from '../../../platform/contract/wire/operation.js';
import { checkedTriggers } from './checks.js';

const subjects: Readonly<Record<string, CheckSubjectKind>> = { submit_work: 'tree', edit: 'file', read_block: 'head' };
const subjectOf = (operation: string) => subjects[operation] ?? null;

it.effect('a trigger declaration accepts both tree and head phases, but only the written file after an edit', () =>
  Effect.gen(function* () {
    const on: readonly Trigger[] = [
      { op: 'submit_work', phase: 'before' },
      { op: 'submit_work', phase: 'after' },
      { op: 'read_block', phase: 'before' },
      { op: 'read_block', phase: 'after' },
      { op: 'edit', phase: 'after' },
    ];
    expect(yield* checkedTriggers(on, subjectOf)).toEqual(on);
  }),
);

it.effect('a file before its write and an operation with no check subject refuse the declaration', () =>
  Effect.gen(function* () {
    for (const on of [[{ op: 'edit', phase: 'before' }], [{ op: 'no_such_op', phase: 'before' }]] as const) {
      const refusal = yield* checkedTriggers(on, subjectOf).pipe(Effect.flip);
      expect(refusal.code).toBe('trigger-unknown');
    }
  }),
);
