// @vitest-environment jsdom
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/xterm';
import { afterEach, expect, test } from 'vitest';

const opened: Terminal[] = [];

afterEach(() => {
  for (const terminal of opened.splice(0)) terminal.dispose();
  document.body.replaceChildren();
});

function open(): { terminal: Terminal; serialize: SerializeAddon } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const terminal = new Terminal({ allowProposedApi: true });
  terminal.open(host);
  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);
  opened.push(terminal);
  return { terminal, serialize };
}

function parse(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

test('a hyperlink survives a serialize round trip with its target', async () => {
  const { terminal, serialize } = open();

  await parse(terminal, '\u001b]8;;https://example.test/x\u0007link\u001b]8;;\u0007');

  expect(serialize.serialize()).toContain(']8;;https://example.test/x');
});

test('bold and dim are diffed as one intensity group, so a bold run after a dim one stays bold', async () => {
  const { terminal, serialize } = open();

  await parse(terminal, '\u001b[2mA\u001b[22m\u001b[1mB');
  const restored = open();
  await parse(restored.terminal, serialize.serialize());

  const cell = restored.terminal.buffer.active.getLine(0)?.getCell(1);
  expect(cell?.isBold()).toBeTruthy();
  expect(cell?.isDim()).toBeFalsy();
});
