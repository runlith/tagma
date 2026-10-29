import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

export type Highlighting = 'focus' | 'descendant';

export interface CollectionConduct {
  readonly highlighting: Highlighting;
  readonly loop?: boolean;
  readonly tracksPointer?: () => boolean;
  readonly selected?: () => string | undefined;
}

export interface CollectionItem {
  readonly value?: string;
  readonly disabled?: boolean;
  readonly textValue?: string;
  readonly onSelect?: (event: Event) => void;
}

const PAUSE_MS = 1000;

let serial = 0;

export class Typeahead {
  private buffer = '';
  private at = -Infinity;

  get typing(): boolean {
    return this.buffer !== '' && performance.now() - this.at <= PAUSE_MS;
  }

  seek(key: string, labels: readonly string[], current: number): number {
    const now = performance.now();
    this.buffer = now - this.at > PAUSE_MS ? key : this.buffer + key;
    this.at = now;
    const buffer = this.buffer.toLocaleLowerCase();
    const letter = key.toLocaleLowerCase();
    const repeated = [...buffer].every((char) => char === letter);
    const query = repeated ? letter : buffer;
    const start = repeated ? current + 1 : Math.max(current, 0);
    for (let step = 0; step < labels.length; step += 1) {
      const index = (start + step) % labels.length;
      if (labels[index]!.toLocaleLowerCase().startsWith(query)) return index;
    }
    return -1;
  }
}

export const byDocument = (a: HTMLElement, b: HTMLElement): number =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

const isTextEntry = (element: HTMLElement): boolean =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;

export class Collection {
  #highlighted = $state.raw<HTMLElement | null>(null);

  private current: HTMLElement | null = null;
  private fieldElement: HTMLElement | null = null;
  private readonly entries = new Map<HTMLElement, () => CollectionItem>();
  private readonly typeahead = new Typeahead();

  constructor(private readonly conduct: () => CollectionConduct) {}

  get highlighted(): HTMLElement | null {
    return this.#highlighted;
  }

  get value(): string | undefined {
    const highlighted = this.highlighted;
    return highlighted === null ? undefined : this.entries.get(highlighted)?.().value;
  }

  items(): HTMLElement[] {
    return [...this.entries.keys()].sort(byDocument);
  }

  enabled(): HTMLElement[] {
    return this.items().filter((element) => this.entries.get(element)?.().disabled !== true);
  }

  find(value: string): HTMLElement | undefined {
    for (const [element, options] of this.entries) if (options().value === value) return element;
    return undefined;
  }

  first(): HTMLElement | undefined {
    return this.enabled()[0];
  }

  last(): HTMLElement | undefined {
    return this.enabled().at(-1);
  }

  highlight(element: HTMLElement | null | undefined): void {
    this.mark(element ?? null);
    this.current?.scrollIntoView({ block: 'nearest' });
  }

  at(target: EventTarget | null): HTMLElement | undefined {
    for (let node = target instanceof Element ? target : null; node !== null && node !== this.fieldElement; node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const options = this.entries.get(node);
      if (options !== undefined) return untrack(options).disabled === true ? undefined : node;
    }
    return undefined;
  }

  point(element: HTMLElement): void {
    const options = this.entries.get(element);
    if (options !== undefined && untrack(options).disabled !== true && this.tracks()) this.mark(element);
  }

  select(element: HTMLElement, event: Event): void {
    const options = this.entries.get(element)?.();
    if (options !== undefined && options.disabled !== true) options.onSelect?.(event);
  }

  readonly field: Attachment<HTMLElement> = (element) => {
    this.fieldElement = element;
    if (!element.hasAttribute('tabindex') && !isTextEntry(element)) element.tabIndex = -1;
    if (this.current !== null && this.focusing() === false) element.setAttribute('aria-activedescendant', this.current.id);
    element.addEventListener('keydown', this.key);
    return () => {
      element.removeEventListener('keydown', this.key);
      if (this.fieldElement === element) this.fieldElement = null;
    };
  };

