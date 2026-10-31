import { Effect } from 'effect';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mcpToolNamed } from '@runlith/mcp/identity';
import { collectedOperations } from '../composed.js';

it.effect('no operation id is read as an MCP tool name', () =>
  Effect.map(collectedOperations, ({ declarations }) =>
    expect(declarations.filter(({ id }) => mcpToolNamed(id) !== null).map(({ id }) => id)).toEqual([]),
  ),
);
