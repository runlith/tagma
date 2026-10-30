import { afterAll, beforeEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { builtinHarness, shippedHarnessAdaptersLayer } from '../testing/builtin.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { McpSurface } from '@runlith/tagma/adapter/harness';
import { MCP_KEY_VARIABLE } from '../../platform/contract/wire/session.js';
import { declareInto as declareWith, mcpDeclarations, MCP_SERVER_NAME } from './mcpDeclaration.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { declaredForLaunch } from './upgrade.js';

const CLI = ['/opt/tagma/install/current/bun', '/opt/tagma/install/current/bin/cli/main.js'] as const;
const declareInto = (repoRoot: string, adapter: HarnessAdapter, surface: McpSurface, home?: string) =>
  declareWith(repoRoot, adapter, surface, CLI, home);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-mcp-declaration-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let repo: string;
let made = 0;
beforeEach(() => {
  repo = join(root, `repo-${(made += 1)}`);
  mkdirSync(repo, { recursive: true });
});

const claudeCode: HarnessAdapter = builtinHarness('claude-code');
const codex: HarnessAdapter = builtinHarness('codex');
const jsonSurface = claudeCode.mcp as McpSurface;
const tomlSurface: McpSurface = {
  file: { _tag: 'Project', path: '.grok/config.toml' },
  format: 'toml',
  servers: 'mcp_servers',
  fields: { enabled: true },
};

const at = (relative: string) => join(repo, ...relative.split('/'));
const plant = (relative: string, text: string) => {
  mkdirSync(dirname(at(relative)), { recursive: true });
  writeFileSync(at(relative), text);
};
const text = (relative: string) => readFileSync(at(relative), 'utf8');

test('a CLI with no configuration of its own gets one, carrying a key to sign with', async () => {
  const written = await declareInto(repo, claudeCode, jsonSurface);
  expect(written.write).toBe('created');
  const document = JSON.parse(text('.mcp.json')) as Record<string, Record<string, Record<string, unknown>>>;
  const declared = document.mcpServers?.[MCP_SERVER_NAME] as Record<string, unknown>;
  expect(declared.args).toContain('mcp-serve');
  expect(declared.args).toContain('claude-code');
  expect((declared.env as Record<string, string>)[MCP_KEY_VARIABLE]).toMatch(/\S/);
  expect(declared.type).toBe('stdio');
});

test('a second run writes nothing at all, and the key it signs with does not move', async () => {
  expect((await declareInto(repo, claudeCode, jsonSurface)).write).toBe('created');
  const first = text('.mcp.json');
  const again = await declareInto(repo, claudeCode, jsonSurface);
  expect(again.write).toBe('current');
  expect(text('.mcp.json')).toBe(first);
});

test('a nested vendor declaration keeps its signing key and neighbouring settings across upgrades', async () => {
  const adapter = builtinHarness('opencode');
  const surface = adapter.mcp!;
  const home = at('.opencode');
  plant(
    '.opencode/opencode.json',
    '{\n  "theme": "dark",\n  "mcp": { "timeout": 7, "servers": { "other": { "type": "remote", "url": "https://example.invalid/mcp" } } }\n}\n',
  );
  expect((await declareInto(repo, adapter, surface, home)).write).toBe('updated');
  const first = JSON.parse(text('.opencode/opencode.json'));
  const key = first.mcp.servers.tagma.environment[MCP_KEY_VARIABLE];
  expect(key).toMatch(/\S/);
  expect(first.mcp.servers.tagma.command).toEqual([...CLI, 'mcp-serve', '--harness', 'opencode']);
  expect((await declareInto(repo, adapter, surface, home)).write).toBe('current');
  const upgrade = await declareWith(repo, adapter, surface, ['/new/tagma'], home);
  expect(upgrade.write).toBe('updated');
  const after = JSON.parse(text('.opencode/opencode.json'));
  expect(after.mcp.servers.tagma.environment[MCP_KEY_VARIABLE]).toBe(key);
  expect(after.mcp.servers.tagma.command).toEqual(['/new/tagma', 'mcp-serve', '--harness', 'opencode']);
  expect({ theme: after.theme, timeout: after.mcp.timeout, other: after.mcp.servers.other }).toEqual({
    theme: 'dark',
    timeout: 7,
    other: { type: 'remote', url: 'https://example.invalid/mcp' },
  });
});

test('everything the document already held is still there, and nothing of ours reaches it', async () => {
  plant(
    '.mcp.json',
    `${JSON.stringify(
      {
        $schema: 'https://example.invalid/mcp.json',
        mcpServers: { sentry: { type: 'http', url: 'https://mcp.example.invalid/mcp' } },
      },
      null,
      2,
    )}\n`,
  );
  expect((await declareInto(repo, claudeCode, jsonSurface)).write).toBe('updated');
  const document = JSON.parse(text('.mcp.json')) as Record<string, unknown>;
  expect(document.$schema).toBe('https://example.invalid/mcp.json');
  const servers = document.mcpServers as Record<string, Record<string, unknown>>;
  expect(servers.sentry).toEqual({ type: 'http', url: 'https://mcp.example.invalid/mcp' });
  expect(servers[MCP_SERVER_NAME]).toBeDefined();
});

test('a TOML document keeps its comments, its other tables and its own formatting', async () => {
  plant(
    '.grok/config.toml',
    [
      '# The operator wrote this line and it is not ours to lose.',
      'model = "grok-4"',
      '',
      '[mcp_servers.sentry]',
      'url = "https://mcp.example.invalid/mcp"',
      '',
    ].join('\n'),
  );
  expect((await declareInto(repo, { ...claudeCode, harness: 'grok' } as HarnessAdapter, tomlSurface)).write).toBe('updated');
  const after = text('.grok/config.toml');
  expect(after).toContain('# The operator wrote this line and it is not ours to lose.');
  expect(after).toContain('model = "grok-4"');
  expect(after).toContain('[mcp_servers.sentry]');
  const parsed = Bun.TOML.parse(after) as Record<string, Record<string, Record<string, unknown>>>;
  expect(parsed.mcp_servers?.sentry?.url).toBe('https://mcp.example.invalid/mcp');
  expect(parsed.mcp_servers?.[MCP_SERVER_NAME]?.enabled).toBe(true);
  const settled = text('.grok/config.toml');
  expect((await declareInto(repo, { ...claudeCode, harness: 'grok' } as HarnessAdapter, tomlSurface)).write).toBe('current');
  expect(text('.grok/config.toml')).toBe(settled);
});

test('a TOML table of ours is replaced where it stands, never appended beside itself', async () => {
  const grok = { ...claudeCode, harness: 'grok' } as HarnessAdapter;
  expect((await declareInto(repo, grok, tomlSurface)).write).toBe('created');
  plant(
    '.grok/config.toml',
    `${text('.grok/config.toml').replace(/args = \[[^\]]*\]/, 'args = ["mcp-serve", "--harness", "grok"]')}\n[after.ours]\nkept = true\n`,
  );
  expect((await declareInto(repo, grok, tomlSurface)).write).toBe('updated');
  const after = text('.grok/config.toml');
  expect(after.match(/\[mcp_servers\.tagma\]/g)).toHaveLength(1);
  expect((Bun.TOML.parse(after) as Record<string, Record<string, unknown>>).after?.ours).toEqual({ kept: true });
});

test('a TOML document whose lines lie about where a table begins is not damaged', async () => {
  const grok = { ...claudeCode, harness: 'grok' } as HarnessAdapter;
  const documents: readonly (readonly [string, string, 'lands' | 'refused'])[] = [
    [
      'a multi-line string holding what looks like a header',
      ['prompt = """', '[mcp_servers.tagma]', 'not a table at all', '"""', '', '[keep.me]', 'kept = 1', ''].join('\n'),
      'refused',
    ],
    ['an array of tables', ['[[profiles]]', 'name = "one"', '', '[[profiles]]', 'name = "two"', ''].join('\n'), 'lands'],
    [
      'our own entry written as dotted keys rather than a table',
      ['mcp_servers.tagma.command = "/somewhere/else"', 'mcp_servers.tagma.args = ["mcp-serve"]', '', '[keep.me]', 'kept = 1', ''].join(
        '\n',
      ),
      'refused',
    ],
    ['carriage returns', ['[keep.me]\r', 'kept = 1\r', ''].join('\n'), 'lands'],
  ];
  for (const [what, planted, expected] of documents) {
    const where = `.grok/${what.replace(/\W+/g, '-')}.toml`;
    plant(where, planted);
    const before = Bun.TOML.parse(planted) as Record<string, unknown>;
    const written = await declareInto(repo, grok, { ...tomlSurface, file: { _tag: 'Project', path: where } });
    const after = text(where);
    expect(written.write === 'refused' ? 'refused' : 'lands', what).toBe(expected);
    if (written.write === 'refused') {
      expect(after, what).toBe(planted);
      expect(written.detail, what).toMatch(/\S/);
      continue;
    }
    const parsed = Bun.TOML.parse(after) as Record<string, Record<string, unknown>>;
    expect(parsed.mcp_servers?.[MCP_SERVER_NAME], what).toBeDefined();
    for (const [name, held] of Object.entries(before)) {
      if (name === 'mcp_servers') continue;
      expect(parsed[name], `${what}: ${name}`).toEqual(held as Record<string, unknown>);
    }
  }
});

test('a TOML region gives back the blank line and the comment that introduce the next table', async () => {
  const grok = { ...claudeCode, harness: 'grok' } as HarnessAdapter;
  const planted = [
    'model = "grok-4"',
    '',
    '[mcp_servers.tagma]',
    'command = "/an/older/bun"',
    'args = ["mcp-serve", "--harness", "grok"]',
    '',
    '# The operator wrote this about the section below it.',
    '[other]',
    'x = 1',
    '',
  ].join('\n');
  plant('.grok/config.toml', planted);
  expect((await declareInto(repo, grok, tomlSurface)).write).toBe('updated');
  const after = text('.grok/config.toml').split('\n');
  const other = after.indexOf('[other]');
  expect(other).toBeGreaterThan(0);
  expect(after[other - 1]).toBe('# The operator wrote this about the section below it.');
  expect(after[other - 2]).toBe('');
  expect((Bun.TOML.parse(after.join('\n')) as Record<string, unknown>).other).toEqual({ x: 1 });
});

test('a configuration kept private stays private', async () => {
  plant('.grok/config.toml', 'model = "grok-4"\n');
  chmodSync(at('.grok/config.toml'), 0o600);
  expect((await declareInto(repo, { ...claudeCode, harness: 'grok' } as HarnessAdapter, tomlSurface)).write).toBe('updated');
  expect(statSync(at('.grok/config.toml')).mode & 0o777).toBe(0o600);
});

test('a JSON document keeps its comments, its formatting and the order it was written in', async () => {
  const planted = [
    '{',
    '    // The operator keeps a note at the top of this file.',
    '    "$schema": "https://example.invalid/mcp.json",',
    '    "mcpServers": {',
    '        // and another about the server below',
    '        "sentry": { "type": "http", "url": "https://mcp.example.invalid/mcp" }',
    '    }',
    '}',
    '',
  ].join('\n');
  plant('.mcp.json', planted);
  expect((await declareInto(repo, claudeCode, jsonSurface)).write).toBe('updated');
  const after = text('.mcp.json');
  expect(after).toContain('// The operator keeps a note at the top of this file.');
  expect(after).toContain('// and another about the server below');
  expect(after.startsWith(planted.slice(0, planted.indexOf('        "sentry"')))).toBe(true);
  expect(after).toContain('\n        "tagma": {\n            "command"');
  const document = Bun.JSONC.parse(after) as Record<string, Record<string, unknown>>;
  expect(document.mcpServers?.sentry).toEqual({ type: 'http', url: 'https://mcp.example.invalid/mcp' });
  expect(document.mcpServers?.[MCP_SERVER_NAME]).toBeDefined();
});

test('a JSON document whose braces are not where a scan would look for them is not damaged', async () => {
  const documents: readonly (readonly [string, string, 'lands' | 'refused'])[] = [
    [
      'braces and escaped quotes inside a string',
      '{\n  "mcpServers": {\n    "sentry": { "url": "https://x.invalid/{\\"a\\":1}/}" }\n  }\n}\n',
      'lands',
    ],
    ['a block comment holding a brace', '{\n  /* } not a brace at all { */\n  "mcpServers": {}\n}\n', 'lands'],
    ['no server map at all', '{\n  "theme": "dark"\n}\n', 'lands'],
    ['the whole document on one line', '{"theme":"dark","mcpServers":{"sentry":{"url":"https://x.invalid"}}}', 'lands'],
    ['a trailing comma after the last server', '{\n  "mcpServers": {\n    "sentry": { "url": "https://x.invalid" },\n  }\n}\n', 'lands'],
    ['an empty document holding only braces', '{}', 'lands'],
    ['a server map that is a list rather than a table', '{\n  "mcpServers": ["sentry"]\n}\n', 'refused'],
  ];
  for (const [what, planted, expected] of documents) {
    const where = `.${what.replace(/\W+/g, '-')}.json`;
    plant(where, planted);
    const before = Bun.JSONC.parse(planted) as Record<string, unknown>;
    const written = await declareInto(repo, claudeCode, { ...jsonSurface, file: { _tag: 'Project', path: where } });
    const after = text(where);
    expect(written.write === 'refused' ? 'refused' : 'lands', what).toBe(expected);
    if (written.write === 'refused') {
      expect(after, what).toBe(planted);
      expect(written.detail, what).toMatch(/\S/);
      continue;
    }
    const parsed = Bun.JSONC.parse(after) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers?.[MCP_SERVER_NAME], what).toBeDefined();
    for (const [name, held] of Object.entries(before)) {
      if (name === 'mcpServers') continue;
      expect(parsed[name], `${what}: ${name}`).toEqual(held as Record<string, unknown>);
    }
    const servers = (before.mcpServers ?? {}) as Record<string, unknown>;
    for (const [name, held] of Object.entries(servers)) {
      expect(parsed.mcpServers?.[name], `${what}: mcpServers.${name}`).toEqual(held as Record<string, unknown>);
    }
    expect((await declareInto(repo, claudeCode, { ...jsonSurface, file: { _tag: 'Project', path: where } })).write, what).toBe('current');
    expect(text(where), what).toBe(after);
  }
});

