import { expect, test } from 'bun:test';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import { contentOf } from './folding.js';
import { foldPath } from './fold.js';
import { releasedOf, releaseSpan } from './released.js';

const before = 'base\n';
const after = 'written\n';
const hunk = workspaceChangeHunk(before, after)!;
const witness = { row: 'A', thread: 'writer', reason: 'overwritten', span: releaseSpan(hunk) };

test('a withdrawn hunk identifies its returning lines without keeping their text', () => {
  const input = { base: contentOf(before), head: contentOf(before), working: contentOf(after), rows: [], normalized: false };
  const result = foldPath(input, stepsIn(1000)).result;
  if (result.verdict !== 'proven') throw new Error(result.reason);
  expect([...releasedOf(result, [witness]).values()]).toEqual([
    { thread: 'writer', reason: 'overwritten' },
    { thread: 'writer', reason: 'overwritten' },
  ]);
  expect(releasedOf(result, []).size).toBe(0);
});

test('a live writer keeps ownership when its bytes also match a released witness', () => {
  const row = { id: 'B', holder: 'peer', before: contentOf(before), after: contentOf(after), hunk };
  const result = foldPath({ base: row.before, head: row.before, working: row.after, rows: [row], normalized: false }, stepsIn(1000)).result;
  if (result.verdict !== 'proven') throw new Error(result.reason);
  expect(result.hands).toEqual([{ holder: 'peer', added: 1, removed: 1 }]);
  expect(releasedOf(result, [witness]).size).toBe(0);
});
