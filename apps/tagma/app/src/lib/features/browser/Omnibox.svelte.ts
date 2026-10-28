import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { type Completion, completion } from './address.js';
import { keyOf, type Listing, listingOf, type Suggestion, type SuggestionSources, suggestions } from './suggestions.js';

export type OmniboxActs = {
  readonly go: (url: string) => void;
  readonly visit: (page: PageId) => void;
};

export class Omnibox {
  open = $state(false);
  typed = $state('');
  readonly rows: readonly Suggestion[];
  readonly chosen: number;

  private completed = $state.raw<Completion | null>(null);
  private picked = $state.raw<Suggestion | null>(null);
  private readonly listing: Listing;
  private field: HTMLInputElement | null = null;

  constructor(
    private readonly sources: () => SuggestionSources,
    readonly address: () => string,
    private readonly acts: OmniboxActs,
  ) {
    this.listing = $derived(listingOf(this.sources()));
    this.rows = $derived(suggestions(this.typed, this.completed, this.listing));
    this.chosen = $derived.by(() => {
      const picked = this.picked;
      if (picked === null) return this.typed.trim() === '' ? -1 : 0;
      const key = keyOf(picked);
      return this.rows.findIndex((row) => keyOf(row) === key);
    });
  }

  readonly input: Attachment<HTMLInputElement> = (field) => {
    untrack(() => {
      this.field = field;
      this.reset();
      field.value = this.address();
    });
    return () => {
      if (this.field === field) this.field = null;
    };
  };

  edit(): void {
    if (this.open) return this.focus();
    this.reset();
    this.open = true;
  }

  focus(): void {
    this.field?.focus({ preventScroll: true });
    this.field?.select();
  }

  close(): void {
    this.open = false;
    this.reset();
    if (this.field !== null) this.field.value = this.address();
  }

  choose(row: Suggestion): void {
    this.field?.blur();
    this.close();
    if (row.kind === 'open') this.acts.visit(row.page);
    else this.acts.go(row.url);
  }

  typing(event: Event): void {
    const field = event.currentTarget as HTMLInputElement;
    const value = field.value;
    const inserted = event instanceof InputEvent && event.inputType.startsWith('insert');
    const atEnd = field.selectionStart === value.length && field.selectionEnd === value.length;
    const done =
      inserted && atEnd
        ? completion(
            value,
            this.listing.rows.map((row) => row.url),
          )
        : null;
    this.picked = null;
    this.typed = value;
    this.completed = done;
    if (done === null) return;
    field.value = done.text;
    field.setSelectionRange(value.length, done.text.length);
  }

  keydown(event: KeyboardEvent): void {
    const field = this.field;
    if (event.isComposing || field === null) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.step(field, event.key === 'ArrowUp' ? -1 : 1);
        return;
      case 'ArrowRight':
      case 'End':
        if (this.completed === null || field.selectionStart === field.selectionEnd || field.selectionEnd !== field.value.length) return;
        event.preventDefault();
        this.accept(field);
        return;
      case 'Enter':
        event.preventDefault();
        this.enter();
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.back(field);
        return;
    }
  }

  private reset(): void {
    this.typed = '';
    this.completed = null;
    this.picked = null;
  }

  private step(field: HTMLInputElement, by: 1 | -1): void {
    const count = this.rows.length;
    if (count === 0) return;
    const at = this.picked === null ? -1 : this.chosen;
    if (by < 0 && at <= 0 && this.picked !== null) return this.restore(field);
    const next = by > 0 ? (at + 1) % count : at <= 0 ? count - 1 : at - 1;
    const row = this.rows[next];
    if (row === undefined) return;
    this.picked = row;
    const shown = row.kind === 'search' ? row.query : row.url;
    field.value = shown;
    field.setSelectionRange(shown.length, shown.length);
  }

  private accept(field: HTMLInputElement): void {
    const end = field.value.length;
    field.setSelectionRange(end, end);
    this.typed = field.value;
    this.completed = null;
  }

  private enter(): void {
    const row = this.picked ?? (this.typed.trim() === '' ? undefined : this.rows[0]);
    if (row === undefined) return this.leave();
    this.choose(row);
  }

  private restore(field: HTMLInputElement): void {
    this.picked = null;
    this.completed = null;
    if (this.typed !== '') {
      field.value = this.typed;
      field.setSelectionRange(this.typed.length, this.typed.length);
      return;
    }
    field.value = this.address();
    field.select();
  }

  private back(field: HTMLInputElement): void {
    if (this.picked !== null || this.completed !== null) return this.restore(field);
    if (this.typed !== '') {
      this.reset();
      field.value = this.address();
      field.select();
      return;
    }
    this.leave();
  }

  private leave(): void {
    this.field?.blur();
    this.close();
  }
}
