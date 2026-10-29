// @vitest-environment jsdom
import { createEntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import BrowserTools from './browserTools.feed.svelte';

test('a refused malformed action call stays with the generic renderer instead of crashing the page card', async () => {
  const kinds = createEntryKinds();
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(BrowserTools, { target, props: { kinds, contributor: 'browser' } });
  try {
    flushSync();
    const entry: ChatEntryOf<'tool'> = {
      id: 'action',
      kind: 'tool',
      toolName: 'act_on_page',
      toolCallId: 'call',
      toolState: 'output-refused',
      toolInput: { steps: [null] },
      toolRefusal: { code: 'input-invalid', reason: 'the step must be an object' },
    };
    expect(kinds.toolRenders(entry)).toBe(false);
    expect(kinds.toolRenders({ ...entry, toolInput: { steps: [{ action: 'press', key: 'Tab' }] } })).toBe(true);
  } finally {
    await unmount(view);
    target.remove();
  }
});
