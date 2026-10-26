import { describe, expect, test } from 'vitest';
import { createHeadlessMarkdownEditor } from './codec.js';
import { createMarkdownEditorExtensions } from './extensions.js';

describe('the schema adds nothing to the document', () => {
  const schema = () => createMarkdownEditorExtensions({});

  for (const [shape, source] of [
    ['prose and a list', 'Первый абзац.\n\n- пункт один\n- пункт два'],
    ['a terminal code block', 'Before.\n\n```ts\nconst a = 1;\n```'],
    ['a terminal table', 'Before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'],
  ] as const) {
    test(`a document ending in ${shape} survives a transaction unchanged`, () => {
      const editor = createHeadlessMarkdownEditor(schema(), source);
      try {
        const atMount = editor.getMarkdown();
        editor.view.dispatch(editor.state.tr.setMeta('anything', true));
        expect(editor.getMarkdown()).toBe(atMount);
      } finally {
        editor.destroy();
      }
    });
  }
});
