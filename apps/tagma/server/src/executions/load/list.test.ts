import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import type { LoadGroup, LoadReading } from '@runlith/executions/protocol/evidence';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { PageId } from '../../browser/contract/wire/ids.js';
import { LoadList } from './list.js';
import type { PartNames } from './windows.js';
import type { Named } from './work.js';

const machine = { _tag: 'Local', machine: 'fixture' } as const;
const ref = (execution: string) => Schema.decodeUnknownSync(ExecutionRef)({ installation: 'i', execution, incarnation: 1 });
const thread = Schema.decodeUnknownSync(ThreadId)('01a13616-e64d-7243-bac2-4d8b0e28c96e');
const noParts: PartNames = () => undefined;

const process = (pid: number, cores: number, extra: Partial<LoadGroup['processes'][number]> = {}): LoadGroup['processes'][number] => ({
  identity: { pid, birth: `${pid}:0` },
  parent: 1,
  name: `p${pid}`,
  cores,
  gpu: { _tag: 'Unavailable', reason: 'not measured' },
  memoryBytes: 100,
  signal: true,
  ...extra,
});

const group = (owner: LoadGroup['owner'], cores: number, pid: number): LoadGroup => ({
  owner,
  cores,
  gpuCores: 0,
  gpuUnread: 1,
  memoryBytes: 100,
  unread: 0,
  processes: [process(pid, cores)],
});

const reading = (groups: readonly LoadGroup[], usedBytes = 1): LoadReading => ({
  scope: { host: machine, network: machine },
  observedAt: 1,
  revision: 1,
  takenAtMicros: 1,
  overMicros: 1_000_000,
  cores: 10,
  machineName: 'Computer',
  unresolvedParts: [],
  cpu: groups.reduce((sum, one) => sum + one.cores, 0),
  memory: {
    _tag: 'Measured',
    totalBytes: 1_000_000,
    usedBytes,
    availableBytes: 1,
    source: { adapter: 'a', probe: 'p' },
    pressure: { _tag: 'Unknown', reason: 'unknown', detail: '' },
  },
  groups,
});

const named: Named = {
  work: new Map([
    [
      'typecheck',
      {
        projectId: 5,
        project: 'runlith',
        thread,
        label: 'Typecheck tagma',
        kind: 'command',
        transport: 'pipes',
        session: false,
        since: 20,
      },
    ],
    [
      'earlier',
      { projectId: 5, project: 'runlith', thread, label: 'bun test', kind: 'command', transport: 'pipes', session: false, since: 10 },
    ],
  ]),
  threads: new Map([[thread, { title: 'release-publish', archived: false }]]),
  unread: undefined,
};

