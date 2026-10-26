import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TokenStoreFailed } from '@runlith/llm/oauth/storeFailure';
import { Context, Effect } from 'effect';
import { type ImageModel, ImageModels } from '../providers/contract/service/images.js';
import { Settings } from '../settings/contract/service/values.js';
import { makeImageChoice } from './choice.js';

const model = (provider: string, id: string): ImageModel => ({
  provider,
  providerLabel: provider,
  model: id,
  spec: { label: id, inputs: 0, inputTypes: [], transparent: false },
});

const SUBSCRIPTION = model('openai-oauth', 'gpt-image-2');
const KEY = model('xai', 'grok-imagine-image');

const unused = () => Effect.die('the choice reads only the image model setting');

const chosen = (wanted: string, signed: ReturnType<ImageModels['Service']['signed']>) =>
  Effect.flatMap(makeImageChoice, (choice) => choice.of(1)).pipe(
    Effect.provide(
      Context.make(
        Settings,
        Settings.of({
          read: unused,
          value: () => Effect.succeed(wanted as never),
          chain: unused,
          live: unused,
          held: unused,
          changes: unused,
          write: unused,
          amend: unused,
        }),
      ).pipe(Context.add(ImageModels, ImageModels.of({ declared: () => [], signed: () => signed, draw: unused }))),
    ),
  );

it.effect('auto takes the first signed image model, a named one takes it, and off or nothing signed names why there is none', () =>
  Effect.gen(function* () {
    expect(yield* chosen('auto', Effect.succeed([SUBSCRIPTION, KEY]))).toEqual({ _tag: 'Chosen', model: SUBSCRIPTION });
    expect(yield* chosen('xai/grok-imagine-image', Effect.succeed([SUBSCRIPTION, KEY]))).toEqual({ _tag: 'Chosen', model: KEY });
    expect(yield* chosen('off', Effect.succeed([SUBSCRIPTION]))).toMatchObject({ _tag: 'None' });
    expect(yield* chosen('auto', Effect.succeed([]))).toMatchObject({ _tag: 'None' });
    expect(yield* chosen('xai/grok-imagine-image', Effect.succeed([SUBSCRIPTION]))).toMatchObject({ _tag: 'None' });
    expect(yield* chosen('auto', Effect.fail(new TokenStoreFailed({ kind: 'read', reason: 'unreadable' })))).toMatchObject({
      _tag: 'None',
    });
  }),
);
