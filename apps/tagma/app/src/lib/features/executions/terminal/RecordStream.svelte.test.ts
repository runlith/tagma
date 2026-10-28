import { ByteOffset } from '@runlith/executions/protocol/record';
import type { RecordDelivery } from '@tagma/server/executions/contract/wire/viewLeases';
import { expect, test, vi } from 'vitest';
import type { LiveConnection, LiveFailure } from '$lib/wire/Live.js';
import { LaneConnection } from './LaneConnection.js';
import { BYTE_GAP_RESET, RETAINED_GAP_LINE, RecordStream, notShownLine, type StreamFrame } from './RecordStream.svelte.js';
import { DROP, LaneEndpoint } from './testing/endpoint.js';
import { repoReads } from '../Repo.js';
import type { ExecutionsRepo } from '../Repo.js';

type Repo = ReturnType<typeof ExecutionsRepo.use>;

const address = { execution: 'exec-1', incarnation: 0 };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const base64 = (value: string) => Buffer.from(value).toString('base64');
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

type Grid = { readonly rows: number; readonly columns: number };

const chunk = (from: number, value: string, durableThrough: number, gap = false, grid?: Grid) => ({
  range: {
    cursor: { ref: { installation: 'i', execution: 'exec-1', incarnation: 0 }, stream: 'pty', offset: String(from) },
    next: String(from + value.length),
    retainedFrom: '0',
    durableThrough: String(durableThrough),
    gap,
    grid,
  },
  bytes: base64(value),
});

const repoOver = (reads: Record<string, unknown>, state?: unknown): Repo & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    bytes: {
      key: (key: { readonly offset: string; readonly limit?: number }) => ({
        refresh: () => {
          asked.push(key.offset);
          const answer = (key.limit === 0 ? reads[`${key.offset} positions`] : undefined) ?? reads[key.offset];
          return answer === undefined ? Promise.reject(new Error(`this suite answers no read at ${key.offset}`)) : Promise.resolve(answer);
        },
      }),
    },
    record: { key: () => ({ refresh: () => Promise.resolve({ record: {}, state: state ?? null, occupancy: null }) }) },
  } as unknown as Repo & { readonly asked: string[] };
};

const commandRepoOver = (reads: Record<string, unknown>, live?: unknown) => {
  const asked: string[] = [];
  const terminal: string[] = [];
  const repo = {
    commandBytes: {
      key: (key: { readonly offset: string }) => ({
        refresh: () => {
          asked.push(key.offset);
          const answer = reads[key.offset];
          return answer === undefined ? Promise.reject(new Error(`this suite answers no read at ${key.offset}`)) : Promise.resolve(answer);
        },
      }),
    },
    command: { key: () => ({ refresh: () => Promise.resolve(live === undefined ? undefined : { command: {}, live }) }) },
    record: {
      key: () => ({
        refresh: () => {
          terminal.push('asked');
          return Promise.reject(new Error('terminal-unknown: this installation holds no projection of that execution'));
        },
      }),
    },
  } as unknown as Repo;
  return { repo, asked, terminal };
};

