import type { ThreadTypeRow } from '@tagma/server/threads/contract/wire/birth';
import { expect, test } from 'vitest';

import { launchRows } from './launch.js';

const tagma: ThreadTypeRow = { id: 'tagma', name: 'Tagma', description: 'The Tagma agent.', baseAgentId: 'tagma' };

const devin: ThreadTypeRow = {
  id: 'harness:devin',
  name: 'Devin',
  description: "Devin, run as a thread of Tagma in the thread's own world.",
  baseAgentId: 'harness',
  harness: {
    harness: 'devin',
    presentation: {
      label: 'Devin',
      iconProvider: null,
      mark: null,
      install: null,
      modelProvider: null,
      terminal: true,
      acp: true,
      hosted: false,
      sharedSessions: true,
    },
    binary: '/usr/local/bin/devin',
    version: 'devin 1.9.2',
    unreadable: null,
    serves: null,
    searching: false,
    missing: null,
  },
};

const gemini: ThreadTypeRow = {
  id: 'harness:gemini',
  name: 'Gemini',
  description: "Gemini, run as a thread of Tagma in the thread's own world.",
  baseAgentId: 'harness',
  harness: {
    harness: 'gemini',
    presentation: {
      label: 'Gemini',
      iconProvider: null,
      mark: null,
      install: null,
      modelProvider: null,
      terminal: true,
      acp: false,
      hosted: false,
      sharedSessions: true,
    },
    binary: null,
    version: null,
    unreadable: null,
    serves: null,
    searching: false,
    missing: 'gemini was not found',
  },
};

const cursor: ThreadTypeRow = {
  id: 'harness:cursor',
  name: 'Cursor',
  description: "Cursor, run as a thread of Tagma in the thread's own world.",
  baseAgentId: 'harness',
  harness: {
    harness: 'cursor',
    presentation: {
      label: 'Cursor',
      iconProvider: null,
      mark: null,
      install: null,
      modelProvider: null,
      terminal: true,
      acp: true,
      hosted: true,
      sharedSessions: false,
    },
    binary: '/usr/local/bin/cursor-agent',
    version: null,
    unreadable: 'cursor-agent --version exited 1',
    serves: null,
    searching: false,
    missing: null,
  },
};

test('the CLI offer keeps terminal surfaces in its own order, independently of hosted model routes', () => {
  const hosted: ThreadTypeRow = {
    ...cursor,
    id: 'harness:opencode',
    harness: {
      ...cursor.harness!,
      harness: 'opencode',
      presentation: { ...cursor.harness!.presentation, terminal: false },
      serves: 'opencode',
    },
  };
  const rows = launchRows([tagma, devin, hosted, gemini, cursor]);
  expect(rows.map((row) => row.type)).toEqual(['harness:devin', 'harness:gemini', 'harness:cursor']);
  expect(rows[0]).toMatchObject({ name: 'devin', label: 'Devin', version: 'devin 1.9.2', unavailable: null });
  expect(rows[1]?.unavailable).not.toBeNull();
  expect(rows[2]).toMatchObject({ version: null, unreadable: 'cursor-agent --version exited 1', unavailable: null });
});
