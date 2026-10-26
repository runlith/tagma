import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { gotoLine } from '@codemirror/search';
import { EditorState, type Extension, type Text } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, type KeyBinding, keymap } from '@codemirror/view';
import { type CodeLanguage, normalizeCodeLanguage } from '@runlith/highlight/colours';

type CommentTokens = { readonly line?: string; readonly block?: { readonly open: string; readonly close: string } };

const C_LIKE: CommentTokens = { line: '//', block: { open: '/*', close: '*/' } };
const MARKUP: CommentTokens = { block: { open: '<!--', close: '-->' } };
const HASH: CommentTokens = { line: '#' };

const HASH_BLOCK: CommentTokens = { line: '#', block: { open: '/*', close: '*/' } };
const ML: CommentTokens = { block: { open: '(*', close: '*)' } };

const COMMENTS: Record<CodeLanguage, CommentTokens> = {
  ansi: {},
  bat: { line: 'REM' },
  c: C_LIKE,
  clojure: { line: ';' },
  cmake: HASH,
  cpp: C_LIKE,
  csharp: C_LIKE,
  css: { block: { open: '/*', close: '*/' } },
  dart: C_LIKE,
  diff: {},
  docker: HASH,
  dotenv: HASH,
  elixir: HASH,
  erlang: { line: '%' },
  fish: HASH,
  fsharp: { line: '//', block: ML.block },
  go: C_LIKE,
  graphql: HASH,
  groovy: C_LIKE,
  haskell: { line: '--', block: { open: '{-', close: '-}' } },
  hcl: HASH_BLOCK,
  html: MARKUP,
  ini: { line: ';' },
  java: C_LIKE,
  javascript: C_LIKE,
  json: {},
  jsonc: C_LIKE,
  jsx: C_LIKE,
  julia: { line: '#', block: { open: '#=', close: '=#' } },
  kotlin: C_LIKE,
  latex: { line: '%' },
  less: C_LIKE,
  lua: { line: '--', block: { open: '--[[', close: ']]' } },
  make: HASH,
  markdown: MARKUP,
  nginx: HASH,
  nix: HASH_BLOCK,
  'objective-c': C_LIKE,
  'objective-cpp': C_LIKE,
  ocaml: ML,
  perl: HASH,
  php: C_LIKE,
  powershell: { line: '#', block: { open: '<#', close: '#>' } },
  proto: C_LIKE,
  python: HASH,
  r: HASH,
  ruby: HASH,
  rust: C_LIKE,
  sass: { line: '//' },
  scala: C_LIKE,
  scss: C_LIKE,
  shellscript: HASH,
  sql: { line: '--', block: { open: '/*', close: '*/' } },
  svelte: MARKUP,
  swift: C_LIKE,
  terraform: HASH_BLOCK,
  text: {},
  toml: HASH,
  tsx: C_LIKE,
  typescript: C_LIKE,
  vb: { line: "'" },
  vue: MARKUP,
  xml: MARKUP,
  yaml: HASH,
  zig: { line: '//' },
};

const SAMPLE_LINES = 2_000;
const WIDTHS = [2, 3, 4, 6, 8] as const;

export type Indent = { readonly unit: string; readonly tabSize: number };

export function detectIndent(doc: Text): Indent {
  let tabbed = 0;
  let spaced = 0;
  let previous = 0;
  const deltas = new Map<number, number>();
  const lines = doc.iterLines(1, Math.min(doc.lines, SAMPLE_LINES) + 1);
  for (let next = lines.next(); !next.done; next = lines.next()) {
    const text = lines.value;
    if (text.trim() === '') continue;
    const lead = /^[ \t]*/.exec(text)?.[0] ?? '';
    if (lead.startsWith('\t')) {
      tabbed += 1;
      continue;
    }
    if (lead.length > 0) spaced += 1;
    const delta = Math.abs(lead.length - previous);
    previous = lead.length;
    if (delta > 0) deltas.set(delta, (deltas.get(delta) ?? 0) + 1);
  }
  if (tabbed > spaced) return { unit: '\t', tabSize: 4 };
  let width = 4;
  let best = 0;
  for (const candidate of WIDTHS) {
    const seen = deltas.get(candidate) ?? 0;
    if (seen > best) {
      best = seen;
      width = candidate;
    }
  }
  return { unit: ' '.repeat(width), tabSize: width };
}

export function editing(language: string | undefined, indent: Indent): Extension {
  const comments = COMMENTS[normalizeCodeLanguage(language)];
  return [
    indentUnit.of(indent.unit),
    EditorState.tabSize.of(indent.tabSize),
    EditorState.languageData.of(() => [{ commentTokens: comments }]),
  ];
}

const PAGE_CHORDS = new Set(['Mod-[', 'Mod-]']);
const PAGE_CHORDS_BESIDE_MAC = new Set(['Alt-ArrowLeft', 'Alt-ArrowRight']);

function besidePage(binding: KeyBinding): readonly KeyBinding[] {
  if (binding.key === undefined) return [binding];
  if (PAGE_CHORDS.has(binding.key)) return [];
  if (!PAGE_CHORDS_BESIDE_MAC.has(binding.key)) return [binding];
  const { key: _beside, ...onMac } = binding;
  return [onMac];
}

export const editingView: Extension = [
  drawSelection(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  bracketMatching(),
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  keymap.of([{ key: 'Ctrl-g', run: gotoLine, preventDefault: true }, indentWithTab, ...defaultKeymap.flatMap(besidePage)]),
];
