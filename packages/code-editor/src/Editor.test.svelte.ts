import { EditorView } from '@codemirror/view';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { TextDocument } from './document';
import Editor from './Editor.svelte';
import type { Seen } from './marks';

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