const liveOver = (...screens: unknown[]) => {
  const held = {
    opened: [] as { readonly offset: string }[],
    pointed: [] as unknown[],
    acknowledged: [] as { readonly offset: string }[],
    push: null as ((delivery: RecordDelivery) => void | Promise<void>) | null,
    fail: null as ((failure: LiveFailure) => void) | null,
    refuseNext: null as Error | null,
    reopen: null as (() => void) | null,
  };
  const parsed = (payload: { readonly offset: string }) => {
    const refused = held.refuseNext;
    held.refuseNext = null;
    if (refused !== null) throw refused;
    held.acknowledged.push(payload);
    return payload;
  };
  const client = {
    'terminal.bytes.subscribe': (payload: { readonly offset: string }) => payload,
    'terminal.bytes.parsed': parsed,
    'command.bytes.subscribe': (payload: { readonly offset: string }) => payload,
    'command.bytes.parsed': parsed,
    'terminal.screen.point': (payload: unknown) => {
      held.pointed.push(payload);
      return screens.length > 1 ? screens.shift() : screens[0];
    },
  };
  const live = {
    hold: (
      open: (client: unknown) => { readonly offset: string },
      onItem: (delivery: RecordDelivery) => void | Promise<void>,
      onFailure: (failure: LiveFailure) => void,
    ) => {
      held.opened.push(open(client));
      held.push = onItem;
      held.fail = onFailure;
      held.reopen = () => {
        held.opened.push(open(client));
      };
      return {
        unsubscribe: () => {
          held.push = null;
        },
      };
    },
    call: (work: (client: unknown) => unknown) => {
      try {
        return Promise.resolve(work(client));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  } as unknown as LiveConnection;
  return { ...held, live, at: () => held };
};

const writerOver = () => {
  const written: string[] = [];
  const offsets: (string | undefined)[] = [];
  const modes: boolean[] = [];
  const pending: (() => void)[] = [];
  return {
    written,
    offsets,
    modes,
    parse: () => {
      const parsed = pending.shift();
      parsed?.();
      return parsed;
    },
    writer: {
      write: (bytes: Uint8Array, parsed: () => void, at?: ByteOffset) => {
        written.push(text(bytes));
        offsets.push(at);
        pending.push(parsed);
      },
      grid: (grid: Grid) => {
        written.push(`grid ${grid.columns}x${grid.rows}`);
      },
      replaying: (on: boolean) => {
        modes.push(on);
      },
    },
  };
};

const delivery = (from: number, value: string, viewer = 'viewer:test', grid?: Grid): RecordDelivery =>
  ({
    viewer,
    chunk: { _tag: 'Bytes', ...chunk(from, value, from + value.length, false, grid), bytes: new TextEncoder().encode(value) },
  }) as unknown as RecordDelivery;

test('a new grid waits until the notice written before it has parsed', async () => {
  const live = liveOver();
  const pane = writerOver();
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, '', 0) })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();

  const resumed = {
    viewer: 'viewer:test',
    chunk: { _tag: 'Bytes', ...chunk(6, 'ghi', 9, true, { rows: 40, columns: 120 }), bytes: new TextEncoder().encode('ghi') },
  } as unknown as RecordDelivery;
  void live.at().push?.(resumed);
  await settled();
  expect(pane.written).toEqual([RETAINED_GAP_LINE]);

  pane.parse();
  await settled();
  expect(pane.written).toEqual([RETAINED_GAP_LINE, 'grid 120x40', 'ghi']);
});

test('every grid the record carries is laid before the bytes after it, replay and live, and a grid with no bytes asks no acknowledgement', async () => {
  const live = liveOver();
  const pane = writerOver();
  const repo = repoOver({
    '0': chunk(0, 'abc', 6, false, { rows: 24, columns: 80 }),
    '3': chunk(3, 'def', 6, false, { rows: 30, columns: 100 }),
  });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();
  expect(pane.written).toEqual(['grid 80x24', 'abc']);
  pane.parse();
  await settled();
  expect(pane.written).toEqual(['grid 80x24', 'abc', 'grid 100x30', 'def']);
  pane.parse();
  await settled();

  await live.at().push?.(delivery(6, '', 'viewer:test', { rows: 40, columns: 120 }));
  void live.at().push?.(delivery(6, 'ghi', 'viewer:test', { rows: 40, columns: 120 }));
  await settled();
  expect(pane.written).toEqual(['grid 80x24', 'abc', 'grid 100x30', 'def', 'grid 120x40', 'ghi']);
  pane.parse();
  await settled();
  expect(live.at().acknowledged).toEqual([{ viewer: 'viewer:test', offset: '9' }]);
});

test('the record is replayed whole before the first live byte, one chunk at a time, and a replay is never acknowledged', async () => {
  const live = liveOver();
  const pane = writerOver();
  const repo = repoOver({ '0': chunk(0, 'abc', 6), '3': chunk(3, 'def', 6) });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();

  expect(pane.written).toEqual(['abc']);
  expect(repo.asked).toEqual(['0', '3']);
  expect(live.at().opened).toEqual([]);
  pane.parse();
  await settled();
  expect(pane.written).toEqual(['abc', 'def']);
  expect(repo.asked).toEqual(['0', '3']);
  pane.parse();
  await settled();
  expect(live.at().opened).toEqual([{ projectId: 1, execution: 'exec-1', incarnation: 0, stream: 'pty', offset: '6' }]);
  expect(pane.offsets).toEqual(['0', '3']);
  expect(pane.modes).toEqual([true, false]);
  expect(live.at().acknowledged).toEqual([]);

  void live.at().push?.(delivery(6, 'ghi'));
  await settled();
  expect(pane.written).toEqual(['abc', 'def', 'ghi']);
  expect(pane.offsets).toEqual(['0', '3', '6']);
});

