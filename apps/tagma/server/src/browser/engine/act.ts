import { click, drag, insertText, move, type Point, press, wheel } from '@runlith/cdp/input';
import { chordOf, keyOf } from '@runlith/cdp/keys';
import type { CommandFailure } from '@runlith/cdp/session';
import { Effect, type Scope } from 'effect';
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

type SelectOption = { readonly value: string; readonly label: string; readonly text: string; readonly disabled: boolean };

type SelectInfo = {
  readonly native: boolean;
  readonly role: string | null;
  readonly multiple: boolean;
  readonly options: readonly SelectOption[];
};

const SELECT_INFO = `function () {
  const native = this.localName === 'select';
  return { native, role: this.getAttribute('role'), multiple: native ? this.multiple : this.getAttribute('aria-multiselectable') === 'true',
    options: native ? Array.from(this.options, option => ({ value: option.value, label: option.label.trim(), text: option.text.trim(), disabled: option.disabled || (option.parentElement.localName === 'optgroup' && option.parentElement.disabled) })) : [] };
}`;

const CUSTOM_OPTION = `function (wanted) {
  const controlled = (this.getAttribute('aria-controls') || this.getAttribute('aria-owns') || '').split(/\\s+/).filter(Boolean).map(id => this.ownerDocument.getElementById(id)).filter(Boolean);
  const roots = this.getAttribute('role') === 'listbox' ? [this] : controlled;
  for (const root of roots) for (const option of root.querySelectorAll('[role="option"]')) {
    if (option.getAttribute('aria-disabled') === 'true') continue;
    if ([option.getAttribute('value'), option.getAttribute('data-value'), option.getAttribute('aria-label'), option.textContent.trim()].includes(wanted)) return option;
  }
  return null;
}`;

const humanKey = Effect.fnUntraced(function* (attached: Attached, key: string) {
  const chord = chordOf(key);
  if (!('key' in chord)) return yield* shape(`${JSON.stringify(key)} is not a keyboard key`);
  yield* attached.human.press(chord);
});

const select = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim,
  values: readonly string[],
): Effect.fn.Return<void, CommandFailure | Refused> {
  if (!('ref' in aim)) return yield* shape('select aims at a selection control by its ref');
  const located = yield* locate(state, attached, aim.ref);
  if (attached.input === 'fast') {
    yield* markElement(state, attached, located);
    const chosen = yield* call<{ readonly refused?: string }>(attached, located, SELECT, [values]);
    if (chosen.refused !== undefined) return yield* actionFailed(`${aim.ref}: ${chosen.refused}`);
    return;
  }
  const info = yield* call<SelectInfo>(attached, located, SELECT_INFO);
  if (values.length !== 1 || info.multiple)
    return yield* inputMode(attached.profile, 'replacing a multiple selection; choose its options with explicit clicks and modifier keys');
  const wanted = values[0]!;
  const options = info.options.filter((option) => !option.disabled);
  const index = options.findIndex((option) => option.value === wanted || option.label === wanted || option.text === wanted);
  if (info.native && index < 0) return yield* actionFailed(`${aim.ref} has no enabled option ${JSON.stringify(wanted)}`);
  if (!info.native && info.role !== 'combobox' && info.role !== 'listbox')
    return yield* inputMode(
      attached.profile,
      'selecting a custom control without an accessible combobox or listbox; click its visible options by ref',
    );
  if (info.native) {
    const label = options[index]!.label || options[index]!.text;
    const folded = label.toLowerCase();
    let length = 1;
    for (const [other, option] of options.entries()) {
      if (other === index) continue;
      const compared = (option.label || option.text).toLowerCase();
      let common = 0;
      while (common < label.length && compared[common] === folded[common]) common += 1;
      length = Math.max(length, common + 1);
    }
    const prefix = label.slice(0, length);
    if (label.length === 0 || length > label.length || Array.from(prefix).some((glyph) => keyOf(glyph) === undefined))
      return yield* inputMode(
        attached.profile,
        'choosing a native option without a unique keyboard prefix in the current key layout; choose it at the screen',
      );
    yield* reveal(attached, located);
    const count = yield* call<number>(
      attached,
      located,
      `function () { return this.ownerDocument.querySelectorAll('input,textarea,select,button,a[href],[tabindex],iframe').length; }`,
    );
    let focused = yield* call<boolean>(attached, located, `function () { return this.matches(':focus'); }`);
    if (focused) {
      yield* humanKey(attached, 'Tab');
      yield* humanKey(attached, 'Shift+Tab');
      focused = yield* call<boolean>(attached, located, `function () { return this.matches(':focus'); }`);
    }
    for (let step = 0; !focused && step <= count; step += 1) {
      yield* humanKey(attached, 'Tab');
      focused = yield* call<boolean>(attached, located, `function () { return this.matches(':focus'); }`);
    }
    if (!focused)
      return yield* inputMode(attached.profile, 'selecting a native control outside the keyboard focus order; choose it at the screen');
    yield* markElement(state, attached, located);
    yield* attached.human.type(prefix);
    yield* humanKey(attached, 'Tab');
    const selected = yield* call<string>(attached, located, 'function () { return this.value; }');
    if (selected !== options[index]!.value)
      return yield* actionFailed(`${aim.ref} did not select ${JSON.stringify(wanted)} through its keyboard`);
    return;
  }
  const aimed = yield* aimAt(state, attached, aim, true);
  yield* attached.human.click(aimed.local, {}, located.child, { x: aimed.point.x - aimed.local.x, y: aimed.point.y - aimed.local.y });
  const reply = yield* attached.session.send(
    'Runtime.callFunctionOn',
    {
      objectId: located.object,
      functionDeclaration: CUSTOM_OPTION,
      arguments: [{ value: wanted }],
      objectGroup: attached.group,
    },
    located.child,
  );
  if (reply.result.objectId === undefined || reply.result.subtype === 'null')
    return yield* inputMode(
      attached.profile,
      'selecting an option outside the custom control’s accessible listbox; click its visible option by ref',
    );
  const { node } = yield* attached.session.send('DOM.describeNode', { objectId: reply.result.objectId }, located.child);
  const ref = state.refs.issue({ ...located.anchor, node: node.backendNodeId });
  const option = yield* aimAt(state, attached, { ref }, true);
  yield* attached.human.pause();
  yield* attached.human.click(option.local, {}, option.located?.child, {
    x: option.point.x - option.local.x,
    y: option.point.y - option.local.y,
  });
});

