import type { BrowserContext, Page } from 'playwright-core';

type NodeStamp = { id: number; tag: string; classes: string; style: string; row: string | null; connected: boolean };
type ContactEvent = { at: number; stamp: number; type: string; target: NodeStamp; row: NodeStamp | null; x: number | null; y: number | null };
type Removal = { at: number; target: NodeStamp; row: NodeStamp | null; replacement: NodeStamp | null; removed: NodeStamp[] };
type Region = { listener: number; target: string; passive: boolean | null; left: number; top: number; right: number; bottom: number; covers: boolean };
type WheelInput = { at: number; stamp: number; x: number; y: number; deltaY: number; defaultPrevented: boolean; path: NodeStamp[]; targetConnectedAfter: boolean; regions: Region[] };
type PositionWrite = { at: number; method: string; top: number | null; behavior: string | null };
type ScrollEvent = { at: number; stamp: number; type: string; top: number };
type PointerInput = { at: number; stamp: number; type: string; trusted: boolean; target: string; offsetX: number; clientX: number; clientY: number; buttons: number };
type WheelListener = { type: string; target: NodeStamp | string; passive: boolean | null; capture: boolean; once: boolean; stack: string; removed: boolean };
export type InputTrace = { contacts: ContactEvent[]; removals: Removal[]; wheels: WheelInput[]; writes: PositionWrite[]; scrolls: ScrollEvent[]; pointers: PointerInput[]; listeners: WheelListener[]; hooks: { scrollTop: boolean; scrollTo: boolean; scrollBy: boolean } };
type TraceGlobal = typeof globalThis & { __standInput?: InputTrace };