const laneOver = () => {
  const endpoint = new LaneEndpoint();
  endpoint.stand('secret', 'lane');
  const link = new LaneConnection(
    endpoint.channel,
    'ws://127.0.0.1:9/terminal',
    'secret',
    { ready: () => undefined, receipt: () => undefined, closed: () => undefined },
    () => new Promise<void>(() => undefined),
  );
  return { endpoint, link };
};

const parseAll = async (pane: ReturnType<typeof writerOver>) => {
  await settled();
  while (pane.parse() !== undefined) await settled();
  await settled();
};

test('the live output takes over on the lane at the cursor the history reached: an overlap is cut, and a frame ahead reads the record up to it first', async () => {
  const lane = laneOver();
  const live = liveOver();
  const pane = writerOver();
  const repo = repoOver({ '0': chunk(0, 'abc', 3), '5': chunk(5, 'fg', 7) });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.lane(lane.link);
  await settled();
  stream.start();
  await parseAll(pane);
  const socket = lane.endpoint.following();
  expect(socket?.follows).toEqual(['3']);
  expect(live.at().opened).toEqual([]);

  socket?.write(1, 'bcde');
  socket?.write(7, 'hi');
  await parseAll(pane);
  socket?.write(7, 'hi');
  await parseAll(pane);

  expect(pane.written).toEqual(['abc', 'de', 'fg', 'hi']);
  expect(pane.offsets).toEqual(['0', '3', '5', '7']);
  expect(repo.asked).toEqual(['0', '5']);
  expect(socket?.follows).toEqual(['3', '7']);
  expect(live.at().opened).toEqual([]);
});

test('a lost lane hands the live output to the record subscription at the cursor and takes it back there when it stands again; behind reads the record, ended leaves the rest to the record', async () => {
  const lane = laneOver();
  const live = liveOver();
  const pane = writerOver();
  const repo = repoOver({ '0': chunk(0, 'abc', 3), '7': chunk(7, 'hij', 10) });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.lane(lane.link);
  await settled();
  stream.start();
  await parseAll(pane);
  const first = lane.endpoint.following();
  first?.write(3, 'd');

  lane.endpoint.serving = false;
  first?.drop(DROP);
  await settled();
  expect(live.at().opened.map((held) => held.offset)).toEqual(['4']);
  void live.at().push?.(delivery(4, 'ef'));
  await parseAll(pane);

  lane.endpoint.sockets.at(-1)?.onopen?.();
  await settled();
  const second = lane.endpoint.following();
  expect(second?.follows).toEqual(['6']);
  expect(live.at().push).toBeNull();
  second?.write(6, 'g');
  second?.say({ t: 'behind', retainedFrom: '9' });
  await parseAll(pane);
  expect(second?.follows).toEqual(['6', '10']);
  second?.say({ t: 'ended' });
  await settled();

  expect(pane.written).toEqual(['abc', 'd', 'ef', 'g', 'hij']);
  expect(pane.offsets).toEqual(['0', '3', '4', '6', '7']);
  expect(live.at().opened.map((held) => held.offset)).toEqual(['4', '10']);
});

test('a live chunk is acknowledged once, and only once its writer has finished with it', async () => {
  const live = liveOver();
  const pane = writerOver();
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, '', 0) })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();

  let taken = false;
  void Promise.resolve(live.at().push?.(delivery(0, 'live'))).then(() => {
    taken = true;
  });
  await settled();
  expect(live.at().acknowledged).toEqual([]);
  expect(taken).toBe(false);

  const finished = pane.parse();
  await settled();
  expect(live.at().acknowledged).toEqual([{ viewer: 'viewer:test', offset: '4' }]);
  expect(taken).toBe(true);

  finished?.();
  await settled();
  expect(live.at().acknowledged).toHaveLength(1);
});

test('a mark whose lease is gone is dropped, never sent to the lease that replaced it', async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, '', 0) })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  stream.start();
  await settled();

  live.at().refuseNext = new Error('the socket closed under this call');
  void live.at().push?.(delivery(0, 'live'));
  await settled();
  pane.parse();
  await settled();
  expect(live.at().acknowledged).toEqual([]);

  live.at().reopen?.();
  void live.at().push?.(delivery(4, 'more', 'viewer:second'));
  await settled();
  pane.parse();
  await settled();

  expect(live.at().acknowledged).toEqual([{ viewer: 'viewer:second', offset: '8' }]);
  expect(frames).toEqual([]);
});

