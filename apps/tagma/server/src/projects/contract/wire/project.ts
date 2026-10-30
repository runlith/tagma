export const GLOBAL_PROJECT = { name: 'global', repoKey: 'global', rootDirName: 'global' } as const;

export const STORAGE_MODES = ['stealth', 'team'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const PROJECT_KINDS = ['folder', 'global', 'group'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

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

export type ProjectGroup = {
  readonly graph: ProjectRow;
  readonly members: readonly ProjectRow[];
};

export type FormedGroup = { readonly group: ProjectGroup; readonly returned: boolean };

export type FormRefusal = 'grouped' | 'ungroupable' | 'group-size';

export type JoinRefusal = 'grouped' | 'ungroupable' | 'not-a-group';

export type NameRefusal = 'reserved-project' | 'project-name' | 'duplicate-name';
