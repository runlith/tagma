import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import type { McpFailure } from './McpFailure';
import type { McpStdioServerDeclaration } from './McpServerDeclaration';
import { openMcpSession } from './McpSession';
import { mcpAnswer } from './mcpToolCatalog';
import { mcpRedactor } from './mcpRedactor';

const SECRET = 'mcp-secret-probe-7f91';
const redact = mcpRedactor([SECRET]);
const SERVER = resolve(import.meta.dir, '../test/mcpTestServer.ts');

const failed = <A>(effect: Effect.Effect<A, McpFailure, never>) =>
  Effect.result(effect).pipe(Effect.map((result) => (result._tag === 'Failure' ? result.failure : undefined)));

const said = (failure: McpFailure | undefined) => `${failure?.message ?? ''} ${JSON.stringify(failure ?? {})}`;

describe('mcpRedactor', () => {
  test('replaces a resolved value wherever it stands, longest first', () => {
    const both = mcpRedactor(['token-abc', 'token-abc-long']);
    expect(both('use token-abc-long here')).toBe('use [redacted] here');
    expect(both('use token-abc here')).toBe('use [redacted] here');
    expect(mcpRedactor([])('nothing to hide')).toBe('nothing to hide');
    expect(mcpRedactor([''])('nothing to hide')).toBe('nothing to hide');
  });

  it.live(
    'takes a resolved value out of a spawn failure, where it was measured leaking',
    Effect.fnUntraced(function* () {
      const declaration: McpStdioServerDeclaration = {
        name: 'leaky',
        transport: 'stdio',
        command: `${SECRET}-missing`,
        capabilities: { kinds: ['read'], mutates: false },
        enabled: true,
        timeoutMs: 2_000,
      };
      const failure = yield* failed(Effect.scoped(openMcpSession(declaration, { redact })));
      expect(failure?._tag).toBe('McpConnectFailed');
      expect(said(failure)).not.toContain(SECRET);
      expect(said(failure)).toContain('[redacted]');
    }),
  );

  it.live(
    'takes it out of what a dying child wrote to stderr',
    Effect.fnUntraced(function* () {
      const pidFile = join(mkdtempSync(join(tmpdir(), 'mcp-redact-')), 'pid');
      const declaration: McpStdioServerDeclaration = {
        name: 'dying',
        transport: 'stdio',
        command: process.execPath,
        args: [SERVER, '--die', `auth failed for ${SECRET}`],
        env: { MCP_TEST_PID_FILE: pidFile },
        capabilities: { kinds: ['read'], mutates: false },
        enabled: true,
        timeoutMs: 2_000,
      };
      const failure = yield* failed(Effect.scoped(openMcpSession(declaration, { redact })));
      expect(failure?._tag).toBe('McpConnectFailed');
      expect(failure?._tag === 'McpConnectFailed' && failure.stderr).toContain('auth failed for');
      expect(said(failure)).not.toContain(SECRET);
    }),
  );

  test('takes it out of what a server answers, text and structure alike', () => {
    const spoken = mcpAnswer({ content: [{ type: 'text', text: `your key is ${SECRET}` }] }, redact);
    expect(spoken.text).toBe('your key is [redacted]');
    const structured = mcpAnswer({ content: [], structuredContent: { token: SECRET, nested: { again: SECRET } } }, redact);
    expect(JSON.stringify(structured)).not.toContain(SECRET);
    expect(structured.text).toContain('[redacted]');
    expect(JSON.stringify(mcpAnswer({ toolResult: { token: SECRET } }, redact))).not.toContain(SECRET);
    expect(mcpAnswer({ content: [{ type: 'text', text: SECRET }] }).text).toBe(SECRET);
  });
});
