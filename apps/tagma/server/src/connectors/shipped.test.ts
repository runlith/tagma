import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { ConnectorEntry } from './contract/wire/entry.js';
import { SHIPPED_CONNECTORS } from './shipped.js';

const secure = (address: string) => URL.canParse(address) && new URL(address).protocol === 'https:';

test('every shipped connector reads as an entry, has an id of its own and reaches its service over HTTPS', () => {
  const ids = SHIPPED_CONNECTORS.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of SHIPPED_CONNECTORS) {
    const obtain = entry.signIn.kind === 'key' ? entry.signIn.obtain : 'https://unused.invalid';
    expect([entry.id, Schema.is(ConnectorEntry)(entry), secure(entry.url), secure(obtain)]).toEqual([entry.id, true, true, true]);
  }
});
