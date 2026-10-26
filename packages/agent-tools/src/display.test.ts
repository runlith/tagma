import { describe, expect, test } from 'bun:test';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { fileCode, filePatch } from './display';

const languageOf = (display: ToolDisplay): string | undefined =>
  display.form === 'diff' ? display.files[0].language : display.form === 'code' ? display.language : undefined;

describe('what a file display says it is written in', () => {
  test('a changed file and a created one answer the same language for the same path', () => {
    const changed = filePatch('/work', 'src/report.ts', 'const a = 1;\n', 'const a = 2;\n');
    const created = fileCode('/work', 'src/report.ts', 'const a = 2;\n', 'created');

    expect(languageOf(changed)).toBe('ts');
    expect(languageOf(changed)).toBe(languageOf(created));
  });

  test('a path nothing maps carries no language on either form', () => {
    const changed = filePatch('/work', 'LICENSE', 'one\n', 'two\n');
    const created = fileCode('/work', 'LICENSE', 'two\n', 'created');

    expect(languageOf(changed)).toBeUndefined();
    expect(languageOf(created)).toBeUndefined();
  });
});
