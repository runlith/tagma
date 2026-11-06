import { click, drag, insertText, move, type Point, press, wheel } from '@runlith/cdp/input';
import { chordOf } from '@runlith/cdp/keys';
import type { CommandFailure } from '@runlith/cdp/session';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Action, Aim } from '../contract/service/automation.js';
import { erase, fade, mark } from './cursor.js';
import { inputMode } from './refusal.js';
import type { Attached, Paged } from './drive.js';
import { actionFailed, type Box, boxOf, call, coverOf, describe, locate, locateAt, type Located, pointOf, world } from './target.js';

type Refused = GateRefusal<'stale-ref' | 'element-obscured' | 'action-failed' | 'action-shape' | 'input-mode'>;

const shape = (reason: string) => new GateRefusal('action-shape', reason, ['send the fields this action takes']);

const obscured = (ref: string, by: { readonly ref: string | null; readonly named: string }) =>
  new GateRefusal('element-obscured', `${ref} is covered at its click point by ${by.named}${by.ref === null ? '' : ` (${by.ref})`}`, [
    by.ref === null
      ? 'close or scroll away what covers it, then act again'
      : `act on ${by.ref} first if it is a dialog or banner, or scroll the page`,
  ]);

type Aimed = { readonly point: Point; readonly local: Point; readonly located: Located | null };

const pointAt = (state: Paged, attached: Attached, point: Point) => mark(state, attached, { kind: 'point', ...point });

const markElement = (state: Paged, attached: Attached, located: Located) =>
  boxOf(attached, located, false).pipe(
    Effect.flatMap((box) => mark(state, attached, { kind: 'box', box })),
    Effect.catchTag('GateRefusal', (unseen) => Effect.logDebug(`browser: ${located.ref} shows no agent cursor: ${unseen.reason}`)),
  );

const FOCUSED = `(() => {
  let element = document.activeElement;
  let x = 0;
  let y = 0;
  while (element && (element.localName === 'iframe' || element.localName === 'frame')) {
    let inner = null;
    try { inner = element.contentDocument; } catch (error) { inner = null; }
    if (!inner) return null;
    const frame = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    x += frame.x + element.clientLeft + parseFloat(style.paddingLeft);
    y += frame.y + element.clientTop + parseFloat(style.paddingTop);
    element = inner.activeElement;
  }
  if (!element || element === element.ownerDocument.body || element === element.ownerDocument.documentElement) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? { x: box.x + x, y: box.y + y, width: box.width, height: box.height } : null;
})()`;

const markFocused = Effect.fnUntraced(function* (state: Paged, attached: Attached): Effect.fn.Return<void, CommandFailure> {
  const context = yield* world(attached, attached.main).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
  const focused =
    context === null
      ? null
      : ((yield* attached.session.send('Runtime.evaluate', { expression: FOCUSED, contextId: context, returnByValue: true })).result
          .value as Box | null);
  yield* focused === null ? erase(attached) : mark(state, attached, { kind: 'box', box: focused });
});

const reveal = Effect.fn('browser.reveal')(function* (attached: Attached, located: Located) {
  if (attached.input === 'fast') return yield* boxOf(attached, located);
  let box = yield* boxOf(attached, located, false);
  const { cssVisualViewport: view } = yield* attached.session.send('Page.getLayoutMetrics', undefined, located.child);
  for (;;) {
    const local = box.localCenter;
    const width = box.width;
    const height = box.height;
    if (
      local.x + width / 2 > 0 &&
      local.x - width / 2 < view.clientWidth &&
      local.y + height / 2 > 0 &&
      local.y - height / 2 < view.clientHeight
    )
      return box;
    const offset = { x: box.center.x - local.x, y: box.center.y - local.y };
    yield* attached.human.wheel(
      { x: Math.max(1, offset.x + view.clientWidth / 2), y: Math.max(1, offset.y + view.clientHeight / 2) },
      {
        x: local.x < 0 || local.x > view.clientWidth ? local.x - view.clientWidth / 2 : 0,
        y: local.y < 0 || local.y > view.clientHeight ? local.y - view.clientHeight / 2 : 0,
      },
    );
    yield* attached.pictures.paint;
    const next = yield* boxOf(attached, located, false);
    if (next.center.x === box.center.x && next.center.y === box.center.y)
      return yield* actionFailed(`${located.ref} cannot be reached by scrolling its viewport`);
    box = next;
  }
});

