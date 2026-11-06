import { Code, defineConfig, Files, Format, Imports, Loading } from '@runlith/tagma/rules';
import { Effect } from '@runlith/tagma/rules/effect';
import { names, platforms, serverNames } from './checks/builtins';
import { ALLOWED } from './checks/failures';
import { effectStyle, environment, migrationBacks, migrations, stepPlaces, uiTokens } from './checks/law/inspections';
import type { EffectStyleParams } from './checks/law/effect-style/declaration';
import { vendorIds } from './checks/law/architecture/inspections';
import { dead, repeated } from './checks/law/declarations/declaration';
import { askCalls } from './checks/law/architecture/calls/params';
import { loadOs } from './checks/law/load-os';

const EFFECT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte'];
const SOURCE_TESTS = [
  ...Files.tests,
  '**/testing/**',
  '**/testing.*',
  '**/test-utils/**',
  '**/conformance/**',
  '**/conformance.*',
  '**/fixtures/**',
  '**/stand/**',
  '**/sample/**',
  '**/examples/**',
  '**/dist/**',
  '**/build/**',
];
const SOURCE_ALIASES = [{ prefix: '$lib/', dir: 'apps/tagma/app/src/lib/' }];

const EFFECT_FILES = { exclude: ['**/node_modules/**', '**/dist/**'], extensions: EFFECT_EXTENSIONS };

const EFFECT_TEST_FILES = {
  exclude: ['**/node_modules/**', '**/dist/**', 'packages/effect-test/**'],
  extensions: EFFECT_EXTENSIONS,
};

const styled = (forms: EffectStyleParams['forms'], files: EffectStyleParams['files'] = EFFECT_FILES) =>
  effectStyle({ base: '', files, forms, region: ['apps/tagma/server/src/', 'apps/tagma/app/', 'packages/'] });

const APP_WINDOW = 'apps/tagma/app/src/lib/app/window.ts';

const SERVICE_WORKER = 'apps/tagma/app/src/service-worker.ts';

const WIRE = { path: 'apps/tagma/app/src/lib/wire/', why: 'The server doors the rule names.' };

const HOST = { path: APP_WINDOW, why: 'The composition fills `Host`.' };

const WORKERS = { path: 'apps/tagma/app/src/lib/shared/workers/BrowserWorkers.ts', why: 'The browser filler of `ServiceWorkers`.' };

const ADMISSION = 'src/invocation/contract/service/admission.ts';

const SERVING = 'src/graph/contract/service/serving.ts';

const WRITERS = 'src/platform/contract/service/writers.ts';

