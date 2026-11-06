import { expect, test } from 'bun:test';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { viewFrameName } from '@tagma/server/executions/contract/wire/viewName';
import { declared, type Frame, type Hosted, type Metric } from './declared.js';

const PAGE = 'page-1' as PageId;
const SURFACE = 'http://localhost:4000';

const frame = (id: number, parent: number | null, pid: number, origin: string, name = ''): Frame => ({ id, parent, pid, origin, name });

test('a renderer lists the documents its frames belong to: the interface, a page whole across renderers, a named view with its nested frames, and foreign origins', () => {
  const metrics: Metric[] = [
    { pid: 10, type: 'Browser', creationTime: 1_000.4 },
    { pid: 11, type: 'GPU', creationTime: 1_001 },
    { pid: 12, type: 'Tab', creationTime: 1_002 },
    { pid: 13, type: 'Tab', creationTime: 1_003 },
    { pid: 14, type: 'Tab', creationTime: 1_004 },
    { pid: 15, type: 'Utility', creationTime: 1_005 },
    { pid: 16, type: 'Tab', creationTime: 1_006 },
    { pid: 17, type: 'Tab', creationTime: 0 },
    { pid: 18, type: 'Tab', creationTime: 1_008 },
    { pid: 19, type: 'Tab', creationTime: 1_009 },
  ];
  const plugin = viewFrameName({ _tag: 'McpView', server: 'notes' });
  const mcp = viewFrameName({ _tag: 'McpView', server: 'linear' });
  const hosted: Hosted[] = [
    {
      role: { kind: 'interface' },
      frames: [
        frame(1, null, 12, SURFACE),
        frame(2, 1, 12, SURFACE),
        frame(3, 1, 18, 'http://notes.localhost:4000', plugin),
        frame(4, 3, 19, 'https://player.example'),
        frame(5, 1, 18, 'http://127.0.0.1:4100', mcp),
        frame(6, 1, 12, 'http://127.0.0.1:4200', 'tagma-view:{"_tag":"McpView"'),
      ],
    },
    {
      role: { kind: 'page', page: PAGE },
      frames: [frame(21, null, 13, 'https://example.test'), frame(22, 21, 14, 'https://elsewhere.test', mcp)],
    },
    { role: { kind: 'other' }, frames: [frame(31, null, 16, 'null')] },
  ];

  const { processes } = declared(metrics, hosted, 10);

  expect(processes).toEqual([
    { pid: 10, createdMs: 1_000, kind: 'main', documents: [] },
    { pid: 11, createdMs: 1_001, kind: 'graphics', documents: [] },
    {
      pid: 12,
      createdMs: 1_002,
      kind: 'renderer',
      documents: [{ _tag: 'Interface' }, { _tag: 'Origin', origin: 'http://127.0.0.1:4200' }],
    },
    { pid: 13, createdMs: 1_003, kind: 'renderer', documents: [{ _tag: 'Page', page: PAGE }] },
    { pid: 14, createdMs: 1_004, kind: 'renderer', documents: [{ _tag: 'Page', page: PAGE }] },
    { pid: 15, createdMs: 1_005, kind: 'utility', documents: [] },
    { pid: 16, createdMs: 1_006, kind: 'renderer', documents: [] },
    {
      pid: 18,
      createdMs: 1_008,
      kind: 'renderer',
      documents: [
        { _tag: 'McpView', server: 'linear' },
        { _tag: 'McpView', server: 'notes' },
      ],
    },
    { pid: 19, createdMs: 1_009, kind: 'renderer', documents: [{ _tag: 'McpView', server: 'notes' }] },
  ]);
});
