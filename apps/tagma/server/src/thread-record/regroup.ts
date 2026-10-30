import type { ThreadFolder } from './contract/wire/folder.js';

export type HeldFolder = ThreadFolder & { readonly memberId: number | null };

export type FiledRoot = { readonly threadId: string; readonly folderId: string; readonly home: number | null };

export type PlacedFolder = {
  readonly id: string;
  readonly ownerId: number;
  readonly parentId: string | null;
  readonly position: number;
  readonly memberId: number | null;
};

export type CopiedFolder = PlacedFolder & { readonly name: string };

export type Refiled = { readonly threadId: string; readonly folderId: string };

export type FolderPlan = {
  readonly placed: readonly PlacedFolder[];
  readonly copied: readonly CopiedFolder[];
  readonly refiled: readonly Refiled[];
};

type Arrivals = {
  next(ownerId: number): number;
};

const arrivals = (standing: ReadonlyMap<number, number>): Arrivals => {
  const taken = new Map(standing);
  return {
    next: (ownerId) => {
      const position = taken.get(ownerId) ?? 0;
      taken.set(ownerId, position + 1);
      return position;
    },
  };
};

const bySlot = (a: HeldFolder, b: HeldFolder): number => a.position - b.position || (a.id < b.id ? -1 : 1);

const childrenOf = (folders: readonly HeldFolder[]): ReadonlyMap<string, readonly HeldFolder[]> => {
  const children = new Map<string, HeldFolder[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId);
    if (siblings === undefined) children.set(folder.parentId, [folder]);
    else siblings.push(folder);
  }
  for (const siblings of children.values()) siblings.sort(bySlot);
  return children;
};

const ordered = (folders: readonly HeldFolder[], children: ReadonlyMap<string, readonly HeldFolder[]>): readonly HeldFolder[] => {
  const known = new Set(folders.map((folder) => folder.id));
  const tops = folders.filter((folder) => folder.parentId === null || !known.has(folder.parentId)).sort(bySlot);
  const walked: HeldFolder[] = [];
  const visit = (folder: HeldFolder): void => {
    walked.push(folder);
    for (const child of children.get(folder.id) ?? []) visit(child);
  };
  for (const top of tops) visit(top);
  return walked;
};

const memberOf = (folder: HeldFolder, members: readonly number[], held: ReadonlySet<number>): number | null => {
  if (folder.memberId !== null && members.includes(folder.memberId)) return folder.memberId;
  return members.find((member) => held.has(member)) ?? members[0] ?? folder.memberId;
};

export const absorbFolders = (input: {
  readonly groupId: number;
  readonly entering: readonly { readonly memberId: number; readonly folders: readonly HeldFolder[] }[];
  readonly standing: ReadonlyMap<number, number>;
}): readonly PlacedFolder[] => {
  const tops = arrivals(input.standing);
  return input.entering.flatMap(({ memberId, folders }) => {
    const known = new Set(folders.map((folder) => folder.id));
    return ordered(folders, childrenOf(folders)).map((folder) => {
      const top = folder.parentId === null || !known.has(folder.parentId);
      return {
        id: folder.id,
        ownerId: input.groupId,
        parentId: top ? null : folder.parentId,
        position: top ? tops.next(input.groupId) : folder.position,
        memberId,
      };
    });
  });
};

export const partFolders = (input: {
  readonly groupId: number;
  readonly members: readonly number[];
  readonly folders: readonly HeldFolder[];
  readonly filed: readonly FiledRoot[];
  readonly standing: ReadonlyMap<number, number>;
  readonly newId: () => string;
}): FolderPlan => {
  const { groupId, members } = input;
  const ownerOf = (home: number): number => (members.includes(home) ? groupId : home);
  const children = childrenOf(input.folders);
  const walked = ordered(input.folders, children);
  const byId = new Map(walked.map((folder) => [folder.id, folder] as const));
  const filedIn = new Map<string, FiledRoot[]>();
  for (const root of input.filed) filedIn.set(root.folderId, [...(filedIn.get(root.folderId) ?? []), root]);

  const needers = new Map<string, Set<number>>();
  const homes = new Map<string, Set<number>>();
  for (const folder of [...walked].reverse()) {
    const need = new Set<number>();
    const held = new Set<number>();
    for (const root of filedIn.get(folder.id) ?? []) {
      need.add(root.home === null ? groupId : ownerOf(root.home));
      if (root.home !== null) held.add(root.home);
    }
    for (const child of children.get(folder.id) ?? []) {
      for (const owner of needers.get(child.id) ?? []) need.add(owner);
      for (const home of homes.get(child.id) ?? []) held.add(home);
    }
    if (held.size === 0) need.add(folder.memberId === null ? groupId : ownerOf(folder.memberId));
    needers.set(folder.id, need);
    homes.set(folder.id, held);
  }

  const tops = arrivals(input.standing);
  const at = new Map<string, Map<number, string>>();
  const placed: PlacedFolder[] = [];
  const copied: CopiedFolder[] = [];
  const refiled: Refiled[] = [];
  for (const folder of walked) {
    const need = needers.get(folder.id) as Set<number>;
    const parent = folder.parentId === null ? undefined : byId.get(folder.parentId);
    const keeper = need.has(groupId)
      ? groupId
      : folder.memberId !== null && need.has(folder.memberId)
        ? folder.memberId
        : Math.min(...need);
    const places = new Map<number, string>();
    at.set(folder.id, places);
    for (const ownerId of [keeper, ...[...need].filter((one) => one !== keeper).sort((a, b) => a - b)]) {
      const parentId = parent === undefined ? null : (at.get(parent.id)?.get(ownerId) ?? null);
      const top = parentId === null;
      const position = top && ownerId !== groupId ? tops.next(ownerId) : folder.position;
      const memberId = ownerId === groupId ? memberOf(folder, members, homes.get(folder.id) as Set<number>) : null;
      if (ownerId === keeper) {
        places.set(ownerId, folder.id);
        if (ownerId === groupId && parentId === folder.parentId && memberId === folder.memberId) continue;
        placed.push({ id: folder.id, ownerId, parentId, position, memberId });
      } else {
        const id = input.newId();
        places.set(ownerId, id);
        copied.push({ id, ownerId, parentId, position, memberId, name: folder.name });
      }
    }
    for (const root of filedIn.get(folder.id) ?? []) {
      const ownerId = root.home === null ? groupId : ownerOf(root.home);
      if (ownerId !== keeper) refiled.push({ threadId: root.threadId, folderId: places.get(ownerId) as string });
    }
  }
  return { placed, copied, refiled };
};
