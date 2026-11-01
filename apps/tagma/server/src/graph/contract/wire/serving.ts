import type { ProjectRow, StorageMode } from '../../../projects/contract/wire/project.js';

export type GraphPolicy = {
  readonly strictProvenance: boolean;
  readonly private: boolean;
  readonly storage: StorageMode;
};

export type ProjectPolicyRow = ProjectRow & GraphPolicy;

export type AdmittedProject = ProjectPolicyRow & { readonly returned: boolean };
