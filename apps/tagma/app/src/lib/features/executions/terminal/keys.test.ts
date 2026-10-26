// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { ownsKey } from './keys.js';

function within(html: string, selector: string): Element {
  const stage = document.createElement('div');
  stage.innerHTML = html;
  document.body.replaceChildren(stage);
  const found = stage.querySelector(selector);
  if (found === null) throw new Error(`no ${selector} in the fixture`);
  return found;
}

test('the engine keeps its own keystrokes, the tab’s chrome reaches the chords, and every editor the pane host knows keeps its keys', () => {
  const engine = within(
    '<div class="pane-tree"><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div></div>',
    'textarea',
  );
  expect(ownsKey(engine)).toBe(false);

  const title = within('<div class="pane-tree"><div class="pane-title-bar"><button data-pane-title-split></button></div></div>', 'button');
  expect(ownsKey(title)).toBe(true);
  const restart = within('<div class="pane-tree"><div class="pane-exit"><button>Restart</button></div></div>', 'button');
  expect(ownsKey(restart)).toBe(true);

  const rename = within('<div class="pane-tree"><input data-pane-title-input /></div>', 'input');
  expect(ownsKey(rename)).toBe(false);
  for (const spelling of ['true', '', 'plaintext-only']) {
    const editor = within(`<div contenteditable="${spelling}"><span>x</span></div>`, 'span');
    expect(ownsKey(editor)).toBe(false);
  }
  const textbox = within('<div role="textbox"><span>x</span></div>', 'span');
  expect(ownsKey(textbox)).toBe(false);

  expect(ownsKey(null)).toBe(true);
});
