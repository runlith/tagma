import { describe, expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { Tool } from './tool';
import { type ToolCatalog, visibleOutputToolNames } from './ToolCatalog';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

const readsABlock = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read a block.',
  parameters: Schema.Struct({}),
  execute: () => Effect.succeed('a block'),
});

const catalog: ToolCatalog = {
  read_block: readsABlock,
  spawn_agent: Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_IN_REVIEW,
    description: 'Start an agent.',
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed('started'),
    mutates: true,
  }),
  offer_ready_answers: Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Offer answers.',
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed('offered'),
    userVisible: true,
  }),
};

describe('visibleOutputToolNames', () => {
  test('a call that changed something counts beside one whose input is the surface', () => {
    expect([...visibleOutputToolNames(catalog)].sort()).toEqual(['offer_ready_answers', 'spawn_agent']);
  });

  test('a catalog of plain reads leaves a silent run nothing to show', () => {
    expect(visibleOutputToolNames({ read_block: readsABlock }).size).toBe(0);
  });
});
