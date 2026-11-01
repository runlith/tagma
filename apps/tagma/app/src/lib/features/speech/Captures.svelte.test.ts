import type { Capture, CapturesEvent } from '@tagma/server/speech/contract/wire/feeds';
import type { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { Captures } from './Captures.svelte.js';

const capture = (kind: string, id: string, one: string, many: string): Capture => ({
  kind,
  noun: { one, many },
  id,
  projectId: null,
  sources: ['mic'],
  at: 'server',
  startedAt: '2026-11-01T10:00:00Z',
});

test('the chip stops every capture no part claimed through the one stop, by the kind and id its owner named', async () => {
  let feed: (event: CapturesEvent) => void = () => undefined;
  const live = {
    hold: (_open: unknown, onItem: (event: CapturesEvent) => void) => {
      feed = onItem;
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  const performed: unknown[] = [];
  const door = {
    perform: async (id: string, input: unknown) => {
      performed.push([id, input]);
      return { status: 'stopped', stopped: 1 };
    },
  } as unknown as Door;
  const scope = Scope.make();
  const captures = new Captures(live, door, new Notices(scope), scope, { report: () => undefined } as unknown as Failure);
  const recognition = capture('recognition', 'r1', 'recognition', 'recognitions');
  const recording = capture('test-recording', 't1', 'test recording', 'test recordings');
  const shown = capture('test-recording', 't2', 'test recording', 'test recordings');
  feed({ kind: 'snapshot', captures: [recognition, recording, shown] });

  const release = captures.claim(shown);
  expect(captures.unclaimed.map((one) => one.id)).toEqual(['r1', 't1']);
  await captures.stop(captures.unclaimed);
  expect(performed).toEqual([
    ['stop_capture', { kind: 'recognition', id: 'r1' }],
    ['stop_capture', { kind: 'test-recording', id: 't1' }],
  ]);

  release();
  expect(captures.unclaimed.map((one) => one.id)).toEqual(['r1', 't1', 't2']);
});
