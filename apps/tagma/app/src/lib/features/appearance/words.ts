import type { AppearanceMode } from '@tagma/server/appearance/contract/wire/settings';

export const MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

export const MODE_LABEL: { readonly [M in AppearanceMode]: string } = {
  system: 'Same as the system',
  light: 'Light',
  dark: 'Dark',
};