export default defineConfig({
  inspections: {
    'ask-calls': askCalls(
      {
        region: ['apps/tagma/server/src/'],
        aliases: [],
        sources: [
          {
            path: 'apps/tagma/server/src/providers/contract/service/access.ts',
            name: 'ModelAccess',
            capability: 'access',
            form: 'service',
          },
          { path: 'packages/agent/src/agent/modelPort.ts', name: 'ModelRequester', capability: 'requester', form: 'type' },
          { path: 'packages/agent/src/agent/modelPort.ts', name: 'ModelRequest', capability: 'request', form: 'type' },
          { path: 'packages/agent/src/agent/modelPort.ts', name: 'ModelCompaction', capability: 'compaction', form: 'type' },
          {
            path: 'packages/agent/src/thread/compaction/CompactionModels.ts',
            name: 'CompactionModels',
            capability: 'requester',
            form: 'type',
          },
          {
            path: 'apps/tagma/server/src/threads/contract/service/asides.ts',
            name: 'HarnessAsides',
            capability: 'asides',
            form: 'service',
          },
          { path: 'packages/agent/src/thread/ThreadAsides.ts', name: 'ThreadAsides', capability: 'asides', form: 'type' },
          { path: 'packages/agent/src/agent/AgentAside.ts', name: 'AgentAside', capability: 'aside', form: 'type' },
          { path: 'apps/tagma/server/src/threads/contract/service/asks.ts', name: 'ThreadAsks', capability: 'asks', form: 'service' },
          {
            path: 'apps/tagma/server/src/external-harnesses/contract/service/adapters.ts',
            name: 'HarnessAdapters',
            capability: 'adapters',
            form: 'service',
          },
          {
            path: 'apps/tagma/server/src/external-harnesses/contract/service/adapter.ts',
            name: 'HarnessAdapter',
            capability: 'row',
            form: 'type',
          },
          {
            path: 'apps/tagma/server/src/external-harnesses/contract/service/adapter.ts',
            name: 'TerminalHarnessAdapter',
            capability: 'row',
            form: 'type',
          },
        ],
        rows: [],
        allow: {
          request: [
            'apps/tagma/server/src/providers',
            'apps/tagma/server/src/native-harness/kernel.ts',
            'apps/tagma/server/src/native-harness/assembly.ts',
            'apps/tagma/server/src/native-harness/turns/runWebs.ts',
          ],
          ask: ['apps/tagma/server/src/threads/asks.ts'],
          row: ['apps/tagma/server/src/external-harnesses', 'apps/tagma/server/src/threads/harness'],
        },
      },
      {
        files: [
          'apps/tagma/server/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
          'packages/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
          '**/package.json',
        ],
      },
    ),
    'repeated-declarations': repeated(
      {
        region: [''],
        tests: SOURCE_TESTS,
        scope: 'all',
        minMembers: 3,
        minUnion: 3,
        minLiterals: 3,
        ignoreNames: [],
        aliases: SOURCE_ALIASES,
      },
      { files: ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,svelte}', '**/package.json', '.tagma/**/*.md'] },
    ),
    'dead-code': dead(
      {
        region: ['apps/tagma/server/', 'apps/tagma/app/', 'packages/'],
        tests: SOURCE_TESTS,
        entries: [
          '**/{vite,vitest,drizzle,svelte}.config.*',
          'apps/tagma/app/src/routes/**/+*.{ts,js,svelte}',
          'apps/tagma/app/src/hooks.{client,server,universal}.{ts,js}',
          'apps/tagma/app/src/service-worker.ts',
          'apps/tagma/app/src/lib/features/plugin-views/ui.ts',
        ],
        kinds: ['function', 'class', 'const', 'type', 'interface', 'enum', 'namespace', 'default'],
        published: ['packages/tagma'],
        aliases: SOURCE_ALIASES,
      },
      { files: ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,svelte}', '**/package.json'] },
    ),
    'load-os': loadOs(
      {},
      {
        files: [
          'packages/executions/src/protocol/{wire,evidence}.ts',
          'packages/execution-host/src/{ProcessUsage,ProcessAccount,processTree,processSpending,UsageReader}.ts',
          'apps/tagma/server/src/executions/load/**/*.{ts,tsx}',
          'apps/tagma/app/src/lib/features/executions/load/**/*.{ts,svelte}',
          'apps/tagma/app/src/lib/app/chrome/Load*.{ts,svelte}',
        ],
      },
    ),
    'vendor-ids': vendorIds(
      {
        source: 'apps/tagma/server/src',
        include: ['translations/**', 'threads/{naming,recap,decisions}/**', 'native-harness/compaction/**', 'external-harnesses/**'],
        exclude: ['external-harnesses/steps/**', 'composition/adapters.ts', 'plugin-formats/**', 'editors/**'],
      },
      { files: ['apps/tagma/server/src/**/*.ts', 'packages/adapter-*/**/*.{ts,tsx,js,mjs,cjs}'] },
    ),
    'call-services': Effect.servicesOnlyIn({
      allow: ['src/invocation/'],
      base: 'apps/tagma/server',
      files: { exclude: [], extensions: ['.ts'] },
      region: ['src/'],
      tags: [
        { path: ADMISSION, symbol: 'CallRequest' },
        { path: ADMISSION, symbol: 'CurrentCaller' },
        { path: ADMISSION, symbol: 'CallWorld' },
        { path: ADMISSION, symbol: 'CallStanding' },
        { path: 'src/workspace/contract/service/places.ts', symbol: 'CallerWorkspace' },
        { path: 'src/projects/contract/service/caller.ts', symbol: 'CurrentProject' },
        { path: SERVING, symbol: 'GraphCall' },
        { path: SERVING, symbol: 'CallerAim' },
        { path: SERVING, symbol: 'CurrentGraph' },
        { path: SERVING, symbol: 'ServedTree' },
        { path: 'src/change-record/contract/service/scope.ts', symbol: 'ChangeScope' },
        { path: WRITERS, symbol: 'SignedSession' },
        { path: WRITERS, symbol: 'SignedCall' },
        { path: 'src/graph/serving/routing.ts', symbol: 'FreshenedGraphs' },
      ],
    }),
    'effect-style-373e29e4': styled(['scope-run-sync'], EFFECT_TEST_FILES),
    'effect-style-01ba3d55': styled(['schema-tagged-error', 'native-tagged-error']),
    'effect-style-d270a238': styled(['test-runner'], EFFECT_TEST_FILES),
    'effect-style-673f881b': styled(['clock-bypass']),
    'effect-style-bc8f1e15': styled(['throw-in-effect', 'sync-decode-in-effect']),
    'effect-style-df923180': styled(['gen-wrapper', 'pipe-after-fn']),
    'effect-style-8fcfef49': styled(['self-alias', 'self-binding', 'service-class']),
    environment: environment({
      base: '',
      files: {
        exclude: [
          '**/*.d.ts',
          '**/*.test.ts',
          '**/*.itest.ts',
          '**/*.e2e.ts',
          '**/*.stest.ts',
          '**/*.spec.ts',
          '**/*.bench.ts',
          '**/*.fixture.*',
          '**/testing/**',
          '**/testing.ts',
          '**/test-utils/**',
        ],
        extensions: ['.ts', '.svelte'],
      },
      globals: [
        {
          allow: [{ path: APP_WINDOW, why: 'The composition fills the desktop ports from the bridge.' }],
          instead: 'the desktop ports in `lib/shared/desktop` (`DesktopLayer`)',
          name: 'tagmaDesktop',
        },
        {
          allow: [
            WIRE,
            { path: SERVICE_WORKER, why: 'The worker runs without the graph.' },
            {
              path: 'apps/tagma/app/src/lib/features/views/reach.ts',
              why: "Probes whether the browser reaches a plugin view's own origin, not the server.",
            },
            {
              path: 'apps/tagma/app/src/lib/features/browser/pick/Picks.ts',
              why: 'Fetches a `data:` URL to decode a picture; no network.',
            },
            {
              path: 'apps/tagma/app/src/lib/features/browser/screencast/Cast.svelte.ts',
              why: 'Fetches a `data:` URL to decode a frame; no network.',
            },
          ],
          instead: '`Door` (`Platform.fetch` in a filler)',
          name: 'fetch',
        },
        { allow: [WIRE], instead: '`Live` or `SoundChannel` (`Platform.socket` in a filler)', name: 'WebSocket' },
        { allow: [WIRE], instead: '`Live`', name: 'EventSource' },
        { allow: [WIRE], instead: '`Door`', name: 'XMLHttpRequest' },
        { allow: [], instead: '`Platform.storage.local`', name: 'localStorage' },
        { allow: [], instead: '`Platform.storage.session`', name: 'sessionStorage' },
        { allow: [], instead: '`Platform.databases`', name: 'indexedDB' },
        { allow: [], instead: '`Platform.locks`', name: 'navigator.locks' },
        { allow: [], instead: '`Platform.cookies`', name: 'document.cookie' },
        { allow: [], instead: '`Router` or `ServerOrigin`', name: 'document.location' },
        { allow: [], instead: '`Router` or `ServerOrigin`', name: 'document.URL' },
        {
          allow: [{ path: SERVICE_WORKER, why: 'The worker owns its cache and runs without the graph.' }],
          instead: '`ServiceWorkers`',
          name: 'caches',
        },
        {
          allow: [
            { path: APP_WINDOW, why: "The composition fills `ServerOrigin` from the window's origin." },
            { path: SERVICE_WORKER, why: 'The worker runs without the graph.' },
          ],
          instead: '`Router` or `ServerOrigin`',
          name: 'location',
        },
        { allow: [], instead: '`ServerOrigin`', name: 'origin' },
        { allow: [], instead: '`Router`', name: 'history' },
        {
          allow: [{ path: APP_WINDOW, why: 'The composition fills `ExternalLinks`.' }],
          instead: '`ExternalLinks`',
          name: 'open',
        },
        { allow: [HOST], instead: '`Host` (`touch`, `installed`) or `Theme`', name: 'matchMedia' },
        { allow: [HOST], instead: '`Host.os`', name: 'navigator.platform' },
        { allow: [HOST], instead: '`Host` (`Platform.userAgent` in a filler)', name: 'navigator.userAgent' },
        { allow: [HOST], instead: '`Host.os`', name: 'navigator.userAgentData' },
        { allow: [HOST], instead: '`Host` (`os`, `touch`)', name: 'navigator.maxTouchPoints' },
        { allow: [HOST], instead: '`Host.installed`', name: 'navigator.standalone' },
        { allow: [], instead: '`Platform.languages`', name: 'navigator.language' },
        { allow: [], instead: '`Platform.languages`', name: 'navigator.languages' },
        { allow: [WORKERS], instead: '`ServiceWorkers`', name: 'navigator.serviceWorker' },
        {
          allow: [WORKERS, { path: SERVICE_WORKER, why: 'The worker sets the badge of a push it shows and runs without the graph.' }],
          instead: '`ServiceWorkers`',
          name: 'navigator.setAppBadge',
        },
        { allow: [WORKERS], instead: '`ServiceWorkers`', name: 'navigator.clearAppBadge' },
        { allow: [WORKERS], instead: '`ServiceWorkers`', name: 'PushManager' },
        { allow: [WORKERS], instead: '`ServiceWorkers`', name: 'Notification' },
      ],
      imports: [
        { allow: [], instead: '`Router`', specifier: '$app/navigation' },
        { allow: [], instead: '`Router`', specifier: '$app/stores' },
        {
          allow: [{ path: APP_WINDOW, why: 'The composition fills `ClientBuild` from `updated`.' }],
          instead: '`Router`, or `ClientBuild` for `updated`',
          specifier: '$app/state',
        },
      ],
      region: ['apps/tagma/app/src/', 'packages/chat-ui/src/'],
    }),
    'loads-925aed1c': Loading.forbid({
      base: 'packages/code-facts/src',
      files: { exclude: [...Files.tests], extensions: ['.ts'] },
      from: ['adapter.ts', 'blobs.ts', 'floors.ts', 'imports.ts', 'tree.ts', 'languages/index.ts'],
      refuses: ['oxc-parser'],
      runtimes: ['node', 'bun'],
    }),
    'loads-0d2c66a9': Loading.forbid({
      allows: [
        '@runlith/llm/models',
        '@runlith/llm/schema',
        '@runlith/agent/protocol',
        '@runlith/agent/paging',
        '@runlith/agent/ToolPage',
        '@runlith/agent/ToolOutputSpool',
        '@runlith/agent/tool',
        '@runlith/agent/permissions',
        '@runlith/agent/contracts',
        '@runlith/agent/callProgress',
        '@runlith/agent/transcript/entries',
        '@runlith/agent/thread/cache/ThreadCacheWarmth',
        '@runlith/agent/thread/persisted',
        '@runlith/agent/thread/storage/settlement',
        '@runlith/agent/collaboration/label',
        '@runlith/agent/collaboration/CollaborationConfig',
        '@runlith/agent-tools/world',
        '@runlith/agent-tools/WorkspaceChanges',
        '@runlith/mcp/declaration',
        '@effect/platform-bun/*',
        'effect/http-api/*',
      ],
      base: 'apps/tagma/server/src',
      conditions: ['bun', 'node', 'import'],
      files: { exclude: [...Files.tests, 'install/cut/**'], extensions: ['.ts', '.tsx', '.svelte'] },
      from: [
        { module: 'platform' },
        { module: 'projects' },
        { module: 'settings' },
        { module: 'thread-record' },
        { module: 'workspace' },
        { module: 'graph' },
        { module: 'change-record' },
        { module: 'power' },
        { module: 'worktrees' },
        'threads/doctrine/',
      ],
      reads: 'static',
      refuses: [
        '@runlith/llm',
        '@runlith/llm/profiles',
        '@runlith/llm/oauth',
        '@runlith/llm/capture',
        '@runlith/agent',
        '@runlith/agent/collaboration',
        '@runlith/agent-tools',
        '@runlith/mcp',
        '@bufbuild/protobuf',
        '@mixmark-io/domino',
        'turndown',
        'ajv',
        'zod',
        'sharp',
        '@modelcontextprotocol/sdk',
        '@effect/platform-bun',
        'effect/http-api',
      ],
      runtimes: ['node', 'bun'],
    }),
    migrations: migrations(
      { cut: '20261010214002_command_measurement', folder: 'apps/tagma/server/drizzle', source: 'apps/tagma/server/src' },
      { files: ['apps/tagma/server/src/**/*.ts', 'apps/tagma/server/drizzle/**'] },
    ),
    'migration-backs': migrationBacks(
      {
        cut: '20261105164552_delegation_switcher',
        folders: [
          'apps/tagma/server/drizzle',
          'packages/activity/drizzle',
          'packages/execution-host/drizzle',
          'packages/performance/drizzle',
        ],
      },
      {
        files: [
          'apps/tagma/server/drizzle/**',
          'packages/activity/drizzle/**',
          'packages/execution-host/drizzle/**',
          'packages/performance/drizzle/**',
        ],
      },
    ),
    modules: Imports.modules({
      built: [
        {
          output: 'packages/window-behavior/dist/contract/state.js',
          source: 'packages/window-behavior/src/contract/state.ts',
          why: 'window-behavior exports its tsc output under dist/, which git ignores; this source emits it',
        },
        {
          output: 'packages/window-behavior/dist/host-electron/ElectronWindowBehaviorHost.js',
          source: 'packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts',
          why: 'window-behavior exports its tsc output under dist/, which git ignores; this source emits it',
        },
        {
          output: 'packages/window-behavior/dist/host-electron/bootstrap.js',
          source: 'packages/window-behavior/src/host-electron/bootstrap.ts',
          why: 'window-behavior exports its tsc output under dist/, which git ignores; this source emits it',
        },
        {
          output: 'apps/tagma/app/.svelte-kit/tsconfig.json',
          source: 'apps/tagma/app/kit.tsconfig.json',
          why: "the app's tsconfig extends the config svelte-kit sync generates under .svelte-kit/, which git ignores; this tracked copy stands for it",
        },
      ],
      conditions: ['bun', 'node', 'import'],
      files: {
        exclude: ['**/*.d.ts', '**/examples/**'],
        extensions: ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.svelte'],
      },
      framework: ['$app/*', '$service-worker'],
      reads: 'every',
      runtimes: ['node', 'bun'],
      tests: ['.test', '.itest', '.e2e', '.stest', '.spec', '.bench', '.fixture'],
    }),
    names,
    'server-names': serverNames,
    platforms,
    reexports: Code.noReexports({
      allows: ['**/ui/*/index.ts', 'packages/primitives/src/dialog/index.ts', 'apps/tagma/app/src/lib/features/plugin-views/ui.ts'],
      files: {
        exclude: ['**/*.d.ts', '**/*.generated.*'],
        extensions: ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.svelte'],
      },
    }),
    'step-places': stepPlaces({ source: 'apps/tagma/server/src' }),
    'swallowed-failures': Effect.noSwallowedFailures({
      allow: ALLOWED,
      files: {
        exclude: [
          '**/*.d.ts',
          '**/*.test.*',
          '**/*.itest.*',
          '**/*.e2e.*',
          '**/*.stest.*',
          '**/*.spec.*',
          '**/*.bench.*',
          '**/*.fixture.*',
          '**/testing/**',
          '**/*Fixture.*',
        ],
        extensions: ['.ts', '.tsx', '.svelte'],
      },
      region: ['apps/tagma/server/src/', 'apps/tagma/app/', 'packages/'],
    }),
    'ui-tokens': uiTokens(
      {
        allow: {
          icon: ['3', '3.5', '4'],
          rounded: ['none', 'sm', 'md', 'lg', 'full'],
          shadow: ['none', 'raised', 'float'],
          spacing: ['0', '0.5', '1', '1.5', '2', '3', '4', '5', '6', '8', '10', '12', '16', 'px', 'auto', 'reverse'],
          stateBackgrounds: ['hover', 'selected', 'hover-danger'],
          text: ['badge', 'meta', 'small', 'ui', 'body', 'page', 'title'],
          textColors: [
            'chrome',
            'background',
            'field',
            'raised',
            'popover',
            'sunken',
            'foreground',
            'popover-foreground',
            'primary',
            'primary-foreground',
            'muted-foreground',
            'accent-foreground',
            'destructive',
            'border',
            'input',
            'ring',
            'vein',
            'vein-strong',
            'status-open',
            'status-none',
            'status-in-work',
            'status-verified',
            'status-stale',
            'status-done',
            'status-closed',
            'status-superseded',
            'mutation',
            'severity-lie',
            'severity-gap',
            'brand',
            'brand-soft',
            'chat-raised',
            'chat-field',
            'chat-live',
            'chat-live-mark',
            'chat-success',
            'chat-success-mark',
            'chat-success-label',
            'chat-failure',
            'chat-refused',
            'chat-mutation',
            'chat-diff-added',
            'chat-diff-removed',
            'chat-guidance',
            'chat-queued',
            'chat-queued-label',
            'chat-interrupted',
            'chat-interrupted-label',
            'scrim',
            'chat-scrim',
          ],
        },
        base: '',
        casing: [],
        files: {
          exclude: [
            '**/*.test.ts',
            '**/*.itest.ts',
            '**/*.e2e.ts',
            '**/*.stest.ts',
            '**/*.spec.ts',
            '**/*.bench.ts',
            '**/*.fixture.*',
            '**/*.d.ts',
          ],
          extensions: ['.svelte', '.ts', '.css'],
        },
        icons: ['@lucide/svelte'],
        literals: [
          { path: 'apps/tagma/app/src/app.css', why: 'Lode token file: the one place base lengths are defined.' },
          {
            path: 'apps/tagma/app/src/tokens.generated.css',
            why: 'Tagma’s own theme, generated from the appearance module: the one place its colours are written.',
          },
          { path: 'packages/chat-ui/src/theme.css', why: 'Package token contract: default colours other apps override.' },
          { path: 'apps/tagma/app/src/lib/shared/terminalThemes.ts', why: 'Terminal themes are colour data chosen by the user.' },
          {
            path: 'apps/tagma/app/src/lib/features/graph/markdown-body.css',
            why: 'Markdown body is typographic data: syntax palette and em-relative prose metrics.',
          },
          { path: 'apps/tagma/app/src/lib/shared/FileIcon.svelte', why: 'File-type icon colours are a data palette.' },
          { path: 'packages/chat-ui/src/entries/DiffMap.svelte', why: 'Canvas fallbacks: canvas cannot read CSS variables before mount.' },
          {
            path: 'apps/tagma/app/src/lib/features/executions/terminal/canvasInk.ts',
            why: 'xterm paints these colours on its canvas (search decorations, scrollbar), where CSS variables do not reach.',
          },
          { path: 'packages/chat-ui/src/draftImages.ts', why: 'Canvas fallback colours for rendering draft images.' },
        ],
        region: ['apps/tagma/app/src/', 'packages/chat-ui/src/', 'packages/primitives/src/'],
      },
      { files: ['**/*.svelte', '**/*.ts', '**/*.css'] },
    ),
  },
  format: {
    oxfmt: Format.command({
      run: ['node_modules/.bin/oxfmt', '--threads=3', '--no-error-on-unmatched-pattern'],
      files: ['*.{ts,tsx,js,mjs,cjs,json,css,svelte}'],
      reads: 'nearby',
    }),
  },
});
