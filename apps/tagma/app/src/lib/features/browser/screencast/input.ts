import type { InputEvent } from '@tagma/server/browser/contract/wire/screencast';

export type Size = { readonly width: number; readonly height: number };

export type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

export type Point = { readonly x: number; readonly y: number };

type Held = { readonly altKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean };

export const modifiersOf = (event: Held): number =>
  (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

export const pictureIn = (box: Box, picture: Size): Box => {
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
};

export const fractionOf = (at: Point, box: Box, picture: Size, clamped = false): Point | null => {
  const drawn = pictureIn(box, picture);
  const x = (at.x - drawn.left) / drawn.width;
  const y = (at.y - drawn.top) / drawn.height;
  if (clamped) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
};

const BUTTONS = ['left', 'middle', 'right'] as const;

export const buttonOf = (button: number): 'left' | 'middle' | 'right' | 'none' => BUTTONS[button] ?? 'none';

const CONTROL = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Insert',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

const CLIPBOARD = new Set(['KeyC', 'KeyV', 'KeyX']);

export const keyOf = (event: KeyboardEvent, type: 'down' | 'up'): InputEvent | null => {
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.key === 'Unidentified') return null;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && CLIPBOARD.has(event.code)) return null;
  const typed = event.key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey);
  if (!CONTROL.has(event.key) && (typed || event.key.length !== 1)) return null;
  return { kind: 'key', type, key: event.key, code: event.code, modifiers: modifiersOf(event) };
};

export const wantsCopy = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && event.code === 'KeyC' && !event.altKey;

export const wantsCut = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && event.code === 'KeyX' && !event.altKey;