test('an agent row holds every execution of its thread with its own label, CPU, memory and processes, what they left running, and the rows add up to the machine', () => {
  const { view } = new LoadList().compose(
    reading([
      group({ _tag: 'Execution', execution: ref('typecheck'), ended: false }, 3, 11),
      group({ _tag: 'Execution', execution: ref('earlier'), ended: true }, 1, 12),
      group({ _tag: 'Program', key: 'chrome', name: 'Google Chrome' }, 2, 13),
      group({ _tag: 'Program', key: 'idle', name: 'Idle' }, 0.01, 14),
      group({ _tag: 'Kernel' }, 0.5, 15),
    ]),
    named,
    noParts,
    1_000,
    [],
  );
  const agent = view.rows.find((row) => row.kind === 'agent');
  expect(agent).toMatchObject({ title: 'release-publish', detail: 'Typecheck tagma', project: { id: 5, name: 'runlith' }, share: 0.4 });
  expect(
    agent?.work?.executions.map(({ execution, label, share, memoryBytes }) => ({
      execution: String(execution.execution),
      label,
      share,
      memoryBytes,
    })),
  ).toEqual([{ execution: 'typecheck', label: 'Typecheck tagma', share: 0.3, memoryBytes: 100 }]);
  expect(agent?.work?.residuals).toEqual([{ origin: ref('earlier'), pid: 12 }]);
  expect(agent?.processes.map(({ pid, parent, execution }) => ({ pid, parent, execution }))).toEqual([
    { pid: 11, parent: 1, execution: 'typecheck:1' },
    { pid: 12, parent: 1, execution: undefined },
  ]);
  expect(view.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(view.share ?? 0, 9);
  expect(view.rows[0]?.key).toBe(agent?.key);
  expect(view.top).toMatchObject({ key: agent?.key, title: 'release-publish' });
  expect(view.rows.find((row) => row.title === 'Idle')?.minor).toBe(true);
  expect(view.totals.others).toMatchObject({ count: 1, share: 0.001 });
});

test("an agent's own harness session is never named as its work, and still gives the row its project", () => {
  const harnessed: Named = {
    ...named,
    work: new Map([
      ...named.work,
      [
        'session',
        {
          projectId: 5,
          project: 'runlith',
          thread,
          label: 'tagma harness-run claude-code',
          kind: 'terminal',
          transport: 'pipes',
          session: true,
          since: 30,
        },
      ],
    ]),
  };
  const agentOf = (groups: readonly LoadGroup[]) =>
    new LoadList().compose(reading(groups), harnessed, noParts, 1_000, []).view.rows.find((row) => row.kind === 'agent');
  const session = group({ _tag: 'Execution', execution: ref('session'), ended: false }, 1, 31);

  const idle = agentOf([session]);
  expect(idle?.detail).toBeUndefined();
  expect(idle?.project).toEqual({ id: 5, name: 'runlith' });
  expect(agentOf([session, group({ _tag: 'Execution', execution: ref('typecheck'), ended: false }, 2, 32)])?.detail).toBe(
    'Typecheck tagma',
  );
});

test("Tagma's own rows add up to its total and its history point, never fold, alone name the top, and the rest of the machine's memory is what it uses beyond them", () => {
  const { view, point } = new LoadList().compose(
    reading(
      [
        {
          ...group({ _tag: 'Installation' }, 1, 21),
          processes: [process(21, 1, { parent: undefined, name: 'bun', role: 'server', reapedCores: 0.75 })],
        },
        group({ _tag: 'Execution', execution: ref('typecheck'), ended: false }, 2, 22),
        group({ _tag: 'Execution', execution: ref('loose'), ended: false }, 0.01, 23),
        group({ _tag: 'Program', key: 'chrome', name: 'Google Chrome' }, 5, 24),
        group({ _tag: 'Kernel' }, 0.5, 25),
      ],
      1_000,
    ),
    {
      ...named,
      work: new Map([
        ...named.work,
        [
          'loose',
          {
            projectId: 5,
            project: 'runlith',
            thread: undefined,
            label: 'bun run dev',
            kind: 'terminal',
            transport: 'pty',
            session: false,
            since: 30,
          },
        ],
      ]),
    },
    noParts,
    1_000,
    [],
  );
  expect(view.rows.find((row) => row.kind === 'work')).toMatchObject({ title: 'bun run dev', minor: false });
  expect(view.rows.find((row) => row.kind === 'server')?.processes).toMatchObject([
    { role: 'server', share: 0.1, reapedShare: 0.075, killable: false },
  ]);
  expect(view.totals.own.count).toBe(3);
  expect(view.totals.own.share).toBeCloseTo(0.301, 9);
  expect(view.totals.outside.share).toBeCloseTo(0.55, 9);
  expect(view.totals.outside.memoryBytes).toBe(700);
  expect(point?.own).toBeCloseTo(0.301, 9);
  expect(view.top).toMatchObject({ title: 'release-publish' });
});

test("an unread population answers no Tagma figures, a partly read one counts what it missed, and Tagma's CPU stands without the machine's", () => {
  const unread = new LoadList().compose(
    {
      ...reading([]),
      overMicros: 0,
      cpu: null,
      memory: { _tag: 'Unknown', reason: 'unknown', detail: '' },
      unread: 'the process table could not be read',
    },
    named,
    noParts,
    1_000,
    [],
  );
  expect(unread.view.totals.own).toMatchObject({ share: null, memoryBytes: null });
  const partial = new LoadList().compose(
    { ...reading([{ ...group({ _tag: 'Installation' }, 1, 21), unread: 1 }]), cpu: null },
    named,
    noParts,
    1_000,
    [],
  );
  expect(partial.view.totals.own).toMatchObject({ share: 0.1, unread: 1 });
  expect(partial.point).toMatchObject({ machine: null, own: 0.1 });
});

test('window parts land in Interface, Graphics and one row per renderer titled by its documents and closing its pages; the server and the terminal host split by role; an unresolved part is named', () => {
  const page = Schema.decodeUnknownSync(PageId)('page-1');
  const parts: PartNames = (key) =>
    key === 'main'
      ? { _tag: 'Interface' }
      : key === 'gpu'
        ? { _tag: 'Graphics' }
        : key === 'pages'
          ? { _tag: 'Renderer', titles: ['Page — Docs (example.com)', 'App — board'], close: [{ page, projectId: 5 }] }
          : undefined;
  const { view } = new LoadList().compose(
    {
      ...reading([
        {
          ...group({ _tag: 'Installation' }, 1.5, 21),
          memoryBytes: 400,
          processes: [
            process(21, 0.5, { parent: undefined, role: 'server' }),
            process(22, 0.2, { parent: 21 }),
            process(23, 0.3, { parent: undefined, role: 'host' }),
            process(24, 0.1, { parent: 23, role: 'holder' }),
          ],
        },
        group({ _tag: 'Part', key: 'main' }, 0.2, 31),
        group({ _tag: 'Part', key: 'gone' }, 0.1, 32),
        group({ _tag: 'Part', key: 'gpu' }, 2, 33),
        group({ _tag: 'Part', key: 'pages' }, 3, 34),
      ]),
      unresolvedParts: [{ part: { key: 'pages', pid: 99, createdMs: 1, precisionMs: 1 }, reason: 'different' }],
    },
    named,
    parts,
    1_000,
    [],
  );
  const row = (kind: string) => view.rows.find((one) => one.kind === kind);
  expect(row('server')).toMatchObject({ title: 'Server', memoryBytes: 200 });
  expect(row('server')?.share).toBeCloseTo(0.11, 9);
  expect(row('server')?.processes.map((one) => one.pid)).toEqual([21, 22]);
  expect(row('host')).toMatchObject({ title: 'Terminal host', memoryBytes: 200 });
  expect(row('host')?.share).toBeCloseTo(0.04, 9);
  expect(row('interface')?.share).toBeCloseTo(0.03, 9);
  expect(row('graphics')).toMatchObject({ title: 'Graphics', share: 0.2 });
  expect(row('renderer')).toMatchObject({ title: 'Page — Docs (example.com), App — board', close: [{ page, projectId: 5 }], share: 0.3 });
  expect(row('renderer')?.processes[0]?.killable).toBe(false);
  expect(view.totals.own.count).toBe(5);
  expect(view.totals.own.share).toBeCloseTo(0.68, 9);
  expect(view.unresolved).toEqual([{ title: 'Page — Docs (example.com), App — board', pid: 99, reason: 'different' }]);
});
