import jsTokens from 'js-tokens';
import type { CommentRange, Directive, Language, Unlexable } from '../language.js';
import { lineAt, lineStarts } from '../lines.js';

export const JS_DIRECTIVES: readonly Directive[] = [
  { opens: '@ts-expect-error', side: 'content' },
  { opens: '@ts-ignore', side: 'content' },
  { opens: '@ts-nocheck', side: 'content' },
  { opens: '@ts-check', side: 'content' },
  { opens: '/// <reference', side: 'raw' },
  { opens: '///<reference', side: 'raw' },
  { opens: '@type', side: 'content' },
  { opens: '@param', side: 'content' },
  { opens: '@returns', side: 'content' },
  { opens: '@typedef', side: 'content' },
  { opens: '@template', side: 'content' },
  { opens: '@satisfies', side: 'content' },
  { opens: '@import', side: 'content' },
  { opens: 'eslint-disable', side: 'content' },
  { opens: 'eslint-enable', side: 'content' },
  { opens: 'biome-ignore', side: 'content' },
  { opens: 'prettier-ignore', side: 'content' },
  { opens: 'svelte-ignore', side: 'content' },
  { opens: '@vite-ignore', side: 'content' },
  { opens: '@__PURE__', side: 'content' },
  { opens: '#__PURE__', side: 'content' },
  { opens: '@jsx', side: 'content' },
  { opens: '@jsxImportSource', side: 'content' },
  { opens: '@bun', side: 'content' },
  { opens: '@vitest-environment', side: 'content' },
  { opens: '@jest-environment', side: 'content' },
  { opens: 'sourceMappingURL=', side: 'content' },
  { opens: '//# sourceMappingURL=', side: 'raw' },
  { opens: '//#sourceMappingURL=', side: 'raw' },
  { opens: 'v8 ignore', side: 'content' },
  { opens: 'c8 ignore', side: 'content' },
  { opens: 'istanbul ignore', side: 'content' },
  { opens: '@license', side: 'content' },
  { opens: '@preserve', side: 'content' },
  { opens: '#!', side: 'content' },
];

const UNCLOSED: Readonly<Record<string, string>> = {
  NoSubstitutionTemplate: 'unterminated template literal',
  TemplateTail: 'unterminated template literal',
  StringLiteral: 'unterminated string literal',
  RegularExpressionLiteral: 'unterminated regular expression',
  MultiLineComment: 'unterminated comment',
};

const TRIVIA: ReadonlySet<string> = new Set([
  'WhiteSpace',
  'LineTerminatorSequence',
  'SingleLineComment',
  'MultiLineComment',
  'HashbangComment',
]);

const EXPRESSION_AFTER: ReadonlySet<string> = new Set([
  'await',
  'case',
  'default',
  'delete',
  'do',
  'else',
  'instanceof',
  'new',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

type JsToken = ReturnType<typeof jsTokens> extends Iterable<infer Token> ? Token : never;

function dividesAfterAssertion(last: JsToken | undefined, before: JsToken | undefined): boolean {
  if (last === undefined || last.type !== 'Punctuator' || last.value !== '!') return false;
  if (before === undefined) return false;
  switch (before.type) {
    case 'IdentifierName':
      return !EXPRESSION_AFTER.has(before.value);
    case 'PrivateIdentifier':
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'RegularExpressionLiteral':
    case 'NoSubstitutionTemplate':
    case 'TemplateTail':
      return true;
    case 'Punctuator':
      return before.value === ')' || before.value === ']' || before.value === '!';
    default:
      return false;
  }
}

export function jsComments(text: string): readonly CommentRange[] | Unlexable {
  let source = text;
  for (;;) {
    const starts = lineStarts(source);
    const ranges: CommentRange[] = [];
    let at = 0;
    let last: JsToken | undefined;
    let before: JsToken | undefined;
    let lastAt = 0;
    let assertion = -1;
    for (const token of jsTokens(source)) {
      const end = at + token.value.length;
      if (token.type === 'Invalid') return { unlexable: 'invalid token' };
      if ('closed' in token && !token.closed) {
        if (token.type === 'RegularExpressionLiteral' && dividesAfterAssertion(last, before)) {
          assertion = lastAt;
          break;
        }
        return { unlexable: UNCLOSED[token.type] ?? 'unterminated token' };
      }
      if (token.type === 'SingleLineComment') {
        ranges.push({ start: at, end, line: lineAt(starts, at), text: token.value.slice(2) });
      } else if (token.type === 'MultiLineComment') {
        ranges.push({ start: at, end, line: lineAt(starts, at), text: token.value.slice(2, -2) });
      } else if (token.type === 'HashbangComment') {
        ranges.push({ start: at, end, line: 1, text: token.value });
      }
      if (!TRIVIA.has(token.type)) {
        before = last;
        last = token;
        lastAt = at;
      }
      at = end;
    }
    if (assertion === -1) return ranges;
    source = `${source.slice(0, assertion)} ${source.slice(assertion + 1)}`;
  }
}

export const typescript: Language = {
  name: 'typescript',
  extensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
  comments: jsComments,
  directives: JS_DIRECTIVES,
  marker: { line: '//', block: { open: '/*', close: '*/' } },
  continuation: '*',
};