test('bytes the record no longer keeps are written as the retained line, never skipped', async () => {
  const live = liveOver();
  const pane = writerOver();
  const stream = new RecordStream(
    repoReads(
      repoOver({ '0': { ...chunk(0, '', 13), range: { ...chunk(0, '', 13).range, next: '10', gap: true } }, '10': chunk(10, 'abc', 13) }),
    ),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();

  expect(pane.written).toEqual([RETAINED_GAP_LINE, 'abc']);
});

test('an ended record reports the exit the execution state carries', async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, 'bye', 3) }, { nativeExit: { _tag: 'Code', code: 3 } })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();

  void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'completed' } } as RecordDelivery);
  await settled();
  expect(frames).toEqual([{ _tag: 'Ended', ending: { _tag: 'Exit', native: { _tag: 'Code', code: 3 } } }]);
});

test("a command's ending is read through the command door, and the terminal door is never asked", async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const door = commandRepoOver(
    { '0': chunk(0, 'out', 3) },
    { _tag: 'Held', entry: { state: { phase: 'ended' }, ending: { nativeExit: { _tag: 'Code', code: 0 } } } },
  );
  const stream = new RecordStream(
    repoReads(door.repo),
    live.live,
    1,
    address,
    { kind: 'command', stream: 'stdout' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();

  void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'completed' } } as RecordDelivery);
  await settled();
  expect(frames).toEqual([{ _tag: 'Ended', ending: { _tag: 'Exit', native: { _tag: 'Code', code: 0 } } }]);
  expect(door.terminal).toEqual([]);
});

test('a command whose reference the host no longer holds reports an ending nobody could read', async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const door = commandRepoOver({ '0': chunk(0, 'out', 3) }, { _tag: 'Unheld' });
  const stream = new RecordStream(
    repoReads(door.repo),
    live.live,
    1,
    address,
    { kind: 'command', stream: 'stdout' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();

  void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'completed' } } as RecordDelivery);
  await settled();
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({ _tag: 'Ended', ending: { _tag: 'Unread' } });
  expect(door.terminal).toEqual([]);
});

test('an unavailable ending of a running shell says it is recovering, then follows again from its cursor by itself', async () => {
  vi.useFakeTimers();
  try {
    const live = liveOver();
    const pane = writerOver();
    const frames: StreamFrame[] = [];
    const stream = new RecordStream(
      repoReads(repoOver({ '0': chunk(0, 'abc', 3), '3': chunk(3, '', 3) }, { phase: 'running' })),
      live.live,
      1,
      address,
      { kind: 'terminal', stream: 'pty' },
      pane.writer,
      (frame) => frames.push(frame),
    );
    void stream.start();
    await vi.advanceTimersByTimeAsync(0);
    pane.parse();
    await vi.advanceTimersByTimeAsync(0);

    void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'unavailable' } } as RecordDelivery);
    await vi.advanceTimersByTimeAsync(0);
    expect(frames).toEqual([{ _tag: 'Recovering' }]);
    expect(live.at().opened).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(frames).toEqual([{ _tag: 'Recovering' }, { _tag: 'Flowing' }]);
    expect(live.at().opened.map((opened) => opened.offset)).toEqual(['3', '3']);
  } finally {
    vi.useRealTimers();
  }
});

test('a refused feed of an execution that ended reads the rest of its record and reports its exit, opening no feed again', async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, 'abc', 3), '3': chunk(3, 'de', 5) }, { phase: 'ended', nativeExit: { _tag: 'Code', code: 1 } })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();
  expect(live.at().opened).toHaveLength(1);

  live.at().fail?.({
    kind: 'subscription',
    message: 'this host holds no execution under that reference',
    code: 'terminal-host-refused-UnknownExecution',
    unblock: ['read the terminal list again'],
  });
  await settled();
  pane.parse();
  await settled();

  expect(pane.written).toEqual(['abc', 'de']);
  expect(frames).toEqual([{ _tag: 'Recovering' }, { _tag: 'Ended', ending: { _tag: 'Exit', native: { _tag: 'Code', code: 1 } } }]);
  expect(live.at().opened).toHaveLength(1);
});

