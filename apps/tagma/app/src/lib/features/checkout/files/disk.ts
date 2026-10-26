import type { Door } from '$lib/wire/Door.js';

export const diskAddress = (door: Door, path: string): string =>
  door.address((routes) => routes.checkouts.preview({ query: { path, full: 'true' } }));