it.live('startup installs declaration files without approval; a chosen harness launch takes approval and reports its refusal', () =>
  Effect.gen(function* () {
    const home = join(repo, 'home');
    const bin = join(home, 'bin');
    const log = join(home, 'approval.log');
    const denied = join(home, 'denied');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(repo, '.agents', 'skills', 'tagma'), { recursive: true });
    const program = join(bin, 'cursor-agent');
    writeFileSync(
      program,
      `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> '${log}'\nif [ -e '${denied}' ]; then echo 'fixture denied' >&2; exit 4; fi\n`,
      { mode: 0o755 },
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const held = { PATH: process.env.PATH, HOME: process.env.HOME, OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR };
        process.env.PATH = bin;
        process.env.HOME = home;
        process.env.OPENCODE_CONFIG_DIR = join(home, '.config', 'opencode');
        return held;
      }),
      (held) =>
        Effect.sync(() => {
          process.env.PATH = held.PATH;
          process.env.HOME = held.HOME;
          if (held.OPENCODE_CONFIG_DIR === undefined) delete process.env.OPENCODE_CONFIG_DIR;
          else process.env.OPENCODE_CONFIG_DIR = held.OPENCODE_CONFIG_DIR;
        }),
    );
    const declare = yield* mcpDeclarations(CLI);
    const installed = yield* Effect.promise(() => declare(repo));
    expect(installed.find((row) => row.harness === 'cursor')).toMatchObject({ write: 'created' });
    expect(existsSync(log)).toBe(false);
    const before = text('.cursor/mcp.json');
    expect(yield* declaredForLaunch('cursor', false, repo, CLI, {})).toMatchObject({ write: 'current', approved: 'taken' });
    expect(readFileSync(log, 'utf8')).toBe(`${repo}|mcp enable tagma\n`);
    writeFileSync(denied, 'deny');
    const refused = yield* declaredForLaunch('cursor', false, repo, CLI, {});
    expect(refused).toMatchObject({ write: 'current', approved: 'refused' });
    expect(refused?.detail).toContain('fixture denied');
    expect(text('.cursor/mcp.json')).toBe(before);
  }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, shippedHarnessAdaptersLayer))),
);

