// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import TerminalExitOverlay, { exitCopy } from './ExitOverlay.svelte';
import type { ChildEnding } from './RecordStream.svelte.js';

let apps: (() => void)[] = [];

afterEach(() => {
  for (const unmountApp of apps.splice(0)) unmountApp();
  document.body.replaceChildren();
});

function draw(ending: ChildEnding, onRestart: () => void = () => undefined, onClose: () => void = () => undefined) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalExitOverlay, { target: host, props: { ending, onRestart, onClose } });
  flushSync();
  apps.push(() => {
    unmount(app);
    host.remove();
  });
  return host;
}

test('an exit shows the code and keeps the output', () => {
  const copy = exitCopy({ _tag: 'Exit', native: { _tag: 'Code', code: 3 } });
  expect(copy.heading).toBe('Terminal exited');
  expect(copy.detail).toContain('exit code 3');
  expect(copy.detail).toContain('Its output is preserved.');
});

test('a kill names the signal, and no reading is ever shown as an exit code', () => {
  expect(exitCopy({ _tag: 'Exit', native: { _tag: 'Signal', signal: 'SIGTERM' } }).detail).toContain('SIGTERM');
  expect(exitCopy({ _tag: 'None' }).detail).not.toContain('exit code');
  expect(exitCopy({ _tag: 'Unread', problem: 'the host went away' }).detail).toContain('could not be read');
});

test('a process the surface can name is named, and its own screen is what is kept', () => {
  const named = exitCopy({ _tag: 'Exit', native: { _tag: 'Code', code: 0 } }, 'Claude Code');
  expect(named.heading).toContain('Claude Code');
  expect(named.detail).toContain('exit code 0');
  expect(named.detail).toContain('Its screen is preserved.');
});

test('Restart and Close answer the ending line', () => {
  const onRestart = vi.fn();
  const onClose = vi.fn();
  const host = draw({ _tag: 'Exit', native: { _tag: 'Code', code: 1 } }, onRestart, onClose);

  expect(host.querySelector('[data-exit-line]')?.textContent).toContain('exited with code 1');
  host.querySelector<HTMLElement>('[data-exit-restart]')?.click();
  expect(onRestart).toHaveBeenCalledTimes(1);
  host.querySelector<HTMLElement>('[data-exit-close]')?.click();
  expect(onClose).toHaveBeenCalledTimes(1);
});
