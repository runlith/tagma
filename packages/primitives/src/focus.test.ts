// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { AUTOFOCUS_MARK, focusInitialIn } from './focus.js';

afterEach(() => document.body.replaceChildren());

function content(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

describe('which element the dialog gives the keyboard', () => {
  it('leaves the answer the dialog does not want to the one it does', () => {
    const el = content(`
      <button data-runlith-autofocus-ignore>Cancel</button>
      <button id="delete">Delete</button>
    `);

    expect(focusInitialIn(el)).toBe(true);
    expect(document.activeElement?.id).toBe('delete');
  });

  it('passes over the close glyph', () => {
    const el = content(`
      <button data-slot="dialog-close">×</button>
      <button id="save">Save</button>
    `);

    expect(focusInitialIn(el)).toBe(true);
    expect(document.activeElement?.id).toBe('save');
  });

  it('prefers a text field to a button, and a named element to both', () => {
    const withField = content('<button id="go">Go</button><input id="name" />');
    expect(focusInitialIn(withField)).toBe(true);
    expect(document.activeElement?.id).toBe('name');

    const named = content('<input id="first" /><button id="named" data-runlith-autofocus>Named</button>');
    expect(focusInitialIn(named)).toBe(true);
    expect(document.activeElement?.id).toBe('named');
  });

  it('answers false when nothing inside can hold the keyboard', () => {
    expect(focusInitialIn(content('<p>Nothing here</p>'))).toBe(false);
  });
});

describe('the mark that says which element the dialog focused', () => {
  it('stamps what it focused, and the stamp leaves with the focus', () => {
    const el = content('<button id="only">Go</button>');
    const button = el.querySelector('#only') as HTMLElement;

    focusInitialIn(el);
    expect(button.hasAttribute(AUTOFOCUS_MARK)).toBe(true);

    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(button.hasAttribute(AUTOFOCUS_MARK)).toBe(false);
  });

  it('stamps nothing when there was nothing to focus', () => {
    const el = content('<p>Nothing here</p>');
    focusInitialIn(el);
    expect(el.querySelector(`[${AUTOFOCUS_MARK}]`)).toBeNull();
  });
});
