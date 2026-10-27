import { expect, test } from 'vitest';
import type { TerminalBox, TerminalDecider } from '@tagma/server/executions/contract/wire/viewLeases';
import type { LiveConnection } from '$lib/wire/Live.js';
import { ViewGrid, type Grid } from './ViewGrid.js';

const ADDRESS = { execution: 'x-1', incarnation: 0 };
const VIEW = 'view-1';
const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

type Subscribed = { readonly view: string; readonly box?: TerminalBox };
type Failure = { readonly kind: 'subscription'; readonly message: string };

const wireOver = (answer: (box: TerminalBox) => Promise<unknown> = () => Promise.resolve({ acknowledged: true })) => {
  const subscribed: Subscribed[] = [];
  const reported: TerminalBox[] = [];
  let heard: ((frame: TerminalDecider) => void) | null = null;
  let refused: ((failure: Failure) => void) | null = null;
  let open: (() => void) | null = null;
  let held: Subscribed | null = null;
  const client = {
    'terminal.grid.subscribe': (payload: Subscribed) => {
      subscribed.push(payload);
      held = payload;
      return payload;
    },
    'terminal.grid.report': (payload: { readonly box: TerminalBox }) => {
      reported.push(payload.box);
      return answer(payload.box);
    },
  };
  const live = {
    hold: (opening: (client: unknown) => unknown, onItem: (frame: TerminalDecider) => void, onFailure: (failure: Failure) => void) => {
      open = () => opening(client);
      open();
      heard = onItem;
      refused = onFailure;
      const standing = held;
      return {
        unsubscribe: () => {
          if (held === standing) held = null;
        },
      };
    },
    call: (work: (client: unknown) => Promise<unknown>) => work(client),
  } as unknown as LiveConnection;
  return {
    live,
    subscribed,
    reported,
    get held() {
      return held;
    },
    decide: (decider: string | null) => heard?.({ decider, applied: { rows: 24, columns: 80 } } as TerminalDecider),
    reopen: () => open?.(),
    refuse: () => {
      held = null;
      refused?.({ kind: 'subscription', message: 'the grid of this execution could not be followed' });
    },
  };
};

const viewOver = (wire: ReturnType<typeof wireOver>, ceiling: Grid | null = null) => {
  const drawn: Grid[] = [];
  const waits: (() => void)[] = [];
  let recorded: Grid | null = null;
  const grid = new ViewGrid(
    wire.live,
    1,
    VIEW,
    (box) => drawn.push(box),
    () => recorded,
    () => undefined,
    () => ceiling,
    () => new Promise<void>((done) => waits.push(done)),
  );
  const record = (laid: Grid) => {
    recorded = laid;
    grid.laid();
  };
  return { grid, drawn, waits, record };
};

test('even the decider draws each recorded grid only when the byte reader reaches it', () => {
  const wire = wireOver();
  const view = viewOver(wire);
  view.grid.follow(ADDRESS);
  view.record({ rows: 24, columns: 80 });
  view.grid.measured({ rows: 30, columns: 100 });
  wire.decide(VIEW);
  view.grid.measured({ rows: 32, columns: 110 });
  view.record({ rows: 24, columns: 80 });
  view.record({ rows: 30, columns: 100 });
  wire.reopen();
  wire.decide(null);
  expect(view.drawn).toEqual([
    { rows: 24, columns: 80 },
    { rows: 24, columns: 80 },
    { rows: 30, columns: 100 },
  ]);
});

test('a box past the ceiling reports the ceiling without changing the recorded geometry', async () => {
  const wire = wireOver();
  const view = viewOver(wire, { rows: 50, columns: 160 });
  view.grid.follow(ADDRESS);
  wire.decide(VIEW);
  view.grid.measured({ rows: 60, columns: 320 });
  await settled();
  expect(wire.reported).toEqual([{ rows: 50, columns: 160 }]);
  expect(view.drawn).toEqual([]);
});

test('a box the server heard is not told twice, and a new box is told once', async () => {
  const wire = wireOver();
  const view = viewOver(wire);
  view.grid.follow(ADDRESS);
  view.grid.measured({ rows: 30, columns: 100 });
  await settled();
  view.grid.measured({ rows: 30, columns: 100 });
  view.grid.measured({ rows: 31, columns: 101 });
  await settled();
  await settled();
  expect(wire.reported).toEqual([
    { rows: 30, columns: 100 },
    { rows: 31, columns: 101 },
  ]);
});

test('a report the server refused rides a fresh subscription carrying the box instead', async () => {
  let first = true;
  const wire = wireOver(() => {
    if (!first) return Promise.resolve({ acknowledged: true });
    first = false;
    return Promise.reject({ code: 'terminal-view-unknown', reason: 'view view-1 holds no grid subscription on this connection' });
  });
  const view = viewOver(wire);
  view.grid.follow(ADDRESS);
  view.grid.measured({ rows: 30, columns: 100 });
  await settled();
  await settled();
  expect(wire.subscribed.map((held) => held.box)).toEqual([undefined, { rows: 30, columns: 100 }]);
  expect(wire.reported).toEqual([{ rows: 30, columns: 100 }]);
});

test('a refused grid keeps recovering without another measurement or a frame, and stopping ends recovery', async () => {
  const wire = wireOver();
  const view = viewOver(wire);
  const box = { rows: 30, columns: 100 };
  view.grid.measured(box);
  view.grid.follow(ADDRESS);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    wire.refuse();
    expect(wire.held).toBeNull();
    view.waits.shift()?.();
    await settled();
    expect(wire.held?.box).toEqual(box);
  }
  wire.refuse();
  view.grid.stop();
  view.waits.shift()?.();
  await settled();
  expect(wire.held).toBeNull();
});
