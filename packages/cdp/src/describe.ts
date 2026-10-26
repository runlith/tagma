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
