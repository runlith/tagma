import { Effect } from 'effect';
import { ImageModels } from '../providers/contract/service/images.js';
import type { Unblock } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { ImageChoice, type ImageChoiceAnswer } from './contract/service/choice.js';
import { IMAGE_MODEL_AUTO, IMAGE_MODEL_OFF, imageModel, imageModelChoice } from './contract/wire/settings.js';

const SIGN_IN = 'sign in to a provider that draws pictures, such as ChatGPT';

const none = (reason: string, unblock: Unblock): ImageChoiceAnswer => ({ _tag: 'None', reason, unblock });

const unread = (failure: { readonly message: string }): Effect.Effect<ImageChoiceAnswer> =>
  Effect.succeed(none(`The accounts that could draw cannot be read: ${failure.message}`, ['call again once the accounts read']));

export const makeImageChoice = Effect.gen(function* () {
  const settings = yield* Settings;
  const models = yield* ImageModels;
  return ImageChoice.of({
    of: Effect.fn('ImageChoice.of')(function* (projectId) {
      const wanted = yield* settings.value(imageModel, projectId);
      if (wanted === IMAGE_MODEL_OFF) {
        return none('Pictures are switched off in the settings.', [`set ${imageModel.id} to ${IMAGE_MODEL_AUTO} or to an image model`]);
      }
      return yield* models.signed().pipe(
        Effect.map((signed): ImageChoiceAnswer => {
          const chosen =
            wanted === IMAGE_MODEL_AUTO ? signed[0] : signed.find((model) => imageModelChoice(model.provider, model.model) === wanted);
          if (chosen !== undefined) return { _tag: 'Chosen', model: chosen };
          if (wanted === IMAGE_MODEL_AUTO) return none('No provider you are signed in to draws pictures.', [SIGN_IN]);
          return none(`The image model ${wanted} the settings name is not served by an account you are signed in to.`, [
            SIGN_IN,
            `set ${imageModel.id} to ${IMAGE_MODEL_AUTO}`,
          ]);
        }),
        Effect.catchTags({ TokenStoreFailed: unread, CredentialFileInvalid: unread, CredentialFileFailed: unread, GateRefusal: unread }),
      );
    }),
  });
});
