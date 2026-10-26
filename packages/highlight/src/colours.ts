import {
  createBundledHighlighter,
  createSingletonShorthands,
  type GrammarState,
  type LanguageRegistration,
  type ThemedToken,
  type TokensResult,
} from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { lineBody, splitLines } from '@runlith/files/lines';
import { escapeAttribute, escapeHtml } from '@runlith/utils/text';
import { theme } from './theme';

export type CodeToken = { text: string; color?: string };

export type CodeColours = Map<number, CodeToken[]>;

export type CodeSlice = { colours: CodeColours; last: boolean };

const HIGHLIGHT_SLICE_CHARS = 32_000;
export const HIGHLIGHT_LINE_CHAR_CAP = 400;
export const HIGHLIGHT_LINE_TIME_LIMIT = 10_000;
const LINE_BOUNDS = { tokenizeMaxLineLength: HIGHLIGHT_LINE_CHAR_CAP, tokenizeTimeLimit: HIGHLIGHT_LINE_TIME_LIMIT };

export type CodeLanguage =
  | 'ansi'
  | 'bat'
  | 'c'
  | 'clojure'
  | 'cmake'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'dart'
  | 'diff'
  | 'docker'
  | 'dotenv'
  | 'elixir'
  | 'erlang'
  | 'fish'
  | 'fsharp'
  | 'go'
  | 'graphql'
  | 'groovy'
  | 'haskell'
  | 'hcl'
  | 'html'
  | 'ini'
  | 'java'
  | 'javascript'
  | 'json'
  | 'jsonc'
  | 'jsx'
  | 'julia'
  | 'kotlin'
  | 'latex'
  | 'less'
  | 'lua'
  | 'make'
  | 'markdown'
  | 'nginx'
  | 'nix'
  | 'objective-c'
  | 'objective-cpp'
  | 'ocaml'
  | 'perl'
  | 'php'
  | 'powershell'
  | 'proto'
  | 'python'
  | 'r'
  | 'ruby'
  | 'rust'
  | 'sass'
  | 'scala'
  | 'scss'
  | 'shellscript'
  | 'sql'
  | 'svelte'
  | 'swift'
  | 'terraform'
  | 'text'
  | 'toml'
  | 'tsx'
  | 'typescript'
  | 'vb'
  | 'vue'
  | 'xml'
  | 'yaml'
  | 'zig';

export type ShikiCodeLanguage = Exclude<CodeLanguage, 'text'>;

