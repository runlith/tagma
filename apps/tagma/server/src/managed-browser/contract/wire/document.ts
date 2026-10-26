import { Schema } from 'effect';

export const BUILDS = ['chrome-for-testing', 'installed-chrome'] as const;
export type BuildId = (typeof BUILDS)[number];

export const ManagedDocument = Schema.Struct({
  build: Schema.Literals(BUILDS).annotate({
    description:
      'The Chromium build the profile runs: `chrome-for-testing`, which the server downloads, or `installed-chrome`, the Google Chrome installed on this machine with a data directory of its own.',
  }),
});
export type ManagedDocument = typeof ManagedDocument.Type;

export const MANAGED = 'managed';
