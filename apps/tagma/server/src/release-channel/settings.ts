import { Schema } from 'effect';
import { PROGRAM_FEED } from '../platform/contract/wire/program.js';
import { settingKey } from '../platform/contract/wire/setting.js';

export const releaseFeed = settingKey({
  id: 'release.feed',
  order: 1500,
  title: 'Release feed',
  description:
    'The address of the public file that names every release of Tagma: its number, its archive, its SHA-256 and whether it can be stepped back from. Tagma reads it when the server starts and once a day, without signing in, and offers the newest release in the status bar and in tagma status. Empty, no release is offered.',
  schema: Schema.String,
  fallback: PROGRAM_FEED ?? '',
  scopes: ['user'],
  merge: 'replace',
});

export const RELEASE_SETTING_KEYS = [releaseFeed] as const;

export const RELEASE_SETTING_SECTIONS = [
  {
    id: 'release',
    order: 160,
    title: 'Releases',
    description: 'Where new releases of Tagma come from.',
  },
] as const;