test('an ending verified while the first read of the record is in flight hands every byte to the writer once', async () => {
  let answer: (value: unknown) => void = () => undefined;
  const positions = new Promise((resolve) => {
    answer = resolve;
  });
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const reads = { '0 positions': positions, '0': chunk(0, 'abc', 5), '3': chunk(3, 'de', 5) };
  const stream = new RecordStream(
    repoReads(repoOver(reads, { phase: 'ended', nativeExit: { _tag: 'Code', code: 0 } })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    (frame) => frames.push(frame),
  );
  void stream.start();
  await settled();
  void stream.verify();
  await settled();
  answer(chunk(0, '', 5));
  await settled();
  while (pane.parse() !== undefined) await settled();

  expect(pane.written).toEqual(['abc', 'de']);
  expect(pane.offsets).toEqual(['0', '3']);
  expect(frames).toEqual([{ _tag: 'Ended', ending: { _tag: 'Exit', native: { _tag: 'Code', code: 0 } } }]);
  expect(live.at().opened).toEqual([]);
});

test('a lost read of an ending the input verified says it is recovering and reads the rest again before reporting the exit', async () => {
  vi.useFakeTimers();
  try {
    const live = liveOver();
    const pane = writerOver();
    const frames: StreamFrame[] = [];
    const reads: Record<string, unknown> = { '0 positions': chunk(0, '', 3), '0': chunk(0, 'abc', 3) };
    const stream = new RecordStream(
      repoReads(repoOver(reads, { phase: 'ended', nativeExit: { _tag: 'Code', code: 0 } })),
      live.live,
      1,
      address,
      { kind: 'terminal', stream: 'pty' },
      pane.writer,
      (frame) => frames.push(frame),
    );
    void stream.start();
    await vi.advanceTimersByTimeAsync(0);
    pane.parse();
    await vi.advanceTimersByTimeAsync(0);

    void stream.verify();
    await vi.advanceTimersByTimeAsync(0);
    expect(frames).toEqual([{ _tag: 'Recovering' }]);

    reads['3'] = chunk(3, 'de', 5);
    await vi.advanceTimersByTimeAsync(1_000);
    pane.parse();
    await vi.advanceTimersByTimeAsync(0);
    expect(pane.written).toEqual(['abc', 'de']);
    expect(frames).toEqual([{ _tag: 'Recovering' }, { _tag: 'Ended', ending: { _tag: 'Exit', native: { _tag: 'Code', code: 0 } } }]);
  } finally {
    vi.useRealTimers();
  }
});

test('a gap ending re-reads through the bounded door, so a reader retention outran advances instead of reopening at a dead cursor', async () => {
  const live = liveOver();
  const pane = writerOver();
  const frames: StreamFrame[] = [];
  const evicted = (retainedFrom: number, durableThrough: number) => ({
    range: {
      cursor: { offset: '0' },
      next: String(retainedFrom),
      retainedFrom: String(retainedFrom),
      durableThrough: String(durableThrough),
      gap: true,
    },
    bytes: base64(''),
  });
  const kept = (from: number, value: string, durableThrough: number) => {
    const held = chunk(from, value, durableThrough);
    return { ...held, range: { ...held.range, retainedFrom: String(from) } };
  };
  const repo = repoOver({
    '0': chunk(0, 'abc', 3),
    '3': evicted(10, 13),
    '10': kept(10, 'def', 13),
    '13': evicted(20, 23),
    '20': kept(20, 'ghi', 23),
  });
  const stream = new RecordStream(repoReads(repo), live.live, 1, address, { kind: 'terminal', stream: 'pty' }, pane.writer, (frame) =>
    frames.push(frame),
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();
  expect(live.at().opened.map((opened) => opened.offset)).toEqual(['3']);

  void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'gap' } } as RecordDelivery);
  await settled();
  pane.parse();
  pane.parse();
  pane.parse();
  await settled();
  expect(repo.asked).toEqual(['0', '3', '10']);
  expect(pane.written).toEqual(['abc', BYTE_GAP_RESET, RETAINED_GAP_LINE, 'def']);
  expect(live.at().opened.map((opened) => opened.offset)).toEqual(['3', '13']);

  void live.at().push?.({ viewer: 'viewer:test', chunk: { _tag: 'Ended', ending: 'gap' } } as RecordDelivery);
  await settled();
  pane.parse();
  pane.parse();
  pane.parse();
  await settled();
  expect(pane.written).toEqual(['abc', BYTE_GAP_RESET, RETAINED_GAP_LINE, 'def', BYTE_GAP_RESET, RETAINED_GAP_LINE, 'ghi']);
  expect(live.at().opened.map((opened) => opened.offset)).toEqual(['3', '13', '23']);
  expect(frames).toEqual([]);
});

