import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';

export const IMAGE_INPUTS = 5;

export const IMAGE_OPERATIONS = {
  generate_image: operation('generate_image', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'images', needs: ['images'] },
    callers: 'thread',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'external',
    identity: { key: 'call' },
    meaning:
      'Draw a picture from a description, or change pictures given by path: an icon, a diagram, an illustration, a screen mockup. Draw at once from what was asked, without asking back first; a call takes up to a few minutes.',
    grammar:
      'Write `prompt` as the whole brief: subject, style, composition, colours, any text the picture holds. `images` names pictures to change or draw from — attached ones, ones drawn before, files of the project — by absolute path; a relative path is read from this thread’s scratch. The answer of an earlier call names its file. `transparent` draws on a transparent background, for a cut-out such as an icon or sprite. The answer names the file the picture is kept in; copy it into the project where it belongs, never move it.',
    input: Schema.Struct({
      prompt: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'What to draw, or how to change the given pictures.' }),
      images: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(IMAGE_INPUTS))).annotate({
        description: `Up to ${IMAGE_INPUTS} pictures to change or draw from, by path.`,
      }),
      transparent: Schema.optional(Schema.Boolean).annotate({ description: 'Draw on a transparent background.' }),
    }),
    answer: arms({
      drawn: {
        path: Schema.String,
        url: Schema.String,
        mediaType: Schema.String,
        width: Schema.Int,
        height: Schema.Int,
        model: Schema.String,
        prompt: Schema.String,
      },
    }),
    refusals: ['no-image-model', 'image-input', 'image-limit', 'image-refused'],
    subjects: () => [],
    confirmation: (input) => ({ summary: 'Draw a picture?', facts: [{ label: 'Prompt', value: input.prompt }] }),
    confirmLabel: 'Draw',
    called: (input) => ({ form: 'none', ...(input.prompt === undefined ? {} : { title: input.prompt }) }),
    presentation: { running: 'Drawing a picture', done: 'Drew a picture' },
  }),
};

export type ImageOperationId = keyof typeof IMAGE_OPERATIONS;
