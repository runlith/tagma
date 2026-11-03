export const GLOBAL_PROJECT = { name: 'global', repoKey: 'global', rootDirName: 'global' } as const;

export const STORAGE_MODES = ['stealth', 'team'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const PROJECT_KINDS = ['folder', 'global', 'group'] as const;
type ProjectKind = (typeof PROJECT_KINDS)[number];

export type ProjectIdentity = {
  readonly repoKey: string | null;
  readonly rootPath: string;
  readonly gitDir: string | null;
};

export type ProjectPlace = {
  readonly cwd: string;
  readonly identity: ProjectIdentity;
};

export type ProjectRef = {
  readonly id: number;
  readonly name: string;
};

export type ProjectCaller = {
  readonly project: ProjectRef;
};

export type ProjectRefusal = 'unknown-project' | 'ambiguous-project' | 'not-found';

export type ProjectRootFailure = 'relative-root' | 'missing-root' | 'unwritable-root';

export type ProjectRow = {
  readonly id: number;
  readonly name: string;
  readonly repoKey: string;
  readonly rootPath: string;
  readonly createdAt: Date;
  readonly kind: ProjectKind;
};

export type Registered = { readonly project: ProjectRow; readonly returned: boolean };

export const GROUP_SHARES = ['map', 'law', 'skills'] as const;
export type GroupShare = (typeof GROUP_SHARES)[number];

export type MemberSharing = { readonly gives: readonly GroupShare[]; readonly takes: readonly GroupShare[] };

export const FULL_SHARING: MemberSharing = { gives: GROUP_SHARES, takes: GROUP_SHARES };

export type ProjectGroup = {
  readonly graph: ProjectRow;
  readonly members: readonly ProjectRow[];
  readonly sharing: ReadonlyMap<number, MemberSharing>;
};

export const sharingOf = (group: ProjectGroup, projectId: number): MemberSharing => group.sharing.get(projectId) ?? FULL_SHARING;

export const reaching = (group: ProjectGroup, projectId: number, share: GroupShare): readonly ProjectRow[] =>
  sharingOf(group, projectId).takes.includes(share)
    ? group.members.filter((member) => member.id !== projectId && sharingOf(group, member.id).gives.includes(share))
    : [];

export type FormedGroup = { readonly group: ProjectGroup; readonly returned: boolean };

export type DepartedGroup = { readonly from: ProjectGroup; readonly rest: ProjectGroup | null };

export type SharingChange = { readonly gives?: readonly GroupShare[] | undefined; readonly takes?: readonly GroupShare[] | undefined };

export type SharedGroup = { readonly from: MemberSharing; readonly group: ProjectGroup };

export type FormRefusal = 'grouped' | 'ungroupable' | 'group-size' | 'not-found' | 'unwritable-root';

export type JoinRefusal = 'grouped' | 'ungroupable' | 'not-a-group' | 'not-found';

export type NameRefusal = 'reserved-project' | 'project-name' | 'duplicate-name';
