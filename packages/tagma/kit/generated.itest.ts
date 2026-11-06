import { expect, test } from 'bun:test';
import { syncGenerated } from './generated.js';

test("the plugin SDK's generated types and schemas match the owners' point and operation schemas as they stand", async () => {
  expect(await syncGenerated({ write: false })).toEqual([]);
});
