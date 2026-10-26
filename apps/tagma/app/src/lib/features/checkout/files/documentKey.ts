import type { RootId } from '@tagma/server/workspace/contract/wire/ids';

//! rootId null: the path is absolute on the server's disk, outside every checkout of the project.
export type DocumentPlace = { readonly projectId: number; readonly rootId: RootId | null };

export const documentKey = (place: DocumentPlace, path: string): string => `${place.projectId}\u0000${place.rootId ?? ''}\u0000${path}`;

export const within = (path: string, under: string): boolean => path === under || path.startsWith(`${under}/`);
