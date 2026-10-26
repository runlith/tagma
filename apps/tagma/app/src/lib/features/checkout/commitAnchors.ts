import type { Attachment } from 'svelte/attachments';
import type { CommitLink, CommitLookup } from './CommitLinks.svelte.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';

export function commitAnchors(
  lookup: CommitLookup | undefined,
  addresses: Addresses,
  settled: boolean,
  linked: (anchor: HTMLAnchorElement, peer: CommitLink) => () => void,
): Attachment<HTMLElement> {
  return (root) => {
    if (lookup === undefined || !settled) return;
    let standing = true;
    const releases: (() => void)[] = [];
    for (const mark of root.querySelectorAll<HTMLElement>('[data-commit]')) {
      if ((mark.parentElement?.closest('a:not([data-commit-link])') ?? null) !== null) continue;
      void lookup.locate(mark.dataset['commit'] ?? '').then((peer) => {
        if (!standing || peer === null) return;
        if ('error' in peer) {
          mark.title = peer.error.message;
          return;
        }
        const held = mark.parentElement?.closest<HTMLAnchorElement>('a[data-commit-link]') ?? null;
        const anchor = held ?? document.createElement('a');
        if (held === null) {
          anchor.setAttribute('data-commit-link', '');
          mark.replaceWith(anchor);
          anchor.append(mark);
        }
        anchor.setAttribute('href', addresses.commit(peer.sha, peer.project));
        releases.push(linked(anchor, peer));
      });
    }
    return () => {
      standing = false;
      for (const release of releases.splice(0)) release();
    };
  };
}
