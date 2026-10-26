import { expect, test } from 'bun:test';
import { LANDING_PRESENTATION } from './presentation.js';

test('a landed commit names its checkout and full sha, so the feed can read the commit it made', () => {
  const display = LANDING_PRESENTATION.settled?.(
    { subject: 'Land the parser' },
    {
      status: 'ok',
      submitted: {
        status: 'landed',
        checkout: 'root-1',
        commit: '54c90cb17fcdb1abf24199e5ebe592df98bbfebc',
        committed: ['a.ts'],
        carried: [],
      },
    },
  );
  expect(display).toMatchObject({
    title: '54c90cb',
    subtitle: 'Land the parser',
    reference: { kind: 'commit', checkout: 'root-1', commit: '54c90cb17fcdb1abf24199e5ebe592df98bbfebc' },
  });
});
