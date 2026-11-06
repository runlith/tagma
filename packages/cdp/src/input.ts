import { Effect } from 'effect';
import { type Chord, keyOf, type Modifier, modifierMask } from './keys.js';
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

export const move = (session: Session, to: Point, modifiers = 0, child?: string): Effect.Effect<void, CommandFailure> =>
  session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, modifiers, button: 'none', buttons: 0 }, child);

export const click = Effect.fnUntraced(function* (
  session: Session,
  at: Point,
  options: { readonly button?: MouseButton; readonly count?: number; readonly modifiers?: number } = {},
  child?: string,
) {
  const button = options.button ?? 'left';
  const modifiers = options.modifiers ?? 0;
  yield* move(session, at, modifiers, child);
  let down: number | null = null;
  yield* Effect.gen(function* () {
    for (let clickCount = 1; clickCount <= (options.count ?? 1); clickCount += 1) {
      const event = { x: at.x, y: at.y, button, clickCount, modifiers } as const;
      down = clickCount;
      yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed', buttons: BUTTONS[button] }, child);
      yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased', buttons: 0 }, child);
      down = null;
    }
  }).pipe(
    Effect.onError(() =>
      down === null
        ? Effect.void
        : session.post(
            'Input.dispatchMouseEvent',
            {
              type: 'mouseReleased',
              x: at.x,
              y: at.y,
              button,
              clickCount: down,
              modifiers,
              buttons: 0,
            },
            child,
          ),
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

const between = (low: number, high: number) => low + Math.random() * (high - low);
const rest = (low: number, high: number) => Effect.sleep(between(low, high));
const ORIGIN: Point = { x: 0, y: 0 };

export type Pointer = { at: Point };

export const humanInput = (session: Session, pointer: Pointer = { at: ORIGIN }) => {
  const travel = Effect.fn('cdp.travel')(function* (to: Point, modifiers = 0, child?: string, offset: Point = ORIGIN, held = false) {
    const from = { x: pointer.at.x - offset.x, y: pointer.at.y - offset.y };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    const bend = Math.min(100, Math.max(8, distance * between(0.08, 0.22))) * (Math.random() < 0.5 ? -1 : 1);
    const normal = { x: -dy / distance, y: dx / distance };
    const c1 = { x: from.x + dx * 0.28 + normal.x * bend, y: from.y + dy * 0.28 + normal.y * bend };
    const c2 = { x: from.x + dx * 0.76 + normal.x * bend * 0.5, y: from.y + dy * 0.76 + normal.y * bend * 0.5 };
    const duration = between(160, 280) + Math.sqrt(distance) * between(8, 14);
    const steps = Math.max(12, Math.ceil(duration / 16));
    const overshoot = Math.min(5, distance * 0.015);
    const end = { x: to.x + (dx / distance) * overshoot, y: to.y + (dy / distance) * overshoot };
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const eased = t * t * (3 - 2 * t);
      const u = 1 - eased;
      const at = {
        x: u ** 3 * from.x + 3 * u ** 2 * eased * c1.x + 3 * u * eased ** 2 * c2.x + eased ** 3 * end.x,
        y: u ** 3 * from.y + 3 * u ** 2 * eased * c1.y + 3 * u * eased ** 2 * c2.y + eased ** 3 * end.y,
      };
      yield* session.send(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseMoved',
          x: at.x,
          y: at.y,
          modifiers,
          button: held ? 'left' : 'none',
          buttons: held ? 1 : 0,
        },
        child,
      );
      pointer.at = { x: at.x + offset.x, y: at.y + offset.y };
      yield* rest((duration / steps) * 0.7, (duration / steps) * 1.3);
    }
    yield* rest(20, 55);
    yield* session.send(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: to.x,
        y: to.y,
        modifiers,
        button: held ? 'left' : 'none',
        buttons: held ? 1 : 0,
      },
      child,
    );
    pointer.at = { x: to.x + offset.x, y: to.y + offset.y };
  });

  const touch = Effect.fn('cdp.click')(function* (
    at: Point,
    options: { readonly button?: MouseButton; readonly count?: number; readonly modifiers?: number } = {},
    child?: string,
    offset: Point = ORIGIN,
  ) {
    const button = options.button ?? 'left';
    const modifiers = options.modifiers ?? 0;
    yield* travel(at, modifiers, child, offset);
    yield* rest(65, 165);
    let down: number | null = null;
    yield* Effect.gen(function* () {
      for (let clickCount = 1; clickCount <= (options.count ?? 1); clickCount += 1) {
        const event = { x: at.x, y: at.y, button, modifiers, clickCount } as const;
        down = clickCount;
        yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed', buttons: BUTTONS[button] }, child);
        yield* rest(55, 125);
        yield* session.send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased', buttons: 0 }, child);
        down = null;
        if (clickCount < (options.count ?? 1)) yield* rest(90, 175);
      }
    }).pipe(
      Effect.onError(() =>
        down === null
          ? Effect.void
          : session.post(
              'Input.dispatchMouseEvent',
              {
                type: 'mouseReleased',
                x: at.x,
                y: at.y,
                button,
                modifiers,
                clickCount: down,
                buttons: 0,
              },
              child,
            ),
      ),
    );
  });

  const key = Effect.fn('cdp.key')(function* (chord: Chord) {
    const shortcut = chord.modifiers.some((modifier) => modifier !== 'Shift');
    const modifiers =
      !shortcut && chord.key.shifted && !chord.modifiers.includes('Shift') ? [...chord.modifiers, 'Shift' as const] : chord.modifiers;
    const down: Modifier[] = [];
    const mask = modifierMask(modifiers, false);
    const definition = shortcut && !modifiers.includes('Shift') ? keyOf(chord.key.code)! : chord.key;
    const shared = {
      modifiers: mask,
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      location: definition.location,
    };
    const typed = (mask & ~modifierMask([], true)) === 0 && definition.text !== undefined;
    const commands = modifiers.length === 1 && modifiers[0] === 'Meta' ? EDITING[definition.code] : undefined;
    let held = false;
    yield* Effect.gen(function* () {
      for (const modifier of modifiers) {
        down.push(modifier);
        yield* session.send('Input.dispatchKeyEvent', modifierEvent('rawKeyDown', modifier, modifierMask(down, false)));
        yield* rest(25, 65);
      }
      held = true;
      yield* session.send('Input.dispatchKeyEvent', {
        ...shared,
        type: typed ? 'keyDown' : 'rawKeyDown',
        commands: commands === undefined ? undefined : [...commands],
      });
      if (typed)
        yield* session.send('Input.dispatchKeyEvent', { ...shared, type: 'char', text: definition.text, unmodifiedText: definition.text });
      yield* rest(45, 115);
      yield* session.send('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' });
      held = false;
      while (down.length > 0) {
        const modifier = down.pop()!;
        yield* session.send('Input.dispatchKeyEvent', modifierEvent('keyUp', modifier, modifierMask(down, false)));
      }
    }).pipe(
      Effect.onError(() =>
        Effect.gen(function* () {
          if (held) yield* session.post('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' });
          while (down.length > 0) {
            const modifier = down.pop()!;
            yield* session.post('Input.dispatchKeyEvent', modifierEvent('keyUp', modifier, modifierMask(down, false)));
          }
        }),
      ),
    );
  });

  return {
    move: travel,
    click: touch,
    press: key,
    pause: () => rest(180, 520),
    type: Effect.fn('cdp.type')(function* (text: string) {
      for (const { segment: glyph } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
        const known = keyOf(glyph === '\n' ? 'Enter' : glyph);
        if (known === undefined) yield* session.send('Input.insertText', { text: glyph });
        else yield* key({ key: known, modifiers: [] });
        yield* rest(25, 135);
        if (/\s|[.,;:!?]/u.test(glyph)) yield* rest(65, 220);
      }
    }),
    wheel: Effect.fn('cdp.wheel')(function* (at: Point, delta: { readonly x: number; readonly y: number }) {
      yield* travel(at);
      yield* rest(160, 380);
      const ticks = Math.max(3, Math.ceil(Math.hypot(delta.x, delta.y) / between(65, 110)));
      const weights = Array.from({ length: ticks }, () => between(0.65, 1.35));
      const sum = weights.reduce((total, weight) => total + weight, 0);
      for (const weight of weights) {
        yield* wheel(session, at, { x: (delta.x * weight) / sum, y: (delta.y * weight) / sum });
        yield* rest(35, 90);
      }
    }),
    drag: Effect.fn('cdp.drag')(function* (from: Point, to: Point) {
      yield* travel(from);
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
        yield* rest(100, 210);
        yield* travel(to, 0, undefined, ORIGIN, true);
        yield* rest(70, 150);
        yield* session.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: to.x,
          y: to.y,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        });
        down = false;
      }).pipe(
        Effect.onError(() =>
          down
            ? session.post('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: pointer.at.x,
                y: pointer.at.y,
                button: 'left',
                buttons: 0,
                clickCount: 1,
              })
            : Effect.void,
        ),
      );
    }),
  };
};

export type HumanInput = ReturnType<typeof humanInput>;
