import { modelCatalog } from '@runlith/llm/models/catalog';
import { titleModel } from '@tagma/server/threads/contract/wire/settings';
import { expect, test } from 'vitest';
import { modelChoices } from './choices.js';
import { SHIPPED_SERVED } from './testing.js';

test('the model picker offers the thread-model fallback and each served text model by the key naming resolves', () => {
  const models = modelCatalog(SHIPPED_SERVED);
  const offered = modelChoices(models, 'model').map((entry) => entry.value);

  expect(offered).toContain(titleModel.fallback);
  for (const value of offered.filter((entry) => entry !== '')) {
    expect(
      models.modelsByCapability('text').some((model) => model.key === value),
      value,
    ).toBe(true);
  }
});
