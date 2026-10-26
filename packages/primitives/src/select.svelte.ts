import { getContext, setContext, untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import { byDocument, Collection, Typeahead } from './collection.svelte.js';
import { Float } from './float.svelte.js';
import { focusSafely } from './focus.js';
import { OverlayLayer, type DismissReason, type OpenedBy } from './layer.svelte.js';
import type { PlaceOptions } from './place.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const CONTEXT = Symbol.for('@runlith/primitives/select');

const OPENING_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);

export class Select {
  readonly collection = new Collection(() => ({ highlighting: 'descendant', selected: () => this.selected() }));
  readonly shelf = document.createElement('div');

  #open = $state(false);
  private openings = $state(0);
  private readonly labels = new Map<HTMLElement, () => SelectOption>();
  private readonly typeahead = new Typeahead();

  constructor(
    readonly id: string,
    readonly layer: OverlayLayer,
    readonly float: Float,
    private readonly selected: () => string,
    private readonly pick: (value: string) => void,
    private readonly locked: () => boolean,
  ) {}

  static make(
    id: string,
    selected: () => string,
    pick: (value: string) => void,
    locked: () => boolean,
    placement: PlaceOptions = {},
  ): Select {
    const layer = OverlayLayer.make((reason) => select.close(reason));
    const float = Float.make(
      layer,
      () => layer.triggerElement ?? undefined,
      () => placement,
    );
    const select = new Select(id, layer, float, selected, pick, locked);
    setContext(CONTEXT, select);
    return select;
  }

  static use(): Select {
    const select = getContext<Select | undefined>(CONTEXT);
    if (select === undefined) throw new Error('A select part stands outside a select root');
    return select;
  }

  get open(): boolean {
    return this.#open;
  }

  get value(): string {
    return this.selected();
  }

  get disabled(): boolean {
    return this.locked();
  }

  show(by?: OpenedBy): void {
    if (this.#open || this.locked()) return;
    this.#open = true;
    this.openings += 1;
    this.layer.open(by);
  }

  close(reason?: DismissReason): void {
    if (!this.#open) return;
    this.#open = false;
    this.layer.close(reason);
  }

  listed(): boolean {
    return untrack(() => this.#open);
  }

  item(option: () => SelectOption): Attachment<HTMLElement> {
    return this.collection.item(() => {
      const { value, label, disabled } = option();
      return { value, textValue: label, disabled, onSelect: () => this.choose(value) };
    });
  }

  label(option: () => SelectOption): Attachment<HTMLElement> {
    return (element) => {
      this.labels.set(element, option);
      return () => this.labels.delete(element);
    };
  }

  readonly trigger: Attachment<HTMLElement> = (element) => {
    element.id ||= `${this.id}-trigger`;
    const leave = this.layer.trigger(element);
    const toggle = (): void => (this.#open ? this.close() : this.show());
    const key = (event: KeyboardEvent): void => {
      if (this.#open || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const typed = event.key === ' ' ? this.typeahead.typing : !OPENING_KEYS.has(event.key) && [...event.key].length === 1;
      if (typed) this.seek(event.key);
      else if (OPENING_KEYS.has(event.key)) this.show('keyboard');
      else return;
      event.preventDefault();
    };
    element.addEventListener('click', toggle);
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('click', toggle);
      element.removeEventListener('keydown', key);
      if (typeof leave === 'function') leave();
    };
  };

  readonly listbox: Attachment<HTMLElement> = (element) => {
    let given = 0;
    $effect(() => {
      const opening = this.openings;
      if (opening === given || !this.#open || this.float.placement === undefined) return;
      given = opening;
      untrack(() => this.give(element));
    });
    const named = this.layer.triggerElement?.id;
    if (named) element.setAttribute('aria-labelledby', named);
    const leave = this.layer.surface(element);
    const unfloat = this.float.floating(element);
    const unfield = this.collection.field(element);
    const tab = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') this.close();
    };
    element.addEventListener('keydown', tab);
    return () => {
      element.removeEventListener('keydown', tab);
      if (typeof unfield === 'function') unfield();
      if (typeof unfloat === 'function') unfloat();
      if (typeof leave === 'function') leave();
    };
  };

  private give(element: HTMLElement): void {
    focusSafely(element);
    this.collection.highlight(this.collection.find(this.selected()) ?? this.collection.first());
  }

  private choose(value: string): void {
    this.pick(value);
    this.close();
  }

  private seek(key: string): void {
    const options = [...this.labels.keys()]
      .sort(byDocument)
      .map((element) => this.labels.get(element)!())
      .filter((option) => option.disabled !== true);
    const value = this.selected();
    const found = this.typeahead.seek(
      key,
      options.map((option) => option.label),
      options.findIndex((option) => option.value === value),
    );
    if (found !== -1) this.pick(options[found]!.value);
  }
}
