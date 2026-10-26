import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema, Stream } from 'effect';
import { makeThreadEntryReader, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { THREADS_ENTRY_KINDS } from '../contract/wire/entryKinds.js';
import { WORKTREES_ENTRY_KINDS } from '../../worktrees/contract/wire/entryKinds.js';
import { WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { FeedView } from '@runlith/agent/transcript/testing/feedView';
import { threadWireFeedEventSchema, type ThreadWireFeedEvent, type WireState } from '../contract/wire/snapshot.js';
import { feedRig } from './testing/feedRig.js';

const PAIRS = join(import.meta.dir, '../contract/wire/feedPairs');
const RECORDING = process.env.RECORD_FEED_PAIRS === '1';
const kinds = makeThreadEntryReader({ products: [...THREADS_ENTRY_KINDS, ...WORKTREES_ENTRY_KINDS] });
const encode = Schema.encodeEffect(threadWireFeedEventSchema);
const decode = Schema.decodeUnknownEffect(threadWireFeedEventSchema);

type Rig = Effect.Success<ReturnType<typeof feedRig>>;

const said = (id: string, text: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'assistant', runId: 'run', text });

const recordedIn = Effect.fnUntraced(function* (rig: Rig, act: (rig: Rig) => void) {
  const next = yield* Stream.toPull(rig.stream);
  const events: ThreadWireFeedEvent[] = [...(yield* next)];
  act(rig);
  const through = rig.live.view('thread').at.seq;
  while ((events.at(-1)?.at.seq ?? 0) < through) events.push(...(yield* next.pipe(Effect.timeout('1 second'))));
  return { rig, events };
});

const reconnected = Effect.fnUntraced(function* (before: (rig: Rig) => void, away: (rig: Rig) => void) {
  const rig = yield* feedRig();
  const first = yield* Effect.scoped(recordedIn(rig, before));
  away(first.rig);
  const since = first.events.at(-1)!.at;
  const next = yield* Stream.toPull(first.rig.reconnect(since));
  const again = [...(yield* next.pipe(Effect.timeout('1 second')))];
  return { rig: first.rig, events: [...first.events, ...again] };
});

const pair = Effect.fnUntraced(function* (name: string, act: (rig: Rig) => void) {
  yield* stored(name, yield* recordedIn(yield* feedRig(), act));
});

const stored = Effect.fnUntraced(function* (
  name: string,
  { rig, events }: { readonly rig: Rig; readonly events: readonly ThreadWireFeedEvent[] },
) {
  const reader = new FeedView<WireState>();
  for (const event of events) reader.take(event);
  expect(reader.gaps).toBe(0);
  expect(reader.transcript).toEqual(rig.transcript());
  expect(reader.open).toEqual(rig.open());
  const wire = JSON.parse(
    JSON.stringify(yield* Effect.forEach(events, (event) => encode(event)).pipe(Effect.provideService(ThreadEntryKinds, kinds))),
  );
  const folded = JSON.parse(JSON.stringify({ at: reader.at, transcript: reader.transcript, open: reader.open, progress: reader.progress }));
  const path = join(PAIRS, `${name}.json`);
  if (RECORDING) {
    mkdirSync(PAIRS, { recursive: true });
    writeFileSync(path, `${JSON.stringify({ events: wire, folded }, null, 2)}\n`);
  }
  expect(existsSync(path)).toBe(true);
  const stored = JSON.parse(readFileSync(path, 'utf8')) as { events: unknown[]; folded: unknown };
  expect(stored).toEqual({ events: wire, folded });
  const replayed = new FeedView<WireState>();
  for (const event of stored.events) replayed.take(yield* decode(event).pipe(Effect.provideService(ThreadEntryKinds, kinds)));
  expect(
    JSON.parse(JSON.stringify({ at: replayed.at, transcript: replayed.transcript, open: replayed.open, progress: replayed.progress })),
  ).toEqual(stored.folded);
});

it.live('an empty thread projects to a snapshot with nothing in it', () => pair('empty', () => {}));

it.live('more changes than the queue holds reach the reader whole through one resume', () =>
  pair('bounded', (rig) => {
    rig.live.tail('thread', 'run', [said('assistant:run', 'x')], []);
    for (let index = 0; index <= WIRE_PAGE_MAX_ENTRIES; index += 1) rig.live.append('thread', 'run', 'assistant:run', 'x');
    rig.land(said('assistant:earlier', 'landed while the reader lagged'));
  }),
);

it.live('a refused tool call settles from the open tail into a refused record', () =>
  pair('refused', (rig) => {
    const call = { type: 'tool', id: 'tool:run:call', runId: 'run', toolName: 'send_message', toolCallId: 'call' } as const;
    rig.live.tail('thread', 'run', [{ ...call, toolState: 'input-available', toolInput: { to: 'child' } }], []);
    rig.land({
      ...call,
      toolState: 'output-refused',
      toolInput: { to: 'child' },
      toolRefusal: { code: 'no-open-request', reason: 'You owe this agent no final answer now.' },
    });
  }),
);

it.live('pending input stands in the state until its arrival lands as a record', () =>
  pair('pending', (rig) => {
    const turn = { id: 'turn-1', runId: 'run-2', text: 'Next, the docs.', occurredAt: '2026-10-03T00:00:01.000Z' };
    const steer = { id: 'steer-1', runId: 'run', text: 'Shorter, please.', occurredAt: '2026-10-03T00:00:02.000Z' };
    const arrival = {
      type: 'signal',
      id: 'signal:steer-1',
      runId: 'run',
      signalType: 'user-message',
      addressee: 'reader',
      text: 'Shorter, please.',
      occurredAt: '2026-10-03T00:00:02.000Z',
    } as const;
    rig.pending({ queued: [turn], steers: [steer] });
    rig.pending({ queued: [turn], steers: [], arrived: [arrival] });
    rig.land(arrival, { queued: [turn], steers: [] });
  }),
);

it.live('entries of product kinds ride the feed like core ones', () =>
  pair('product', (rig) => {
    const created = {
      type: 'worktree',
      id: 'worktree:created:root-1',
      event: 'created',
      rootId: 'root-1',
      name: 'feature',
      branch: 'feature',
      occurredAt: '2026-10-03T00:00:01.000Z',
    };
    const moved = { type: 'transport', id: 'transport:1', from: 'terminal', to: 'acp', occurredAt: '2026-10-03T00:00:02.000Z' };
    rig.land(created);
    rig.land(moved);
  }),
);

const stopped = { type: 'interruption', id: 'interruption:run', runId: 'run', text: 'Stopped by the reader.' } as const;

it.live('an interrupted run lands what it streamed and closes its open tail', () =>
  pair('interruption', (rig) => {
    rig.live.tail('thread', 'run', [said('assistant:run', 'Half a')], []);
    rig.live.append('thread', 'run', 'assistant:run', ' thought');
    rig.land(said('assistant:run', 'Half a thought'));
    rig.end(stopped);
  }),
);

it.live('a withdrawn run takes its records out of the transcript and its open tail with them', () =>
  pair('withdraw', (rig) => {
    rig.land(said('assistant:run', 'Words to take back'));
    rig.live.tail('thread', 'run', [said('reasoning:run', 'still thinking')], []);
    rig.publish({ kind: 'withdrawal', withdrawn: { runId: 'run' } });
  }),
);

const rewind = { id: 'rewind-1', scope: 'from', runIds: ['run'] } as const;

it.live('a rewind marks the run records instead of removing them', () =>
  pair('rewind', (rig) => {
    rig.land(said('assistant:run', 'Kept as evidence'));
    rig.publish({ kind: 'rewind', rewound: rewind });
  }),
);

it.live('a restore clears the marks its rewind left', () =>
  pair('restore', (rig) => {
    rig.land(said('assistant:run', 'Back again'));
    rig.publish({ kind: 'rewind', rewound: rewind });
    rig.publish({ kind: 'restore', restored: { rewindId: 'rewind-1', runIds: ['run'] } });
  }),
);

it.live('a reader that reconnects from its position is answered with a resume carrying what landed while away', () =>
  Effect.flatMap(
    reconnected(
      (rig) => rig.land(said('assistant:run', 'Seen before the drop')),
      (rig) => rig.land(said('assistant:later', 'Landed while away')),
    ),
    (recorded) => stored('reconnect', recorded),
  ),
);