const aimAt = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim,
  clear: boolean,
): Effect.fn.Return<Aimed, CommandFailure | Refused> {
  if (!('ref' in aim)) {
    yield* pointAt(state, attached, aim);
    return { point: { x: aim.x, y: aim.y }, local: { x: aim.x, y: aim.y }, located: null };
  }
  const located = yield* locate(state, attached, aim.ref);
  const box = yield* reveal(attached, located);
  yield* mark(state, attached, { kind: 'box', box });
  let point = box.center;
  if (attached.input === 'human') {
    const { cssVisualViewport: view } = yield* attached.session.send('Page.getLayoutMetrics');
    const { cssVisualViewport: local } =
      located.child === undefined
        ? { cssVisualViewport: view }
        : yield* attached.session.send('Page.getLayoutMetrics', undefined, located.child);
    const offset = { x: box.center.x - box.localCenter.x, y: box.center.y - box.localCenter.y };
    const left = Math.max(0, box.x, offset.x);
    const top = Math.max(0, box.y, offset.y);
    const right = Math.min(view.clientWidth, box.x + box.width, offset.x + local.clientWidth);
    const bottom = Math.min(view.clientHeight, box.y + box.height, offset.y + local.clientHeight);
    if (right <= left || bottom <= top) return yield* actionFailed(`${aim.ref} is outside the visible viewport`);
    const across = (Math.random() < 0.5 ? 0.2 : 0.6) + Math.random() * 0.2;
    point = { x: left + (right - left) * across, y: top + (bottom - top) * (0.2 + Math.random() * 0.6) };
  }
  if (clear) {
    const cover = yield* coverOf(state, attached, located, point);
    if (cover !== null) return yield* obscured(aim.ref, cover);
  }
  return {
    point,
    local:
      attached.input === 'fast'
        ? box.localCenter
        : { x: box.localCenter.x + point.x - box.center.x, y: box.localCenter.y + point.y - box.center.y },
    located,
  };
});

const focusOn = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim | null,
): Effect.fn.Return<void, CommandFailure | Refused> {
  if (aim === null) return yield* markFocused(state, attached);
  if (attached.input === 'human') {
    const aimed = yield* aimAt(state, attached, aim, true);
    return yield* attached.human.click(aimed.local, {}, aimed.located?.child, {
      x: aimed.point.x - aimed.local.x,
      y: aimed.point.y - aimed.local.y,
    });
  }
  if (!('ref' in aim)) {
    yield* pointAt(state, attached, aim);
    const located = yield* locateAt(state, attached, aim);
    if (!(yield* call<boolean>(attached, located, FOCUS))) return yield* actionFailed(`nothing focusable stands at ${aim.x}, ${aim.y}`);
    return;
  }
  const located = yield* locate(state, attached, aim.ref);
  yield* attached.session
    .send('DOM.focus', { backendNodeId: located.anchor.node }, located.child)
    .pipe(
      Effect.catchTag('CommandRefused', () =>
        Effect.flatMap(pointOf(attached, located), (point) => click(attached.session, point, {}, located.child)),
      ),
    );
  yield* markElement(state, attached, located);
});

const FOCUS = `function () {
  for (let element = this.nodeType === 1 ? this : this.parentElement; element; element = element.parentElement || element.getRootNode().host || null) {
    element.focus();
    if (element.matches(':focus')) return true;
  }
  return false;
}`;

const EDITABLE = `(function (doc) {
  let element = doc.activeElement;
  while (element && (element.localName === 'iframe' || element.localName === 'frame' || element.shadowRoot)) {
    if (element.shadowRoot) { element = element.shadowRoot.activeElement || element; break; }
    try { element = element.contentDocument && element.contentDocument.activeElement; } catch { return false; }
  }
  return !!element && (element.isContentEditable || ((!element.disabled && !element.readOnly) && (element.localName === 'textarea' || (element.localName === 'input' && ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(element.type)))));
})`;

const SELECT_ALL = `function () {
  const element = this.nodeType === 1 ? this : this.parentElement;
  element.focus();
  if (typeof element.select === 'function' && 'value' in element) { element.select(); return 'value'; }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const selection = element.ownerDocument.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return 'content';
}`;

const ACTIVE_SELECT_ALL = `(() => {
  let element = document.activeElement;
  while (element && (element.localName === 'iframe' || element.localName === 'frame')) {
    let inner = null;
    try { inner = element.contentDocument; } catch (error) { inner = null; }
    if (!inner) return 'frame';
    element = inner.activeElement;
  }
  if (!element || element === element.ownerDocument.body) return 'none';
  if (typeof element.select === 'function' && 'value' in element) { element.select(); return 'value'; }
  element.ownerDocument.execCommand('selectAll');
  return 'content';
})()`;

