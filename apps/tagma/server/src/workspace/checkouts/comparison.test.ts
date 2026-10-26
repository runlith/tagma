import { expect, test } from 'bun:test';
import type { Status } from '@runlith/git/status';
import { mergeScopedReading, type TreeReading } from './comparison.js';

const empty = { staged: [], unstaged: [], untracked: [], unmerged: [] } as const;
const branch = { head: 'head', ref: 'main', upstream: 'origin/main', ahead: 0, behind: 0 };

const reading = (status: Status, areas: TreeReading['areas']): TreeReading => ({
  status,
  sequencer: 'none',
  statusMs: null,
  areas,
  publishTo: null,
});

test('a named path replaces only its rows, retaining whole-tree coverage', () => {
  const previous = reading(
    {
      branch,
      coverage: { untracked: 'all', paths: null },
      entries: {
        ...empty,
        staged: [
          { path: 'dir/a', status: 'modified' },
          { path: 'elsewhere/new', oldPath: 'dir/old', status: 'renamed' },
          { path: 'other', status: 'modified' },
        ],
      },
    },
    {
      ...empty,
      staged: [
        { path: 'dir/a', status: 'modified', lines: { added: 1, removed: 0 } },
        { path: 'elsewhere/new', oldPath: 'dir/old', status: 'renamed', lines: { added: 1, removed: 0 } },
        { path: 'other', status: 'modified', lines: { added: 1, removed: 0 } },
      ],
    },
  );
  const fresh = reading(
    {
      branch,
      coverage: { untracked: 'all', paths: [':(literal)dir'] },
      entries: { ...empty, staged: [{ path: 'dir/a', status: 'added' }], untracked: [{ path: 'dir/new', status: 'untracked' }] },
    },
    {
      ...empty,
      staged: [{ path: 'dir/a', status: 'added', lines: { added: 3, removed: 0 } }],
      untracked: [{ path: 'dir/new', status: 'untracked', lines: { added: 2, removed: 0 } }],
    },
  );

  const merged = mergeScopedReading(previous, fresh, ['dir']);
  expect(merged.status.coverage.paths).toBeNull();
  expect(merged.status.entries.staged.map((row) => row.path)).toEqual(['dir/a', 'other']);
  expect(merged.areas.staged.map((row) => row.lines)).toEqual([
    { added: 3, removed: 0 },
    { added: 1, removed: 0 },
  ]);
  expect(merged.status.entries.untracked.map((row) => row.path)).toEqual(['dir/new']);
});

test('an empty scoped reading removes a disappeared file without clearing unrelated paths', () => {
  const priorStatus: Status = {
    branch,
    coverage: { untracked: 'all', paths: null },
    entries: {
      ...empty,
      unstaged: [
        { path: 'gone', status: 'modified' },
        { path: 'kept', status: 'modified' },
      ],
    },
  };
  const previous = reading(priorStatus, {
    ...empty,
    unstaged: [
      { path: 'gone', status: 'modified', lines: 'unweighed' },
      { path: 'kept', status: 'modified', lines: 'unweighed' },
    ],
  });
  const fresh = reading({ ...priorStatus, entries: empty, coverage: { untracked: 'all', paths: ['gone'] } }, empty);
  expect(mergeScopedReading(previous, fresh, ['gone']).areas.unstaged.map((row) => row.path)).toEqual(['kept']);
});
