// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { createRawSnippet } from 'svelte';
import { afterEach, expect, test } from 'vitest';

import type { BlockListRow } from '@tagma/server/graph/contract/wire/reads';
import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
import ToolResultRow from './ToolResultRow.svelte';

const pointer = {
  truncated: true,
  outputId: 'b2f0c1d4',
  byteLength: 131_072,
  lineCount: 1,
  preview:
    '{"status":"ok","blocks":[{"name":"5940aab8","tags":["claim"]\n... tool output truncated (1 lines, 131072 bytes); full output id: b2f0c1d4 ...',
  format: 'json',
};

const block: BlockListRow = {
  name: '5940aab8',
  tags: ['claim'],
  fields: {},
  actions: { moves: [], slots: [], offers: [], revision: 'test' },
  title: 'The Tool Result the Transcript Shows',
  snippet: '',
  parentTitle: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function draw(toolOutput: unknown): HTMLElement {
  const entry: ChatEntryOf<'tool'> = {
    id: 'entry-1',
    kind: 'tool',
    toolName: 'query_blocks',
    toolCallId: 'call-1',
    toolState: 'output-available',
    toolOutput,
  };
  app ??= mountShell(
    Layer.mergeAll(
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(SessionNaming, new SessionNaming()),
      Layer.of(BlockTitles, {
        peer: () => ({ title: block.title, project: 'runlith', branch: null }),
        placed: () => null,
      } as never),
      Layer.of(Opening, { knows: () => true, tip: () => ({ text: null }) } as never),
    ),
  );
  return app.draw(ToolResultRow as never, {
    entry,
    markdown: createRawSnippet(() => ({ render: () => '<div></div>' })),
  });
}

test('a retained-value pointer draws the sample it carries and states the size behind it', () => {
  const target = draw(pointer);

  expect(target.querySelector('pre')?.textContent).toBe(pointer.preview);
  expect(target.textContent).toContain('128 KB');
});

test('a graph answer that fits still renders its own arm', () => {
  const target = draw({ status: 'ok', blocks: [block], total: 1 });

  const card = target.querySelector('a');
  expect(card?.textContent).toContain(block.title);
  expect(card?.getAttribute('href')).toContain(block.name);
});