const SELECT = `function (wanted) {
  if (this.localName !== 'select') return { refused: 'not a <select> element' };
  const options = Array.from(this.options);
  const picked = [];
  for (const value of wanted) {
    const option = options.find((held) => held.value === value) || options.find((held) => held.label.trim() === value || held.text.trim() === value);
    if (!option) return { refused: 'no option ' + JSON.stringify(value) + ' among ' + options.map((held) => JSON.stringify(held.label || held.value)).slice(0, 20).join(', ') };
    picked.push(option);
  }
  if (!this.multiple && picked.length > 1) return { refused: 'this <select> takes one value' };
  for (const option of options) option.selected = picked.includes(option);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { picked: picked.map((held) => held.value) };
}`;

const CHECKED = `function () {
  const element = this.nodeType === 1 ? this : this.parentElement;
  if ('checked' in element && (element.type === 'checkbox' || element.type === 'radio')) return element.checked;
  const aria = element.getAttribute('aria-checked');
  return aria === null ? null : aria === 'true';
}`;

const FILE_INPUT = `function () { return this.localName === 'input' && this.type === 'file'; }`;

const viewportCenter = Effect.fnUntraced(function* (attached: Attached): Effect.fn.Return<Point, CommandFailure> {
  const metrics = yield* attached.session.send('Page.getLayoutMetrics');
  return { x: metrics.cssVisualViewport.clientWidth / 2, y: metrics.cssVisualViewport.clientHeight / 2 };
});

const fill = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim | null,
  text: string,
): Effect.fn.Return<void, CommandFailure | Refused> {
  if (attached.input === 'human') {
    yield* focusOn(state, attached, aim);
    const context = yield* world(attached, attached.main);
    const editable =
      aim === null
        ? (yield* attached.session.send('Runtime.evaluate', {
            expression: `${EDITABLE}(document)`,
            contextId: context,
            returnByValue: true,
          })).result.value === true
        : yield* call<boolean>(
            attached,
            'ref' in aim ? yield* locate(state, attached, aim.ref) : yield* locateAt(state, attached, aim),
            `function () { return ${EDITABLE}(this.ownerDocument); }`,
          );
    if (!editable) return yield* actionFailed('no editable field holds the focus of the page; fill names a visible editable field by ref');
    const platform = yield* attached.session.send('Runtime.evaluate', {
      expression: 'navigator.platform',
      contextId: context,
      returnByValue: true,
    });
    const all = chordOf(`${String(platform.result.value).startsWith('Mac') ? 'Meta' : 'Control'}+A`);
    const clear = chordOf('Delete');
    if ('key' in all) yield* attached.human.press(all);
    if ('key' in clear) yield* attached.human.press(clear);
    return yield* attached.human.type(text);
  }
  if (aim !== null) {
    const located = 'ref' in aim ? yield* locate(state, attached, aim.ref) : yield* locateAt(state, attached, aim);
    yield* 'ref' in aim ? markElement(state, attached, located) : pointAt(state, attached, aim);
    yield* call<string>(attached, located, SELECT_ALL);
  } else {
    const selected = yield* attached.session.send('Runtime.evaluate', {
      expression: ACTIVE_SELECT_ALL,
      contextId: yield* world(attached, attached.main),
      returnByValue: true,
    });
    if (selected.result.value === 'none') return yield* actionFailed('no field holds the focus of the page; fill names the field by ref');
    if (selected.result.value === 'frame')
      return yield* actionFailed('the focus of the page is inside a cross-origin frame; fill names the field by ref');
    yield* markFocused(state, attached);
  }
  if (text.length === 0) {
    const chord = chordOf('Delete');
    if ('key' in chord) yield* press(attached.session, chord);
    return;
  }
  yield* insertText(attached.session, text);
});

const setChecked = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim,
  wanted: boolean,
): Effect.fn.Return<void, CommandFailure | Refused> {
  const located = 'ref' in aim ? yield* locate(state, attached, aim.ref) : yield* locateAt(state, attached, aim);
  const named = 'ref' in aim ? aim.ref : `the element at ${aim.x}, ${aim.y}`;
  yield* 'ref' in aim ? markElement(state, attached, located) : pointAt(state, attached, aim);
  const before = yield* call<boolean | null>(attached, located, CHECKED);
  if (before === null) {
    const what = 'ref' in aim ? named : `${yield* describe(attached, located)} at ${aim.x}, ${aim.y}`;
    return yield* actionFailed(`${what} is neither a checkbox, a radio nor an element with aria-checked`);
  }
  if (before === wanted) return;
  if ('ref' in aim) {
    const aimed = yield* aimAt(state, attached, aim, true);
    if (attached.input === 'human')
      yield* attached.human.click(aimed.local, {}, located.child, { x: aimed.point.x - aimed.local.x, y: aimed.point.y - aimed.local.y });
    else yield* click(attached.session, aimed.local, {}, located.child);
  } else if (attached.input === 'human') yield* attached.human.click(aim);
  else yield* click(attached.session, aim);
  const after = yield* call<boolean | null>(attached, 'ref' in aim ? yield* locate(state, attached, aim.ref) : located, CHECKED);
  if (after !== wanted) return yield* actionFailed(`clicking ${named} left it ${after === true ? 'checked' : 'unchecked'}`);
});

