import { ARTIFACT_PREFIX } from '@tagma/server/http/contract/wire/served';
import { onLoopback, type ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import type { LinkPort } from '$lib/shared/ExternalLinks.js';

export function reachArtifacts(origin: ServerOrigin, links: LinkPort): () => void {
  const here = origin.http;
  if (origin.local) return () => undefined;
  const reach = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (link === null) return;
    const url = new URL(link.href, here);
    if (url.origin === here || !onLoopback(url.hostname) || !url.pathname.startsWith(ARTIFACT_PREFIX)) return;
    event.preventDefault();
    links.open(`${here}${url.pathname}${url.search}${url.hash}`);
  };
  document.addEventListener('click', reach, true);
  return () => document.removeEventListener('click', reach, true);
}
