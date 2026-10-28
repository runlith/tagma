import { afterAll, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { BUILTINS } from '@tagma/inspection/builtins';
import { inArray } from 'drizzle-orm';
import { Effect, Result, Schema } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { block } from '../store/tables.js';
import { platformsDeclared } from './platformsDeclared.js';

const FILES = { extensions: ['.ts', '.js', '.svelte'], exclude: ['**/*.test.*'] };
const KIT = 'apps/web/kit.tsconfig.json';
const KIT_CONFIG = JSON.stringify({ compilerOptions: { paths: { $lib: ['../src/lib'], '$lib/*': ['../src/lib/*'] } } });
const WHY = 'svelte-kit sync writes it under .svelte-kit/';

const modules = {
  base: '',
  framework: ['$app/*'],
  built: [
    { output: 'apps/web/.svelte-kit/tsconfig.json', source: KIT, why: WHY },
    { output: 'packages/native/dist/index.js', source: 'packages/native/src/index.ts', why: 'tsc writes it under dist/' },
  ],
  tests: ['.test'],
  cycles: 'refuse',
  coverage: 'refuse',
  reads: 'every',
  unresolved: 'refuse',
  files: FILES,
};
const loads = {
  base: 'packages/core/src',
  from: ['index.ts'],
  refuses: ['oxc-parser'],
  allows: [],
  reads: 'runtime',
  conditions: [],
  files: FILES,
};
const app = (at: string, internal: readonly string[], ssr: readonly string[]) => ({ at, roots: ['src'], ssr, internal, files: FILES });
const platforms = (apps: readonly object[]) => ({
  base: '',
  allows: { browser: ['node:path'] },
  refuses: { browser: ['pg'] },
  packages: { '@demo/core': { names: ['bun:sqlite'], loads: { any: ['pg'], browser: ['drizzle-orm'] } } },
  apps,
  programs: [{ at: 'apps/server/src/main.ts', platform: 'bun' }],
  built: ['@demo/native'],
  leaves: ['.css', '?raw'],
  files: FILES,
});
const document = (builtin: string, params: object) => ({
  enforcement: { strictness: 'gate', on: [{ op: 'submit_work', phase: 'before' }], checks: [{ builtin, params }], debt: [], escaped: [] },
});
const WEB = {
  'apps/web/tsconfig.json': JSON.stringify({ extends: './.svelte-kit/tsconfig.json' }),
  'apps/web/kit.tsconfig.json': KIT_CONFIG,
  'apps/web/src/lib/util.ts': 'export const one = 1;\n',
  'apps/web/src/pages/+page.svelte': "<script>\n  import { one } from '$lib/util';\n</script>\n<h1>{one}</h1>\n",
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const tracked = (files: Readonly<Record<string, string>>) =>
  Effect.sync(() => {
    const root = mkdtempSync(join(tmpdir(), 'platforms-declared-'));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    return root;
  });

const decodes = (builtin: 'modules' | 'loads' | 'platforms', params: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(BUILTINS[builtin].params)(params));

layer(demoGraphLayer(), { excludeTestServices: true })('platforms declared', (it) => {
  it.effect('old modules, loads and platforms documents take the declarations the old code held, read from the project tree', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const { db } = graph.graphStore;
        const root = yield* tracked({
          ...WEB,
          'apps/web/svelte.config.js':
            "import adapter from '@sveltejs/adapter-static';\nconst config = { kit: { adapter: adapter(), files: { routes: 'src/pages', hooks: { server: 'src/hooks.ts' } } } };\nexport default config;\n",
          'apps/web/src/pages/about/+layout.ts': 'export const ssr = false;\n',
          'apps/web/src/worker.ts': "const make = () => import('./w.ts?worker&inline');\n",
          'apps/desk/src/main.ts': 'export {};\n',
        });
        const project = { ...(yield* graph.projects.byId(projectId)), rootPath: root };
        const rules = yield* Effect.forEach(['modules', 'loads', 'platforms'], (title) =>
          graph.blocks.create({ projectId, parentId: demo.root, title }),
        );
        const stored = [
          document('modules', modules),
          document('loads', loads),
          document(
            'platforms',
            platforms([
              app('apps/web', ['$lib', '$app', '$env', 'virtual:'], ['src/pages/**/+page.ts', 'src/entry.server.ts']),
              app('apps/desk', ['$lib'], ['src/main.ts']),
            ]),
          ),
        ];
        for (const [at, fields] of stored.entries())
          yield* db
            .update(block)
            .set({ fields })
            .where(inArray(block.id, [rules[at]!.id]));
        yield* platformsDeclared(project);
        const read = () =>
          db
            .select()
            .from(block)
            .where(
              inArray(
                block.id,
                rules.map((rule) => rule.id),
              ),
            )
            .orderBy(block.id);
        const once = yield* read();
        const params = once.map((row) => (row.fields as ReturnType<typeof document>).enforcement.checks[0]!.params);
        expect(params[0]).toEqual({ ...modules, runtimes: ['node', 'bun'] });
        expect(params[1]).toEqual({ ...loads, runtimes: ['node', 'bun'] });
        expect(params[2]).toEqual({
          base: '',
          allows: { browser: ['node:path'] },
          refuses: { browser: ['pg'] },
          packages: { '@demo/core': { names: ['bun:sqlite'], loads: { any: ['pg'], browser: ['drizzle-orm'] } } },
          programs: [{ at: 'apps/server/src/main.ts', platform: 'bun' }],
          leaves: ['.css', '?raw'],
          files: FILES,
          platforms: {
            browser: { runtime: 'browser', conditions: ['svelte', 'module', 'production'] },
            ssr: { runtime: 'node', conditions: ['svelte', 'module', 'production'] },
            node: { runtime: 'node', unmarked: true },
            bun: { runtime: 'bun', unmarked: true },
          },
          shipped: 'bun',
          rendering: { client: 'browser', server: 'ssr' },
          apps: [
            {
              at: 'apps/web',
              roots: ['src'],
              internal: ['virtual:'],
              files: FILES,
              ssr: ['src/entry.server.ts'],
              server: [
                'src/hooks.ts',
                'src/hooks.ts.{ts,js}',
                'src/pages/**/+server.{ts,js}',
                'src/pages/**/+page.server.{ts,js}',
                'src/pages/**/+layout.server.{ts,js}',
              ],
              routes: {
                at: 'src/pages',
                pages: ['+page.svelte', '+page.ts', '+page.js', '+error.svelte', '+error.ts', '+error.js'],
                layouts: ['+layout.svelte', '+layout.ts', '+layout.js'],
                option: { export: 'ssr', off: [false], pages: ['+page.ts', '+page.js'], layouts: ['+layout.ts', '+layout.js'] },
              },
            },
            { at: 'apps/desk', roots: ['src'], internal: [], files: FILES, ssr: ['src/main.ts'] },
          ],
          compiled: ['@demo/native'],
          built: [{ output: 'apps/web/.svelte-kit/tsconfig.json', source: KIT, why: WHY }],
          internal: ['$app', '$env', '$service-worker'],
          workers: ['?worker', '?sharedworker', '?worker&inline'],
        });
        expect([decodes('modules', params[0]), decodes('loads', params[1]), decodes('platforms', params[2])]).toEqual([true, true, true]);
        yield* platformsDeclared(project);
        expect(yield* read()).toEqual(once);
      }),
    ),
  );

  it.effect('a platforms document whose old verdict the tree cannot carry over stays as stored, naming why, and does not decode', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const { db } = graph.graphStore;
        const cases = [
          {
            files: { 'apps/web/svelte.config.js': "import { defineConfig } from 'x';\nexport default defineConfig({ kit: {} });\n" },
            reason: 'SvelteKit configuration must use a static object',
          },
          {
            files: {
              ...WEB,
              'apps/web/svelte.config.js': "export default { kit: { files: { routes: 'src/pages' } } };\n",
              'apps/web/src/pages/+page.ts': 'export const ssr = false as const;\n',
            },
            reason: "apps/web/src/pages/+page.ts turns `ssr` off through a wrapped literal, which SvelteKit's old reading left on",
          },
          {
            files: {
              ...WEB,
              'apps/web/svelte.config.js': "export default { kit: { files: { routes: 'src/pages' } } };\n",
              'apps/web/tsconfig.json': '{}',
            },
            reason:
              "apps/web/src/pages/+page.svelte:2 imports `$lib/util`: SvelteKit's alias landed it on apps/web/src/lib/util.ts and the tsconfig on no alias",
          },
        ];
        for (const { files, reason } of cases) {
          const root = yield* tracked(files);
          const project = { ...(yield* graph.projects.byId(projectId)), rootPath: root };
          const rule = yield* graph.blocks.create({ projectId, parentId: demo.root, title: 'platforms' });
          const old = platforms([app('apps/web', ['$lib'], [])]);
          yield* db
            .update(block)
            .set({ fields: document('platforms', old) })
            .where(inArray(block.id, [rule.id]));
          yield* platformsDeclared(project);
          const [row] = yield* db
            .select()
            .from(block)
            .where(inArray(block.id, [rule.id]));
          const params = (row!.fields as ReturnType<typeof document>).enforcement.checks[0]!.params;
          expect(params).toEqual({ ...old, unmigrated: reason });
          expect(decodes('platforms', params)).toBe(false);
        }
      }),
    ),
  );
});
