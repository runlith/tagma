import type { ProjectRow, StorageMode } from '../../../projects/contract/wire/project.js';

export type ProjectPolicyRow = ProjectRow & {
  readonly strictProvenance: boolean;
  readonly private: boolean;
  readonly storage: StorageMode;
  readonly graphRemote: string | null;
};

export type AdmittedProject = ProjectPolicyRow & { readonly returned: boolean };
