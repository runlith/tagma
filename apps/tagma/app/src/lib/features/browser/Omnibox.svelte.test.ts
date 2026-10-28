// @vitest-environment jsdom
import { PageId } from '@tagma/server/browser/contract/wire/ids';
import { afterEach, expect, test } from 'vitest';
import { Omnibox, type OmniboxActs } from './Omnibox.svelte.js';
import type { SuggestionSources } from './suggestions.js';
import { pageOf } from './testing/page.js';

afterEach(() => document.body.replaceChildren());

function acts() {
  const went: string[] = [];
  const visited: PageId[] = [];
  const told: OmniboxActs = { go: (url) => void went.push(url), visit: (page) => void visited.push(page) };
  return { told, went, visited };
}

function field(omnibox: Omnibox): HTMLInputElement {
  const input = document.createElement('input');
  document.body.append(input);
  omnibox.input(input);
  input.addEventListener('input', (event) => omnibox.typing(event));
  input.addEventListener('keydown', (event) => omnibox.keydown(event));
  return input;
}

const press = (input: HTMLInputElement, key: string) => input.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
}

test('Enter visits the row the field shows even after live sources reorder the list', () => {
  const [here, one, two] = [pageOf('here'), pageOf('one'), pageOf('two')];
  let sources = $state<SuggestionSources>({ served: [], open: [here, one, two], closed: [], current: here.id });
  const { told, visited } = acts();
  const omnibox = new Omnibox(
    () => sources,
    () => here.url,
    told,
  );
  const input = field(omnibox);

  press(input, 'ArrowDown');
  expect(input.value).toBe(one.url);
  sources = { ...sources, open: [here, two, one] };
  press(input, 'Enter');

  expect(visited).toEqual([one.id]);
});

test('Escape steps back: the completion, then the page address, then out of the field', () => {
  const here = pageOf('here');
  const sources: SuggestionSources = {
    served: [{ url: 'http://localhost:5193/', label: 'tagma:try' }],
    open: [here],
    closed: [],
    current: here.id,
  };
  const omnibox = new Omnibox(
    () => sources,
    () => here.url,
    acts().told,
  );
  omnibox.edit();
  const input = field(omnibox);
  expect(input.value).toBe(here.url);

  type(input, 'loc');
  expect(input.value).toBe('localhost:5193');
  press(input, 'Escape');
  expect(input.value).toBe('loc');
  press(input, 'Escape');
  expect([input.value, omnibox.open]).toEqual([here.url, true]);
  press(input, 'Escape');
  expect(omnibox.open).toBe(false);
});

test('a field attached anew shows the page address, and Enter there goes nowhere an old draft pointed', () => {
  const sources: SuggestionSources = { served: [], open: [], closed: [], current: PageId.make('here') };
  const { told, went } = acts();
  const omnibox = new Omnibox(
    () => sources,
    () => 'https://example.com/here',
    told,
  );
  type(field(omnibox), 'draft');

  const again = field(omnibox);
  press(again, 'Enter');

  expect(again.value).toBe('https://example.com/here');
  expect(went).toEqual([]);
});
