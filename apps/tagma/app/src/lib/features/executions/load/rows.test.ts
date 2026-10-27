import { expect, test } from 'vitest';
import type { LoadProcess, LoadRow } from '@tagma/server/executions/contract/wire/load';
import { executionProcesses } from './rows.js';

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
