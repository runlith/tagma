import { expect, test } from 'bun:test';
import programs from './programs';
import type { EnvironmentParams } from './environment/declaration';

const params: EnvironmentParams = {
  base: '',
  region: ['src/'],
  files: { extensions: ['.svelte', '.ts'], exclude: ['**/*.test.ts'] },
  globals: [
    { name: 'tagmaDesktop', instead: 'the desktop ports', allow: [{ path: 'src/runtime.ts', why: 'the composition fills them' }] },
    { name: 'localStorage', instead: 'Platform.storage', allow: [] },
    { name: 'location', instead: 'Router', allow: [] },
    { name: 'open', instead: 'ExternalLinks', allow: [] },
    { name: 'fetch', instead: 'Door', allow: [] },
    { name: 'matchMedia', instead: 'Host', allow: [] },
    { name: 'navigator.serviceWorker', instead: 'ServiceWorkers', allow: [] },
  ],
  imports: [{ specifier: '$app/navigation', instead: 'Router', allow: [] }],
};

const judge = async (files: Readonly<Record<string, string>>) => {
  const tree = { commit: 'tree', paths: Object.keys(files), whole: false, read: async (path: string) => files[path] ?? null, facts: null };
  return (await programs.environment({ params, tree, base: null })).tree.findings.map((one) => [
    one.fingerprint,
    one.line,
    one.sites?.map((site) => site.line) ?? [],
  ]);
};

test('a finding names what the file reads and the service it takes instead', async () => {
  const tree = {
    commit: 'tree',
    paths: ['src/store.ts'],
    whole: false,
    read: async () => "import { goto } from '$app/navigation';\nexport const bridge = window.tagmaDesktop;\n",
    facts: null,
  };
  expect((await programs.environment({ params, tree, base: null })).tree.findings.map(({ message, fix }) => ({ message, fix }))).toEqual([
    { message: 'imports `$app/navigation` directly', fix: 'Take Router instead of importing `$app/navigation`.' },
    {
      message: 'reads `tagmaDesktop` directly',
      fix: 'Take the desktop ports instead of reading `tagmaDesktop`; only `src/runtime.ts` may touch it directly.',
    },
  ]);
});

test('a free read of a watched global or import refuses once per file and name, wherever the file reads it', async () => {
  expect(
    await judge({
      'src/Panel.svelte': [
        '<script module lang="ts">',
        "  import { goto } from '$app/navigation';",
        '  export const here = () => location.href;',
        '</script>',
        '<script lang="ts">',
        "  const saved = localStorage.getItem('k');",
        "  const location = { href: '/' };",
        '  const own = location.href;',
        "  const worker = 'serviceWorker' in navigator;",
        '  const items: string[] = [];',
        '</script>',
        '',
        "<button onclick={() => window.open('/a')}>{saved}</button>",
        '{#each items as open}{open}{/each}',
        '{#snippet row(fetch: () => void)}{fetch()}{/snippet}',
        '<button onclick={() => navigator.clipboard.writeText(own)}>{worker}</button>',
      ].join('\n'),
      'src/store.ts': [
        "import type { Navigation } from '$app/navigation';",
        'export const touch = typeof matchMedia === "function";',
        "export const first = globalThis.localStorage?.getItem('a');",
        'export const read = (fetch: () => void) => fetch();',
        "export const second = window['localStorage'].getItem('b');",
        'export const bridge = window.tagmaDesktop;',
        'const { serviceWorker } = navigator;',
      ].join('\n'),
      'src/runtime.ts': 'export const desktop = window.tagmaDesktop;\n',
    }),
  ).toEqual([
    ['src/Panel.svelte import $app/navigation', 2, []],
    ['src/Panel.svelte location', 3, []],
    ['src/Panel.svelte localStorage', 6, []],
    ['src/Panel.svelte navigator.serviceWorker', 9, []],
    ['src/Panel.svelte open', 13, []],
    ['src/store.ts matchMedia', 2, []],
    ['src/store.ts localStorage', 3, [3, 5]],
    ['src/store.ts tagmaDesktop', 6, []],
    ['src/store.ts navigator.serviceWorker', 7, []],
  ]);
});
