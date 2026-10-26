// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm';
import { afterEach, expect, test } from 'vitest';

const opened: Terminal[] = [];

afterEach(() => {
  for (const terminal of opened.splice(0)) terminal.dispose();
  document.body.replaceChildren();
});

function open(): Terminal {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const terminal = new Terminal({ allowProposedApi: true });
  terminal.open(host);
  opened.push(terminal);
  return terminal;
}

test('a composition opens a transaction the page can observe, carrying its own id', () => {
  const terminal = open();
  const textarea = terminal.textarea;
  const started: unknown[] = [];
  textarea?.addEventListener('xterm-composition-session-start', (event) => {
    started.push((event as CustomEvent<{ id: number }>).detail.id);
  });

  textarea?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));

  expect(started).toHaveLength(1);
  expect(typeof started[0]).toBe('number');
});

test('two compositions carry two transaction ids, so a late commit cannot be read as the live one', () => {
  const terminal = open();
  const textarea = terminal.textarea;
  const ids: number[] = [];
  textarea?.addEventListener('xterm-composition-session-start', (event) => {
    ids.push((event as CustomEvent<{ id: number }>).detail.id);
  });

  textarea?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  textarea?.dispatchEvent(new CompositionEvent('compositionend', { data: 'a' }));
  textarea?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));

  expect(ids).toHaveLength(2);
  expect(ids[1]).toBeGreaterThan(ids[0] as number);
});

test('a commit ends its own session and hands the page what the composition produced', async () => {
  const terminal = open();
  const textarea = terminal.textarea;
  const ended: { id: number; data: string }[] = [];
  textarea?.addEventListener('xterm-composition-session-end', (event) => {
    ended.push((event as CustomEvent<{ id: number; data: string }>).detail);
  });

  textarea?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  textarea?.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }));
  if (textarea) textarea.value = '\u4f60';
  textarea?.dispatchEvent(new CompositionEvent('compositionend', { data: '\u4f60' }));
  await new Promise((resolve) => setTimeout(resolve));

  expect(ended).toHaveLength(1);
  expect(ended[0]?.data).toBe('\u4f60');
});
