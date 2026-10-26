import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { ThreadEventDelta } from '../../transcript/eventFold';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { FeedView } from '../../transcript/testing/feedView';
import type { ThreadStateShape } from '../state';
import { makeThreadLiveFeed, type ThreadLiveEvent } from './ThreadLiveFeed';

const said = (id: string, text: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'assistant', runId: 'run-1', text });

const frame = (
  position: number,
  run: { readonly active: string | null; readonly latest: string | null },
  deltas: readonly ThreadEventDelta[] = [],
) => ({
  state: {
    thread: { id: 'thread-1' },
    position,
    activeRun: run.active === null ? null : { id: run.active, progress: { stage: 'streaming' as const } },
    latestRun: run.latest === null ? null : { id: run.latest },
  },
  from: 0,
  deltas,
});

function readerOf(events: readonly ThreadLiveEvent<ThreadStateShape>[]): FeedView<object> {
  const reader = new FeedView<object>();
  reader.take({
    type: 'snapshot',
    at: { position: 0, seq: 0 },
    payload: { status: 'loaded', snapshot: { transcript: [], before: null, open: [], progress: null } },
  });
  for (const event of events) {
    reader.take(
      event.type === 'open'
        ? { type: 'open', at: event.at, change: event.change }
        : { type: 'state', at: event.at, payload: { records: event.frame.deltas, snapshot: {} } },
    );
  }
  return reader;
}

describe('ThreadLiveFeed', () => {
  it.effect(
    'a landed entry leaves the open tail with its published record, and a finished run drops what never landed',
    Effect.fnUntraced(function* () {
      const feed = yield* makeThreadLiveFeed<ThreadStateShape>();
      const events: ThreadLiveEvent<ThreadStateShape>[] = [];
      feed.subscribe('thread-1', (event) => events.push(event));

      feed.tail('thread-1', 'run-1', [said('assistant:run-1', 'Hel'), said('assistant:run-1:text:1', 'draft')], []);
      feed.append('thread-1', 'run-1', 'assistant:run-1', 'lo');
      feed.tail('thread-1', 'run-1', [said('assistant:run-1:text:1', 'draft')], ['assistant:run-1']);

      expect(feed.view('thread-1').open.map((entry) => entry.id)).toEqual(['assistant:run-1:text:1']);

      feed.publishState(
        frame(1, { active: 'run-1', latest: 'run-1' }, [{ position: 1, kind: 'message', entry: said('assistant:run-1', 'Hello') }]),
      );
      feed.publishState(frame(1, { active: null, latest: 'run-1' }));

      expect(events.map((event) => (event.type === 'open' ? event.change.op : event.type))).toEqual([
        'put',
        'put',
        'append',
        'state',
        'state',
        'drop',
      ]);
      expect(events.map((event) => event.at.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(feed.view('thread-1').open).toEqual([]);
      const reader = readerOf(events);
      expect(reader.gaps).toBe(0);
      expect(reader.transcript).toEqual([said('assistant:run-1', 'Hello')]);
      expect(reader.open).toEqual([]);
    }),
  );

  it.effect(
    'a frame read before the run opened leaves the streaming run’s open entries alone',
    Effect.fnUntraced(function* () {
      const feed = yield* makeThreadLiveFeed<ThreadStateShape>();
      const events: ThreadLiveEvent<ThreadStateShape>[] = [];
      feed.subscribe('thread-1', (event) => events.push(event));

      feed.tail('thread-1', 'run-2', [said('assistant:run-2', 'still streaming')], []);
      feed.publishState(frame(0, { active: null, latest: 'run-1' }));

      expect(feed.view('thread-1').open.map((entry) => entry.id)).toEqual(['assistant:run-2']);
      expect(events.filter((event) => event.type === 'open').map((event) => event.change.op)).toEqual(['put']);
    }),
  );
});