test('start answers when the replay has been written and parsed, before the live feed opens', async () => {
  const live = liveOver();
  const pane = writerOver();
  const repo = repoOver({ '0': chunk(0, 'abc', 6), '3': chunk(3, 'def', 6) });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  let replayed = false;
  void stream.start().then(() => {
    replayed = true;
  });
  await settled();

  expect(pane.written).toEqual(['abc']);
  expect(replayed).toBe(false);
  expect(live.at().opened).toEqual([]);

  pane.parse();
  await settled();
  expect(pane.written).toEqual(['abc', 'def']);
  expect(replayed).toBe(false);

  pane.parse();
  await settled();
  expect(replayed).toBe(true);
  expect(live.at().opened).toEqual([{ projectId: 1, execution: 'exec-1', incarnation: 0, stream: 'pty', offset: '6' }]);
});

test('a fresh replay starts at the tail the engine can hold, saying where the skipped head was', async () => {
  const live = liveOver();
  const pane = writerOver();
  const window = (next: string, value: string) => ({
    range: { cursor: { offset: '0' }, next, retainedFrom: '0', durableThrough: '2097152', gap: false },
    bytes: base64(value),
  });
  const repo = repoOver({ '0': window('4', 'head'), '1497152': window('2097152', 'tail') });
  const stream = new RecordStream(
    repoReads(repo),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
    {
      scrollbackRows: 5000,
    },
  );
  let replayed = false;
  void stream.start().then(() => {
    replayed = true;
  });
  await settled();

  expect(repo.asked).toEqual(['0', '1497152']);
  expect(pane.written).toEqual([notShownLine(ByteOffset.make('0'), ByteOffset.make('0'), ByteOffset.make('1497152')), 'tail']);
  expect(pane.offsets).toEqual([undefined, '1497152']);
  expect(replayed).toBe(false);

  pane.parse();
  pane.parse();
  await settled();
  expect(replayed).toBe(true);
  expect(live.at().opened).toEqual([{ projectId: 1, execution: 'exec-1', incarnation: 0, stream: 'pty', offset: '2097152' }]);
});

test('a fresh terminal opens on the screen the host holds and reads the record from that screen’s byte, a gap after it takes the screen again, and one without a screen opens on the tail', async () => {
  const point = (position: string, text: string) => ({
    _tag: 'ScreenPoint',
    position,
    geometry: { rows: 24, columns: 80 },
    bytes: new TextEncoder().encode(text),
  });
  const evicted = {
    range: { cursor: { offset: '6' }, next: '10', retainedFrom: '10', durableThrough: '12', gap: true },
    bytes: base64(''),
  };
  const opened = async (screens: unknown[], reads: Record<string, unknown>) => {
    const live = liveOver(...screens);
    const pane = writerOver();
    const writer = {
      ...pane.writer,
      screen: (bytes: Uint8Array, at: ByteOffset, parsed: () => void) => pane.writer.write(bytes, parsed, at),
    };
    const repo = repoOver(reads);
    const options = { scrollbackRows: 5000 };
    const stream = new RecordStream(
      repoReads(repo),
      live.live,
      1,
      address,
      { kind: 'terminal', stream: 'pty' },
      writer,
      () => undefined,
      options,
    );
    void stream.start();
    for (let step = 0; step < 6; step += 1) {
      await settled();
      pane.parse();
    }
    await settled();
    return { live, pane, repo };
  };

  const pointed = await opened([point('6', 'screen'), point('12', 'again')], { '6': evicted, '12': chunk(12, 'ghi', 15) });
  expect(pointed.live.pointed).toEqual([
    { projectId: 1, execution: 'exec-1', incarnation: 0, scrollback: 5000 },
    { projectId: 1, execution: 'exec-1', incarnation: 0, scrollback: 5000 },
  ]);
  expect(pointed.pane.written).toEqual(['grid 80x24', 'screen', 'again', 'ghi']);
  expect(pointed.pane.offsets).toEqual(['6', '12', '12']);
  expect(pointed.repo.asked).toEqual(['6', '12']);
  expect(pointed.live.at().opened.map((at) => at.offset)).toEqual(['15']);

  const tailed = await opened([{ _tag: 'ScreenUnavailable', reason: 'transport', detail: 'pipes' }], { '0': chunk(0, 'abc', 3) });
  expect(tailed.pane.written).toEqual(['abc']);
  expect(tailed.live.at().opened.map((at) => at.offset)).toEqual(['3']);
});

