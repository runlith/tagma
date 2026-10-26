import { Effect } from 'effect';
import { type Chord, type Modifier, modifierMask } from './keys.js';
import type { CommandFailure, Session } from './session.js';

export type Point = { readonly x: number; readonly y: number };

export type MouseButton = 'left' | 'right' | 'middle';

const BUTTONS: Readonly<Record<MouseButton, number>> = { left: 1, right: 2, middle: 4 };

const EDITING: Readonly<Record<string, readonly string[]>> = {
  KeyA: ['selectAll'],
  KeyC: ['copy'],
  KeyX: ['cut'],
  KeyV: ['paste'],
  KeyZ: ['undo'],
};

export const TEXT_CHUNK = 1000;

export const move = (session: Session, to: Point, modifiers = 0): Effect.Effect<void, CommandFailure> =>
  session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, modifiers, button: 'none', buttons: 0 });

export const click = Effect.fnUntraced(function* (
  session: Session,
  at: Point,
  options: { readonly button?: MouseButton; readonly count?: number; readonly modifiers?: number } = {},
) {
  const button = options.button ?? 'left';
  const modifiers = options.modifiers ?? 0;
  yield* move(session, at, modifiers);
  let down: number | null = null;
  yield* Effect.gen(function* () {
    for (let clickCount = 1; clickCount <= (options.count ?? 1); clickCount += 1) {
      const event = { x: at.x, y: at.y, button, clickCount, modifiers } as const;
      down = clickCount;
      yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed', buttons: BUTTONS[button] });
      yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased', buttons: 0 });
      down = null;
    }
  }).pipe(
    Effect.onError(() =>
      down === null
        ? Effect.void
        : session.post('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: at.x,
            y: at.y,
            button,
            clickCount: down,
            modifiers,
            buttons: 0,
          }),
    ),
  );
});

export const drag = Effect.fnUntraced(function* (session: Session, from: Point, to: Point, steps = 10) {
  yield* move(session, from);
  let at = from;
  let down = true;
  yield* Effect.gen(function* () {
    yield* session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= steps; step += 1) {
      at = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
      yield* session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'left', buttons: 1 });
    }
    yield* session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    down = false;
  }).pipe(
    Effect.onError(() =>
      down
        ? session.post('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 })
        : Effect.void,
    ),
  );
});

export const wheel = (
  session: Session,
  at: Point,
  delta: { readonly x: number; readonly y: number },
): Effect.Effect<void, CommandFailure> =>
  session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: delta.x, deltaY: delta.y });

const MODIFIER_CODES: Readonly<Record<Modifier, number>> = { Alt: 18, Control: 17, Meta: 91, Shift: 16 };

const modifierEvent = (type: 'rawKeyDown' | 'keyUp', modifier: Modifier, modifiers: number) =>
  ({ type, modifiers, key: modifier, code: `${modifier}Left`, windowsVirtualKeyCode: MODIFIER_CODES[modifier], location: 1 }) as const;

export const press = Effect.fnUntraced(function* (session: Session, chord: Chord) {
  const { key } = chord;
  const down: Modifier[] = [];
  let keyDown = false;
  const modifiers = modifierMask(chord.modifiers, key.shifted);
  const shared = { modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, location: key.location };
  const lift = (modifier: Modifier) => modifierEvent('keyUp', modifier, modifierMask(down.slice(0, -1), false));
  yield* Effect.gen(function* () {
    for (const modifier of chord.modifiers) {
      down.push(modifier);
      yield* session.send('Input.dispatchKeyEvent', modifierEvent('rawKeyDown', modifier, modifierMask(down, false)));
    }
    const typed = (modifiers & ~modifierMask([], true)) === 0 && key.text !== undefined;
    const commands = chord.modifiers.length === 1 && chord.modifiers[0] === 'Meta' ? EDITING[key.code] : undefined;
    keyDown = true;
    yield* session.send('Input.dispatchKeyEvent', {
      ...shared,
      type: typed ? 'keyDown' : 'rawKeyDown',
      text: typed ? key.text : undefined,
      unmodifiedText: typed ? key.text : undefined,
      commands: commands === undefined ? undefined : [...commands],
    });
    yield* session.send('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' });
    keyDown = false;
    while (down.length > 0) {
      yield* session.send('Input.dispatchKeyEvent', lift(down.at(-1)!));
      down.pop();
    }
  }).pipe(
    Effect.onError(() =>
      Effect.gen(function* () {
        if (keyDown) yield* session.post('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' });
        while (down.length > 0) {
          yield* session.post('Input.dispatchKeyEvent', lift(down.at(-1)!));
          down.pop();
        }
      }),
    ),
  );
});

export const insertText = Effect.fnUntraced(function* (session: Session, text: string) {
  const glyphs = Array.from(text);
  for (let at = 0; at < glyphs.length; at += TEXT_CHUNK) {
    yield* session.send('Input.insertText', { text: glyphs.slice(at, at + TEXT_CHUNK).join('') });
  }
});
