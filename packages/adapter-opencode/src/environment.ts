import { join } from 'node:path';
import type { AccountEnvironment } from '@runlith/tagma/adapter/provider';

export const accountEnvironment = (directory: string | null): readonly AccountEnvironment[] => [
  ...(directory === null
    ? []
    : [
        { _tag: 'Set' as const, name: 'HOME', value: directory },
        { _tag: 'Set' as const, name: 'USERPROFILE', value: directory },
        { _tag: 'Set' as const, name: 'XDG_DATA_HOME', value: join(directory, '.local', 'share') },
        { _tag: 'Set' as const, name: 'XDG_STATE_HOME', value: join(directory, '.local', 'state') },
        { _tag: 'Set' as const, name: 'XDG_CACHE_HOME', value: join(directory, '.cache') },
        { _tag: 'Set' as const, name: 'XDG_CONFIG_HOME', value: join(directory, '.config') },
      ]),
  { _tag: 'Unset', name: 'OPENCODE_DB' },
  { _tag: 'Unset', name: 'OPENCODE_TEST_HOME' },
  { _tag: 'Unset', name: 'OPENCODE_DISABLE_CHANNEL_DB' },
  { _tag: 'Unset', name: 'OPENCODE_CONFIG_DIR' },
  { _tag: 'Unset', name: 'OPENCODE_CONFIG' },
  { _tag: 'Unset', name: 'OPENCODE_CONFIG_CONTENT' },
];
