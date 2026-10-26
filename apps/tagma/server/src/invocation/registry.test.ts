import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import type { Operation } from '../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../platform/contract/wire/conditions.js';
import { operationRegistry } from './registry.js';

const declared = (bridges: Partial<Operation> = {}): Operation =>
  ({
    callers: 'any',
    tool: undefined,
    meaning: 'm',
    approval: ASKS_NEVER,
    params: Schema.Struct({}),
    refusals: [],
    confirmation: () => ({ summary: 's' }),
    confirmLabel: 'c',
    presentation: { running: 'r', done: 'd' },
    subjects: () => [],
    ...bridges,
  }) as Operation;

const registry = operationRegistry({
  read_overview: declared({ callers: 'any', doors: { http: true }, tool: { capability: 'graph' } }),
  live_act: declared({ callers: 'any', doors: { socket: true, http: false }, tool: undefined }),
  operator_read: declared({ callers: 'operator', doors: { http: true } }),
  harness_report: declared({ callers: 'thread', doors: { http: 'perform' }, tool: undefined }),
});

test('an entry is served to agents over MCP exactly when it declares a tool', () => {
  expect(registry.doors('read_overview')).toEqual(['http', 'mcp']);
  expect(registry.doors('harness_report')).toEqual(['http']);
  expect(registry.doors('operator_read')).toEqual(['http']);
  expect(registry.callers('operator_read')).toBe('operator');
  expect(registry.doors('live_act')).toEqual(['socket']);
});
