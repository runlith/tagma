import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import { Schema } from 'effect';
import type { Params } from '../../../builtins';
import { platforms as declaration, runningOf } from './declaration';
import { inspect } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { type InspectionMemo, type MemoStats, type MemoValue, memoWrites } from '../../../core/node/memo';
import { resolveDoor } from './doors';
import { ready } from '../../../builtins.node';

await ready('platforms');

const platforms = {
  browser: { runtime: 'browser' },
  ssr: { runtime: 'node' },
  node: { runtime: 'node', unmarked: true },
  bun: { runtime: 'bun', unmarked: true },
};
const params: Params<'platforms'> = {
  base: '',
  platforms,
  shipped: 'bun',
  rendering: { client: 'browser', server: 'ssr' },
  allows: {},
  refuses: {},
  packages: {},
  apps: [],
  compiled: [],
  leaves: ['.css', '.json', '?raw'],
  files: { extensions: ['.ts', '.js', '.mjs', '.svelte'], exclude: ['**/*.test.ts'] },
};
type App = Params<'platforms'>['apps'][number];
const paths = (aliases: Record<string, string>) =>
  JSON.stringify({ compilerOptions: { paths: Object.fromEntries(Object.entries(aliases).map(([key, target]) => [key, [target]])) } });
const lib = { 'apps/web/tsconfig.json': paths({ $lib: './src/lib', '$lib/*': './src/lib/*' }) };
const routed = (extensions: string[]): App => ({
  at: 'apps/web',
  roots: ['src'],
  internal: ['$app'],
  server: ['src/hooks.server.ts', 'src/routes/**/+server.ts', 'src/routes/**/+{page,layout}.server.ts'],
  routes: {
    at: 'src/routes',
    pages: ['+page.svelte', '+page.ts'],
    layouts: ['+layout.svelte', '+layout.ts'],
    option: { export: 'ssr', off: [false], pages: ['+page.ts'], layouts: ['+layout.ts'] },
  },
  files: { extensions: extensions as App['files']['extensions'], exclude: [] },
});
const manifest = (name: string, exports: unknown, dependencies: Record<string, string> = {}) =>
  JSON.stringify({ name, exports, dependencies });
const files = (extra: Record<string, string> = {}) =>
  new Map(
    Object.entries({
      'package.json': JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }),
      'packages/a/package.json': manifest('a', { '.': { browser: './src/main.ts', default: './src/main.ts' } }, { b: '*' }),
      'packages/a/src/main.ts': "import { value } from 'b'; export const a = value;",
      'packages/b/package.json': manifest('b', { '.': { browser: './src/main.ts', default: './src/main.ts' } }),
      'packages/b/src/main.ts': 'export const value = 1;',
      ...extra,
    }),
  );
const tree = (texts: Map<string, string>): Tree => ({
  has: (path) => texts.has(path),
  paths: () => texts.keys(),
  object: (path) => texts.get(path),
  size: (path) => texts.get(path)?.length,
  read: (path) => {
    const text = texts.get(path);
    if (text === undefined) throw new Error(`Unread ${path}`);
    return text;
  },
});
const read = (texts: Map<string, string>, options = params, memo?: InspectionMemo) =>
  inspect({ builtin: 'platforms', params: options }, tree(texts), [...texts.keys()], undefined, undefined, memo);