  item(options: () => CollectionItem): Attachment<HTMLElement> {
    return (element) => {
      this.entries.set(element, options);
      const focusing = this.focusing();
      if (focusing) element.tabIndex = -1;
      else {
        element.id ||= `collection-item-${(serial += 1)}`;
        const selected = untrack(this.conduct).selected;
        if (selected === undefined) element.setAttribute('aria-selected', 'false');
        else $effect(() => element.setAttribute('aria-selected', String(options().value === selected())));
      }
      const hover = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') this.point(element);
      };
      const leave = (): void => {
        if (focusing && this.current === element && this.tracks()) this.mark(null);
      };
      const click = (event: MouseEvent): void => this.select(element, event);
      const focus = (): void => this.mark(element);
      const keepField = (event: MouseEvent): void => event.preventDefault();
      element.addEventListener('pointermove', hover);
      element.addEventListener('pointerleave', leave);
      element.addEventListener('click', click);
      if (focusing) element.addEventListener('focus', focus);
      else element.addEventListener('mousedown', keepField);
      return () => {
        element.removeEventListener('mousedown', keepField);
        element.removeEventListener('pointermove', hover);
        element.removeEventListener('pointerleave', leave);
        element.removeEventListener('click', click);
        element.removeEventListener('focus', focus);
        this.entries.delete(element);
        if (this.current !== element) return;
        this.mark(null);
        if (!focusing) queueMicrotask(() => this.current === null && this.highlight(this.first()));
      };
    };
  }

  private tracks(): boolean {
    return untrack(this.conduct).tracksPointer?.() !== false;
  }

  private focusing(): boolean {
    return untrack(this.conduct).highlighting === 'focus';
  }

  private mark(next: HTMLElement | null): void {
    const previous = this.current;
    const focusing = this.focusing();
    if (previous !== next) {
      previous?.removeAttribute('data-highlighted');
      next?.setAttribute('data-highlighted', '');
      this.current = next;
      this.#highlighted = next;
      if (!focusing) {
        if (untrack(this.conduct).selected === undefined) {
          previous?.setAttribute('aria-selected', 'false');
          next?.setAttribute('aria-selected', 'true');
        }
        if (next === null) this.fieldElement?.removeAttribute('aria-activedescendant');
        else this.fieldElement?.setAttribute('aria-activedescendant', next.id);
      }
    }
    if (!focusing) return;
    if (next !== null) {
      if (document.activeElement !== next) next.focus({ preventScroll: true });
    } else if (previous !== null && this.held(previous)) {
      this.fieldElement?.focus({ preventScroll: true });
    }
  }

  private held(previous: HTMLElement): boolean {
    const active = document.activeElement;
    if (previous.isConnected) return previous.contains(active);
    return active === null || active === document.body;
  }

  private readonly key = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target !== this.fieldElement && !this.entries.has(target)) return;
    if (this.press(event, isTextEntry(target))) event.preventDefault();
  };

  private press(event: KeyboardEvent, text: boolean): boolean {
    const key = event.key;
    switch (key) {
      case 'ArrowDown':
        return this.move(1);
      case 'ArrowUp':
        return this.move(-1);
      case 'Home':
        this.highlight(this.first());
        return true;
      case 'End':
        this.highlight(this.last());
        return true;
      case 'Enter':
        return this.choose(event);
      case ' ':
        if (text) return false;
        return this.typeahead.typing ? this.type(key) : this.choose(event);
    }
    if (text || [...key].length !== 1) return false;
    return this.type(key);
  }

  private move(step: 1 | -1): boolean {
    const items = this.items();
    const count = items.length;
    const loop = untrack(this.conduct).loop === true;
    let at = this.current === null ? (step > 0 ? -1 : count) : items.indexOf(this.current);
    for (let walked = 0; walked < count; walked += 1) {
      at += step;
      if (at < 0 || at >= count) {
        if (!loop) return true;
        at = (at + count) % count;
      }
      const item = items[at]!;
      if (untrack(this.entries.get(item)!).disabled !== true) {
        this.highlight(item);
        return true;
      }
    }
    return true;
  }

  private choose(event: Event): boolean {
    if (this.current === null) return false;
    this.select(this.current, event);
    return true;
  }

  private type(key: string): boolean {
    const items = this.enabled();
    const labels = items.map((element) => untrack(this.entries.get(element)!).textValue ?? element.textContent?.trim() ?? '');
    const found = this.typeahead.seek(key, labels, this.current === null ? -1 : items.indexOf(this.current));
    if (found !== -1) this.highlight(items[found]);
    return true;
  }
}
