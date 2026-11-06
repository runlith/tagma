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

export type Pointer = { at: Point | null };

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
};

const lognormal = (sigma: number, median: number) => {
  const at = (tau: number) => (tau <= 0 ? 0 : 0.5 * (1 + erf((Math.log(tau) - Math.log(median)) / (sigma * Math.SQRT2))));
  const whole = at(1);
  return (tau: number) => at(tau) / whole;
};

const ENTRY_MARGIN = 0.15;
const DETOUR_FROM = 120;
const DETOUR_REACH = 260;
const DETOUR_EDGE = 12;

const entry = Effect.fnUntraced(function* (session: Session, target: Point) {
  const { cssVisualViewport: view } = yield* session.send('Page.getLayoutMetrics');
  const low = { x: view.clientWidth * ENTRY_MARGIN, y: view.clientHeight * ENTRY_MARGIN };
  const high = { x: view.clientWidth * (1 - ENTRY_MARGIN), y: view.clientHeight * (1 - ENTRY_MARGIN) };
  const at = { x: between(low.x, high.x), y: between(low.y, high.y) };
  if (Math.hypot(at.x - target.x, at.y - target.y) >= Math.min(view.clientWidth, view.clientHeight) / 4) return at;
  const corner = {
    x: Math.abs(low.x - target.x) > Math.abs(high.x - target.x) ? low.x : high.x,
    y: Math.abs(low.y - target.y) > Math.abs(high.y - target.y) ? low.y : high.y,
  };
  return { x: corner.x + (at.x - corner.x) * 0.2, y: corner.y + (at.y - corner.y) * 0.2 };
});

