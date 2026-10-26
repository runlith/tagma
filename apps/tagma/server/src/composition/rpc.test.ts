import { expect, test } from 'bun:test';
import { CallLog } from '../socket/rpc.js';
import { LiveRpc } from './rpc.js';

test('every verb of the live group is annotated', () => {
  const bare = [...LiveRpc.requests.values()].filter((rpc) => !rpc.middlewares.has(CallLog)).map((rpc) => rpc._tag);
  expect(bare).toEqual([]);
});
