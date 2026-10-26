import type { Door } from '$lib/wire/Door.js';

export const savedAddress = (door: Door, path: string, name: string): string =>
  door.address((routes) => routes.checkouts.preview({ query: { path, full: 'true', save: name } }));
