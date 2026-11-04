import { Effect, Schema } from 'effect';

export const BUILDS = ['chrome-for-testing', 'installed-chrome'] as const;
export type BuildId = (typeof BUILDS)[number];

const WINDOWS = ['hidden', 'shown'] as const;
export type WindowMode = (typeof WINDOWS)[number];

export const ManagedDocument = Schema.Struct({
  build: Schema.Literals(BUILDS).annotate({
    description:
      'The Chromium build the profile runs: `chrome-for-testing`, which the server downloads, or `installed-chrome`, the Google Chrome installed on this machine with a data directory of its own.',
  }),
  window: Schema.Literals(WINDOWS)
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed('hidden' as const)))
    .annotate({
      description:
        'How the browser runs: `hidden` without a window, `shown` as an ordinary windowed browser on this machine, each page in its own window. Sites that refuse headless browsers, Google sign-in among them, need `shown` on `installed-chrome`. Absent: `hidden`.',
    }),
});
export type ManagedDocument = typeof ManagedDocument.Type;

export const MANAGED = 'managed';
