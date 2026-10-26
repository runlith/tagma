import type { ThemeRegistration } from 'shiki/core';

type Role =
  | 'text'
  | 'declaration'
  | 'property'
  | 'punctuation'
  | 'operator'
  | 'comment'
  | 'keyword'
  | 'string'
  | 'constant'
  | 'function'
  | 'type'
  | 'tag'
  | 'attribute'
  | 'inserted'
  | 'deleted'
  | 'changed';

type Rule = { readonly role?: Role; readonly scope: readonly string[]; readonly fontStyle?: string };

const ink = (role: Role | 'background'): string => `var(--syntax-${role})`;

const RULES: readonly Rule[] = [
  {
    role: 'text',
    scope: [
      'variable',
      'variable.other',
      'support.variable',
      'meta.embedded',
      'meta.template.expression',
      'meta.jsx.children',
      'storage.modifier.import',
      'storage.modifier.package',
    ],
  },
  { role: 'punctuation', scope: ['punctuation', 'meta.brace', 'keyword.operator.accessor', 'keyword.operator.access'] },
  { role: 'operator', scope: ['keyword.operator', 'storage.type.function.arrow'] },
  {
    role: 'keyword',
    scope: [
      'keyword',
      'storage',
      'variable.language',
      'keyword.operator.expression',
      'keyword.operator.new',
      'keyword.operator.word',
      'keyword.operator.logical.python',
      'punctuation.definition.template-expression',
      'punctuation.section.embedded',
      'constant.character.format.placeholder',
      'constant.other.placeholder',
    ],
  },
  {
    role: 'string',
    scope: [
      'string',
      'punctuation.definition.string',
      'storage.type.string.python',
      'string.regexp',
      'source.regexp',
      'markup.inline.raw',
      'markup.fenced_code',
      'string.other.link',
      'constant.other.reference.link',
    ],
  },
  {
    role: 'constant',
    scope: [
      'constant',
      'constant.character.escape',
      'variable.other.constant',
      'variable.other.enummember',
      'entity.name.constant',
      'support.constant',
      'keyword.other.unit',
    ],
  },
  {
    role: 'declaration',
    scope: [
      'entity.name',
      'variable.parameter',
      'meta.definition.variable variable',
      'meta.definition.variable variable.other.constant',
      'meta.definition.variable variable.other.readwrite',
    ],
  },
  { role: 'function', scope: ['entity.name.function', 'support.function', 'meta.function-call.generic', 'entity.name.command'] },
  {
    role: 'type',
    scope: [
      'entity.name.type',
      'entity.name.class',
      'entity.other.inherited-class',
      'support.type',
      'support.class',
      'storage.type.numeric.go',
      'storage.type.string.go',
      'storage.type.boolean.go',
      'storage.type.byte.go',
      'storage.type.rune.go',
      'storage.type.error.go',
      'storage.type.uintptr.go',
    ],
  },
  { role: 'tag', scope: ['entity.name.tag', 'support.class.component'] },
  { role: 'attribute', scope: ['entity.other.attribute-name'] },
  {
    role: 'property',
    scope: [
      'variable.other.property',
      'variable.other.object.property',
      'variable.object.property',
      'support.variable.property',
      'meta.object-literal.key',
      'support.type.property-name',
      'support.type.vendored.property-name',
      'meta.property-name',
      'meta.attribute.python',
    ],
  },
  { role: 'comment', scope: ['comment', 'punctuation.definition.comment', 'string.comment', 'string.quoted.docstring', 'markup.quote'] },
  { role: 'keyword', scope: ['markup.heading', 'markup.heading entity.name', 'entity.name.section'], fontStyle: 'bold' },
  { scope: ['markup.bold'], fontStyle: 'bold' },
  { scope: ['markup.italic'], fontStyle: 'italic' },
  { scope: ['markup.strikethrough'], fontStyle: 'strikethrough' },
  { scope: ['markup.underline'], fontStyle: 'underline' },
  { role: 'inserted', scope: ['markup.inserted', 'meta.diff.header.to-file', 'punctuation.definition.inserted'] },
  { role: 'deleted', scope: ['markup.deleted', 'meta.diff.header.from-file', 'punctuation.definition.deleted'] },
  { role: 'changed', scope: ['markup.changed', 'punctuation.definition.changed'] },
  { role: 'comment', scope: ['meta.diff.header', 'meta.diff.range'] },
];

export const theme: ThemeRegistration = {
  name: 'syntax',
  type: 'dark',
  colors: { 'editor.foreground': ink('text'), 'editor.background': ink('background') },
  tokenColors: RULES.map(({ role, scope, fontStyle }) => ({
    scope: [...scope],
    settings: { foreground: role === undefined ? undefined : ink(role), fontStyle },
  })),
};
