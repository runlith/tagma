import { expect, test } from 'bun:test';
import { askFrame, guestFailure, GuestFrames } from './wire.js';

const encoder = new TextEncoder();

function answerBytes(header: Record<string, unknown>, payload: Uint8Array): Uint8Array {
  const line = encoder.encode(`${JSON.stringify({ ...header, bytes: payload.length > 0 ? payload.length : undefined })}\n`);
  const framed = new Uint8Array(line.length + payload.length);
  framed.set(line, 0);
  framed.set(payload, line.length);
  return framed;
}

test('a frame arrives whole however the pipe split it', () => {
  const payload = encoder.encode('first line\nsecond line\nthird\n');
  const bytes = answerBytes({ id: 7, ok: true }, payload);
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const reader = new GuestFrames();
    const early = reader.read(bytes.subarray(0, cut));
    const late = reader.read(bytes.subarray(cut));
    const frames = [...early, ...late];
    expect(frames.length, `split at ${cut}`).toBe(1);
    expect(frames[0]?.id).toBe(7);
    expect(frames[0]?.ok).toBe(true);
    expect(new TextDecoder().decode(frames[0]?.payload)).toBe('first line\nsecond line\nthird\n');
  }
});

test('several answers in one arrival are all delivered, in order', () => {
  const reader = new GuestFrames();
  const one = answerBytes({ id: 1, ok: true, path: '/work' }, new Uint8Array(0));
  const two = answerBytes({ id: 2, ok: false, error: { code: 'ENOENT' } }, new Uint8Array(0));
  const three = answerBytes({ id: 3, ok: true }, encoder.encode('bytes'));
  const together = new Uint8Array(one.length + two.length + three.length);
  together.set(one, 0);
  together.set(two, one.length);
  together.set(three, one.length + two.length);
  const frames = reader.read(together);
  expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3]);
  expect(frames[0]?.value.path).toBe('/work');
  expect(frames[1]?.ok).toBe(false);
  expect(new TextDecoder().decode(frames[2]?.payload)).toBe('bytes');
});

test('a request carries its payload after a header that declares the length', () => {
  const payload = encoder.encode('content with a \n newline');
  const framed = askFrame(4, { op: 'writeFile', path: '/work/a.txt', flag: 'w' }, payload);
  const separator = framed.indexOf(0x0a);
  const header = JSON.parse(new TextDecoder().decode(framed.subarray(0, separator))) as Record<string, unknown>;
  expect(header).toEqual({ id: 4, op: 'writeFile', path: '/work/a.txt', flag: 'w', bytes: payload.length });
  expect(framed.subarray(separator + 1)).toEqual(payload);
});

test('a guest errno becomes the platform failure the filesystem contract declares', () => {
  const missing = guestFailure('readFile', '/work/gone.txt', {
    code: 'ENOENT',
    message: 'no such file',
    syscall: 'open',
  });
  expect(missing.reason._tag).toBe('NotFound');
  expect(missing.reason.method).toBe('readFile');
  const refused = guestFailure('writeFile', '/work/ro.txt', { code: 'EACCES', message: 'permission denied' });
  expect(refused.reason._tag).toBe('PermissionDenied');
  const strange = guestFailure('stat', '/work', { code: 'ENOTRECOVERABLE', message: 'odd' });
  expect(strange.reason._tag).toBe('Unknown');
});

test('a guest failure carries the errno itself, so a caller can tell a kind from a fault', () => {
  const notALink = guestFailure('readLink', '/work/plain.ts', {
    code: 'EINVAL',
    message: 'invalid argument',
    syscall: 'readlink',
  });
  expect(notALink.reason._tag).toBe('Unknown');
  expect((notALink.reason.cause as { code?: string }).code).toBe('EINVAL');

  const unreadable = guestFailure('readLink', '/work/closed/link.ts', { code: 'EACCES', message: 'denied' });
  expect((unreadable.reason.cause as { code?: string }).code).toBe('EACCES');
  expect(unreadable.reason._tag).toBe('PermissionDenied');
});