export const languageLoaders: Record<ShikiCodeLanguage, () => Promise<{ default: LanguageRegistration[] }>> = {
  ansi: async () => ({ default: [] }),
  bat: () => import('shiki/langs/bat.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  clojure: () => import('shiki/langs/clojure.mjs'),
  cmake: () => import('shiki/langs/cmake.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  erlang: () => import('shiki/langs/erlang.mjs'),
  fish: () => import('shiki/langs/fish.mjs'),
  fsharp: () => import('shiki/langs/fsharp.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  julia: () => import('shiki/langs/julia.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/md.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  nix: () => import('shiki/langs/nix.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  'objective-cpp': () => import('shiki/langs/objective-cpp.mjs'),
  ocaml: () => import('shiki/langs/ocaml.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  proto: () => import('shiki/langs/proto.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sass: () => import('shiki/langs/sass.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/sh.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  terraform: () => import('shiki/langs/terraform.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vb: () => import('shiki/langs/vb.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
};

const highlighter = createSingletonShorthands(
  createBundledHighlighter<ShikiCodeLanguage, 'syntax'>({
    engine: () => createOnigurumaEngine(import('shiki/wasm')),
    langs: languageLoaders,
    themes: { syntax: async () => ({ default: theme }) },
  }),
);

const codeToHtml = highlighter.codeToHtml;
const codeToTokens = highlighter.codeToTokens;

const languageAliases: Record<string, CodeLanguage> = {
  ansi: 'ansi',
  bash: 'shellscript',
  bat: 'bat',
  batch: 'bat',
  c: 'c',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cljs: 'clojure',
  clojure: 'clojure',
  cmake: 'cmake',
  cmd: 'bat',
  cpp: 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  css: 'css',
  cts: 'typescript',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  docker: 'docker',
  dockerfile: 'docker',
  dotenv: 'dotenv',
  elixir: 'elixir',
  erl: 'erlang',
  erlang: 'erlang',
  ex: 'elixir',
  exs: 'elixir',
  'f#': 'fsharp',
  fish: 'fish',
  fs: 'fsharp',
  fsharp: 'fsharp',
  go: 'go',
  golang: 'go',
  gql: 'graphql',
  gradle: 'groovy',
  graphql: 'graphql',
  groovy: 'groovy',
  h: 'c',
  haskell: 'haskell',
  hcl: 'hcl',
  hpp: 'cpp',
  hs: 'haskell',
  html: 'html',
  ini: 'ini',
  java: 'java',
  javascript: 'javascript',
  jl: 'julia',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  julia: 'julia',
  kotlin: 'kotlin',
  kt: 'kotlin',
  kts: 'kotlin',
  latex: 'latex',
  less: 'less',
  lua: 'lua',
  make: 'make',
  makefile: 'make',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  ml: 'ocaml',
  mts: 'typescript',
  nginx: 'nginx',
  nix: 'nix',
  objc: 'objective-c',
  'objective-c': 'objective-c',
  'objective-cpp': 'objective-cpp',
  objcpp: 'objective-cpp',
  ocaml: 'ocaml',
  perl: 'perl',
  php: 'php',
  pl: 'perl',
  plain: 'text',
  plaintext: 'text',
  powershell: 'powershell',
  proto: 'proto',
  protobuf: 'proto',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  python: 'python',
  r: 'r',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  rust: 'rust',
  sass: 'sass',
  scala: 'scala',
  scss: 'scss',
  sh: 'shellscript',
  shell: 'shellscript',
  shellscript: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  terraform: 'terraform',
  tex: 'latex',
  text: 'text',
  tf: 'terraform',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  typescript: 'typescript',
  vb: 'vb',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'shellscript',
};

export async function highlightCode(code: string, language: string | undefined): Promise<string> {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === 'text') return plainCodeHtml(code, normalized);

  try {
    return await codeToHtml(code, {
      lang: normalized,
      theme: 'syntax',
      ...LINE_BOUNDS,
    });
  } catch {
    return plainCodeHtml(code, normalized);
  }
}

export async function highlightLines(code: string, language: string | undefined): Promise<CodeColours> {
  const coloured: CodeColours = new Map();
  for await (const slice of highlightLineSlices(code, language)) {
    for (const [at, line] of slice.colours) coloured.set(at, line);
    if (!slice.last) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return coloured;
}

export async function* highlightLineSlices(code: string, language: string | undefined): AsyncGenerator<CodeSlice> {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === 'text') return;

  const lines = splitLines(code).map(lineBody);
  let grammarState: GrammarState | undefined;
  for (let at = 0; at < lines.length;) {
    const end = sliceEnd(lines, at);
    let result: TokensResult;
    try {
      result = await codeToTokens(lines.slice(at, end).join('\n'), {
        lang: normalized,
        theme: 'syntax',
        ...LINE_BOUNDS,
        grammarState,
      });
    } catch {
      return;
    }
    const colours: CodeColours = new Map();
    result.tokens.forEach((tokens, index) => {
      const line = colouredTokens(tokens);
      if (line) colours.set(at + index, line);
    });
    yield { colours, last: end >= lines.length };
    grammarState = result.grammarState;
    at = end;
  }
}

export function plainCodeHtml(code: string, language: string | undefined): string {
  const normalized = normalizeCodeLanguage(language);
  const className = normalized === 'text' ? '' : ` class="language-${escapeAttribute(normalized)}"`;
  return `<pre><code${className}>${escapeHtml(code)}</code></pre>`;
}

function sliceEnd(lines: readonly string[], start: number): number {
  let chars = (lines[start]?.length ?? 0) + 1;
  let end = start + 1;
  while (end < lines.length) {
    chars += (lines[end]?.length ?? 0) + 1;
    if (chars > HIGHLIGHT_SLICE_CHARS) break;
    end += 1;
  }
  return end;
}

function colouredTokens(tokens: ThemedToken[]): CodeToken[] | undefined {
  if (tokens.length === 0) return undefined;
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only && only.content.length >= HIGHLIGHT_LINE_CHAR_CAP) return undefined;
  return tokens.map((token) => ({ text: token.content, color: token.color }));
}

export function normalizeCodeLanguage(language: string | undefined): CodeLanguage {
  const info = language?.trim().toLowerCase().split(/\s+/, 1)[0];
  if (!info) return 'text';
  return languageAliases[info] ?? 'text';
}
