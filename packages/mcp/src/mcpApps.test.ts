import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { MCP_APP_DOCUMENT_MAX_LENGTH, MCP_APP_MIME_TYPE, mcpAppDocument } from './mcpApps';
import type { McpResourceContent } from './mcpResources';
import { mcpAnswer, mcpViewResult } from './mcpToolCatalog';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';

const uri = 'ui://app/view';

const served = (content: McpResourceContent) => ({
  read: () => Effect.succeed({ contents: [content] }),
  directory: Effect.succeed(new Map()),
});

test('a tool result too large for the feed record reaches the view as its text, bounded, never empty', () => {
  const big = 'x'.repeat(TOOL_OUTPUT_MAX_BYTES * 2);
  const result = { content: [{ type: 'text' as const, text: big }], structuredContent: { rows: big } };
  const shown = mcpViewResult(result, mcpAnswer(result));
  expect(Buffer.byteLength(JSON.stringify(shown))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
  expect(shown.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^x+$/u) });
});

it.effect(
  'a blob document is decoded as UTF-8, and one past the document limit is refused before decoding',
  Effect.fnUntraced(function* () {
    const html = '<p>Привет</p>';
    const blob = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
    const view = yield* mcpAppDocument('app', uri, served({ uri, mimeType: MCP_APP_MIME_TYPE, blob }));
    expect(view.html).toBe(html);

    const huge = 'A'.repeat(Math.ceil((MCP_APP_DOCUMENT_MAX_LENGTH * 4) / 3) + 8);
    const refused = yield* Effect.flip(mcpAppDocument('app', uri, served({ uri, mimeType: MCP_APP_MIME_TYPE, blob: huge })));
    expect(refused._tag).toBe('McpResourceFailed');
    const broken = yield* Effect.flip(mcpAppDocument('app', uri, served({ uri, mimeType: MCP_APP_MIME_TYPE, blob: '@@' })));
    expect(broken._tag).toBe('McpResourceFailed');
  }),
);
