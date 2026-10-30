// @vitest-environment jsdom
import { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import StripContribution from './strip.composer.svelte';

test('the place strip stands under the composer only while a draft is open', async () => {
  const composer = new ComposerContributions();
  const shown = $state<{ id: string | null }>({ id: null });
  const target = document.createElement('div');
  const host = mount(StripContribution, {
    target,
    props: { shown: shown as never, birth: {} as never, places: {} as never, writes: {} as never, composer, contributor: 'threads' },
  });
  flushSync();
  expect(composer.chips('strip').map((chip) => chip.id)).toEqual(['place']);

  shown.id = 'thread-1';
  flushSync();
  expect(composer.chips('strip')).toEqual([]);

  shown.id = null;
  flushSync();
  expect(composer.chips('strip').map((chip) => chip.id)).toEqual(['place']);
  await unmount(host);
});