describe('platforms', () => {
  it('refuses overlapping app scopes before a later internal prefix can shadow the first', () => {
    expect(() =>
      Schema.decodeUnknownSync(declaration.params)({
        ...params,
        apps: [
          { at: 'apps', roots: ['tagma/app/src'], internal: ['node:fs'], files: params.files },
          { at: 'apps/tagma/app', roots: ['src'], internal: [], files: params.files },
        ],
      }),
    ).toThrow();
  });

  it('judges an inherent refusal at its own package and carries an origin refusal through declared doors', () => {
    const texts = files({ 'packages/b/src/main.ts': "import 'node:fs'; import 'effect/http'; export const value = 1;" });
    const report = read(texts, { ...params, packages: { a: { loads: { browser: ['effect/http'] } } } });
    expect(report.unjudged).toEqual([]);
    expect(report.violations.map(({ fingerprint }) => fingerprint).sort()).toEqual(['a [browser] -> effect/http', 'b [browser] -> fs']);
    expect(report.violations.find(({ fingerprint }) => fingerprint.startsWith('a '))?.chain).toEqual([
      'packages/b/src/main.ts',
      'effect/http',
    ]);
  });

  it('continues through an undeclared platform door and fingerprints unresolved sources', () => {
    const texts = files({
      'packages/b/package.json': manifest('b', { '.': { node: './src/main.ts', default: './src/main.ts' } }),
      'packages/b/src/main.ts': "import 'node:fs'; import './missing'; export const value = 1;",
    });
    const report = read(texts);
    expect(report.violations.map(({ fingerprint }) => fingerprint)).toContain('a [browser] -> b (no browser)');
    expect(report.violations.map(({ fingerprint }) => fingerprint)).toContain('a [browser] -> fs');
    expect(report.violations.some(({ fingerprint }) => fingerprint.includes('unresolved ./missing'))).toBe(true);
    const worded = (fingerprint: string) => {
      const found = report.violations.find((one) => one.fingerprint === fingerprint);
      return { message: found?.message, fix: found?.fix };
    };
    expect(worded('a [browser] -> b (no browser)')).toEqual({
      message: 'loads `b`, whose `exports` declare no browser condition',
      fix: 'Give the `exports` entry `.` of `packages/b/package.json` a `browser` condition, or load a door of `b` that declares one.',
    });
    expect(worded('a [browser] -> fs')).toEqual({
      message: 'loads the built-in `fs`, which the browser runtime does not provide',
      fix: 'Move this load out of what browser starts reach, or behind a door whose `exports` give browser a file of its own; name `node:fs` in `allows.browser` only where browser truly provides it.',
    });
  });

  it('keeps the origin-independent fingerprint when another door becomes a shorter path', () => {
    const exports = {
      './alpha': { browser: './src/alpha.ts', default: './src/alpha.ts' },
      './beta': { browser: './src/beta.ts', default: './src/beta.ts' },
    };
    const texts = files({
      'packages/a/package.json': manifest('a', exports),
      'packages/a/src/alpha.ts': "import './via';",
      'packages/a/src/via.ts': "import './cause';",
      'packages/a/src/beta.ts': "import './cause';",
      'packages/a/src/cause.ts': "import 'node:fs';",
    });
    const before = read(texts).violations.map(({ fingerprint }) => fingerprint);
    expect(before).toContain('a/alpha [browser] -> fs');
    texts.set('packages/a/src/alpha.ts', "import './cause';");
    expect(read(texts).violations.map(({ fingerprint }) => fingerprint)).toContain('a/alpha [browser] -> fs');
  });

  it('keeps import and require marker branches separate and judges the require target', () => {
    const exports = {
      '.': {
        import: { browser: './src/esm.ts', default: './src/esm.ts' },
        require: { browser: './src/cjs.ts', default: './src/cjs.ts' },
      },
    };
    const member = { dir: 'packages/b', manifest: { name: 'b', exports } };
    const conditions = runningOf(params);
    expect(resolveDoor('b', member, '.', 'browser', conditions).marker).toBeUndefined();
    expect(resolveDoor('b', member, '.', 'browser', conditions, 'require').marker).toBeUndefined();
    expect(resolveDoor('b', member, '.', 'browser', conditions, 'require').file).toBe('packages/b/src/cjs.ts');
    const texts = files({
      'packages/b/package.json': manifest('b', exports),
      'packages/b/src/esm.ts': 'export const value = 1;',
      'packages/b/src/cjs.ts': "require('node:fs'); export const value = 2;",
    });
    expect(read(texts).violations.map(({ fingerprint }) => fingerprint)).toContain('b [browser] -> fs');
  });

  it('resolves SSR without an ssr condition and checks its marker against the selected target', () => {
    const texts = files({
      'packages/a/package.json': manifest('a', { '.': { ssr: './src/marker.ts', node: './src/main.ts', default: './src/main.ts' } }),
      'packages/a/src/main.ts': "import 'bun:sqlite';",
      'packages/a/src/marker.ts': 'export const safe = true;',
    });
    const fingerprints = read(texts).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('a [ssr] marker');
    expect(fingerprints).toContain('a [ssr] -> bun');
  });

  it('reads names in types but not transitively, and distinguishes dependency declarations from linker dev links', () => {
    const texts = files({
      'packages/a/src/main.ts': "import type { Z } from 'zod'; import { value } from 'b';",
      'packages/a/package.json': JSON.stringify({ name: 'a', exports: { '.': { browser: './src/main.ts' } }, devDependencies: { b: '*' } }),
      'packages/b/src/main.ts': "import type { X } from 'forbidden'; export const value = 1;",
      'packages/b/package.json': manifest('b', { '.': { browser: './src/main.ts', node: './src/main.ts', default: './src/main.ts' } }),
    });
    const report = read(texts, { ...params, packages: { a: { names: ['zod', 'forbidden'] } } });
    expect(
      report.violations
        .map(({ fingerprint, message, fix }) => ({ fingerprint, message, fix }))
        .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    ).toEqual([
      {
        fingerprint: 'packages/a/src/main.ts -> b (undeclared)',
        message: 'imports `b`, which `packages/a/package.json` does not declare',
        fix: "Declare `b` in the `dependencies` of `packages/a/package.json`, then run the package manager's install.",
      },
      {
        fingerprint: 'packages/a/src/main.ts -> zod (names)',
        message: 'names `zod`, which package `a` refuses',
        fix: 'Remove `zod` from this source, types included: `packages.a.names` refuses it.',
      },
    ]);
  });

  it('refuses missing authored aliases while generated app outputs and virtual aliases remain leaves', () => {
    const texts = files({
      'apps/web/package.json': manifest('web', {}),
      'apps/web/tsconfig.json': JSON.stringify({ extends: './.gen/tsconfig.json' }),
      'apps/web/gen.json': paths({ $lib: '../src/lib', '$lib/*': '../src/lib/*' }),
      'apps/web/src/page.ts':
        "import '$lib/typo'; import '$lib/ready'; import '$lib/paraglide/messages.js'; import './lib/paraglide/runtime.js'; import '$app/paths'; import '$env/dynamic/public'; import 'virtual:route';",
      'apps/web/src/lib/ready.ts': 'export const ready = true;',
    });
    const options: Params<'platforms'> = {
      ...params,
      built: [{ output: 'apps/web/.gen/tsconfig.json', source: 'apps/web/gen.json', why: 'the generated config the app extends' }],
      apps: [
        {
          at: 'apps/web',
          roots: ['src'],
          internal: ['$app', '$env', 'virtual:'],
          generated: ['src/lib/paraglide/**'],
          files: params.files,
        },
      ],
    };
    const stored = new Map<string, MemoValue>();
    const memo: InspectionMemo = {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.set(key, value);
      },
    };
    const first = read(texts, options, memo).violations.map(({ fingerprint }) => fingerprint);
    expect(first).toContain('apps/web/src/page.ts [browser] -> unresolved $lib/typo @ apps/web/src/page.ts');
    expect(
      first.some(
        (one) =>
          one.includes('paraglide/') ||
          one.includes('$lib/ready') ||
          one.includes('$app/') ||
          one.includes('$env/') ||
          one.includes('virtual:'),
      ),
    ).toBe(false);
    texts.set('apps/web/src/lib/paraglide/messages.js', "import 'node:fs';");
    expect(read(texts, options, memo).violations.map(({ fingerprint }) => fingerprint)).toEqual(first);
    texts.set('apps/web/src/lib/typo.ts', 'export const typo = true;');
    expect(read(texts, options, memo).violations.some(({ fingerprint }) => fingerprint.includes('unresolved $lib/typo'))).toBe(false);
  });

  it('leaves a non-literal load inside a declared injected file to the page it runs in and only that file', () => {
    const texts = files({
      'apps/ext/package.json': manifest('ext', {}),
      'apps/ext/src/probe.ts': 'export const probe = async (url: string) => import(url);',
      'apps/ext/src/other.ts': 'export const other = async (url: string) => import(url);',
      'apps/ext/src/main.ts': "import { probe } from './probe'; import { other } from './other'; export const run = [probe, other];",
    });
    const app = { at: 'apps/ext', roots: ['src'] as [string], internal: [], files: params.files };
    const found = (injected?: string[]) =>
      read(texts, { ...params, apps: [{ ...app, injected }] })
        .violations.map(({ fingerprint }) => fingerprint)
        .filter((one) => one.includes('unresolved url'));
    expect(found()).toHaveLength(2);
    expect(found(['src/probe.ts']).every((one) => one.endsWith('src/other.ts'))).toBe(true);
    expect(found(['src/probe.ts'])).toHaveLength(1);
  });

  it('leaves a non-literal load inside a declared loader file to the code it installs at runtime, and only that file', () => {
    const texts = files({
      'apps/ext/package.json': manifest('ext', {}),
      'apps/ext/src/probe.ts': 'export const probe = async (url: string) => import(url);',
      'apps/ext/src/other.ts': 'export const other = async (url: string) => import(url);',
      'apps/ext/src/main.ts': "import { probe } from './probe'; import { other } from './other'; export const run = [probe, other];",
    });
    const app = { at: 'apps/ext', roots: ['src'] as [string], internal: [], files: params.files };
    const found = read(texts, { ...params, apps: [app], loaders: [{ at: 'apps/ext/src/probe.ts', why: 'installed adapters' }] })
      .violations.map(({ fingerprint }) => fingerprint)
      .filter((one) => one.includes('unresolved url'));
    expect(found).toHaveLength(1);
    expect(found[0]).toEndWith('src/other.ts');
  });

  it('judges each platform by the runtime the rule names for it, under the name the rule gives it', () => {
    const texts = files({
      'packages/a/package.json': manifest('a', { '.': { edge: './src/main.ts', default: './src/main.ts' } }),
      'packages/a/src/main.ts': "import 'node:fs'; import 'bun:sqlite';",
    });
    const found = (runtime: string) =>
      read(texts, {
        ...params,
        platforms: { edge: { runtime }, server: { runtime: 'bun', unmarked: true } },
        shipped: 'server',
        rendering: undefined,
      })
        .violations.map(({ fingerprint }) => fingerprint)
        .filter((one) => one.startsWith('a '))
        .sort();
    expect(found('node')).toEqual(['a [edge] -> bun']);
    expect(found('browser')).toEqual(['a [edge] -> bun', 'a [edge] -> fs']);
    expect(found('bun')).toEqual([]);
  });

  it('reads routes and export conditions only as the rule declares them and aliases only from tsconfig, never from a framework config', () => {
    const texts = files({
      'apps/web/package.json': manifest('web', {}, { b: '*' }),
      'apps/web/svelte.config.js': "export default { kit: { alias: { '@feature': './src/elsewhere' } } };",
      'apps/web/tsconfig.json': paths({ '@feature/*': './src/feature/*' }),
      'apps/web/src/routes/+page.svelte': '<script>import "@feature/entry"; import "b";</script>',
      'apps/web/src/feature/entry.ts': "import 'sharp';",
      'packages/b/package.json': manifest('b', {
        '.': { node: { component: './src/component.ts', default: './src/main.ts' }, default: './src/main.ts' },
      }),
      'packages/b/src/component.ts': "import 'node:fs';",
    });
    const app = { at: 'apps/web', roots: ['src/client'] as [string], internal: [], files: params.files };
    const declared = { ...app, routes: { at: 'src/routes', pages: ['+page.svelte'], layouts: [] } };
    const found = (options: Partial<Params<'platforms'>>) =>
      read(texts, { ...params, refuses: { ssr: ['sharp', 'node:fs'] }, ...options })
        .violations.map(({ fingerprint }) => fingerprint)
        .filter((one) => one.includes('[ssr]'))
        .sort();
    expect(found({ apps: [app] })).toEqual([]);
    expect(found({ apps: [declared] })).toEqual(['apps/web/src/routes/+page.svelte [ssr] -> sharp']);
    expect(found({ apps: [declared], platforms: { ...platforms, ssr: { runtime: 'node', conditions: ['component'] } } })).toEqual([
      'apps/web/src/routes/+page.svelte [ssr] -> sharp',
      'b [ssr] -> node:fs',
    ]);
  });

  it('judges another file-routed framework from data alone, and names a declaration that no longer fits the tree', () => {
    const texts = files({
      'apps/site/package.json': manifest('site', {}),
      'apps/site/tsconfig.json': paths({ '~/*': './src/*' }),
      'apps/site/app/layout.tsx': "import '~/shell';",
      'apps/site/app/page.tsx': "import '~/home';",
      'apps/site/app/api/route.ts': "import '~/api';",
      'apps/site/src/api.ts': "import 'node:os';",
      'apps/site/app/static/page.tsx': "import '~/home';",
      'apps/site/app/static/config.ts': "const runtime = 'edge' as const; export { runtime };",
      'apps/site/app/lazy/page.tsx': "import '@/missing';",
      'apps/site/src/shell.ts': "import 'sharp';",
      'apps/site/src/home.ts': "import 'node:fs';",
    });
    const site: App = {
      at: 'apps/site',
      roots: ['src/client'],
      internal: [],
      server: ['app/**/route.ts'],
      routes: {
        at: 'app',
        pages: ['page.tsx'],
        layouts: ['layout.tsx'],
        option: { export: 'runtime', off: ['edge'], pages: ['config.ts'], layouts: [] },
      },
      files: { extensions: ['.ts', '.tsx'], exclude: [] },
    };
    const found = (app: App) =>
      read(texts, { ...params, refuses: { ssr: ['sharp', 'node:fs', 'node:os'] }, apps: [app] })
        .violations.map(({ fingerprint }) => fingerprint)
        .sort();
    expect(found(site)).toEqual([
      'apps/site/app/api/route.ts [ssr] -> node:os',
      'apps/site/app/layout.tsx [ssr] -> sharp',
      'apps/site/app/lazy/page.tsx [ssr] -> unresolved @/missing @ apps/site/app/lazy/page.tsx',
      'apps/site/app/page.tsx [ssr] -> node:fs',
    ]);
    expect(found({ ...site, routes: { ...site.routes!, at: 'pages' } })).toContain(
      'apps/site -> unresolved pages @ apps/site/package.json',
    );
  });

  it('starts declared server routes and follows tsconfig aliases on SSR, judging again when the config moves them', () => {
    const config = (target: string) => paths({ $lib: './src/lib', '$lib/*': './src/lib/*', '@feature/*': `./src/lib/${target}/*` });
    const texts = files({
      'apps/web/package.json': manifest('web', {}),
      'apps/web/tsconfig.json': config('feature'),
      'apps/web/src/routes/+page.server.ts': "import '@feature/entry';",
      'apps/web/src/routes/+page.svelte': '<script>import "$lib/feature/entry";</script>',
      'apps/web/src/routes/+server.ts': "import '$lib/feature/entry';",
      'apps/web/src/routes/+layout.svelte': '<script lang="ts">import "$lib/feature/entry";</script>',
      'apps/web/src/hooks.server.ts': "import '@feature/entry';",
      'apps/web/src/lib/feature/entry.ts': "import 'node:fs';",
      'apps/web/src/lib/other/entry.ts': "import 'bun:sqlite';",
    });
    const options: Params<'platforms'> = {
      ...params,
      packages: { web: { loads: { ssr: ['node:fs', 'bun:sqlite'] } } },
      apps: [routed(['.ts', '.svelte'])],
    };
    const stored = new Map<string, MemoValue>();
    const memo: InspectionMemo = {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.set(key, value);
      },
    };
    const first = read(texts, options, memo).violations.map(({ fingerprint }) => fingerprint);
    for (const start of ['+page.server.ts', '+server.ts', '+layout.svelte'])
      expect(first).toContain(`apps/web/src/routes/${start} [ssr] -> node:fs`);
    expect(first).toContain('apps/web/src/hooks.server.ts [ssr] -> node:fs');
    texts.set('apps/web/tsconfig.json', config('other'));
    const changed = read(texts, options, memo).violations.map(({ fingerprint }) => fingerprint);
    expect(changed).toContain('apps/web/src/routes/+page.server.ts [ssr] -> bun:sqlite');
  });

  it('starts declared server-only entries on SSR without inventing browser starts', () => {
    const texts = files({
      ...lib,
      'apps/web/package.json': manifest('web', {}),
      'apps/web/src/routes/+layout.ts': 'export const ssr = false;',
      'apps/web/src/routes/+page.ts': "import 'sharp';",
      'apps/web/src/routes/+page.server.ts': "import 'node:fs';",
      'apps/web/src/routes/+layout.server.ts': "import 'node:fs';",
      'apps/web/src/routes/+server.ts': "import 'node:fs';",
      'apps/web/src/hooks.server.ts': "import 'node:fs';",
    });
    const options: Params<'platforms'> = {
      ...params,
      refuses: { browser: ['sharp'] },
      packages: { web: { loads: { ssr: ['node:fs'] } } },
      apps: [routed(['.ts'])],
    };
    const fingerprints = read(texts, options).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('apps/web/src/routes/+page.ts [browser] -> sharp');
    for (const file of ['routes/+page.server.ts', 'routes/+layout.server.ts', 'routes/+server.ts', 'hooks.server.ts'])
      expect(fingerprints).toContain(`apps/web/src/${file} [ssr] -> node:fs`);
    expect(fingerprints.some((one) => one.includes('[browser] -> fs'))).toBe(false);
  });

  it('keeps SSR server entries while a false layout disables universal routes until a child re-enables them', () => {
    const texts = files({
      ...lib,
      'apps/web/package.json': manifest('web', {}),
      'apps/web/src/routes/+layout.ts': 'export const ssr = false;',
      'apps/web/src/routes/+layout.svelte': '<script>import "$lib/unsafe";</script>',
      'apps/web/src/routes/+page.svelte': '<script>import "$lib/unsafe";</script>',
      'apps/web/src/routes/+page.server.ts': "import '$lib/unsafe';",
      'apps/web/src/routes/+server.ts': "import '$lib/unsafe';",
      'apps/web/src/hooks.server.ts': "import '$lib/unsafe';",
      'apps/web/src/routes/child/+layout.ts': 'export const ssr = true;',
      'apps/web/src/routes/child/+page.svelte': '<script>import "$lib/unsafe";</script>',
      'apps/web/src/lib/unsafe.ts': "import 'sharp';",
    });
    const options: Params<'platforms'> = {
      ...params,
      packages: { web: { loads: { ssr: ['sharp'] } } },
      apps: [routed(['.ts', '.svelte'])],
    };
    const ssr = read(texts, options)
      .violations.map(({ fingerprint }) => fingerprint)
      .filter((one) => one.includes('[ssr]'));
    expect(ssr).toContain('apps/web/src/routes/+page.server.ts [ssr] -> sharp');
    expect(ssr).toContain('apps/web/src/routes/+server.ts [ssr] -> sharp');
    expect(ssr).toContain('apps/web/src/hooks.server.ts [ssr] -> sharp');
    expect(ssr).toContain('apps/web/src/routes/child/+page.svelte [ssr] -> sharp');
    expect(ssr).toContain('apps/web/src/routes/+layout.svelte [ssr] -> sharp');
    expect(ssr.some((one) => one.includes('apps/web/src/routes/+page.svelte [ssr]'))).toBe(false);
    texts.set('apps/web/src/routes/child/+layout.ts', 'export const ssr = computed(); export const prerender = true;');
    expect(read(texts, options).violations.map(({ fingerprint }) => fingerprint)).toContain(
      'apps/web/src/routes/child/+page.svelte [ssr] -> sharp',
    );
  });

  it('leaves matched glob data unread and refuses unsupported absolute glob bases', () => {
    const texts = files({
      'packages/a/src/main.ts': "import.meta.glob('./parts/*.json'); import.meta.glob('/src/*.ts');",
      'packages/a/src/parts/data.json': '{"valid":true}',
    });
    const fingerprints = read(texts).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints.some((one) => one.includes('data.json'))).toBe(false);
    expect(fingerprints.some((one) => one.includes('unresolved /src/*.ts'))).toBe(true);
  });

  it('follows workers and literal globs, leaves data alone, and refuses a non-literal import', () => {
    const texts = files({
      'packages/a/src/main.ts':
        "new Worker(new URL('./worker.ts', import.meta.url)); import.meta.glob('./parts/*.ts'); import('./icon.svg?raw'); import(name);",
      'packages/a/src/worker.ts': "import 'sharp';",
      'packages/a/src/parts/one.ts': "import 'node:fs';",
    });
    const report = read(texts, { ...params, refuses: { browser: ['sharp'] } });
    expect(report.violations.some(({ fingerprint }) => fingerprint === 'packages/a/src/worker.ts [browser] -> sharp')).toBe(true);
    expect(report.violations.some(({ fingerprint }) => fingerprint === 'a [browser] -> fs')).toBe(true);
    expect(report.violations.some(({ fingerprint }) => fingerprint.includes('unresolved name'))).toBe(true);
    expect(report.violations.some(({ fingerprint }) => fingerprint.includes('icon.svg'))).toBe(false);
  });

  it('reads a query as a worker start or a leaf only where the rule declares it, and refuses it unresolved otherwise', () => {
    const texts = files({
      'packages/a/src/main.ts': "import Work from './work.ts?worker'; import data from './data.bin?bytes';",
      'packages/a/src/work.ts': "import 'sharp';",
      'packages/a/src/data.bin': 'binary',
    });
    const refuses = { browser: ['sharp'] };
    const prints = (options: Params<'platforms'>) => read(texts, options).violations.map(({ fingerprint }) => fingerprint);
    const declared = prints({ ...params, refuses, leaves: [...params.leaves, '?bytes'], workers: ['?worker'] });
    expect(declared).toContain('packages/a/src/work.ts [browser] -> sharp');
    expect(declared.some((one) => one.includes('unresolved'))).toBe(false);
    const bare = prints({ ...params, refuses });
    expect(bare.some((one) => one.includes('work.ts [browser]'))).toBe(false);
    expect(bare.filter((one) => one.includes('unresolved')).length).toBe(2);
    const edged = files({
      'packages/a/src/main.ts':
        "import 'b?spawn'; import 'b?unknown'; import './style?format.css'; new Worker(new URL('./work.ts?mode?spawn', import.meta.url));",
      'packages/a/src/work.ts': 'export {};',
    });
    const edges = read(edged, { ...params, refuses: { browser: ['b'] }, workers: ['?spawn'] }).violations.map(
      ({ fingerprint }) => fingerprint,
    );
    expect(edges).toContain('a [browser] -> b');
    expect(edges.filter((one) => one.includes('unresolved')).length).toBe(2);
    expect(edges.some((one) => one.includes('work.ts'))).toBe(false);
    const decoded = (leaves: readonly string[], workers: readonly string[]) =>
      Schema.decodeUnknownResult(declaration.params)({ ...params, leaves, workers })._tag;
    expect(decoded(['.css', '?bytes'], ['?worker&inline'])).toBe('Success');
    expect(decoded(['.css', '?worker'], ['?worker'])).toBe('Failure');
  });

  it('invalidates only dependent starts, including absent resolution candidates and changed platform declarations', () => {
    const texts = files({
      'packages/a/src/main.ts': "import './part';",
      'packages/a/src/part/index.ts': 'export const part = 1;',
    });
    const stored = new Map<string, MemoValue>();
    const stats: MemoStats = { starts: 0, walked: 0, blobs: 0 };
    const memo: InspectionMemo = {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.set(key, value);
      },
      stats,
    };
    const cold = memoWrites(memo);
    expect(read(texts, params, cold).violations).toEqual([]);
    cold.commit();
    stats.walked = 0;
    expect(read(texts, params, memo).violations).toEqual([]);
    expect(stats.walked).toBe(0);
    texts.set('packages/a/src/part.ts', 'export const part = 2;');
    const changed = read(texts, params, memo);
    expect(stats.walked).toBe(1);
    expect(changed.violations.some(({ message }) => message?.includes('more than one'))).toBe(true);
    texts.set('packages/a/src/main.ts', "import 'b';");
    read(texts, params, memo);
    texts.set('packages/b/package.json', manifest('b', { '.': { node: './src/main.ts', default: './src/main.ts' } }));
    expect(read(texts, params, memo).violations.some(({ fingerprint }) => fingerprint === 'a [browser] -> b (no browser)')).toBe(true);
  });

  it('admits a tracked shim into the output its manifest declares only for an explicitly built package', () => {
    const texts = files({
      'packages/b/package.json': JSON.stringify({
        name: '@acme/identity',
        exports: { '.': './out/index.js', './raw': '/raw/index.js' },
        bin: { identity: './bin/identity.mjs' },
      }),
      'packages/b/bin/identity.mjs': "import '../out/cli.js'; import '../dist/cli.js';",
    });
    const options: Params<'platforms'> = { ...params, compiled: ['@acme/identity'] };
    const unresolved = (report: ReturnType<typeof read>) =>
      report.violations
        .map(({ fingerprint }) => fingerprint)
        .filter((one) => one.includes('unresolved ../'))
        .map((one) => (one.includes('../out/') ? 'out' : 'dist'));
    expect(unresolved(read(texts, options))).toEqual(['dist']);
    expect(unresolved(read(texts)).sort()).toEqual(['dist', 'out']);
  });

  it('fingerprints absent main and bin entries but accepts a declared source for built output', () => {
    const texts = files({
      'packages/b/package.json': JSON.stringify({ name: 'b', main: './dist/main.js', bin: { b: './src/gone.ts' } }),
      'packages/b/src/main.ts': 'export const ready = true;',
    });
    const program = {
      ...params,
      programs: [{ at: 'packages/b/src/main.ts', platform: 'bun' as const, replaces: 'packages/b/dist/main.js' }],
    };
    const fingerprints = read(texts, program).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('b#bin/b [bun] -> unresolved ./src/gone.ts @ packages/b/package.json');
    expect(fingerprints.some((one) => one.includes('dist/main.js'))).toBe(false);
  });

  it('takes no shell script a package names as its bin for a start', () => {
    const texts = files({
      'packages/b/package.json': JSON.stringify({ name: 'b', bin: { b: './b', c: './src/gone.ts' } }),
      'packages/b/b': '#!/bin/sh\nexec "$HOME/.b/bin/b" "$@"\n',
    });
    const fingerprints = read(texts).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints.filter((one) => one.startsWith('b#bin/'))).toEqual([
      'b#bin/c [bun] -> unresolved ./src/gone.ts @ packages/b/package.json',
    ]);
  });

  it('reads direct names in unreachable source without treating it as a runtime start', () => {
    const texts = files({ 'packages/a/src/unreached.ts': "import type { Z } from 'zod'; import 'bun:sqlite';" });
    const options = { ...params, packages: { a: { names: ['zod'], loads: { any: ['bun:sqlite'] } } } };
    const fingerprints = read(texts, options).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('packages/a/src/unreached.ts -> zod (names)');
    expect(fingerprints.some((one) => one.includes('unreached.ts [') && one.includes('bun:sqlite'))).toBe(false);
  });

  it('checks undeclared dependencies in production files reached from a shipped door', () => {
    const texts = files({
      'packages/b/src/main.ts': "import './internal'; export const value = 1;",
      'packages/b/src/internal.ts': "import 'a';",
    });
    expect(read(texts).violations.map(({ fingerprint }) => fingerprint)).toContain('packages/b/src/internal.ts -> a (undeclared)');
  });

  it('reads transitive loads from shipped doors without inventing Bun starts for browser-only entries', () => {
    const texts = files({
      'packages/a/src/main.ts': "import 'b';",
      'packages/b/package.json': manifest('b', { '.': { browser: './src/main.ts', default: './src/main.ts' } }),
      'packages/b/src/main.ts': "import 'bun:sqlite'; export const value = 1;",
    });
    const options = { ...params, packages: { a: { loads: { any: ['bun:sqlite'] } } } };
    const report = read(texts, options);
    expect(report.violations.map(({ fingerprint }) => fingerprint)).toContain('a [browser] -> bun:sqlite');
    expect(report.violations.some(({ fingerprint }) => fingerprint.includes('(no bun)'))).toBe(false);
  });

  it('expands pattern doors over production paths without treating suites as shipped starts', () => {
    const texts = files({
      'packages/b/package.json': manifest('b', { './protocol/*': { browser: './src/protocol/*.ts', default: './src/protocol/*.ts' } }),
      'packages/b/src/protocol/safe.ts': 'export const safe = true;',
      'packages/b/src/protocol/safe.test.ts': "import 'bun:test';",
    });
    expect(read(texts).violations.some(({ fingerprint }) => fingerprint.includes('safe.test'))).toBe(false);
  });

  it('reads a null pattern as excluding the subpaths it matches, never as a door', () => {
    const texts = files({
      'packages/b/package.json': manifest('b', {
        '.': { browser: './src/main.ts', default: './src/main.ts' },
        './protocol/*.test': null,
        './protocol/*': { browser: './src/protocol/*.ts', default: './src/protocol/*.ts' },
      }),
      'packages/b/src/protocol/safe.ts': 'export const safe = true;',
      'packages/b/src/protocol/safe.test.ts': "import 'bun:test';",
    });
    expect(read(texts).violations).toEqual([]);
  });

  it('follows a moved app start when its offending descendant stays in place', () => {
    const before = files({
      'apps/a/package.json': manifest('a', {}),
      'apps/a/src/main.ts': "import './child';",
      'apps/a/src/child.ts': "import 'sharp';",
    });
    const after = new Map(before);
    after.delete('apps/a/src/main.ts');
    after.set('apps/a/src/launch.ts', "import './child';");
    const options: Params<'platforms'> = {
      ...params,
      files: { extensions: ['.js'], exclude: [] },
      packages: { a: { loads: { browser: ['sharp'] } } },
      apps: [{ at: 'apps/a', roots: ['src'], internal: [], files: params.files }],
    };
    const report = judge(
      { builtin: 'platforms', params: options },
      {
        base: tree(before),
        built: tree(after),
        paths: ['apps/a/src/main.ts', 'apps/a/src/launch.ts'],
      },
      [],
    );
    expect(report.violations).toEqual([]);
    expect(report.followed).toContainEqual({
      from: 'apps/a/src/main.ts [browser] -> sharp',
      to: 'apps/a/src/launch.ts [browser] -> sharp',
    });
  });

  it('keeps a closed package verdict after its intermediate memo entries leave, and rejudges foreign and absent sources', () => {
    const texts = files({ 'packages/b/src/main.ts': "import './missing'; export const value = 1;" });
    const options = { ...params, packages: { a: { loads: { browser: ['heavy'] } } } };
    const stored = new Map<string, MemoValue>();
    const memo: InspectionMemo = {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.delete(key);
        stored.set(key, value);
        if (stored.size > 4) stored.delete(stored.keys().next().value!);
      },
    };
    const measured = () => {
      const writing = memoWrites(memo);
      const result = read(texts, options, writing);
      writing.commit();
      return result;
    };
    const first = measured();
    expect(measured()).toEqual(first);
    texts.set('packages/b/src/missing.ts', "import 'heavy';");
    const changed = measured();
    expect(changed).toEqual(read(texts, options));
    expect(changed.violations.map(({ fingerprint }) => fingerprint)).toContain('a [browser] -> heavy');
    texts.set('packages/b/src/missing.ts', 'export const missing = 1;');
    expect(measured()).toEqual({ violations: [], unjudged: [] });
  });

  it('keeps worker and direct-name violations on a warm memo, and tolerates closure cycles', () => {
    const texts = files({
      'packages/a/src/main.ts': "new Worker(new URL('./worker.ts', import.meta.url)); import type { Z } from 'zod';",
      'packages/a/src/worker.ts': "import './main'; import 'sharp';",
    });
    const options = { ...params, refuses: { browser: ['sharp'] }, packages: { a: { names: ['zod'], loads: { browser: ['sharp'] } } } };
    const memo = new Map<string, MemoValue>();
    const cold = read(texts, options, memo);
    expect(cold.violations.map(({ fingerprint }) => fingerprint)).toContain('packages/a/src/worker.ts [browser] -> sharp');
    expect([...read(texts, options, memo).violations].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))).toEqual(
      [...cold.violations].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    );
  });
});
