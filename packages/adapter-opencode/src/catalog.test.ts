import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { projectCatalog } from './catalog';
import { modelSelection } from './selection';

const model = {
  id: 'anthropic/claude',
  providerID: 'github-copilot',
  name: 'Claude',
  enabled: true,
  capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
  variants: [{ id: 'high' }, { id: 'max' }],
  limit: { context: 200_000, input: 180_000, output: 32_000 },
};

it.effect('available text-tool models retain identity, capacity, vision and exact vendor variants', () =>
  Effect.gen(function* () {
    const result = yield* projectCatalog(
      {
        data: [
          model,
          { ...model, id: 'audio', capabilities: { tools: true, input: ['audio'], output: ['text'] } },
          { ...model, id: 'chat', capabilities: { tools: false, input: ['text'], output: ['text'] } },
          { ...model, id: 'disabled', enabled: false },
          { ...model, id: 'unknown', limit: { context: 0, output: 0 }, variants: [] },
        ],
      },
      { data: model },
    );
    expect(Object.keys(result.models)).toEqual(['github-copilot/anthropic/claude', 'github-copilot/unknown']);
    expect(result.defaultTextModel).toBe('github-copilot/anthropic/claude');
    expect(result.models[result.defaultTextModel]).toEqual({
      label: 'Claude',
      capacity: { context: 200_000, input: 180_000, output: 32_000 },
      capabilities: ['text', 'vision'],
      reasoning: ['high', 'max'],
      defaultReasoning: null,
      servedAs: 'github-copilot/anthropic/claude',
    });
    expect(result.models['github-copilot/unknown']?.capacity).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(modelSelection(result.defaultTextModel, 'max')).toEqual({
      providerID: 'github-copilot',
      id: 'anthropic/claude',
      variant: 'max',
    });
    expect(Result.isFailure(yield* Effect.result(projectCatalog({ data: [{ id: 'broken' }] }, { data: null })))).toBe(true);
  }),
);
