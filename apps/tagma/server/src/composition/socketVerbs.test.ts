import { expect, test } from 'bun:test';
import { OPERATION_IDS } from './catalog.js';
import type { FeedDeclaration } from '../platform/contract/wire/operation.js';
import { COLLECTED_FEEDS } from './manifest.js';
import { SOCKET_VERBS } from './socketBinding.js';

test('every socket act performs a registered operation', () => {
  const unknown = Object.entries(SOCKET_VERBS).filter(([, id]) => !(OPERATION_IDS as readonly string[]).includes(id));
  expect(unknown).toEqual([]);
});

test('every feed that names an operation is a verb of the socket door', () => {
  const feeds: readonly FeedDeclaration[] = COLLECTED_FEEDS;
  expect(
    feeds
      .filter((declared) => declared.performs !== undefined)
      .map((declared) => declared.id)
      .sort(),
  ).toEqual(Object.keys(SOCKET_VERBS).sort());
});
