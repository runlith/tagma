import { expect, test } from 'bun:test';
import { adapter } from './adapter';
import { settings } from './settings';

const product = { mcpServer: 'tagma', client: { name: 'tagma', version: '0' } };
const base = { name: 'Local', baseUrl: 'http://localhost:11434/v1/' };

test.each([
  [
    { ...base, models: [{ id: 'm', context: 8192, output: 9000 }] },
    'Model m: the output limit cannot exceed the context window of 8192 tokens.',
  ],
  [{ ...base, models: [{ id: 'm' }] }, 'Model m needs its context window in tokens.'],
  [
    { ...base, models: [{ id: 'm', context: 8, reasoning: ['low'], defaultReasoning: 'high' }] },
    'Model m: the default reasoning level must be one of its levels.',
  ],
  [{ ...base, baseUrl: 'ftp://host' }, 'The address must be an http or https URL, such as http://localhost:11434/v1.'],
])('settings that cannot serve are refused with their reason', (values, problem) => {
  expect(settings.validate?.(values)).toBe(problem);
});

test('an instance serves only its listed models, each with an output limit inside its window, and none without models', () => {
  const served = adapter({
    product,
    instances: [
      {
        id: 'compat-local',
        secrets: {},
        values: {
          ...base,
          models: [
            { id: 'small', context: 8192 },
            { id: 'large', context: 400000, output: 5000 },
          ],
        },
      },
      { id: 'compat-empty', values: base, secrets: {} },
    ],
  });

  expect(served.map((provider) => provider.id)).toEqual(['compat-local']);
  expect(Object.entries(served[0]!.models).map(([id, spec]) => [id, spec.capacity])).toEqual([
    ['small', { context: 8192, output: 2048 }],
    ['large', { context: 400000, output: 5000 }],
  ]);
  expect(Object.values(served[0]!.models).map((spec) => spec.toolChoice)).toEqual([['auto'], ['auto']]);
});
