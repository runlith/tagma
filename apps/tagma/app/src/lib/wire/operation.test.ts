import { Effect } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { operationAnswer } from './operation.js';

const account = '0e937f4c-e47c-422b-b103-17194a7b863d';

it.effect('an answer that crossed as JSON decodes its dates and failures into their declared types', () =>
  Effect.gen(function* () {
    const wire = {
      status: 'set',
      account,
      revision: 2,
      accounts: [
        {
          provider: 'openai-oauth',
          account,
          label: 'a@b.c',
          origin: { kind: 'own' },
          default: true,
          quota: {
            observedAt: '2026-09-29T05:42:33.005Z',
            source: 'reply',
            windows: [{ kind: 'weekly', usedPercent: 79 }],
          },
          restored: true,
          failure: { _tag: 'invalid-response', message: 'the answer did not match' },
          failedAt: 1790712257086,
          problem: null,
        },
      ],
    };
    const answered = yield* operationAnswer('set_default_account', wire);
    expect(answered.status).toBe('set');
    const row = 'accounts' in answered ? answered.accounts[0] : undefined;
    expect(row?.quota?.observedAt).toEqual(new Date('2026-09-29T05:42:33.005Z'));
    expect(row?.failure).toMatchObject({ _tag: 'invalid-response', message: 'the answer did not match' });
  }),
);
