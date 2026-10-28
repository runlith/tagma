import { expect, test } from 'bun:test';
import { account, type Capture } from './trace';

test('main-thread accounting partitions nested script, layout and paint without double counting', () => {
  const event = (name: string, start: number, duration: number, tid = 1) => ({
    name,
    ph: 'X',
    pid: 1,
    tid,
    ts: start * 1000,
    dur: duration * 1000,
  });
  const trace: Capture<null> = {
    result: null,
    marker: 'clock',
    markerTime: 0,
    events: [
      event('clock', 0, 0),
      event('RunTask', 0, 20),
      event('FunctionCall', 1, 12),
      event('FunctionCall', 2, 10),
      event('Layout', 4, 3),
      event('Paint', 7, 2),
      event('RunTask', 0, 20, 2),
    ],
  };
  const result = account(trace, [0, 10, 20], 10);
  expect(result.frames).toEqual([
    { time: 0, interval: 10, script: 4, layout: 3, paint: 2, other: 1, total: 10 },
    { time: 10, interval: 10, script: 3, layout: 0, paint: 0, other: 7, total: 10 },
  ]);
});