test('the replay reports how far it has got, against the frontier it read', async () => {
  const live = liveOver();
  const pane = writerOver();
  const reported: [number, number][] = [];
  const window = (next: string, value: string) => ({
    range: { cursor: { offset: '0' }, next, retainedFrom: '0', durableThrough: '2097152', gap: false },
    bytes: base64(value),
  });
  const stream = new RecordStream(
    repoReads(repoOver({ '0': window('4', 'head'), '1497152': window('2097152', 'tail') })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
    { scrollbackRows: 5000, progress: (written, total) => reported.push([written, total]) },
  );
  stream.start();
  await settled();

  expect(reported).toEqual([[0, 600_000]]);

  pane.parse();
  pane.parse();
  await settled();
  expect(reported).toEqual([
    [0, 600_000],
    [4, 600_000],
  ]);
});

test('a re-read grounds the engine before replaying from the offset it is given, and follows from where that reading ends', async () => {
  const live = liveOver();
  const pane = writerOver();
  const stream = new RecordStream(
    repoReads(repoOver({ '0': chunk(0, 'abc', 3), '1': chunk(1, 'bc', 3) })),
    live.live,
    1,
    address,
    { kind: 'terminal', stream: 'pty' },
    pane.writer,
    () => undefined,
  );
  stream.start();
  await settled();
  pane.parse();
  await settled();
  expect(pane.written).toEqual(['abc']);

  stream.reread(ByteOffset.make('1'));
  await settled();
  expect(pane.written).toEqual(['abc', BYTE_GAP_RESET, 'bc']);
  expect(pane.offsets).toEqual(['0', undefined, '1']);
  pane.parse();
  pane.parse();
  await settled();
  expect(live.at().opened.map((opened) => opened.offset)).toEqual(['3', '3']);
});

test('a command pipe replays and follows through the command door, and resumes at the offset it stands at', async () => {
  const opened: { readonly stream: string; readonly offset: string }[] = [];
  const acknowledged: { readonly stream: string; readonly offset: string }[] = [];
  const asked: string[] = [];
  const repo = {
    commandBytes: {
      key: (key: { readonly offset: string }) => ({
        refresh: () => {
          asked.push(key.offset);
          return Promise.resolve(chunk(Number(key.offset), 'abc', 3));
        },
      }),
    },
  } as unknown as Repo;
  const client = {
    'command.bytes.subscribe': (payload: { readonly stream: string; readonly offset: string }) => {
      opened.push({ stream: payload.stream, offset: payload.offset });
      return { stream: payload.stream, offset: payload.offset };
    },
    'command.bytes.parsed': (payload: { readonly stream?: string; readonly offset: string }) => {
      acknowledged.push({ stream: 'stderr', offset: payload.offset });
      return payload;
    },
  };
  const socket = { push: null as ((delivery: RecordDelivery) => void | Promise<void>) | null };
  const live = {
    hold: (open: (client: unknown) => unknown, onItem: (delivery: RecordDelivery) => void | Promise<void>) => {
      open(client);
      socket.push = onItem;
      return {
        unsubscribe: () => {
          socket.push = null;
        },
      };
    },
    call: (work: (client: unknown) => unknown) => Promise.resolve(work(client)),
  } as unknown as LiveConnection;
  const pane = writerOver();
  const stream = new RecordStream(
    repoReads(repo),
    live,
    1,
    { execution: 'exec-1', incarnation: 0 },
    { kind: 'command', stream: 'stderr' },
    pane.writer,
    () => undefined,
  );

  const started = stream.start();
  await settled();
  expect(asked).toEqual(['0']);
  expect(pane.written).toEqual(['abc']);
  pane.parse();
  await started;

  expect(opened).toEqual([{ stream: 'stderr', offset: '3' }]);

  void socket.push?.(delivery(3, 'def'));
  await settled();
  expect(pane.written).toEqual(['abc', 'def']);
  pane.parse();
  await settled();
  expect(acknowledged).toEqual([{ stream: 'stderr', offset: '6' }]);
  stream.stop();
});