const upload = Effect.fnUntraced(function* (
  state: Paged,
  attached: Attached,
  aim: Aim,
  files: readonly string[],
): Effect.fn.Return<void, CommandFailure | Refused, Scope.Scope> {
  if (!('ref' in aim)) return yield* shape('upload aims at a file control by its ref');
  const located = yield* locate(state, attached, aim.ref);
  if (attached.input === 'fast') {
    yield* markElement(state, attached, located);
    if (!(yield* call<boolean>(attached, located, FILE_INPUT))) return yield* actionFailed(`${aim.ref} is not an <input type="file">`);
    return yield* attached.session.send('DOM.setFileInputFiles', { files: [...files], backendNodeId: located.anchor.node }, located.child);
  }
  if (files.length === 0)
    return yield* inputMode(attached.profile, 'clearing a file input without a file choice; use the page’s remove control');
  if (attached.chooser.current() !== null) return yield* actionFailed('the page already has an unanswered file chooser');
  const aimed = yield* aimAt(state, attached, aim, true);
  const pending = yield* attached.chooser.arm([...attached.children.keys()]);
  yield* attached.human.click(aimed.local, {}, located.child, { x: aimed.point.x - aimed.local.x, y: aimed.point.y - aimed.local.y });
  yield* attached.session.send('Page.getFrameTree');
  yield* attached.syncEvents();
  const choice = pending.choice;
  if (choice === null)
    return yield* inputMode(
      attached.profile,
      'uploading without a chooser opened by the clicked control; name the visible file-chooser control',
    );
  const { node } = yield* attached.session.send('DOM.describeNode', { backendNodeId: choice.node }, choice.child);
  if (node.attributes?.some((name, index) => index % 2 === 0 && name === 'webkitdirectory'))
    return yield* inputMode(attached.profile, 'choosing a directory; upload takes individual files from a file chooser');
  if (!choice.multiple && files.length > 1) return yield* actionFailed('the opened file chooser takes only one file');
  yield* attached.human.pause();
  yield* attached.chooser.supply(choice, files);
}, Effect.scoped);

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
    case 'select':
      return yield* select(state, attached, action.aim, action.values);
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
    case 'upload':
      return yield* upload(state, attached, action.aim, action.files);
  }
});
