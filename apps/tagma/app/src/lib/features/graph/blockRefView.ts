import { blockAddress } from '@tagma/server/graph/contract/wire/references';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { BlockLens } from '$lib/features/workspace/address.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import type { Refusal } from '$lib/wire/refusal.js';
import type { GraphLens } from '$lib/features/workspace/GraphDoor.js';

export type BlockPlace = { readonly projectId: number; readonly checkout: string | null; readonly branch?: string | null };

export function placedHref(
  addresses: Addresses,
  name: string,
  place: BlockPlace,
  project: Project | null,
  diff?: string,
): string | null | undefined {
  if (project === null) return undefined;
  if (place.checkout === null) return addresses.block(name, { project: project.name, diff });
  if (place.branch !== undefined) return addresses.block(name, { project: project.name, branch: place.branch, diff });
  return place.checkout === project.rootPath ? addresses.block(name, { project: project.name, branch: null, diff }) : null;
}

export type BlockRefFailure = { readonly error: Refusal };
export type BlockRefPeer =
  | { readonly title: string; readonly project: string; readonly branch?: string | null }
  | BlockRefFailure
  | null
  | undefined;

export type BlockRefs = {
  readonly peer: (name: string) => BlockRefPeer;
  readonly open: (name: string, lens?: BlockLens) => Promise<void>;
};

export function lensOf(peer: BlockRefPeer): GraphLens | null {
  return peer == null || 'error' in peer ? null : { project: peer.project, branch: peer.branch ?? undefined };
}

export type BlockRefView = {
  readonly text: string;
  readonly title: string | null;
  readonly dead: boolean;
  readonly href: string | null;
};

const DEAD_TITLE = 'Not on this machine';

export function blockRefView(
  addresses: Addresses,
  name: string,
  label: string | null,
  peer: BlockRefPeer,
  lens: BlockLens = {},
): BlockRefView {
  const fallback = name;
  if (peer != null && 'error' in peer) {
    return { text: label ?? fallback, title: peer.error.message, dead: false, href: null };
  }
  const liveTitle = peer == null ? fallback : peer.title.trim() || fallback;
  const bare = blockAddress(name).name;
  const href =
    peer === undefined ? null : addresses.block(bare, peer === null ? lens : { ...lens, project: peer.project, branch: peer.branch });
  if (label !== null) {
    return {
      text: label,
      title: peer === undefined ? null : peer === null ? DEAD_TITLE : liveTitle,
      dead: peer === null,
      href,
    };
  }
  return {
    text: liveTitle,
    title: peer === null ? DEAD_TITLE : null,
    dead: peer === null,
    href,
  };
}
