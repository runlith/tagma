import { describe, expect, test } from 'bun:test';
import type { ThreadEventDelta } from './eventFold';
import type { FeedPosition, ThreadFeedEvent, ThreadOpenChange } from './live';
import type { ThreadTranscriptEntry } from './rows';
import { FeedView } from './testing/feedView';

type State = { readonly name: string };

const at = (position: number, seq: number): FeedPosition => ({ position, seq });

const message = (id: string, runId: string, text: string): ThreadTranscriptEntry => ({
  type: 'message',
  id,
  role: 'assistant',
  runId,
  text,
});

const snapshot = (
  where: FeedPosition,
  transcript: readonly ThreadTranscriptEntry[],
  open: readonly ThreadTranscriptEntry[] = [],
): ThreadFeedEvent<State> => ({
  type: 'snapshot',
  at: where,
  payload: { status: 'loaded', snapshot: { name: 'snapshot', transcript, before: null, open, progress: null } },
});

const state = (where: FeedPosition, records: readonly ThreadEventDelta[]): ThreadFeedEvent<State> => ({
  type: 'state',
  at: where,
  payload: { records, snapshot: { name: `state ${where.seq}` } },
});

const open = (where: FeedPosition, change: ThreadOpenChange): ThreadFeedEvent<State> => ({ type: 'open', at: where, change });

const record = (position: number, entry: ThreadTranscriptEntry): ThreadEventDelta => ({ position, kind: entry.type, entry });

describe('feed step', () => {
  test('an event that does not follow the held sequence is a gap and changes nothing', () => {
    const view = new FeedView<State>();
    expect(view.take(open(at(0, 1), { op: 'put', entry: message('a', 'run', 'x') }))).toBe(false);
    view.take(snapshot(at(3, 10), [message('m1', 'run', 'one')]));

    expect(view.take(open(at(3, 12), { op: 'put', entry: message('a', 'run', 'x') }))).toBe(false);
    expect(view.take(state(at(4, 10), [record(4, message('m2', 'run', 'two'))]))).toBe(false);
    expect(view.take(state(at(5, 11), [record(4, message('m2', 'run', 'two'))]))).toBe(false);

    expect(view.gaps).toBe(4);
    expect(view.transcript.map((entry) => entry.id)).toEqual(['m1']);
    expect(view.open).toEqual([]);
    expect(view.at).toEqual(at(3, 10));
  });

  test('a resume replaying records the view already holds applies each record once and leaves exactly its open tail', () => {
    const view = new FeedView<State>();
    view.take(
      snapshot(
        at(2, 5),
        [message('m1', 'run', 'one'), message('m2', 'run', 'two')],
        [message('gone', 'run', 'x'), message('live', 'run', 't')],
      ),
    );
    const replayed: ThreadFeedEvent<State> = {
      type: 'resume',
      at: at(3, 9),
      payload: {
        from: at(1, 2),
        records: [record(2, message('m2', 'run', 'two')), record(3, message('m3', 'run', 'three'))],
        open: [message('live', 'run', 'typ')],
        progress: { phase: { phase: 'writing', since: 1 }, estimate: null },
        snapshot: { name: 'resumed' },
      },
    };

    view.take(replayed);
    view.take({ ...replayed, at: at(3, 9) });

    expect(view.transcript.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
    expect(view.open).toEqual([message('live', 'run', 'typ')]);
    expect(view.progress?.phase?.phase).toBe('writing');
    expect(view.state).toEqual({ name: 'resumed' });
    expect(view.at).toEqual(at(3, 9));
  });

  test('a state carrying records older than the held position keeps the held position', () => {
    const view = new FeedView<State>();
    view.take(snapshot(at(5, 1), [message('m1', 'run', 'one')]));

    view.take(state(at(4, 2), [record(4, message('m1', 'run', 'one'))]));

    expect(view.at).toEqual(at(5, 2));
    expect(view.transcript.map((entry) => entry.id)).toEqual(['m1']);
  });

  test('open text grows by appended characters and its record settles it in place', () => {
    const view = new FeedView<State>();
    view.take(snapshot(at(1, 0), [message('user', 'run', 'hi')]));
    view.take(open(at(1, 1), { op: 'put', entry: message('assistant:run', 'run', 'Hel') }));
    view.take(open(at(1, 2), { op: 'append', id: 'assistant:run', text: 'lo' }));

    expect(view.open).toEqual([message('assistant:run', 'run', 'Hello')]);

    view.take(state(at(2, 3), [record(2, message('assistant:run', 'run', 'Hello'))]));

    expect(view.open).toEqual([]);
    expect(view.transcript.map((entry) => entry.id)).toEqual(['user', 'assistant:run']);
  });

  test('an open put for an entry already journaled replaces it there instead of opening a second copy', () => {
    const announced: ThreadTranscriptEntry = {
      type: 'tool',
      id: 'tool:call',
      runId: 'run',
      toolName: 'read',
      toolCallId: 'call',
      toolState: 'input-available',
    };
    const view = new FeedView<State>();
    view.take(snapshot(at(1, 0), [announced]));

    view.take(open(at(1, 1), { op: 'put', entry: { ...announced, toolState: 'output-available', toolOutput: 'text' } }));

    expect(view.open).toEqual([]);
    expect(view.transcript).toEqual([{ ...announced, toolState: 'output-available', toolOutput: 'text' }]);
  });

  test('a withdrawal removes the run’s journaled and open entries but keeps its system prompt', () => {
    const prompt: ThreadTranscriptEntry = { type: 'system-prompt', id: 'system-prompt:run', runId: 'run', text: 'be brief' };
    const view = new FeedView<State>();
    view.take(snapshot(at(2, 0), [prompt, message('message:user:run', 'run', 'words')], [message('assistant:run', 'run', 'par')]));

    view.take(state(at(3, 1), [{ position: 3, kind: 'withdrawal', withdrawn: { runId: 'run' } }]));

    expect(view.transcript).toEqual([prompt]);
    expect(view.open).toEqual([]);
  });

  test('records of one event see each other: an entry appended and then replaced lands once', () => {
    const view = new FeedView<State>();
    view.take(snapshot(at(0, 0), []));

    view.take(
      state(at(2, 1), [
        record(1, { type: 'tool', id: 'tool:c', runId: 'run', toolName: 'read', toolCallId: 'c', toolState: 'input-available' }),
        record(2, { type: 'tool', id: 'tool:c', runId: 'run', toolName: 'read', toolCallId: 'c', toolState: 'output-available' }),
      ]),
    );

    expect(view.transcript).toEqual([
      { type: 'tool', id: 'tool:c', runId: 'run', toolName: 'read', toolCallId: 'c', toolState: 'output-available' },
    ]);
  });
});
