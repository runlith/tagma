import { click, drag, insertText, move, type Point, press, wheel } from '@runlith/cdp/input';
import { chordOf } from '@runlith/cdp/keys';
import type { CommandFailure } from '@runlith/cdp/session';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Action, Aim } from '../contract/service/automation.js';
import type { Attached, Paged } from './drive.js';
import { actionFailed, call, coverOf, describe, locate, locateAt, type Located, pointOf, world } from './target.js';

type Refused = GateRefusal<'stale-ref' | 'element-obscured' | 'action-failed' | 'action-shape'>;

const shape = (reason: string) => new GateRefusal('action-shape', reason, ['send the fields this action takes']);

const obscured = (ref: string, by: { readonly ref: string | null; readonly named: string }) =>
  new GateRefusal('element-obscured', `${ref} is covered at its click point by ${by.named}${by.ref === null ? '' : ` (${by.ref})`}`, [
    by.ref === null
      ? 'close or scroll away what covers it, then act again'
      : `act on ${by.ref} first if it is a dialog or banner, or scroll the page`,
  ]);

type Aimed = { readonly point: Point; readonly located: Located | null };

const aimAt = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim,
  clear: boolean,
): Effect.fn.Return<Aimed, CommandFailure | Refused> {
  if (!('ref' in aim)) return { point: { x: aim.x, y: aim.y }, located: null };
  const located = yield* locate(state, attached, aim.ref);
  const point = yield* pointOf(attached, located);
  if (clear) {
    const cover = yield* coverOf(state, attached, located, point);
    if (cover !== null) return yield* obscured(aim.ref, cover);
  }
  return { point, located };
});

const focusOn = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim | null,
): Effect.fn.Return<void, CommandFailure | Refused> {
  if (aim === null) return;
  if (!('ref' in aim)) {
    const located = yield* locateAt(state, attached, aim);
    if (!(yield* call<boolean>(attached, located, FOCUS))) return yield* actionFailed(`nothing focusable stands at ${aim.x}, ${aim.y}`);
    return;
  }
  const located = yield* locate(state, attached, aim.ref);
  yield* attached.session
    .send('DOM.focus', { backendNodeId: located.anchor.node }, located.child)
    .pipe(Effect.catchTag('CommandRefused', () => Effect.flatMap(pointOf(attached, located), (point) => click(attached.session, point))));
});

const FOCUS = `function () {
  for (let element = this.nodeType === 1 ? this : this.parentElement; element; element = element.parentElement || element.getRootNode().host || null) {
    element.focus();
    if (element.matches(':focus')) return true;
  }
  return false;
}`;

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
  if (aim !== null) {
    const located = 'ref' in aim ? yield* locate(state, attached, aim.ref) : yield* locateAt(state, attached, aim);
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
  const before = yield* call<boolean | null>(attached, located, CHECKED);
  if (before === null) {
    const what = 'ref' in aim ? named : `${yield* describe(attached, located)} at ${aim.x}, ${aim.y}`;
    return yield* actionFailed(`${what} is neither a checkbox, a radio nor an element with aria-checked`);
  }
  if (before === wanted) return;
  const point = 'ref' in aim ? (yield* aimAt(state, attached, aim, true)).point : { x: aim.x, y: aim.y };
  yield* click(attached.session, point);
  const after = yield* call<boolean | null>(attached, 'ref' in aim ? yield* locate(state, attached, aim.ref) : located, CHECKED);
  if (after !== wanted) return yield* actionFailed(`clicking ${named} left it ${after === true ? 'checked' : 'unchecked'}`);
});

export const perform = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  action: Action,
): Effect.fn.Return<void, CommandFailure | Refused> {
  const session = attached.session;
  switch (action.kind) {
    case 'click':
    case 'double-click': {
      const aimed = yield* aimAt(state, attached, action.aim, true);
      return yield* click(session, aimed.point, { count: action.kind === 'click' ? 1 : 2 });
    }
    case 'hover': {
      const aimed = yield* aimAt(state, attached, action.aim, false);
      return yield* move(session, aimed.point);
    }
    case 'focus':
      return yield* focusOn(state, attached, action.aim);
    case 'fill':
      return yield* fill(state, attached, action.aim, action.text);
    case 'type':
      yield* focusOn(state, attached, action.aim);
      return yield* insertText(session, action.text);
    case 'press': {
      const chord = chordOf(action.key);
      if (!('key' in chord))
        return yield* shape(`${JSON.stringify(chord.unknown)} is not a key of the US layout, like Enter, Tab, ArrowDown, a or Control+A`);
      yield* focusOn(state, attached, action.aim);
      return yield* press(session, chord);
    }
    case 'select': {
      if (!('ref' in action.aim)) return yield* shape('select aims at a <select> by its ref');
      const located = yield* locate(state, attached, action.aim.ref);
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
        yield* session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: located.anchor.node }, located.child);
        return;
      }
      const at = action.aim === null ? yield* viewportCenter(attached) : (yield* aimAt(state, attached, action.aim, false)).point;
      return yield* wheel(session, at, { x: action.dx, y: action.dy });
    }
    case 'drag': {
      const from = yield* aimAt(state, attached, action.aim, true);
      const to = yield* aimAt(state, attached, action.to, false);
      return yield* drag(session, from.point, to.point);
    }
    case 'upload': {
      if (!('ref' in action.aim)) return yield* shape('upload aims at an <input type="file"> by its ref');
      const located = yield* locate(state, attached, action.aim.ref);
      if (!(yield* call<boolean>(attached, located, FILE_INPUT)))
        return yield* actionFailed(`${action.aim.ref} is not an <input type="file">`);
      return yield* session.send('DOM.setFileInputFiles', { files: [...action.files], backendNodeId: located.anchor.node }, located.child);
    }
  }
});
