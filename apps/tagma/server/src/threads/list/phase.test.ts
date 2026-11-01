import { expect, test } from 'bun:test';
import type { ThreadToolEntry, ThreadToolState } from '@runlith/agent/transcript/entries';
import type { ThreadLivePosition, ThreadOpenChange, ThreadOpenView } from '@runlith/agent/transcript/live';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadStateShape } from '@runlith/agent/thread/state';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { phaseChanges, ThreadPhaseFeed, type PhaseSeed } from './phase.js';

const NO_VIEW: ThreadOpenView = { at: { position: 0, seq: 0 }, open: [], progress: null };

type Journal = 'none' | readonly ThreadTranscriptEntry[] | 'pending';

const at = (seq: number, runId = 'run-1'): ThreadLivePosition => ({ incarnation: 'phase-test', runId, at: { position: 1, seq } });

function feed(view: ThreadOpenView = NO_VIEW, journal: Journal = 'none') {
  const changed: string[] = [];
  let emit: ((changes: readonly ThreadOpenChange[], at: ThreadLivePosition) => void) | null = null;
  let released = 0;
  let seq = view.at.seq;
  let deliver: ((seed: PhaseSeed | null) => void) | null = null;
  const seedOf = (stored: readonly ThreadTranscriptEntry[], activeRunId = 'run-1', liveRun = activeRunId): PhaseSeed => ({
    activeRunId,
    storedOpen: stored,
    live: { ...view, incarnation: 'phase-test', runId: liveRun },
  });
  const phases = new ThreadPhaseFeed({
    watch: (_threadId, listener) => {
      emit = listener;
      return () => {
        released += 1;
        emit = null;
      };
    },
    cut: (_threadId, delivery) => {
      if (journal === 'pending') deliver = delivery;
      else delivery(seedOf(journal === 'none' ? [] : journal));
    },
    onChanged: (threadId) => changed.push(threadId),
  });
  return {
    phases,
    changed,
    releases: () => released,
    send: (change: ThreadOpenChange, runId = 'run-1') => emit?.([change], at(++seq, runId)),
    sendAt: (change: ThreadOpenChange, position: ThreadLivePosition) => emit?.([change], position),
    sendState: (...entries: readonly ThreadTranscriptEntry[]) =>
      emit?.(
        phaseChanges({
          type: 'state',
          ...at(++seq),
          frame: stateOf(entries),
          weight: 0,
        }),
        at(seq),
      ),
    read: (entries: readonly ThreadTranscriptEntry[], activeRunId?: string, liveRun?: string) =>
      deliver?.(seedOf(entries, activeRunId, liveRun)),
  };
}

function stateOf(entries: readonly ThreadTranscriptEntry[]) {
  return {
    state: {} as ThreadStateShape,
    deltas: entries.map((entry, index) => ({ position: index + 1, kind: 'entry', entry })),
  } as unknown as Extract<ThreadLiveEvent<ThreadStateShape>, { type: 'state' }>['frame'];
}

const entry = (
  id: string,
  name: string,
  toolState: ThreadToolState = 'input-available',
  title?: string,
  execution?: ThreadToolEntry['execution'],
): ThreadToolEntry => ({
  type: 'tool',
  id,
  toolCallId: id,
  toolName: name,
  toolState,
  toolDisplay: title === undefined ? undefined : { form: 'none', title },
  execution,
});
const tool = (...args: Parameters<typeof entry>): ThreadOpenChange => ({ op: 'put', entry: entry(...args), from: 0 });
const startedAt = '2026-10-10T12:00:00.000Z';
const started = { state: 'started', at: startedAt } as const;
const phase = (name: 'preparing' | 'reasoning' | 'retrying' | 'writing' | 'tools' | 'calling', since = 0): ThreadOpenChange => ({
  op: 'progress',
  progress: { phase: { phase: name, since }, estimate: null },
});
const ended: ThreadOpenChange = { op: 'progress', progress: { phase: null, estimate: null } };

test('the phase names the row while no call stands, dated by the instant its spell began', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(phase('reasoning', 1_700_000_000_000));
  expect(world.phases.phaseOf('thread-1')).toEqual({ phase: 'reasoning', since: 1_700_000_000_000, calls: [], queued: [] });
});

