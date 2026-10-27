import type { Builtin } from '@runlith/tagma/rules';
import type { BUILTINS } from '@tagma/inspection/builtins';

type NamesParams = (typeof BUILTINS)['names']['params']['Encoded'];

type PlatformsParams = (typeof BUILTINS)['platforms']['params']['Encoded'];

const JS_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.svelte'];

const SOURCES = {
  exclude: ['**/*.test.*', '**/*.itest.*', '**/*.stest.*', '**/*.spec.*', '**/*.bench.*', '**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
  extensions: JS_EXTENSIONS,
};

const SERVER = [
  'src/hooks.server',
  'src/hooks.server.{ts,js}',
  'src/routes/**/+server.{ts,js}',
  'src/routes/**/+page.server.{ts,js}',
  'src/routes/**/+layout.server.{ts,js}',
];

export const names: Builtin<'names', NamesParams> = {
  builtin: 'names',
  params: {
    base: '',
    checks: {
      F4: {
        allowances: [
          {
            lines: 662,
            path: 'apps/tagma/server/src/managed-browser/host.ts',
            why: 'One subject: the managed Chromium Host adapter owns each profile process and its CDP pipe, target sessions, browser events and shutdown; these operations share the same running profiles and tabs, whose lifetime determines whether pages close or become dormant.',
          },
          {
            lines: 673,
            path: 'apps/tagma/server/src/change-record/holdings/inputs.ts',
            why: 'One subject: what the Holdings judge reads about a path before folding it — the probe of its record rows, head, working bytes and git letters, and the preparation of the contents, version texts and hunks those rows fold over; both halves share the same probe and prepared shapes.',
          },
          {
            lines: 736,
            path: 'apps/tagma/server/src/enforcement/remeasure/driver.ts',
            why: 'One subject: the remeasurement lifecycle of an open checkout — Start waiters, rule-slot scheduling with its per-request answers, pauses, debt and origin-tracing lanes, HEAD observation and cancellation share the same copy and confirmed measurement boundary.',
          },
          {
            lines: 698,
            path: 'apps/tagma/server/src/enforcement/judging/judge.ts',
            why: 'One subject: enforcement judgement of a tree or HEAD, including selection, inspection outcomes, gate decisions and their recovery contract in the graph context that owns the law.',
          },
          {
            lines: 742,
            path: 'packages/agent/src/agent/door/ToolExecution.ts',
            why: "One subject: a tool call's life at the door from admission through permission, order and execution to its answer, foreground or carried to the background at any of those stages; every stage shares the same tracked call, its order claim and its ledger.",
          },
          {
            lines: 674,
            path: 'apps/tagma/server/src/threads/contract/wire/operations/catalog.ts',
            why: 'One subject: the declarations of the thread operations — their doors, callers, answers, refusals and the words agents read for each.',
          },
          {
            lines: 725,
            path: 'apps/tagma/server/src/composition/testing/threads/protocolRig.ts',
            why: 'One subject: the ACP conformance rig owns its project, execution host — including replacing it with its next generation — core harness, account and scratch context, its protocol rows and vendor turn map, and each scoped driver. Thread and scripted-agent events wake observations within those same lifetimes.',
          },
          {
            lines: 719,
            path: 'apps/tagma/server/src/external-harnesses/testing/acpAgent.ts',
            why: 'One subject: the scripted ACP agent the protocol system tests run as a process; its configuration, keywords and control files drive that one agent over the same prompt, steer and cancel state.',
          },
          {
            lines: 660,
            path: 'packages/agent/src/thread/run/lifecycle/RunReports.ts',
            why: "One subject: the reports a transport adapter makes about a run (the contract type and the one layer applying each as a plan in the adapter's write); every report shares the same run, tail and ending state.",
          },
          {
            lines: 693,
            path: 'packages/navigation-ts/src/engine/workspace.ts',
            why: 'One subject: the snapshots one engine serves to its base and worktrees — which revision each checkout reads, how a change, a moved HEAD or a rescan renews them once a question asks, and which questions warm the next; every step shares the same trees, revisions and serialized TypeScript session.',
          },
          {
            lines: 651,
            path: 'packages/code-facts/src/languages/js/declarations.ts',
            why: 'One subject: what one parse of a JavaScript or TypeScript module says about its top level — the declarations it exports and keeps, the names it imports, the tag literals and published types its body holds, and the outline digest; every reading walks the same program and script offsets.',
          },
          {
            lines: 655,
            path: 'packages/execution-host/src/ExecutionInput.ts',
            why: 'One subject: the input queue of one execution — admission per lane with its sequences and receipts, backpressure, the writer that drains it into the sink, interrupt flushing and the carry a departing logic hands on; every act reads and moves the same lane book and pending bytes.',
          },
        ],
        lines: 650,
      },
    },
    errors: ['Data.TaggedError'],
    files: {
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.itest.*',
        '**/*.stest.*',
        '**/*.spec.*',
        '**/*.bench.*',
        '**/*.generated.*',
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.svelte-kit/**',
        'apps/audio-transcription-playground/**',
        'apps/workflow-studio/**',
        'checks/**',
        'scripts/**',
        'test/**',
        'target/**',
        'apps/tagma/server/scripts/**',
        'apps/tagma/server/drizzle/**',
        'apps/tagma/server/drizzle.config.ts',
        'packages/audio-capture-browser/**',
        'packages/audio-capture-core/**',
        'packages/audio-capture-darwin/**',
        'packages/audio-capture-node/**',
        'packages/audio-playback-browser/**',
        'packages/audio-vad/**',
        'packages/transcription/**',
        'packages/transcription-deepgram/**',
        'packages/transcription-openai/**',
        'packages/transcription-soniox/**',
        'packages/transcription-whisper/**',
        'packages/tts/**',
        'packages/tts-cartesia/**',
        'packages/tts-elevenlabs/**',
        'packages/tts-soniox/**',
        'packages/ui-primitives/**',
        'packages/desktop-input/**',
      ],
      extensions: ['.ts', '.tsx', '.svelte'],
    },
    glossary: [],
    modules: [],
    services: ['Context.Service'],
    uncovered: [],
  },
};

export const platforms: Builtin<'platforms', PlatformsParams> = {
  builtin: 'platforms',
  params: {
    allows: {},
    apps: [
      {
        at: 'apps/tagma/app',
        files: SOURCES,
        internal: ['virtual:'],
        roots: ['src'],
        routes: {
          at: 'src/routes',
          layouts: ['+layout.svelte', '+layout.ts', '+layout.js'],
          option: {
            export: 'ssr',
            layouts: ['+layout.ts', '+layout.js'],
            off: [false],
            pages: ['+page.ts', '+page.js'],
          },
          pages: ['+page.svelte', '+page.ts', '+page.js', '+error.svelte', '+error.ts', '+error.js'],
        },
        server: SERVER,
      },
    ],
    base: '',
    built: [
      {
        output: 'apps/tagma/app/.svelte-kit/tsconfig.json',
        source: 'apps/tagma/app/kit.tsconfig.json',
        why: "the app's tsconfig extends the config svelte-kit sync generates under .svelte-kit/, which git ignores; this tracked copy stands for it",
      },
    ],
    compiled: ['@runlith/window-behavior', '@runlith/desktop-input', '@runlith/audio-capture-darwin'],
    files: SOURCES,
    internal: ['$app', '$env', '$service-worker'],
    leaves: ['.css', '.json', '.svg', '.wasm', '?url', '?raw', '?inline'],
    loaders: [
      {
        at: 'packages/window-behavior/src/native/no-focus-steal.ts',
        why: 'loads the generated macOS addon from native/build, outside the tracked JavaScript tree',
      },
      {
        at: 'packages/tagma/src/adapter/loader.ts',
        why: 'imports adapters installed outside the tree at runtime; no start of the tree reaches them',
      },
    ],
    packages: {
      '@lode/inspection': { names: ['bun:sqlite', 'node:child_process'] },
      '@runlith/agent': {
        loads: {
          any: [
            'ai',
            '@ai-sdk',
            'zod',
            'bun:sqlite',
            'pg',
            'fs',
            'node:fs',
            'child_process',
            'node:child_process',
            '@modelcontextprotocol/sdk',
          ],
        },
        names: [
          'ai',
          '@ai-sdk',
          'zod',
          'bun:sqlite',
          'pg',
          'fs',
          'node:fs',
          'child_process',
          'node:child_process',
          '@modelcontextprotocol/sdk',
        ],
      },
      '@runlith/agent-sources': {
        loads: { any: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'] },
        names: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg', 'drizzle-orm'],
      },
      '@runlith/agent-tools': {
        loads: { any: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'] },
        names: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg', '@modelcontextprotocol/sdk'],
      },
      '@runlith/chat-ui': { names: ['ai', '@ai-sdk', 'bun:sqlite', 'pg'] },
      '@runlith/execution-host': {
        loads: { any: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'] },
        names: ['ai', '@ai-sdk', 'zod', 'bun:sqlite'],
      },
      '@runlith/executions': {
        loads: {
          any: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'],
          browser: ['@effect/platform-bun', 'drizzle-orm'],
        },
        names: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'bun:ffi'],
      },
      '@runlith/git': { names: ['drizzle-orm', 'bun:sqlite'] },
      '@runlith/github': {
        loads: { browser: ['@effect/platform-bun', 'effect/unstable/process'] },
        names: ['drizzle-orm', 'bun:sqlite'],
      },
      '@runlith/i18n': { names: ['effect', 'ai', '@ai-sdk', 'bun:sqlite'] },
      '@runlith/layer': { names: ['effect', 'ai', '@ai-sdk', 'bun:sqlite'] },
      '@runlith/llm': {
        loads: {
          any: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'],
          browser: ['effect/unstable/http'],
        },
        names: ['ai', '@ai-sdk', 'zod', 'bun:sqlite', 'pg'],
      },
      '@runlith/mcp': {
        loads: { browser: ['@modelcontextprotocol/sdk'] },
        names: ['express', 'hono'],
      },
      '@runlith/primitives': { names: ['effect', 'ai', '@ai-sdk', 'bun:sqlite'] },
      '@runlith/query': { names: ['effect', 'ai', '@ai-sdk', 'bun:sqlite'] },
      '@runlith/seam': { names: ['effect'] },
      '@runlith/source-comments': { names: ['effect', 'typescript'] },
    },
    platforms: {
      browser: { conditions: ['svelte', 'module', 'production'], runtime: 'browser' },
      bun: { runtime: 'bun', unmarked: true },
      node: { runtime: 'node', unmarked: true },
      ssr: { conditions: ['svelte', 'module', 'production'], runtime: 'node' },
    },
    programs: [
      { at: 'apps/tagma/desktop/src/main.ts', platform: 'node', replaces: 'apps/tagma/desktop/dist/app/main.mjs' },
      { at: 'apps/tagma/desktop/src/preload.ts', platform: 'node' },
      { at: 'apps/tagma/server/src/composition/server.ts', platform: 'bun' },
      { at: 'apps/tagma/server/src/enforcement/workers/judge.worker.ts', platform: 'bun' },
      { at: 'apps/tagma/server/src/enforcement/workers/reach.worker.ts', platform: 'bun' },
      { at: 'apps/tagma/server/src/platform/durable/flush.worker.ts', platform: 'bun' },
      { at: 'packages/sqlite-process/src/child.ts', platform: 'bun' },
      { at: 'packages/performance/src/store/worker.ts', platform: 'bun' },
      { at: 'packages/execution-host/src/recovery.ts', platform: 'bun' },
    ],
    refuses: {
      browser: [
        '@effect/platform-bun',
        '@effect/platform-node',
        'effect/unstable/process',
        'drizzle-orm',
        '@effect/sql-sqlite-bun',
        'pg',
        'sharp',
        'aws4fetch',
        '@smithy',
        'oxc-parser',
        'typescript',
        '@modelcontextprotocol/sdk',
        'ai',
        '@ai-sdk',
      ],
    },
    rendering: { client: 'browser', server: 'ssr' },
    shipped: 'bun',
    workers: ['?worker', '?sharedworker'],
  },
};
