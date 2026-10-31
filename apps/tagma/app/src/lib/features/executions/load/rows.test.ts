import { expect, test } from 'vitest';
import type { LoadProcess, LoadRow, LoadRowKind, LoadView } from '@tagma/server/executions/contract/wire/load';
import { executionProcesses, heldListing, listing, rowGpu } from './rows.js';

const loadRow = (key: string, kind: LoadRowKind, rank: number, memoryBytes: number, title = key): LoadRow => ({
  key,
  kind,
  title,
  share: rank,
  rank,
  memoryBytes,
  unread: 0,
  gpu: 0,
  gpuUnread: 0,
  minor: false,
  processes: [],
});

test('Tagma rows stand in one list by the chosen order, and idle ones fold to its end only under CPU without a search', () => {
  const view = {
    rows: [
      loadRow('agent', 'agent', 0.0002, 900, 'release'),
      loadRow('pages', 'renderer', 0.3, 100, 'Page — Docs (example.com)'),
      loadRow('server', 'server', 0.02, 500),
      loadRow('chrome', 'program', 0.5, 50),
    ],
    totals: { others: { count: 0, share: 0, memoryBytes: 0, unread: 0 } },
  } as unknown as LoadView;
  const keys = (shown: readonly { readonly row: LoadRow }[]) => shown.map((one) => one.row.key);
  const byCpu = listing(view, 'cpu', '');
  expect(keys(byCpu.own)).toEqual(['pages', 'server']);
  expect(keys(byCpu.idle)).toEqual(['agent']);
  expect(keys(byCpu.outside)).toEqual(['chrome']);
  const byMemory = listing(view, 'memory', '');
  expect(keys(byMemory.own)).toEqual(['agent', 'server', 'pages']);
  expect(byMemory.idle).toEqual([]);
  expect(keys(listing(view, 'cpu', 'example').own)).toEqual(['pages']);
  const later = {
    ...view,
    rows: [loadRow('server', 'server', 0.6, 500), loadRow('pages', 'renderer', 0.0001, 100), loadRow('chrome', 'program', 0.5, 50)],
  } as LoadView;
  const held = heldListing(byCpu, listing(later, 'cpu', ''));
  expect(keys(held.own)).toEqual(['pages', 'server']);
  expect(held.own[1]?.row.share).toBe(0.6);
  expect(held.idle).toEqual([]);
});

test('a row whose GPU nobody measured shows no figure, never zero', () => {
  expect(rowGpu({ ...loadRow('system', 'kernel', 0.1, 0), gpuUnread: 1 }).text).toBe('—');
  expect(rowGpu({ ...loadRow('gpu', 'graphics', 0.1, 0), gpu: 0.25, gpuUnread: 1 }).text).toBe('≥25%');
});

const process = (pid: number, parent: number | undefined, execution: string | undefined): LoadProcess => ({
  pid,
  birth: `${pid}:0`,
  parent,
  execution,
  name: `p${pid}`,
  share: 0.01,
  memoryBytes: 1,
  killable: true,
});

test("one command's processes stand as a tree under their parents, its other work and what was left running excluded", () => {
  const row = {
    processes: [
      process(30, 20, 'run:1'),
      process(21, 10, 'run:1'),
      process(10, 1, 'run:1'),
      process(20, 10, 'run:1'),
      process(40, 10, 'other:1'),
      process(50, 10, undefined),
    ],
  } as unknown as LoadRow;
  expect(executionProcesses(row, 'run:1').map(({ process: one, depth }) => [one.pid, depth])).toEqual([
    [10, 0],
    [20, 1],
    [30, 2],
    [21, 1],
  ]);
});
