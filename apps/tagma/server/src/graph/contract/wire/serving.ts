import type { ProjectRow, StorageMode } from '../../../projects/contract/wire/project.js';

export type GraphPolicy = {
  readonly strictProvenance: boolean;
  readonly private: boolean;
  readonly storage: StorageMode;
  readonly graphRemote: string | null;
};

export type ProjectPolicyRow = ProjectRow & GraphPolicy;

export type AdmittedProject = ProjectPolicyRow & { readonly returned: boolean };
