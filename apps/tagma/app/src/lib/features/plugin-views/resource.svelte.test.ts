// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { makeClient } from './client.svelte.js';

const absent = undefined as never;

const facts = { projectId: 1, plugin: 'board', view: 'board', threadId: null, key: null };

const reading = (text: string) => ({ status: 'ok', contents: [{ uri: 'board://x', mimeType: 'text/plain', text }] });

test('a resource view shows the newest read even when an older read completes after it', async () => {
  const answers: Array<(text: string) => void> = [];
  const door = {
    perform: () => new Promise((resolve) => answers.push((text) => resolve(reading(text)))),
  } as unknown as Door;
  let changed = () => {};
  const live = {
    hold: (_open: unknown, onItem: () => void) => {
      changed = onItem;
      return { unsubscribe: () => {} };
    },
  } as unknown as LiveConnection;
  const client = makeClient(door, live, absent, absent, absent, absent, absent, absent, [], facts, new AbortController().signal);
  const seen = client.resource('board://x');
  let shown: unknown;
  const stop = $effect.root(() => {
    $effect(() => {
      shown = seen.current;
    });
  });
  flushSync();
  changed();
  changed();
  expect(answers).toHaveLength(2);
  answers[1]!('newest');
  await Promise.resolve();
  answers[0]!('older');
  await new Promise((resolve) => setTimeout(resolve));
  flushSync();
  expect(shown).toBe('newest');
  stop();
});