export const humanInput = (session: Session, pointer: Pointer = { at: null }) => {
  const travel = Effect.fn('cdp.travel')(function* (to: Point, modifiers = 0, child?: string, offset: Point = ORIGIN, held = false) {
    const start = pointer.at ?? (yield* entry(session, { x: to.x + offset.x, y: to.y + offset.y }));
    pointer.at = start;
    const from = { x: start.x - offset.x, y: start.y - offset.y };
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance < 1) return;
    const send = (at: Point) =>
      Effect.andThen(
        session.send(
          'Input.dispatchMouseEvent',
          { type: 'mouseMoved', x: at.x, y: at.y, modifiers, button: held ? 'left' : 'none', buttons: held ? 1 : 0 },
          child,
        ),
        Effect.sync(() => {
          pointer.at = { x: at.x + offset.x, y: at.y + offset.y };
        }),
      );
    const sweep = Effect.fnUntraced(function* (a: Point, b: Point, share: number, duration: number) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return;
      const bend = Math.min(100, Math.max(Math.min(8, length * 0.1), length * share)) * (Math.random() < 0.5 ? -1 : 1);
      const normal = { x: -dy / length, y: dx / length };
      const c1 = { x: a.x + dx * 0.28 + normal.x * bend, y: a.y + dy * 0.28 + normal.y * bend };
      const c2 = { x: a.x + dx * 0.76 + normal.x * bend * 0.5, y: a.y + dy * 0.76 + normal.y * bend * 0.5 };
      const progress = lognormal(between(0.28, 0.42), between(0.42, 0.52));
      const steps = Math.max(4, Math.ceil(duration / between(14, 18)));
      for (let step = 1; step <= steps; step += 1) {
        const eased = progress(step / steps);
        const u = 1 - eased;
        yield* send({
          x: u ** 3 * a.x + 3 * u ** 2 * eased * c1.x + 3 * u * eased ** 2 * c2.x + eased ** 3 * b.x,
          y: u ** 3 * a.y + 3 * u ** 2 * eased * c1.y + 3 * u * eased ** 2 * c2.y + eased ** 3 * b.y,
        });
        yield* rest((duration / steps) * 0.7, (duration / steps) * 1.3);
      }
    });
    const glide = Effect.fnUntraced(function* (a: Point, b: Point, share: number, corrected: boolean) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return;
      const duration = between(220, 320) + Math.sqrt(length) * between(9, 15);
      if (!corrected || length < 24) return yield* sweep(a, b, share, duration);
      const normal = { x: -dy / length, y: dx / length };
      const reach = between(0.9, 0.97);
      const miss = Math.max(-6, Math.min(6, length * between(-0.03, 0.03)));
      let at = { x: a.x + dx * reach + normal.x * miss, y: a.y + dy * reach + normal.y * miss };
      yield* sweep(a, at, share, duration);
      for (let left = Math.random() < 0.6 ? 1 : 2; left > 0; left -= 1) {
        yield* rest(30, 110);
        const gap = { x: b.x - at.x, y: b.y - at.y };
        const part = left === 1 ? 1 : between(0.55, 0.8);
        const aside = left === 1 ? 0 : between(-0.15, 0.15);
        const next = { x: at.x + gap.x * part - gap.y * aside, y: at.y + gap.y * part + gap.x * aside };
        yield* sweep(at, next, 0, between(70, 150) + Math.sqrt(Math.hypot(gap.x, gap.y)) * 3);
        at = next;
      }
    });
    const via = held ? null : yield* detour(from, to, offset, distance);
    if (via === null) yield* glide(from, to, between(0.08, 0.22), true);
    else {
      yield* glide(from, via, between(0.02, 0.06), false);
      const ahead = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      let at = via;
      for (let drift = Math.floor(between(1, 4)); drift > 0; drift -= 1) {
        yield* rest(60, 190);
        const forward = between(0.3, 2);
        const aside = between(-2, 2);
        at = { x: at.x + ahead.x * forward - ahead.y * aside, y: at.y + ahead.y * forward + ahead.x * aside };
        yield* send(at);
      }
      yield* rest(40, 160);
      yield* glide(at, to, between(0.02, 0.06), true);
    }
    pointer.at = { x: to.x + offset.x, y: to.y + offset.y };
  });

  const detour = Effect.fnUntraced(function* (from: Point, to: Point, offset: Point, distance: number) {
    if (distance < DETOUR_FROM || Math.random() >= (distance >= 250 ? 0.75 : 0.55)) return null;
    const { cssVisualViewport: view } = yield* session.send('Page.getLayoutMetrics');
    const along = between(0.35, 0.65);
    const normal = { x: -(to.y - from.y) / distance, y: (to.x - from.x) / distance };
    const inside = (at: Point) =>
      at.x + offset.x > DETOUR_EDGE &&
      at.x + offset.x < view.clientWidth - DETOUR_EDGE &&
      at.y + offset.y > DETOUR_EDGE &&
      at.y + offset.y < view.clientHeight - DETOUR_EDGE;
    for (const away of [Math.min(DETOUR_REACH, distance * between(0.3, 0.6)), distance * 0.3]) {
      const sides = (Math.random() < 0.5 ? [1, -1] : [-1, 1])
        .map((side) => ({
          x: from.x + (to.x - from.x) * along + normal.x * away * side,
          y: from.y + (to.y - from.y) * along + normal.y * away * side,
        }))
        .filter(inside);
      if (sides.length > 0) return sides[0]!;
    }
    return null;
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
    const definition = shortcut && !modifiers.includes('Shift') ? (keyOf(chord.key.code) ?? chord.key) : chord.key;
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
        if (known === undefined) {
          yield* session.send('Input.imeSetComposition', { text: glyph, selectionStart: glyph.length, selectionEnd: glyph.length });
          yield* rest(90, 190);
          yield* session.send('Input.insertText', { text: glyph });
        } else yield* key({ key: known, modifiers: [] });
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
      let spot = at;
      for (const [index, weight] of weights.entries()) {
        yield* wheel(session, spot, { x: (delta.x * weight) / sum, y: (delta.y * weight) / sum });
        yield* rest(35, 90);
        if (index < weights.length - 1 && Math.random() < 0.45) {
          const angle = between(0, Math.PI * 2);
          const reach = between(1, 4);
          spot = { x: spot.x + Math.cos(angle) * reach, y: spot.y + Math.sin(angle) * reach };
          yield* session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none', buttons: 0 });
          pointer.at = spot;
        }
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
                x: pointer.at?.x ?? from.x,
                y: pointer.at?.y ?? from.y,
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
