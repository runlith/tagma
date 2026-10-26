import { expect, test } from 'bun:test';
import { instantOf, recordConsole } from './serveRecord.js';

const STAMPED = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}) \[pid (\d+)\] /;

test('an instant names its date, time and offset, and reads back as the same moment', () => {
  for (const at of [
    new Date(Date.UTC(2026, 8, 25, 23, 18, 23, 11)),
    new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0)),
    new Date(Date.UTC(2026, 6, 1, 12, 30, 5, 999)),
  ]) {
    const instant = instantOf(at);
    expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(instant).getTime()).toBe(at.getTime());
  }
});

test('every line a recorded console prints carries the instant and the pid, whichever printer wrote it', () => {
  const printed: { readonly to: 'out' | 'err'; readonly text: string }[] = [];
  const target = {
    log: (...args: unknown[]) => printed.push({ to: 'out', text: String(args[1] ?? args[0]) }),
    info: (..._args: unknown[]) => undefined,
    debug: (..._args: unknown[]) => undefined,
    warn: (..._args: unknown[]) => undefined,
    error: (...args: unknown[]) => printed.push({ to: 'err', text: String(args[1] ?? args[0]) }),
  };
  const at = new Date(Date.UTC(2026, 8, 25, 23, 18, 23, 11));
  recordConsole(target, 4242, () => at);

  target.log('[01:18:23.011] INFO (#1) http.span=2ms:', 'Sent HTTP response', { 'http.url': '/api/x', 'http.status': 200 });
  target.info('%d%% of %s', 50, 'the tree');
  target.debug('quiet');
  target.warn('[sqlite] a statement has been running 5s');
  target.error('the thread floor did not settle', new Error('first line\nsecond line'));

  expect(printed.map((one) => one.to)).toEqual(['out', 'out', 'out', 'err', 'err']);
  const lines = printed.flatMap((one) => one.text.split('\n'));
  expect(lines.length).toBeGreaterThan(printed.length);
  for (const line of lines) {
    const stamp = STAMPED.exec(line);
    expect(stamp?.[2]).toBe('4242');
    expect(new Date(stamp?.[1] ?? '').getTime()).toBe(at.getTime());
  }
  expect(printed[0]?.text.split('\n')).toHaveLength(1);
  expect(printed[1]?.text).toContain('50% of the tree');
});
