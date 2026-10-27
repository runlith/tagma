import { EditorView } from '@codemirror/view';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { TextDocument } from './document';
import Editor from './Editor.svelte';
import type { Find, Seen } from './marks';

test('Mod-F finds the word under the caret, counts its matches and seeks as the query changes', () => {
  const document = new TextDocument('asked = 1;\nthis.asked = 2;\nask(asked);\n', 'disk-1');
  const target = window.document.body.appendChild(window.document.createElement('div'));
  let find: Find | undefined;
  const bar = createRawSnippet((control: () => Find) => ({
    render: () => '<span></span>',
    setup: () => {
      find = control();
    },
  }));
  const shown = mount(Editor, { target, props: { document, at: { line: 1, column: 7 }, find: bar } });
  flushSync();
  const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;

  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, ctrlKey: true, bubbles: true }));
  flushSync();
  expect(find?.query.search).toBe('asked');
  expect(find?.matches).toEqual({ total: 3, current: 2, more: false });

  find?.set({ search: 'ask' });
  expect(find?.matches).toEqual({ total: 4, current: 2, more: false });

  find?.set({ wholeWord: true });
  const selected = view.state.selection.main;
  expect([selected.from, selected.to]).toEqual([27, 30]);
  expect(find?.matches).toEqual({ total: 1, current: 1, more: false });

  find?.close();
  flushSync();
  expect(target.querySelector('.find')).toBeNull();
  void unmount(shown);
  flushSync();
});

test('an editor opens on the asked range and, torn down, reports its selection', () => {
  const document = new TextDocument('zero\none\ntwo\nthree four\n', 'disk-1');
  const target = window.document.body.appendChild(window.document.createElement('div'));
  const seen: Seen[] = [];
  const shown = mount(Editor, {
    target,
    props: { document, at: { line: 3, column: 6, length: 4 }, onView: (place: Seen) => seen.push(place) },
  });
  flushSync();
  const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;
  const selected = view.state.selection.main;
  expect(view.state.sliceDoc(selected.from, selected.to)).toBe('four');

  void unmount(shown);
  flushSync();
  expect(seen).toEqual([{ line: 3, column: 10, anchor: { line: 3, column: 6 }, scroll: 0 }]);
});

test('a backward multiline selection survives closing and reopening the editor', () => {
  const text = 'zero\none\ntwo\nthree four\n';
  const document = new TextDocument(text, 'disk-1');
  const target = window.document.body.appendChild(window.document.createElement('div'));
  let seen: Seen | undefined;
  const first = mount(Editor, { target, props: { document, onView: (place: Seen) => (seen = place) } });
  flushSync();
  const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;
  view.dispatch({ selection: { anchor: 18, head: 6 } });
  void unmount(first);
  flushSync();
  const again = mount(Editor, { target, props: { document: new TextDocument(text, 'disk-1'), at: seen } });
  flushSync();
  const restored = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement) as EditorView;
  expect([restored.state.selection.main.anchor, restored.state.selection.main.head]).toEqual([18, 6]);
  void unmount(again);
  flushSync();
});
