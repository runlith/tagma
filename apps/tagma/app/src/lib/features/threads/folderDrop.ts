import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { folderSubtrees } from './tree.js';

export type FolderPlace = { readonly parentId: string | null; readonly index: number };

export type FolderHover =
  | { readonly kind: 'before'; readonly folderId: string }
  | { readonly kind: 'into'; readonly folderId: string }
  | { readonly kind: 'root' };

function siblingsOf(folders: readonly ThreadFolder[], parentId: string | null): readonly ThreadFolder[] {
  const known = new Set(folders.map((folder) => folder.id));
  return folders.filter((folder) => (folder.parentId !== null && known.has(folder.parentId) ? folder.parentId : null) === parentId);
}

export function lineageOf(folders: readonly ThreadFolder[], folderId: string | null): ReadonlySet<string> {
  const lineage = new Set<string>();
  for (let at = folderId; at !== null && !lineage.has(at);) {
    lineage.add(at);
    at = folders.find((folder) => folder.id === at)?.parentId ?? null;
  }
  return lineage;
}

export function placeOf(folders: readonly ThreadFolder[], folderId: string): FolderPlace | null {
  const folder = folders.find((held) => held.id === folderId);
  if (folder === undefined) return null;
  const parentId = folder.parentId !== null && folders.some((held) => held.id === folder.parentId) ? folder.parentId : null;
  return { parentId, index: siblingsOf(folders, parentId).findIndex((held) => held.id === folderId) };
}

export function placeFolder(folders: readonly ThreadFolder[], carriedId: string, hover: FolderHover): FolderPlace | null {
  const current = placeOf(folders, carriedId);
  if (current === null) return null;
  const inside = folderSubtrees(folders, [carriedId]);
  const without = (parentId: string | null) => siblingsOf(folders, parentId).filter((folder) => folder.id !== carriedId);
  let place: FolderPlace;
  if (hover.kind === 'root') place = { parentId: null, index: without(null).length };
  else if (inside.has(hover.folderId)) return null;
  else if (hover.kind === 'into') place = { parentId: hover.folderId, index: without(hover.folderId).length };
  else {
    const target = folders.find((folder) => folder.id === hover.folderId);
    if (target === undefined) return null;
    const parentId = placeOf(folders, target.id)?.parentId ?? null;
    place = { parentId, index: without(parentId).findIndex((folder) => folder.id === target.id) };
  }
  return place.parentId === current.parentId && place.index === current.index ? null : place;
}
