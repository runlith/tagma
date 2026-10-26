import type { PlatformFetch } from '@runlith/layer/Platform';
import { makeRouter } from '@runlith/layer/testing';
import { Door } from './Door.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

export const TEST_ORIGIN = 'http://localhost';

const noServer: PlatformFetch = () => Promise.reject(new Error('This test named no server.'));

export function testDoor(fetch: PlatformFetch = noServer): Door {
  return new Door(fetch, new ServerOrigin(TEST_ORIGIN), makeRouter());
}
