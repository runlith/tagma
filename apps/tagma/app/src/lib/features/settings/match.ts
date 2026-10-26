import type { Target } from '@runlith/search-text/match';

export type SettingText = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
};

export function settingTarget(entry: SettingText): Target {
  return { name: entry.title, names: [entry.id], text: [entry.description] };
}
