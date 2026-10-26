import { EditorView } from '@codemirror/view';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import Diff from './Diff.svelte';
import type { DiffKind, DiffLine, Mark } from './marks';

const AGENT: Mark = { id: 'thread-a', label: 'Agent', colour: 'rgb(1, 2, 3)' };

const row = (kind: DiffKind, text: string, before: number | null, after: number | null, mark: Mark | null = null): DiffLine => ({
  kind,
  text,
  before,
  after,
  mark,
  spans: [],
  hiddenBefore: 0,
  hiddenAt: 0,
});

const ROWS: DiffLine[] = [
  row('context', 'const a = 1;', 1, 1, AGENT),
  row('removed', 'const b = 2;', 2, null),
  row('added', 'const b = 3;', null, 2),
  row('context', 'export { a, b };', 3, 3),
];

let shown: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (shown) void unmount(shown);
  shown = undefined;
  document.body.replaceChildren();
});

function show(props: { rows: readonly DiffLine[] }): EditorView {
  const target = document.body.appendChild(document.createElement('div'));
  shown = mount(Diff, { target, props });
  flushSync();
  return EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;
}

function copy(view: EditorView): { text: string; prevented: boolean } {
  let text = 'untouched';
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => undefined, setData: (_type: string, data: string) => (text = data) },
  });
  view.contentDOM.dispatchEvent(event);
  return { text, prevented: event.defaultPrevented };
}

test('copying a diff selection leaves the removed lines out, and a selection of removed lines alone copies nothing', () => {
  const view = show({ rows: ROWS });
  view.focus();

  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  expect(copy(view)).toEqual({ text: 'const a = 1;\nconst b = 3;\nexport { a, b };', prevented: true });

  view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 6, head: view.state.doc.line(3).to } });
  expect(copy(view).text).toBe('const b = 3;');

  view.dispatch({ selection: { anchor: view.state.doc.line(2).from, head: view.state.doc.line(2).to } });
  expect(copy(view)).toEqual({ text: '', prevented: true });
});

test('a holder mark stands on a row of any kind, follows new rows, and its press reaches the caller', () => {
  const pressed: Mark[] = [];
  const target = document.body.appendChild(document.createElement('div'));
  let rows = $state.raw(ROWS);
  shown = mount(Diff, {
    target,
    props: {
      get rows() {
        return rows;
      },
      onMark: (mark: Mark) => pressed.push(mark),
    },
  });
  flushSync();
  const strips = () => [...target.querySelectorAll<HTMLElement>('.cm-strips .cm-strip')];

  const first = strips()[0];
  expect(first?.style.getPropertyValue('--strip')).toBe(AGENT.colour);
  first?.closest('.cm-gutterElement')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(pressed).toEqual([AGENT]);

  const moved = { ...AGENT, colour: 'rgb(9, 9, 9)' };
  rows = ROWS.map((line, at) => (at === 0 ? { ...line, mark: moved } : line));
  flushSync();
  expect(strips()[0]?.style.getPropertyValue('--strip')).toBe(moved.colour);
});

test('the expand buttons follow whether the caller can expand', () => {
  const target = document.body.appendChild(document.createElement('div'));
  const hidden = [row('context', 'a', 1, 1), { ...row('context', 'z', 900, 900), hiddenBefore: 898, hiddenAt: 2 }];
  let onExpand = $state<((at: number, lines: number) => void) | undefined>(undefined);
  shown = mount(Diff, {
    target,
    props: {
      rows: hidden,
      get onExpand() {
        return onExpand;
      },
    },
  });
  flushSync();
  expect(target.querySelectorAll('.cm-diff-hidden button')).toHaveLength(0);

  onExpand = () => undefined;
  flushSync();
  expect(target.querySelectorAll('.cm-diff-hidden button')).toHaveLength(2);
});

test('the seen line is the after-side number of the row under the cursor, or of the nearest row that has one', () => {
  const target = document.body.appendChild(document.createElement('div'));
  const diff = mount(Diff, { target, props: { rows: ROWS } });
  shown = diff;
  flushSync();
  const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;

  expect(diff.seenLine()).toBe(1);
  view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
  expect(diff.seenLine()).toBe(2);
  view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 2 } });
  expect(diff.seenLine()).toBe(2);
});