test('what the opening waits on names the row, and the first step phase takes it off', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  const waiting = { reason: 'graph', place: 'tagma-exp-classes-d74152' };
  world.send({ op: 'progress', progress: { phase: { phase: 'opening', since: 1_700_000_000_000, waiting }, estimate: null } });
  expect(world.phases.phaseOf('thread-1')).toEqual({ phase: 'opening', since: 1_700_000_000_000, waiting, calls: [], queued: [] });

  world.send(phase('preparing', 1_700_000_041_000));
  expect(world.phases.phaseOf('thread-1')?.waiting).toBeUndefined();
});

test('a call is dated by the instant its executor admitted it, never by when the list first saw it; settling takes it off', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(phase('tools'));
  world.send(tool('call-1', 'read', 'input-available', undefined, started));
  expect(world.phases.phaseOf('thread-1')).toEqual({
    phase: 'tools',
    since: 0,
    calls: [{ id: 'call-1', name: 'read', title: null, since: Date.parse(startedAt) }],
    queued: [],
  });

  world.send(tool('call-1', 'read', 'input-available', 'agent.ts', started));
  expect(world.phases.phaseOf('thread-1')?.calls).toEqual([
    { id: 'call-1', name: 'read', title: 'agent.ts', since: Date.parse(startedAt) },
  ]);

  world.send(tool('call-1', 'read', 'output-available', 'agent.ts', started));
  expect(world.phases.phaseOf('thread-1')).toEqual({ phase: 'tools', since: 0, calls: [], queued: [] });
});

test('a call its executor said nothing about or Tagma has not admitted yet stands undated, a queued one is counted apart, and an argument still streaming is no call', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(tool('call-1', 'bash'));
  world.send(tool('call-2', 'read', 'input-available', undefined, { state: 'queued', reason: 'waits for writes' }));
  world.send(tool('call-3', 'edit', 'input-streaming'));
  world.send(tool('call-4', 'grep', 'input-available', undefined, { state: 'queued', gated: true }));
  expect(world.phases.phaseOf('thread-1')).toEqual({
    phase: 'tools',
    since: null,
    calls: [
      { id: 'call-1', name: 'bash', title: null, since: null },
      { id: 'call-4', name: 'grep', title: null, since: null },
    ],
    queued: ['call-2'],
  });

  world.send(tool('call-2', 'read', 'input-available', undefined, started));
  expect(world.phases.phaseOf('thread-1')?.queued).toEqual([]);
  expect(world.phases.phaseOf('thread-1')?.calls.map((call) => call.name)).toEqual(['read', 'bash', 'grep']);
});

test('one call leaving the open tail leaves its neighbours', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(tool('call-1', 'read', 'input-available', undefined, started));
  world.send(tool('call-2', 'bash', 'input-available', undefined, started));
  world.send({ op: 'drop', id: 'call-1' });
  expect(world.phases.phaseOf('thread-1')?.calls).toEqual([{ id: 'call-2', name: 'bash', title: null, since: Date.parse(startedAt) }]);
});

test('a phase from inside the stream leaves an open call standing; the step ending takes it off', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(tool('call-1', 'bash', 'input-available', undefined, started));
  world.send(phase('writing', 5));
  expect(world.phases.phaseOf('thread-1')).toEqual({
    phase: 'writing',
    since: 5,
    calls: [{ id: 'call-1', name: 'bash', title: null, since: Date.parse(startedAt) }],
    queued: [],
  });

  world.send(phase('retrying', 9));
  expect(world.phases.phaseOf('thread-1')).toEqual({ phase: 'retrying', since: 9, calls: [], queued: [] });
});

test('following a run already under way reads the calls open in it', () => {
  const world = feed({
    at: { position: 4, seq: 7 },
    open: [
      { entry: entry('call-1', 'bash', 'input-available', 'bun test', started), from: 0 },
      { entry: entry('call-2', 'read', 'input-available', undefined, { state: 'queued' }), from: 0 },
    ],
    progress: { phase: { phase: 'tools', since: 3 }, estimate: null },
  });
  world.phases.follow('thread-1', 'run-1');
  expect(world.phases.phaseOf('thread-1')).toEqual({
    phase: 'tools',
    since: 3,
    calls: [{ id: 'call-1', name: 'bash', title: 'bun test', since: Date.parse(startedAt) }],
    queued: ['call-2'],
  });
  expect(world.changed).toEqual(['thread-1']);
});

