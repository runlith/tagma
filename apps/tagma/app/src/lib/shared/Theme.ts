import type { ThemeMode } from '@tagma/server/appearance/contract/wire/format';
import type { TerminalPalette } from '@tagma/server/appearance/contract/wire/resolve';
import { Service } from '@runlith/layer/key';

export type Look = {
  readonly id: string;
  readonly mode: ThemeMode;
  readonly terminal: TerminalPalette;
};

export interface ThemePort {
  readonly look: Look;
}

export class Theme extends Service<ThemePort>()('Theme', { tier: 'app' }) {}
