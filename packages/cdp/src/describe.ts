import { Schema } from 'effect';

export const Location = Schema.Struct({
  file: Schema.String,
  line: Schema.NullOr(Schema.Int),
  column: Schema.NullOr(Schema.Int),
  basis: Schema.Literals(['element', 'component', 'stack']),
});

export const Component = Schema.Struct({
  framework: Schema.String,
  name: Schema.NullOr(Schema.String),
  source: Schema.NullOr(Location),
});
export type Component = typeof Component.Type;

export const TEXT_LIMIT = 2_000;
export const HTML_LIMIT = 4_096;

export const ATTRIBUTES = [
  'id',
  'class',
  'name',
  'type',
  'role',
  'href',
  'src',
  'alt',
  'title',
  'placeholder',
  'value',
  'for',
  'action',
  'method',
  'target',
  'rel',
  'data-testid',
  'data-test',
  'data-qa',
] as const;

export const STYLES = [
  'display',
  'position',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'opacity',
  'visibility',
  'z-index',
] as const;

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type Described = {
  readonly tag: string;
  readonly selector: string;
  readonly text: string;
  readonly html: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly styles: Readonly<Record<string, string>>;
  readonly rect: Rect;
};

export const DESCRIBE = `function (attributeNames, styleNames, textLimit, htmlLimit) {
  const element = this.nodeType === 1 ? this : this.parentElement;
  if (!element) return null;
  const cut = (text, limit) => (text.length > limit ? text.slice(0, limit) + '…' : text);
  const quoted = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'));
  const unique = (selector) => { try { return element.ownerDocument.querySelectorAll(selector).length === 1; } catch { return false; } };
  const selectorOf = () => {
    if (element.id && unique('#' + quoted(element.id))) return '#' + quoted(element.id);
    for (const name of ['data-testid', 'data-test', 'data-qa', 'name']) {
      const value = element.getAttribute(name);
      if (value) {
        const selector = element.localName + '[' + name + '="' + value.replace(/"/g, '\\\\"') + '"]';
        if (unique(selector)) return selector;
      }
    }
    const parts = [];
    let at = element;
    while (at && at.nodeType === 1 && parts.length < 8) {
      if (at.id && unique('#' + quoted(at.id))) { parts.unshift('#' + quoted(at.id)); break; }
      const parent = at.parentElement;
      if (!parent) { parts.unshift(at.localName); break; }
      const same = Array.from(parent.children).filter((child) => child.localName === at.localName);
      parts.unshift(same.length > 1 ? at.localName + ':nth-of-type(' + (same.indexOf(at) + 1) + ')' : at.localName);
      at = parent;
    }
    return parts.join(' > ');
  };
  const attributes = {};
  for (const name of attributeNames) {
    if (name === 'value' && 'value' in element && typeof element.value === 'string') attributes.value = element.value;
    else if (element.hasAttribute(name)) attributes[name] = element.getAttribute(name);
  }
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('aria-')) attributes[attribute.name] = attribute.value;
  }
  const computed = element.ownerDocument.defaultView.getComputedStyle(element);
  const styles = {};
  for (const name of styleNames) styles[name] = computed.getPropertyValue(name);
  const box = element.getBoundingClientRect();
  return {
    tag: element.localName,
    selector: selectorOf(),
    text: cut((element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim(), textLimit),
    html: cut(element.outerHTML, htmlLimit),
    attributes,
    styles,
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}`;