export async function observeInput(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const selector = '[data-scrollable][role="group"]';
    const trace: InputTrace = { contacts: [], removals: [], wheels: [], writes: [], scrolls: [], pointers: [], listeners: [], hooks: { scrollTop: false, scrollTo: false, scrollBy: false } };
    (globalThis as TraceGlobal).__standInput = trace;
    const listenerTypes = new Set(['wheel', 'mousewheel', 'DOMMouseScroll']);
    const registered = new Map<string, WheelListener>();
    const listened: { index: number; element: Element }[] = [];
    const listenerKey = (target: EventTarget, type: string, listener: unknown, capture: boolean) => `${type}:${capture}:${String(listener)}:${target === window ? 'window' : target === document ? 'document' : ''}`;
    const describe = (target: EventTarget): NodeStamp | string => (target === window ? 'window' : target === document ? 'document' : target instanceof Node ? stamp(target) : String(target));
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (listenerTypes.has(type)) {
        const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
        const record: WheelListener = {
          type,
          target: describe(this),
          passive: typeof options === 'object' ? options.passive ?? null : null,
          capture,
          once: typeof options === 'object' ? options.once ?? false : false,
          stack: new Error().stack?.split('\n').slice(1, 6).join(' | ') ?? '',
          removed: false,
        };
        trace.listeners.push(record);
        if (this instanceof Element) listened.push({ index: trace.listeners.length - 1, element: this });
        registered.set(listenerKey(this, type, listener, capture), record);
      }
      return Reflect.apply(add, this, [type, listener, options]);
    };
    EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      if (listenerTypes.has(type)) {
        const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
        const record = registered.get(listenerKey(this, type, listener, capture));
        if (record !== undefined) record.removed = true;
      }
      return Reflect.apply(remove, this, [type, listener, options]);
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'lostpointercapture'])
      document.addEventListener(type, (event) => {
        const pointer = event as MouseEvent;
        const target = event.target instanceof Element ? `${event.target.tagName}${event.target.matches(selector) ? '[scroller]' : ''}` : String(event.target);
        trace.pointers.push({ at: performance.now(), stamp: event.timeStamp, type, trusted: event.isTrusted, target, offsetX: pointer.offsetX, clientX: pointer.clientX, clientY: pointer.clientY, buttons: pointer.buttons });
      }, { capture: true, passive: true });
    const identities = new WeakMap<Node, number>();
    let sequence = 0;
    const stamp = (node: Node): NodeStamp => {
      let id = identities.get(node);
      if (id === undefined) { id = ++sequence; identities.set(node, id); }
      const element = node instanceof Element ? node : null;
      return { id, tag: element?.tagName ?? node.nodeName, classes: element?.getAttribute('class') ?? '', style: element?.getAttribute('style') ?? '', row: element?.closest('[data-timeline-key]')?.getAttribute('data-timeline-key') ?? null, connected: node.isConnected };
    };
    document.addEventListener('touchstart', (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const target = event.target;
      const root = target.closest(selector);
      if (root === null) return;
      const row = target.closest('[data-timeline-key]');
      const key = row?.getAttribute('data-timeline-key');
      const receive = (sample: TouchEvent) => {
        const point = sample.touches[0] ?? sample.changedTouches[0];
        trace.contacts.push({ at: performance.now(), stamp: sample.timeStamp, type: sample.type, target: stamp(target), row: row === null ? null : stamp(row), x: point?.clientX ?? null, y: point?.clientY ?? null });
      };
      receive(event);
      let detached = false;
      const observer = new MutationObserver((records) => {
        if (detached || target.isConnected) return;
        detached = true;
        const replacement = key === undefined || key === null ? null : root.querySelector(`[data-timeline-key="${CSS.escape(key)}"]`);
        const removed = records.flatMap((record) => [...record.removedNodes].filter((node) => node === target || node.contains(target)));
        trace.removals.push({ at: performance.now(), target: stamp(target), row: row === null ? null : stamp(row), replacement: replacement === null ? null : stamp(replacement), removed: removed.map(stamp) });
      });
      observer.observe(root, { childList: true, subtree: true });
      const finish = (sample: Event) => {
        receive(sample as TouchEvent);
        observer.disconnect();
        target.removeEventListener('touchend', finish);
        target.removeEventListener('touchcancel', finish);
      };
      target.addEventListener('touchend', finish, { passive: true });
      target.addEventListener('touchcancel', finish, { passive: true });
    }, { capture: true, passive: true });
    document.addEventListener('wheel', (event) => {
      if (!event.isTrusted || !(event.target instanceof Element) || event.target.closest(selector) === null) return;
      const target = event.target;
      const regions = listened
        .filter(({ index, element }) => !trace.listeners[index]!.removed && element.isConnected)
        .map(({ index, element }) => {
          const rect = element.getBoundingClientRect();
          const listener = trace.listeners[index]!;
          return { listener: index, target: `${element.tagName}.${element.getAttribute('class') ?? ''}`, passive: listener.passive, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, covers: event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom };
        });
      const input: WheelInput = { at: performance.now(), stamp: event.timeStamp, x: event.clientX, y: event.clientY, deltaY: event.deltaY, defaultPrevented: event.defaultPrevented, path: event.composedPath().filter((node): node is Node => node instanceof Node).map(stamp), targetConnectedAfter: target.isConnected, regions };
      trace.wheels.push(input);
      queueMicrotask(() => { input.defaultPrevented = event.defaultPrevented; input.targetConnectedAfter = target.isConnected; });
    }, { capture: true, passive: true });
    for (const type of ['scroll', 'scrollend']) document.addEventListener(type, (event) => {
      if (!(event.target instanceof Element) || !event.target.matches(selector)) return;
      trace.scrolls.push({ at: performance.now(), stamp: event.timeStamp, type, top: event.target.scrollTop });
    }, { capture: true, passive: true });
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (descriptor?.set !== undefined) {
      const set = descriptor.set;
      Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor, set(this: Element, value: number) {
        if (this.matches(selector)) trace.writes.push({ at: performance.now(), method: 'scrollTop', top: value, behavior: null });
        set.call(this, value);
      } });
      trace.hooks.scrollTop = true;
    }
    for (const method of ['scrollTo', 'scrollBy'] as const) {
      const native = Element.prototype[method];
      if (typeof native !== 'function') continue;
      Object.defineProperty(Element.prototype, method, { configurable: true, writable: true, value(this: Element, ...args: (number | ScrollToOptions)[]) {
        if (this.matches(selector)) {
          const options = args[0];
          const top = typeof options === 'object' ? options.top ?? null : typeof args[1] === 'number' ? args[1] : null;
          const behavior = typeof options === 'object' ? options.behavior ?? null : null;
          trace.writes.push({ at: performance.now(), method, top, behavior });
        }
        return Reflect.apply(native, this, args);
      } });
      trace.hooks[method] = true;
    }
  });
}

export function readInput(page: Page): Promise<(InputTrace & { properties: string[] }) | undefined> {
  return page.evaluate(() => {
    const trace = (globalThis as TraceGlobal).__standInput;
    if (trace === undefined) return undefined;
    const properties: string[] = [];
    const holders: [string, object][] = [['window', window], ['document', document], ...[...document.querySelectorAll('*')].map((element, index): [string, object] => [`${element.tagName}#${index}`, element])];
    for (const [name, holder] of holders)
      for (const key of ['onwheel', 'onmousewheel'])
        if (key in holder && (holder as Record<string, unknown>)[key] != null) properties.push(`${name}.${key}`);
    return { ...trace, properties };
  });
}
