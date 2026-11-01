import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { WIRE_PAGE_MAX_BYTES, WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import { OPEN_WINDOW } from '@runlith/agent/transcript/openText';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { FeedView } from '@runlith/agent/transcript/testing/feedView';
import type { WireState } from '../contract/wire/snapshot.js';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { feedRig as world } from './testing/feedRig.js';

const said = (id: string, text: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'assistant', runId: 'run', text });

it.live('a subscriber that falls behind is answered with a resume from what it was handed and loses no fact', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    const reader = new FeedView<WireState>();
    const next = yield* Stream.toPull(rig.stream);
    const opening = (yield* next)[0]!;
    expect(opening.type).toBe('snapshot');
    reader.take(opening);
    rig.live.tail('thread', 'run', [said('assistant:run', 'x')], []);
    for (let index = 0; index <= WIRE_PAGE_MAX_ENTRIES; index += 1) rig.live.append('thread', 'run', 'assistant:run', 'x');
    rig.land(said('assistant:earlier', 'landed while the reader lagged'));

    const recovered = (yield* next)[0]!;
    expect(recovered.type).toBe('resume');
    if (recovered.type === 'resume') expect(recovered.payload.from).toEqual(opening.at);
    reader.take(recovered);
    rig.live.append('thread', 'run', 'assistant:run', ' tail');
    reader.take((yield* next)[0]!);
    expect(reader.gaps).toBe(0);
    expect(reader.transcript).toEqual(rig.transcript());
    expect(reader.open).toEqual(rig.open());
    expect(reader.open).toEqual([{ entry: said('assistant:run', `${'x'.repeat(WIRE_PAGE_MAX_ENTRIES + 2)} tail`), from: 0 }]);
  }),
);

it.live('an open entry larger than the window travels as its newest window, named by the offset it starts at', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    const text = `${'y'.repeat(4 * WIRE_PAGE_MAX_BYTES)}${'😀'.repeat(OPEN_WINDOW)}z`;
    const window = { entry: said('assistant:run', `${'😀'.repeat(OPEN_WINDOW / 2 - 1)}z`), from: text.length - OPEN_WINDOW + 1 };
    const next = yield* Stream.toPull(rig.stream);
    yield* next;
    rig.live.tail('thread', 'run', [said('assistant:run', text)], []);
    const put = (yield* next)[0]!;
    expect(put.type === 'open' ? put.change : null).toEqual({ op: 'put', ...window });

    const reopened = (yield* Stream.toPull(rig.reconnect({ position: 0, seq: 0 })).pipe(Effect.flatMap((pull) => pull)))[0]!;
    expect(reopened.type === 'resume' ? reopened.payload.open : null).toEqual([window]);

    const burst = 'q'.repeat(OPEN_WINDOW + 1);
    rig.live.append('thread', 'run', 'assistant:run', burst);
    const grown = (yield* next)[0]!;
    expect(grown.type === 'open' ? grown.change : null).toEqual({
      op: 'put',
      entry: said('assistant:run', 'q'.repeat(OPEN_WINDOW)),
      from: text.length + 1,
    });
  }),
);

it.live('every frame carries the context limit in force when it is cut, so a moved compaction point reaches a resting reader', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    const before: ThreadContextLimit = {
      window: 1_000_000,
      compaction: { at: 550_000, strategy: 'percent', share: 0.55, source: 'override' },
    };
    const after: ThreadContextLimit = { window: 1_000_000, compaction: null };
    rig.limit(before);
    const next = yield* Stream.toPull(rig.stream);
    const opening = (yield* next)[0]!;
    expect(opening.type === 'snapshot' && opening.payload.status === 'loaded' ? opening.payload.snapshot.contextLimit : undefined).toEqual(
      before,
    );

    rig.limit(after);
    rig.republish();
    const moved = (yield* next)[0]!;
    expect(moved.type === 'state' ? moved.payload.snapshot.contextLimit : undefined).toEqual(after);
  }),
);

it.live('what changes while the snapshot is read reaches the reader exactly once', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    const reader = new FeedView<WireState>();
    rig.live.tail('thread', 'run', [said('assistant:run', 'before')], []);
    rig.duringRead(() => {
      rig.live.append('thread', 'run', 'assistant:run', ' during');
      rig.land(said('assistant:other', 'landed during the read'));
    });
    const next = yield* Stream.toPull(rig.stream);
    reader.take((yield* next)[0]!);
    rig.live.append('thread', 'run', 'assistant:run', ' after');
    reader.take((yield* next)[0]!);
    expect(reader.gaps).toBe(0);
    expect(reader.transcript).toEqual([said('assistant:other', 'landed during the read')]);
    expect(reader.open).toEqual([{ entry: said('assistant:run', 'before during after'), from: 0 }]);
  }),
);
