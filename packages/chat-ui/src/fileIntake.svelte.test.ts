// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { FileIntake } from './fileIntake.svelte';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function surface() {
  const taken: File[][] = [];
  const intake = new FileIntake(() => (files) => void taken.push([...files]));
  const root = document.createElement('div');
  const row = root.appendChild(document.createElement('p'));
  const field = root.appendChild(document.createElement('textarea'));
  document.body.append(root);
  const cleanup = intake.surface(root);
  if (cleanup) cleanups.push(cleanup);
  return { intake, root, row, field, taken };
}

function transfer(types: readonly string[], files: readonly File[] = []) {
  return {
    types,
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    dropEffect: 'none',
  };
}

function fire(target: EventTarget, type: string, property: 'dataTransfer' | 'clipboardData', data: unknown): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, property, { value: data });
  target.dispatchEvent(event);
  return event;
}

const picture = new File([new Uint8Array(4)], 'image.png', { type: 'image/png' });

describe('files reaching a chat surface', () => {
  test('a drag carrying files is taken and its drop reaches the draft; a drag of anything else is left alone', () => {
    const { intake, row, taken } = surface();

    const rowDrag = fire(row, 'dragover', 'dataTransfer', transfer(['text/plain']));
    expect([rowDrag.defaultPrevented, intake.dragging]).toEqual([false, false]);

    const over = fire(row, 'dragover', 'dataTransfer', transfer(['Files'], [picture]));
    expect([over.defaultPrevented, intake.dragging]).toEqual([true, true]);

    fire(row, 'drop', 'dataTransfer', transfer(['Files'], [picture]));
    expect([intake.dragging, taken]).toEqual([false, [[picture]]]);
  });

  test('a paste outside a field reaches the surface it lands in, or the one last clicked when nothing holds focus', () => {
    const first = surface();
    const second = surface();
    const clipboard = transfer(['Files'], [picture]);

    fire(first.row, 'paste', 'clipboardData', clipboard);
    fire(second.field, 'paste', 'clipboardData', clipboard);
    expect([first.taken.length, second.taken.length]).toEqual([1, 0]);

    second.row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fire(document.body, 'paste', 'clipboardData', clipboard);
    expect([first.taken.length, second.taken.length]).toEqual([1, 1]);
  });

  test('a pasted PDF is taken like a picture, even one the system names only by its extension, and a file of another kind is left alone', () => {
    const { row, taken } = surface();
    const pdf = new File([new Uint8Array(4)], 'report.pdf', { type: 'application/pdf' });
    const untyped = new File([new Uint8Array(4)], 'scan.PDF', { type: '' });
    const archive = new File([new Uint8Array(4)], 'notes.zip', { type: 'application/zip' });

    const kept = fire(row, 'paste', 'clipboardData', transfer(['Files'], [pdf, untyped]));
    const left = fire(row, 'paste', 'clipboardData', transfer(['Files'], [archive]));

    expect([kept.defaultPrevented, left.defaultPrevented, taken]).toEqual([true, false, [[pdf, untyped]]]);
  });
});
