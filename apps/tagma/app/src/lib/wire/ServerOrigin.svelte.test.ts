import { expect, test } from 'vitest';
import { ServerOrigin } from './ServerOrigin.svelte.js';

const DECLARED = 'http://localhost:5634';

const declared = (page: string): ServerOrigin => {
  const origin = new ServerOrigin(page);
  origin.declare({ artifactOrigin: `${DECLARED}/`, sandboxOrigin: null });
  return origin;
};

test('a page on this machine keeps the declared artifact address; a page reached from elsewhere gets its own', () => {
  expect(declared('http://127.0.0.1:5633').artifact('http://localhost:5634/a/plan/v/3?tab=2#top')).toBe(
    'http://localhost:5634/a/plan/v/3?tab=2#top',
  );
  expect(declared('https://studio.tail4e2a.ts.net').artifact('http://localhost:5634/a/plan/v/3?tab=2#top')).toBe('/a/plan/v/3?tab=2#top');
  expect(declared('https://studio.tail4e2a.ts.net').artifact('http://localhost:5634/a/plan/v/3/video-30-2x.mp4')).toBe(
    '/a/plan/v/3/video-30-2x.mp4',
  );
});

test('anything outside the exact artifact form at the declared origin is no artifact', () => {
  const origin = declared('https://studio.tail4e2a.ts.net');
  expect(origin.artifact('http://localhost:5634/a/')).toBeNull();
  expect(origin.artifact('http://localhost:5634/a/plan/raw')).toBeNull();
  expect(origin.artifact('http://localhost:5634/a/plan/v/3/page.html')).toBeNull();
  expect(origin.artifact('http://localhost:5634/api/op/read')).toBeNull();
  expect(origin.artifact('http://localhost:56345/a/plan')).toBeNull();
  expect(origin.artifact('https://example.com/a/plan')).toBeNull();
});

test('the socket of a door reached over https is wss on the same host', () => {
  expect(new ServerOrigin('https://studio.tail4e2a.ts.net').socket('/api/socket')).toBe('wss://studio.tail4e2a.ts.net/api/socket');
});
