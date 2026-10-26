import type { SettingsPage } from '@tagma/server/platform/contract/wire/refusal';

export type Act = { readonly label: string; readonly run: () => void };

export type Told = {
  readonly text: string;
  readonly note?: string;
  readonly act?: Act;
  readonly settings?: SettingsPage;
  readonly details: readonly string[];
  readonly code?: string;
};

export const hasDetails = (told: Told): boolean => told.details.length > 0 || told.code !== undefined;

export const toldLine = (told: Told): string =>
  told.note === undefined ? told.text : `${told.text}${/[.!?:;…]$/.test(told.text) ? '' : '.'} ${told.note}`;
