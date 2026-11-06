import type { ColumnView } from './Column.svelte.js';

export const COLUMN_ACTIONS: Readonly<Record<ColumnView, string>> = {
  files: 'files.explorer',
  search: 'files.search',
  git: 'files.changes',
};

export const TAB_PLACES = 9;

export const tabPlace = (place: number): string => `tab.place-${place}`;

const FLOATING = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const TYPING = 'input, textarea, select, [contenteditable], [role="textbox"]';

export const underOverlay = (target: EventTarget | null): boolean => target instanceof Element && target.closest(FLOATING) !== null;

export const typingIn = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.classList.contains('cm-content') && target.closest(TYPING) !== null;
