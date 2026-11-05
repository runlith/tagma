import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result, Schema } from 'effect';
import { threadEntryWireSchema, threadOpenChangeSchema, threadOpenEntrySchema } from '../protocol/http';
import { makeThreadEntryReader, ThreadEntryKinds, ThreadEntryUnreadable } from '../transcript/kinds';

const Placed = Schema.Struct({ type: Schema.Literal('placed'), id: Schema.String, rootId: Schema.String });
const kinds = makeThreadEntryReader({ products: [{ type: 'placed', schema: Placed }] });

it.effect('wire ingress reads installed entries and preserves a refusal for an unreadable entry without accepting its body', () =>
  Effect.gen(function* () {
    const placed = { type: 'placed', id: 'placed:1', rootId: 'root-1' };
    const read = yield* Schema.decodeUnknownEffect(threadEntryWireSchema)(placed).pipe(Effect.provideService(ThreadEntryKinds, kinds));
    expect(read).toEqual(placed);
    const unknown = yield* Schema.decodeUnknownEffect(threadEntryWireSchema)(placed);
    expect(unknown).toBeInstanceOf(ThreadEntryUnreadable);
    if (!(unknown instanceof ThreadEntryUnreadable)) return;
    expect(unknown.refusal).toMatchObject({ _tag: 'ThreadEntryUndecodable', id: 'placed:1', type: 'placed' });
  }),
);

it.effect('an entry the store could not read crosses the wire as its diagnosis, without its body', () =>
  Effect.gen(function* () {
    const stored = { type: 'placed', id: 'placed:1', runId: 'run', occurredAt: 'then', rootId: 'a body the reader never sees' };
    const held = makeThreadEntryReader({ products: [] }).stored(stored);
    const carried = Result.getOrThrow(held);
    const sent = yield* Schema.encodeEffect(threadEntryWireSchema)(carried);
    const crossed = JSON.parse(JSON.stringify(sent));
    expect(JSON.stringify(crossed)).not.toContain('a body the reader never sees');
    const read = yield* Schema.decodeUnknownEffect(threadEntryWireSchema)(crossed);
    expect(read).toBeInstanceOf(ThreadEntryUnreadable);
    expect(read).toMatchObject({ id: 'placed:1', runId: 'run', occurredAt: 'then', refusal: { type: 'placed', id: 'placed:1' } });
  }),
);

it.effect('an entry holding an absent optional as undefined crosses the JSON wire in its kind form', () =>
  Effect.gen(function* () {
    const wire = Schema.toCodecJson(threadOpenChangeSchema);
    const entry = {
      type: 'tool',
      id: 't',
      toolName: 'read',
      toolCallId: 'c',
      toolState: 'input-available',
      runId: undefined,
      toolOutput: undefined,
    };
    const sent = yield* Schema.encodeUnknownEffect(wire)({ op: 'put', entry });
    const read = yield* Schema.decodeUnknownEffect(wire)(JSON.parse(JSON.stringify(sent)));
    expect(read).toMatchObject({ op: 'put', entry: { type: 'tool', id: 't', toolState: 'input-available' } });
  }),
);

it.effect('an open entry crosses the JSON wire with its offset, and a frame from before offsets reads as starting at zero', () =>
  Effect.gen(function* () {
    const open = Schema.toCodecJson(Schema.Array(threadOpenEntrySchema));
    const change = Schema.toCodecJson(threadOpenChangeSchema);
    const entry = { type: 'message', id: 'm', role: 'assistant', runId: 'r', text: 'tail' };
    const sent = yield* Schema.encodeUnknownEffect(open)([{ entry, from: 70_000 }]);
    expect(yield* Schema.decodeUnknownEffect(open)(JSON.parse(JSON.stringify(sent)))).toEqual([{ entry, from: 70_000 }]);

    expect(yield* Schema.decodeUnknownEffect(open)([entry])).toEqual([{ entry, from: 0 }]);
    expect(yield* Schema.decodeUnknownEffect(change)({ op: 'put', entry })).toEqual({ op: 'put', entry, from: 0 });
  }),
);

it.effect('a malformed installed entry becomes a typed diagnostic at feed ingress', () =>
  Effect.gen(function* () {
    const change = yield* Schema.decodeUnknownEffect(threadOpenChangeSchema)({
      op: 'put',
      entry: {
        type: 'tool',
        id: 't',
        runId: 42,
        occurredAt: '2026-10-19T00:00:00Z',
        rewound: { by: 1, scope: 'from' },
      },
    });
    expect(change.op).toBe('put');
    if (change.op !== 'put') return;
    expect(change.entry).toBeInstanceOf(ThreadEntryUnreadable);
    expect((change.entry as ThreadEntryUnreadable).refusal).toMatchObject({ _tag: 'ThreadEntryUndecodable', id: 't', type: 'tool' });
    expect(change.entry.occurredAt).toBe('2026-10-19T00:00:00Z');
  }),
);
