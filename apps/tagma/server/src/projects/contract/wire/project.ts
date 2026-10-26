export const GLOBAL_PROJECT = { name: 'global', repoKey: 'global', rootDirName: 'global' } as const;

export const STORAGE_MODES = ['stealth', 'team'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

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
  readonly global: boolean;
};

export type Registered = { readonly project: ProjectRow; readonly returned: boolean };
