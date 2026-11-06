import { Service } from '@runlith/layer/key';

type ThemeMode = 'light' | 'dark';

export type Look = {
  readonly id: string;
  readonly mode: ThemeMode;
  readonly terminal: Readonly<Record<string, string>>;
};

export interface ThemePort {
  readonly mode: ThemeMode;
  readonly look: Look;
}

export class Theme extends Service<ThemePort>()('Theme', { tier: 'app' }) {}
