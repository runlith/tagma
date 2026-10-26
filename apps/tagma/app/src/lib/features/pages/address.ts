import type { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';

export type DoorAddress = { readonly src: string; readonly href: string };

export function doorAddress(server: ServerOrigin, url: string): DoorAddress | null {
  const src = server.artifact(url);
  return src === null ? null : { src, href: new URL(src, server.http).href };
}