test('a call journaled by an adapter arrives as a state delta, stands while open and leaves when it settles', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.sendState(entry('call-1', 'bash', 'input-available', 'bun test', started));
  expect(world.phases.phaseOf('thread-1')?.calls).toEqual([
    { id: 'call-1', name: 'bash', title: 'bun test', since: Date.parse(startedAt) },
  ]);
  world.sendState(entry('call-1', 'bash', 'output-available', 'bun test', started));
  expect(world.phases.phaseOf('thread-1')?.calls).toEqual([]);
});

test('a run found already under way reads its open calls from the journal, and what the stream says meanwhile wins', () => {
  const journaled = [
    entry('call-1', 'bash', 'input-available', 'bun test', started),
    entry('call-2', 'read', 'input-available', undefined, started),
  ];
  const restarted = feed(NO_VIEW, journaled);
  restarted.phases.follow('thread-1', 'run-1');
  expect(restarted.phases.phaseOf('thread-1')?.calls.map((call) => call.name)).toEqual(['bash', 'read']);

  const reading = feed(NO_VIEW, 'pending');
  reading.phases.follow('thread-1', 'run-1');
  reading.send(tool('call-2', 'read', 'output-available'));
  expect(reading.phases.phaseOf('thread-1')).toBeNull();
  reading.read(journaled);
  expect(reading.phases.phaseOf('thread-1')?.calls.map((call) => call.name)).toEqual(['bash']);
});

test('a run released before its journal answers takes nothing from the answer', () => {
  const world = feed(NO_VIEW, 'pending');
  world.phases.follow('thread-1', 'run-1');
  world.phases.follow('thread-1', null);
  world.read([entry('call-1', 'bash', 'input-available', undefined, started)]);
  expect(world.phases.phaseOf('thread-1')).toBeNull();
});

test('a live change the cut already covers is not taken again; one after it is', () => {
  const world = feed(
    { at: { position: 4, seq: 5 }, open: [], progress: { phase: { phase: 'tools', since: 3 }, estimate: null } },
    'pending',
  );
  world.phases.follow('thread-1', 'run-1');
  world.sendAt(tool('call-1', 'bash', 'input-available', undefined, started), at(3));
  world.sendAt(tool('call-2', 'read', 'input-available', undefined, started), at(6));
  world.read([]);
  expect(world.phases.phaseOf('thread-1')?.calls.map((call) => call.name)).toEqual(['read']);
});

test('a successor run the cut finds waits until the row facts name it, keeping what was heard of it', () => {
  const world = feed(NO_VIEW, 'pending');
  world.phases.follow('thread-1', 'run-1');
  world.read([entry('call-9', 'bash', 'input-available', undefined, started)], 'run-2', 'run-2');
  world.send(tool('call-10', 'read', 'input-available', undefined, started), 'run-2');
  expect(world.phases.phaseOf('thread-1')).toBeNull();
  world.phases.follow('thread-1', 'run-2');
  expect(world.phases.phaseOf('thread-1')?.calls.map((call) => call.name)).toEqual(['bash', 'read']);
});

test('the phase a run opens on is announced', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(phase('preparing'));
  expect(world.phases.phaseOf('thread-1')).toEqual({ phase: 'preparing', since: 0, calls: [], queued: [] });
  expect(world.changed).toEqual(['thread-1']);
});

test('a change that moves nothing the row says announces nothing', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(phase('writing'));
  world.changed.length = 0;
  world.send(phase('writing'));
  world.send({ op: 'append', id: 'assistant', text: 'more' });
  world.send({ op: 'drop', id: 'call-gone' });
  world.send(tool('call-gone', 'read', 'output-available'));
  expect(world.changed).toEqual([]);
});

test('a run that ends leaves the row silent, and the watch is released with it', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(tool('call-1', 'read'));
  world.send(ended);
  expect(world.phases.phaseOf('thread-1')).toBeNull();

  world.phases.follow('thread-1', null);
  expect(world.releases()).toBe(1);
  expect(world.phases.phaseOf('thread-1')).toBeNull();
});

test('dropping the watch clears whatever the row was saying', () => {
  const world = feed();
  world.phases.follow('thread-1', 'run-1');
  world.send(tool('call-1', 'read'));
  world.changed.length = 0;
  world.phases.follow('thread-1', null);
  expect(world.phases.phaseOf('thread-1')).toBeNull();
  expect(world.changed).toEqual(['thread-1']);
});
