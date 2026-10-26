import { describe, expect, it } from 'bun:test';
import { type ImportReads, readOf, UnsupportedSource } from '../../imports';
import { js } from '../adapters';
import { jsOf } from './index';

const importSites = (text: string, path: string) => js.imports(text, path);
const importSitesOffThread = (text: string, path: string) => js.importsOffThread!(text, path);

const source = [
  "import type { T } from './types';",
  "import { value } from './value';",
  "import './effect';",
  "export { again } from './again';",
  "export type { Shape } from './shape';",
  "const later = () => import('./later');",
  "const required = require('./required');",
  "type Seen = import('./seen').Seen;",
  "import { type Only } from './only';",
  '// import { gone } from "./commented";',
  'const spelled = \'import { fake } from "./string"\';',
  '',
].join('\n');

const read = (reads: ImportReads) => readOf(importSites(source, 'src/entry.ts'), reads).map(({ specifier }) => specifier);

describe('JS import readings', () => {
  it('keeps what loads with the module in a static reading and leaves only the import() call to the runtime one', () => {
    expect(read('static')).toEqual(['./value', './effect', './again', './required']);
    expect(read('runtime')).toEqual(['./value', './effect', './again', './later', './required']);
  });

  it('reads declared clauses alone under from, and every parsed construct under every, never a comment or a string', () => {
    expect(read('from')).toEqual(['./types', './value', './again', './shape', './only']);
    expect(read('every')).toEqual(['./types', './value', './effect', './again', './shape', './later', './required', './seen', './only']);
  });

  it('keeps macro dependencies without runtime loads while other import attributes still load', () => {
    const imports = [
      "import { rule } from './macro' with { type: 'macro' };",
      "import * as macros from './namespace' with { 'type': 'macro' };",
      "import text from './text' with { type: 'text' };",
    ].join('\n');
    for (const text of [imports, `declare module 'ambient' {\n${imports}\n}`]) {
      const sites = importSites(text, 'src/entry.ts');
      expect(sites.map(({ specifier, loads }) => ({ specifier, loads }))).toEqual([
        { specifier: './macro', loads: 'never' },
        { specifier: './namespace', loads: 'never' },
        { specifier: './text', loads: 'with-module' },
      ]);
      expect(readOf(sites, 'from').map(({ specifier }) => specifier)).toEqual(['./macro', './namespace', './text']);
      expect(readOf(sites, 'runtime').map(({ specifier }) => specifier)).toEqual(['./text']);
    }
  });

  it('reads the spellings only the syntax tree holds, however they are written', () => {
    const tree = [
      "export{}from'./packed';",
      "export {/* none */} from './commented';",
      "import type Typed = require('./typed');",
      "import Loaded = require('./loaded');",
      "declare module 'ambient' { export {} from './inside'; }",
      "const escaped = \\u0072equire('./escaped');",
      '',
    ].join('\n');
    const reading = (reads: ImportReads) => readOf(importSites(tree, 'src/tree.ts'), reads).map(({ specifier }) => specifier);
    expect(reading('every')).toEqual(['./packed', './commented', './typed', './loaded', './inside', './escaped']);
    expect(reading('static')).toEqual(['./packed', './commented', './loaded', './inside', './escaped']);
  });

  it('answers the same sites parsed off the calling thread, with each line counted over the whole text', async () => {
    expect(await importSitesOffThread(source, 'src/entry.ts')).toEqual(importSites(source, 'src/entry.ts'));
    const markup =
      '<!-- <script>import \'./hidden\';</script> -->\n<script lang="ts" generics="T extends Record<string, unknown>">\n// ёжик 🦔\nimport { a } from \'./a\';\n</script>\n';
    expect(importSites(markup, 'src/view.svelte').map(({ specifier, line }) => ({ specifier, line }))).toEqual([
      { specifier: './a', line: 4 },
    ]);
  });

  it('reads a file that embeds scripts only through an embedding the composition hands the JS adapter', () => {
    const markup = "<script>import './a';</script>";
    expect(() => jsOf([]).imports(markup, 'src/view.svelte')).toThrow(UnsupportedSource);
    const page = jsOf([{ extensions: ['.page'], scripts: (text) => [{ text: text.slice(8), at: 8, module: true }] }]);
    expect(page.parses('src/home.page')).toBe(true);
    expect(page.imports("<script>import './b';", 'src/home.page').map(({ specifier }) => specifier)).toEqual(['./b']);
    expect(importSites(markup, 'src/view.svelte').map(({ specifier }) => specifier)).toEqual(['./a']);
  });

  it('reads as forwarding each re-export and each export of a binding an import brought in, and nothing the module makes of one', () => {
    const forwarded = (text: string) =>
      readOf(importSites(text, 'src/barrel.ts'), 'forwards').map(({ specifier, line }) => `${line} ${specifier}`);
    const record = [
      "import { a, b as c } from './named';",
      "import * as ns from './space';",
      "import fallback from './fallback';",
      "import type { T } from './types';",
      "import { kept } from './kept';",
      'export { a, c as d, ns, type T };',
      'export default fallback;',
      "export * from './all';",
      "export * as star from './star';",
      "export { e } from './e';",
      "export type { F } from './f';",
      'export const own = kept;',
      '',
    ].join('\n');
    expect(forwarded(record)).toEqual(['1 ./named', '2 ./space', '3 ./fallback', '4 ./types', '8 ./all', '9 ./star', '10 ./e', '11 ./f']);
    expect(forwarded("import x = require('./required');\nexport = x;\n")).toEqual(['1 ./required']);
    expect(forwarded("import y from './assigned';\nexport = y;\n")).toEqual(['1 ./assigned']);
    expect(forwarded("export = require('./direct');\n")).toEqual(['1 ./direct']);
    const required = [
      "const x = require('./x');",
      "const { a, b: c } = require('./y');",
      'const z = 1;',
      "function f() { const z = require('./z'); return z; }",
      'export { x, c, z };',
      '',
    ].join('\n');
    expect(forwarded(required)).toEqual(['1 ./x', '2 ./y']);
    const component = (text: string) =>
      readOf(importSites(text, 'src/view.svelte'), 'forwards').map(({ specifier, line }) => `${line} ${specifier}`);
    const instance = '<script lang="ts" generics="T extends module">\nimport { b } from \'./b\';\nexport { b };\n</script>\n';
    expect(component(`<script module lang="ts">\nexport { a } from './a';\n</script>\n${instance}`)).toEqual(['2 ./a']);
    expect(component(`<script context="module">\nexport * from './c';\n</script>\n${instance}`)).toEqual(['2 ./c']);
    expect(
      forwarded(
        "export {} from './empty';\nexport import z = require('./alias');\ndeclare module 'ambient' { export * from './inside'; }\n",
      ),
    ).toEqual(['1 ./empty', '2 ./alias', '3 ./inside']);
    expect(forwarded("import { a } from './a';\nexport default a.b;\nexport const b = a;\nexport function f() { return a; }\n")).toEqual(
      [],
    );
  });

  it('keeps conditional form and bundler starts, and names a dynamic expression it cannot resolve', () => {
    const text = [
      "import { a } from 'dual';",
      "const b = require('dual');",
      "import Typed = require('typed');",
      "const workers = new Worker(new URL('./worker.ts', import.meta.url));",
      "const pages = import.meta.glob(['./pages/*.ts', '!./pages/private.ts']);",
      'const dynamic = import(`./${name}.ts`);',
      "const asset = new URL('./icon.svg', import.meta.url);",
      "const data = new URL('../records/', import.meta.url);",
      "const shared = new SharedWorker(new URL('./shared.ts', import.meta.url));",
      "const quoted = 'import.meta.glob(unknown)';",
    ].join('\n');
    const sites = importSites(text, 'src/start.ts');
    expect(sites.map(({ specifier, form, kind, patterns }) => ({ specifier, form, kind, patterns }))).toEqual([
      { specifier: 'dual', form: 'import', kind: undefined, patterns: undefined },
      { specifier: 'dual', form: 'require', kind: undefined, patterns: undefined },
      { specifier: 'typed', form: 'require', kind: undefined, patterns: undefined },
      { specifier: './worker.ts', form: 'import', kind: 'worker', patterns: undefined },
      { specifier: './pages/*.ts, !./pages/private.ts', form: 'import', kind: 'glob', patterns: ['./pages/*.ts', '!./pages/private.ts'] },
      { specifier: '`./${name}.ts`', form: 'import', kind: 'unresolved', patterns: undefined },
      { specifier: './shared.ts', form: 'import', kind: 'worker', patterns: undefined },
    ]);
    expect(readOf(sites, 'runtime').map(({ specifier }) => specifier)).toEqual(['dual', 'dual', 'typed']);
  });

  it('marks glob options unresolved rather than silently losing their query transform', () => {
    const sites = importSites("import.meta.glob('./parts/*.json', { query: '?raw' });", 'src/start.ts');
    expect(sites.some(({ kind }) => kind === 'unresolved')).toBe(true);
  });

  it('keeps a glob whose options only choose when and which export loads', () => {
    const text = [
      "const eager = import.meta.glob<Parts>('./parts/*.ts', { eager: true, import: 'default' });",
      "const computed = import.meta.glob('./parts/*.ts', { [key]: true });",
      "const unknown = import.meta.glob('./parts/*.ts', { eager: flag });",
    ].join('\n');
    const sites = importSites(text, 'src/start.ts');
    expect(sites.map(({ kind, line }) => `${line} ${kind}`)).toEqual(['1 glob', '2 unresolved', '3 unresolved']);
  });

  it('flags a dynamic require as unresolved while keeping a literal require a runtime site', () => {
    const text = ["const a = require('./a');", 'const b = require(name);', 'const c = require(`./${name}.ts`);', ''].join('\n');
    const sites = importSites(text, 'src/entry.ts');
    const literal = sites.find(({ specifier }) => specifier === './a');
    expect(literal).toMatchObject({ form: 'require', loads: 'with-module', line: 1 });
    expect(literal?.kind).toBeUndefined();
    expect(sites.filter(({ kind }) => kind === 'unresolved').map(({ specifier, line }) => `${line} ${specifier}`)).toEqual([
      '2 name',
      '3 `./${name}.ts`',
    ]);
    expect(readOf(sites, 'runtime').map(({ specifier }) => specifier)).toEqual(['./a']);
  });

  it('reads no require out of a string or a comment', () => {
    const text = ["const spelled = 'require(ghost)';", '// require(ghost);', ''].join('\n');
    expect(importSites(text, 'src/entry.ts')).toEqual([]);
  });

  it('refuses a text that does not parse rather than reading what the parser recovered', () => {
    expect(() => importSites("import { a } from './a';\nconst = ;\n", 'src/broken.ts')).toThrow(UnsupportedSource);
    expect(() => importSites('<script>\nimport a from "./a";\n', 'src/open.svelte')).toThrow(UnsupportedSource);
  });
});
