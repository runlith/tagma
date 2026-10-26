import { TextSelection } from '@tiptap/pm/state';
import { expect, test } from 'vitest';
import { createHeadlessMarkdownEditor } from './codec.js';
import { createCodeLinkExtension } from './codeLinks.js';
import { createMarkdownEditorExtensions } from './extensions.js';

test('a code being typed is asked about once the caret leaves it, and typing elsewhere asks about no code again', () => {
  const asked: string[] = [];
  const links = createCodeLinkExtension({
    linked: (code) => {
      asked.push(code);
      return false;
    },
  });
  const editor = createHeadlessMarkdownEditor(createMarkdownEditorExtensions({ extensions: [links] }), 'See `u` here.\n');
  try {
    asked.length = 0;
    let at = 6;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    for (const char of 'seState') {
      editor.view.dispatch(editor.state.tr.insertText(char, at));
      at += 1;
    }
    expect(asked).toEqual([]);

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    for (const char of 'ee') editor.view.dispatch(editor.state.tr.insertText(char, 2));

    expect(asked).toEqual(['useState']);
  } finally {
    editor.destroy();
  }
});

test('a linked code stays a link while the text before it changes', () => {
  const links = createCodeLinkExtension({ linked: (code) => code === 'src/a.ts' });
  const editor = createHeadlessMarkdownEditor(createMarkdownEditorExtensions({ extensions: [links] }), 'See `src/a.ts` here.\n');
  try {
    editor.view.dispatch(editor.state.tr.insertText('Do ', 1));
    expect(editor.view.dom.querySelector('[data-code-link]')?.textContent).toBe('src/a.ts');
  } finally {
    editor.destroy();
  }
});