export const COMPONENT = `function () {
  const descriptor = Object.getOwnPropertyDescriptor;
  const prototype = Object.getPrototypeOf;
  const apply = Reflect.apply;
  const functionText = Function.prototype.toString;
  const own = (object, key) => {
    if (object === null || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
    const property = descriptor(object, key);
    return property && 'value' in property ? property.value : undefined;
  };
  const text = (value) => typeof value === 'string' && value.length <= 65536 ? value : null;
  const named = (type, display = true) => {
    for (let depth = 0; type && depth < 8; depth++) {
      const name = text((display && own(type, 'displayName')) || own(type, 'name') || own(type, '__name'));
      if (name) return name;
      type = own(type, 'render') || own(type, 'type');
    }
    return null;
  };
  const source = (file, line, column, basis) => text(file) ? {
    file, line: Number.isInteger(line) && line > 0 ? line : null,
    column: Number.isInteger(column) && column > 0 ? column : null,
    basis,
  } : null;
  const frameOf = (stack, name) => {
    if (!text(stack) || !name) return null;
    for (const frame of stack.split('\\n').slice(0, 20)) {
      const match = /^\\s*at (.*?) \\((.+):(\\d+):(\\d+)\\)$/.exec(frame);
      if (match && (match[1] === name || match[1].endsWith('.' + name))) return source(match[2], Number(match[3]), Number(match[4]), 'stack');
    }
    return null;
  };
  const withoutHook = (object) => {
    for (let depth = 0; object && depth < 16; depth++, object = prototype(object)) {
      if (descriptor(object, 'prepareStackTrace')) return false;
    }
    return object === null;
  };
  let nativeStack = null;
  const svelte = (element) => {
    const meta = own(element, '__svelte_meta');
    const loc = own(meta, 'loc');
    const file = text(own(loc, 'file'));
    if (!file) return null;
    const name = file.split(/[\\\\/]/).pop().replace(/\\.svelte$/, '');
    return { framework: 'svelte', name, source: source(file, own(loc, 'line'), own(loc, 'column') + 1, 'element') };
  };
  const react = (element) => {
    let fiber;
    let keys = 0;
    for (const key in element) {
      if (++keys > 128) break;
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) { fiber = own(element, key); break; }
    }
    if (!fiber || (!descriptor(fiber, '_debugOwner') && !descriptor(fiber, '_debugSource') && !descriptor(fiber, '_debugStack'))) return null;
    let owner = fiber;
    let name = null;
    for (let depth = 0; owner && depth < 32; depth++) {
      name = named(own(owner, 'type'));
      if (name) break;
      owner = own(owner, '_debugOwner') || own(owner, 'return');
    }
    const renderName = named(own(owner, 'type'), false) || name;
    const loc = own(fiber, '_debugSource');
    let location = source(own(loc, 'fileName'), own(loc, 'lineNumber'), own(loc, 'columnNumber'), 'element');
    const error = own(fiber, '_debugStack');
    const stack = error && descriptor(error, 'stack');
    if (!location && stack) {
      if ('value' in stack) location = frameOf(stack.value, renderName);
      else if (typeof stack.get === 'function' && text(own(error, 'message'))) {
        const constructor = own(prototype(error), 'constructor');
        const globalError = own(globalThis, 'Error');
        if (constructor && globalError && withoutHook(constructor) && withoutHook(globalError) && apply(functionText, constructor, []) === 'function Error() { [native code] }') {
          const native = descriptor(new constructor(), 'stack');
          if (native && native.get === stack.get) nativeStack = { error, get: stack.get, constructor, globalError, name: renderName };
        }
      }
    }
    return name || location ? { framework: 'react', name, source: location } : null;
  };
  const vue = (element) => {
    const instance = own(element, '__vueParentComponent');
    const type = own(instance, 'type');
    const context = own(instance, 'ctx');
    if (!type || !context || typeof descriptor(context, '_')?.get !== 'function') return null;
    const file = text(own(type, '__file'));
    const name = named(type) || (file ? file.split(/[\\\\/]/).pop().replace(/\\.vue$/, '') : null);
    return name || file ? { framework: 'vue', name, source: source(file, null, null, 'component') } : null;
  };
  let element = this.nodeType === 1 ? this : this.parentElement;
  let component = null;
  for (let depth = 0; element && depth < 32 && !component; depth++, element = element.parentElement || (element.parentNode && element.parentNode.host)) {
    for (const read of [svelte, react, vue]) {
      component = read(element);
      if (component) break;
    }
  }
  return () => {
    if (component && nativeStack && withoutHook(nativeStack.constructor) && withoutHook(nativeStack.globalError)) {
      const location = frameOf(apply(nativeStack.get, nativeStack.error, []), nativeStack.name);
      if (location) return { ...component, source: location };
    }
    return component;
  };
}`;

const SECRET_NAME = /pass|secret|token|key|auth|session|credential|otp|pin|cvc|cvv|card/i;
const SECRET_VALUE = /^(?:[A-Za-z0-9+/_-]{32,}={0,2}|eyJ[\w-]+\.[\w-]+\.[\w-]+|[a-f0-9]{32,})$/;
const SECRET_QUERY = /([?&](?:[^=&]*(?:token|key|secret|auth|session|sig|password)[^=&]*)=)[^&#]*/gi;

export const REDACTED = '[redacted]';

export function redacted(described: Described): Described {
  const kind = (described.attributes.type ?? '').toLowerCase();
  const field = `${described.attributes.name ?? ''} ${described.attributes.id ?? ''} ${described.attributes['aria-label'] ?? ''}`;
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(described.attributes)) {
    if (name === 'value' && (kind === 'password' || kind === 'hidden' || SECRET_NAME.test(field))) attributes[name] = REDACTED;
    else if (SECRET_VALUE.test(value)) attributes[name] = REDACTED;
    else if (name === 'href' || name === 'src' || name === 'action') attributes[name] = value.replace(SECRET_QUERY, `$1${REDACTED}`);
    else attributes[name] = value;
  }
  const secret = kind === 'password' || kind === 'hidden' || SECRET_NAME.test(field);
  const html = (secret ? described.html.replace(/(\svalue=")[^"]*(")/gi, `$1${REDACTED}$2`) : described.html).replace(
    SECRET_QUERY,
    `$1${REDACTED}`,
  );
  return { ...described, attributes, html };
}
