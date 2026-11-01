import { expect, test } from 'bun:test';
import { launchGate, LAUNCH_REFUSALS_BEFORE_BLOCK } from './LaunchGate';

test('launch class changes are observed after the mutator and detach with their subscription', () => {
  const gate = launchGate();
  const seen: boolean[] = [];
  const stop = gate.subscribe((change) => {
    expect(change.blocked).toBe(gate.blocked(change.threadId));
    seen.push(change.blocked);
  });
  for (let count = 1; count < LAUNCH_REFUSALS_BEFORE_BLOCK; count++) gate.refused('thread');
  expect(seen).toEqual([]);
  gate.refused('thread');
  gate.refused('thread');
  gate.confirmed('thread');
  gate.refused('thread', true);
  gate.lift('thread');
  expect(seen).toEqual([true, false, true, false]);
  stop();
  gate.refused('thread', true);
  expect(gate.blocked('thread')).toBe(true);
  expect(seen).toEqual([true, false, true, false]);
});
