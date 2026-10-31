import { expect, test } from 'bun:test';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { declared, type Hosted, type Metric } from './declared.js';

const PAGE = 'page-1' as PageId;
const SURFACE = 'http://localhost:4000';

test('a process lists the documents its renderer hosts: the interface, a page by id, and each foreign origin on its own process', () => {
  const metrics: Metric[] = [
    { pid: 10, type: 'Browser', creationTime: 1_000.4 },
    { pid: 11, type: 'GPU', creationTime: 1_001 },
    { pid: 12, type: 'Tab', creationTime: 1_002 },
    { pid: 13, type: 'Tab', creationTime: 1_003 },
    { pid: 14, type: 'Tab', creationTime: 1_004 },
    { pid: 15, type: 'Utility', creationTime: 1_005 },
    { pid: 16, type: 'Tab', creationTime: 1_006 },
    { pid: 17, type: 'Tab', creationTime: 0 },
  ];
  const hosted: Hosted[] = [
    {
      role: { kind: 'interface' },
      frames: [
        { pid: 12, origin: SURFACE, main: true },
        { pid: 12, origin: SURFACE, main: false },
        { pid: 12, origin: 'http://notes.localhost:4000', main: false },
      ],
    },
    {
      role: { kind: 'page', page: PAGE },
      frames: [
        { pid: 13, origin: 'https://example.test', main: true },
        { pid: 14, origin: 'https://elsewhere.test', main: false },
      ],
    },
    { role: { kind: 'other' }, frames: [{ pid: 16, origin: 'null', main: true }] },
  ];

  const { processes } = declared(metrics, hosted, 10);

  expect(processes).toEqual([
    { pid: 10, createdMs: 1_000, kind: 'main', documents: [] },
    { pid: 11, createdMs: 1_001, kind: 'graphics', documents: [] },
    {
      pid: 12,
      createdMs: 1_002,
      kind: 'renderer',
      documents: [{ _tag: 'Interface' }, { _tag: 'Origin', origin: 'http://notes.localhost:4000' }],
    },
    { pid: 13, createdMs: 1_003, kind: 'renderer', documents: [{ _tag: 'Page', page: PAGE }] },
    { pid: 14, createdMs: 1_004, kind: 'renderer', documents: [{ _tag: 'Origin', origin: 'https://elsewhere.test' }] },
    { pid: 15, createdMs: 1_005, kind: 'utility', documents: [] },
    { pid: 16, createdMs: 1_006, kind: 'renderer', documents: [] },
  ]);
});
