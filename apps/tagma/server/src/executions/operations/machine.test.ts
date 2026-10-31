import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { LoadReader, type LoadRow, type LoadView, type MachineLoadFrame } from '../contract/wire/load.js';
import { LoadFeed } from '../contract/service/load.js';
import { MACHINE_PAIRS } from './machine.js';

const row = (key: string, share: number, processes: number): LoadRow => ({
  key,
  kind: 'program',
  title: key,
  share,
  rank: share,
  memoryBytes: 1,
  unread: 0,
  minor: false,
  processes: Array.from({ length: processes }, (_, at) => ({
    pid: 100 + at,
    birth: `${100 + at}:0`,
    name: key,
    share: share / processes,
    memoryBytes: 1,
    killable: true,
  })),
});

const none = { count: 0, share: 0, memoryBytes: 0, unread: 0 };

const view = (share: number | null): LoadView => ({
  scope: { host: { _tag: 'Local', machine: 'fixture' }, network: { _tag: 'Local', machine: 'fixture' } },
  readAt: 2000,
  cores: 4,
  machine: 'Computer',
  share,
  memory: { _tag: 'Unknown', reason: 'unknown', detail: 'fixture' },
  saturated: false,
  rows: [row('chrome', 0.5, 12), row('yes', 0.25, 1)],
  totals: { own: none, agent: none, work: none, outside: none, others: none },
  background: [],
  unresolved: [],
});

it.live('the read waits for an interval, answers the heaviest rows with their heaviest processes and releases its subscription', () =>
  Effect.gen(function* () {
    let released = false;
    const frames: MachineLoadFrame[] = [
      {
        _tag: 'Snapshot',
        sequence: 1,
        snapshot: {
          composedAt: 1000,
          reader: LoadReader.make('fixture'),
          state: { _tag: 'Read', view: view(null) },
          history: [],
        },
      },
      { _tag: 'Delta', sequence: 2, base: 1, delta: { composedAt: 2000, state: { _tag: 'Read', view: view(0.75) } } },
    ];
    const answer = yield* MACHINE_PAIRS.read_machine_load.body
      .execute({ limit: 1 }, undefined, { actor: { kind: 'operator' }, files: null })
      .pipe(
        Effect.provideService(LoadFeed, {
          interest: () => Effect.succeed(true),
          machine: () =>
            Stream.fromIterable(frames).pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  released = true;
                }),
              ),
            ),
        }),
      );
    expect(answer).toMatchObject({ status: 'ok', shown: 1, state: { _tag: 'Read', share: 0.75, total: 2 } });
    if (answer.status === 'ok' && answer.state._tag === 'Read') {
      expect(answer.state.rows.map((one) => one.key)).toEqual(['chrome']);
      expect(answer.state.rows[0]?.processes).toHaveLength(8);
      expect(answer.state.rows[0]?.more).toBe(4);
    }
    expect(released).toBe(true);
  }),
);