export const perform = (state: Paged, attached: Attached, action: Action): Effect.Effect<void, CommandFailure | Refused> =>
  performed(state, attached, action).pipe(Effect.ensuring(fade(attached)));

const performed = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  action: Action,
): Effect.fn.Return<void, CommandFailure | Refused> {
  const session = attached.session;
  switch (action.kind) {
    case 'click':
    case 'double-click': {
      const aimed = yield* aimAt(state, attached, action.aim, true);
      const options = { count: action.kind === 'click' ? 1 : 2 };
      if (attached.input === 'human')
        return yield* attached.human.click(aimed.local, options, aimed.located?.child, {
          x: aimed.point.x - aimed.local.x,
          y: aimed.point.y - aimed.local.y,
        });
      yield* click(session, aimed.local, options, aimed.located?.child);
      state.pointer.at = aimed.point;
      return;
    }
    case 'hover': {
      const aimed = yield* aimAt(state, attached, action.aim, false);
      if (attached.input === 'human')
        return yield* attached.human.move(aimed.local, 0, aimed.located?.child, {
          x: aimed.point.x - aimed.local.x,
          y: aimed.point.y - aimed.local.y,
        });
      yield* move(session, aimed.local, 0, aimed.located?.child);
      state.pointer.at = aimed.point;
      return;
    }
    case 'focus':
      return yield* focusOn(state, attached, action.aim);
    case 'fill':
      return yield* fill(state, attached, action.aim, action.text);
    case 'type':
      yield* focusOn(state, attached, action.aim);
      return yield* attached.input === 'human' ? attached.human.type(action.text) : insertText(session, action.text);
    case 'press': {
      const chord = chordOf(action.key);
      if (!('key' in chord))
        return yield* shape(`${JSON.stringify(chord.unknown)} is not a key of the US layout, like Enter, Tab, ArrowDown, a or Control+A`);
      yield* focusOn(state, attached, action.aim);
      return yield* attached.input === 'human' ? attached.human.press(chord) : press(session, chord);
    }
    case 'select': {
      if (!('ref' in action.aim)) return yield* shape('select aims at a <select> by its ref');
      const located = yield* locate(state, attached, action.aim.ref);
      yield* markElement(state, attached, located);
      if (attached.input === 'human')
        return yield* inputMode(attached.profile, 'programmatic option selection; use keyboard input to select at the screen');
      const chosen = yield* call<{ readonly refused?: string }>(attached, located, SELECT, [action.values]);
      if (chosen.refused !== undefined) return yield* actionFailed(`${action.aim.ref}: ${chosen.refused}`);
      return;
    }
    case 'check':
    case 'uncheck':
      return yield* setChecked(state, attached, action.aim, action.kind === 'check');
    case 'scroll': {
      if (action.aim !== null && 'ref' in action.aim && action.dx === 0 && action.dy === 0) {
        const located = yield* locate(state, attached, action.aim.ref);
        return yield* mark(state, attached, { kind: 'box', box: yield* reveal(attached, located) });
      }
      const at = action.aim === null ? yield* viewportCenter(attached) : (yield* aimAt(state, attached, action.aim, false)).point;
      if (action.aim === null) yield* pointAt(state, attached, at);
      return yield* attached.input === 'human'
        ? attached.human.wheel(at, { x: action.dx, y: action.dy })
        : wheel(session, at, { x: action.dx, y: action.dy });
    }
    case 'drag': {
      const from = yield* aimAt(state, attached, action.aim, true);
      const to = yield* aimAt(state, attached, action.to, false);
      if (attached.input === 'human') return yield* attached.human.drag(from.point, to.point);
      yield* drag(session, from.point, to.point);
      state.pointer.at = to.point;
      return;
    }
    case 'upload': {
      if (attached.input === 'human') return yield* inputMode(attached.profile, 'programmatic file assignment; choose files at the screen');
      if (!('ref' in action.aim)) return yield* shape('upload aims at an <input type="file"> by its ref');
      const located = yield* locate(state, attached, action.aim.ref);
      yield* markElement(state, attached, located);
      if (!(yield* call<boolean>(attached, located, FILE_INPUT)))
        return yield* actionFailed(`${action.aim.ref} is not an <input type="file">`);
      return yield* session.send('DOM.setFileInputFiles', { files: [...action.files], backendNodeId: located.anchor.node }, located.child);
    }
  }
});
