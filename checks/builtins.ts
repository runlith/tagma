import type { Builtin } from '@runlith/tagma/rules';
import type { BUILTINS } from '@tagma/inspection/builtins';

type NamesParams = (typeof BUILTINS)['names']['params']['Encoded'];

type PlatformsParams = (typeof BUILTINS)['platforms']['params']['Encoded'];

const JS_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.svelte'];

const SOURCES = {
  exclude: [
    '**/*.test.*',
    '**/*.itest.*',
    '**/*.e2e.*',
    '**/*.stest.*',
    '**/*.spec.*',
    '**/*.bench.*',
    '**/*.fixture.*',
    '**/*.d.ts',
    '**/*.d.mts',
    '**/*.d.cts',
  ],
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
            lines: 728,
            path: 'apps/tagma/server/src/mcp/serverPool.ts',
            why: 'One subject: the project MCP pool lifecycle; declaration reconciliation, sign-in readers and the contributed sign-ins they keep, secret redaction, app calls and which pools stand open share its session ownership and scope.',
          },
          {
            lines: 736,
            path: 'apps/tagma/server/src/enforcement/remeasure/driver.ts',
            why: 'One subject: the remeasurement lifecycle of an open checkout — Start waiters, rule-slot scheduling with its per-request answers, pauses, debt and origin-tracing lanes, HEAD observation and cancellation share the same copy and confirmed measurement boundary.',
          },
          {
            lines: 817,
            path: 'packages/agent/src/agent/door/ToolExecution.ts',
            why: "One subject: a tool call's life at the door from admission through permission, order and execution to confirmed delivery, foreground or carried to the background at any stage; the stages and final release share the same tracked call, read-back, order claim, causal cost and ledger.",
          },
          {
            lines: 804,
            path: 'apps/tagma/server/src/composition/testing/threads/protocolRig.ts',
            why: 'One subject: the ACP conformance rig owns its project, execution host — including replacing it with its next generation — core harness, account and scratch context, its protocol rows and vendor turn map, and each scoped driver. Thread and scripted-agent events wake observations within those same lifetimes.',
          },
          {
            lines: 727,
            path: 'apps/tagma/server/src/external-harnesses/testing/acpAgent.ts',
            why: 'One subject: the scripted ACP agent the protocol system tests run as a process; its configuration, keywords and control files drive that one agent over the same prompt, steer and cancel state.',
          },
          {
            lines: 847,
            path: 'packages/chat-ui/stand/recorder.ts',
            why: 'One subject: a DOM recording lifecycle — trusted input, wheel and scroll timing and command evidence, own scroller writes and the movement they leave running, row measurements, anchor history and final ResizeObserver samples share the same pending capture and frame boundary.',
          },
          {
            lines: 752,
            path: 'packages/agent/src/thread/conformance/transport.ts',
            why: 'One subject: adapter report and lifecycle conformance over the shared storage contract; its durable reports, live tail and launch handover use the same harness unchanged over memory and SQLite.',
          },
          {
            lines: 704,
            path: 'packages/code-facts/src/languages/js/symbols.ts',
            why: "One subject: the JS/TS implementation of SymbolReader — reading a text's references, names and exports, and placing member spellings on checker types over handed texts, share the same spelling, receiver and script helpers.",
          },
        ],
        lines: 700,
      },
    },
    errors: ['Data.TaggedError'],
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

const CATALOG_TAGS: [string, ...string[]] = [
  'task',
  'spec',
  'rule',
  'idea',
  'module',
  'explanation',
  'feature',
  'reflection',
  'research',
  'view',
  'experiment',
];

export const serverNames: Builtin<'names', NamesParams> = {
  builtin: 'names',
  params: {
    base: 'apps/tagma/server/src',
    checks: {
      F1: { exempt: [] },
      F2: { exempt: [] },
      S4: { within: 'module', exempt: [] },
      S5: {
        heads: ['Data', 'Info', 'Helper', 'Manager', 'Service'],
        allows: [
          { head: 'Data', in: ['installation/contract/wire/layout.ts', 'plugins/sources.ts', 'tagma-apps/discovery.ts'] },
          { head: 'Helper', in: ['installation/contract/wire/layout.ts'] },
        ],
        exempt: [],
      },
      literals: [
        {
          region: ['graph/**'],
          words: CATALOG_TAGS,
          positions: ['compare', 'argument', 'property', 'lookup'],
          allowIn: ['graph/steps/**', 'graph/contract/wire/operations/shared.ts'],
        },
      ],
    },
    errors: ['Data.TaggedError'],
    files: {
      exclude: [...SOURCES.exclude, '**/testing/**', '**/testing.ts', '**/conformance/**'],
      extensions: ['.ts'],
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
      { at: 'apps/tagma/server/src/composition/developer/server.ts', platform: 'bun' },
      { at: 'apps/tagma/server/src/composition/release/server.ts', platform: 'bun' },
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
