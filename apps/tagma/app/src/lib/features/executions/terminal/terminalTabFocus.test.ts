import { expect, test } from 'vitest';
import { focusTabSurface, refreshImeContext, type FocusHelper } from './terminalTabFocus.js';

const helperOver = (state: { connected?: boolean; active?: unknown } = {}) => {
  const events: string[] = [];
  const body = {};
  const document_ = { activeElement: (state.active ?? null) as unknown, body: body as unknown };
  const tracked: FocusHelper = {
    focus: () => {
      events.push('focus');
      document_.activeElement = tracked as unknown;
    },
    blur: () => {
      events.push('blur');
      document_.activeElement = null;
    },
    isConnected: state.connected ?? true,
    ownerDocument: document_,
  };
  return { tracked, events, body, document_ };
};

const framesOver = () => {
  const queue: (() => void)[] = [];
  return {
    queue,
    frame: (run: () => void) => queue.push(run),
    run: (count: number) => {
      for (let index = 0; index < count; index += 1) queue.shift()?.();
    },
  };
};

test('the focus lands after exactly two frames, a rename keeps it away, and macOS rebuilds the IME context', () => {
  const frames = framesOver();
  const { tracked, events } = helperOver();
  let renaming = false;
  focusTabSurface(() => tracked, { frame: frames.frame, renamingNow: () => renaming, isMac: false });
  frames.run(1);
  expect(events).toEqual([]);
  frames.run(1);
  expect(events).toEqual(['focus']);

  events.length = 0;
  renaming = true;
  focusTabSurface(() => tracked, { frame: frames.frame, renamingNow: () => renaming, isMac: false });
  frames.run(2);
  expect(events).toEqual([]);
  renaming = false;

  focusTabSurface(() => null, { frame: frames.frame, renamingNow: () => renaming, isMac: false });
  frames.run(2);
  expect(events).toEqual([]);
});

test('the IME refresh blurs and refocuses on macOS only, and never steals a claimed focus', () => {
  const { tracked, events, body } = helperOver();
  const refocus: (() => void)[] = [];
  expect(refreshImeContext(tracked, { isMac: true, schedule: (run) => refocus.push(run) })).toBe(true);
  expect(events).toEqual(['blur']);
  refocus.shift()?.();
  expect(events).toEqual(['blur', 'focus']);

  events.length = 0;
  expect(refreshImeContext(tracked, { isMac: false, schedule: (run) => refocus.push(run) })).toBe(false);
  expect(events).toEqual([]);
  expect(refocus).toEqual([]);

  const claimed = {};
  const claimedHelper = helperOver();
  const skipped: unknown[] = [];
  let refocusClaimed: (() => void) | undefined;
  expect(
    refreshImeContext(claimedHelper.tracked, {
      isMac: true,
      schedule: (run) => (refocusClaimed = run),
      onRefocusSkipped: (active) => skipped.push(active),
    }),
  ).toBe(true);
  expect(claimedHelper.events).toEqual(['blur']);
  claimedHelper.document_.activeElement = claimed;
  refocusClaimed?.();
  expect(claimedHelper.events).toEqual(['blur']);
  expect(skipped).toEqual([claimed]);
});