test('a document this installation cannot read is refused by name, and nothing is written', async () => {
  plant('.mcp.json', '{ this is not json');
  const refused = await declareInto(repo, claudeCode, jsonSurface);
  expect(refused.write).toBe('refused');
  expect(refused.detail).toContain('could not be read');
  expect(text('.mcp.json')).toBe('{ this is not json');
});

test('a server under our own name that Tagma did not write is never overwritten', async () => {
  const theirs = { command: '/usr/local/bin/their-own-tagma', args: ['serve'] };
  plant('.mcp.json', `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: theirs } }, null, 2)}\n`);
  const refused = await declareInto(repo, claudeCode, jsonSurface);
  expect(refused.write).toBe('refused');
  expect(refused.detail).toContain('not one Tagma wrote');
  expect((JSON.parse(text('.mcp.json')) as Record<string, Record<string, unknown>>).mcpServers?.[MCP_SERVER_NAME]).toEqual(theirs);
});

test('a configuration the operator keeps elsewhere stays where they put it', async () => {
  const elsewhere = join(root, `elsewhere-${made}.json`);
  writeFileSync(elsewhere, `${JSON.stringify({ mcpServers: { sentry: { url: 'https://example.invalid' } } }, null, 2)}\n`);
  mkdirSync(repo, { recursive: true });
  symlinkSync(elsewhere, at('.mcp.json'));
  expect((await declareInto(repo, claudeCode, jsonSurface)).write).toBe('updated');
  expect(lstatSync(at('.mcp.json')).isSymbolicLink()).toBe(true);
  const document = JSON.parse(readFileSync(elsewhere, 'utf8')) as Record<string, Record<string, unknown>>;
  expect(document.mcpServers?.[MCP_SERVER_NAME]).toBeDefined();
  expect(document.mcpServers?.sentry).toEqual({ url: 'https://example.invalid' });
});

test('a CLI that reads no project configuration is declared in the file it does read', async () => {
  const home = join(root, `codex-home-${made}`);
  const held = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const written = await declareInto(repo, codex, codex.mcp as McpSurface);
    expect(written.write).toBe('created');
    expect(written.path).toBe(join(home, 'config.toml'));
    const parsed = Bun.TOML.parse(readFileSync(written.path, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed.mcp_servers?.[MCP_SERVER_NAME]?.args).toContain('codex');
  } finally {
    if (held === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = held;
  }
});
