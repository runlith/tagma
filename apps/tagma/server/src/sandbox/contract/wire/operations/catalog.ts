import { GUEST_OPERATIONS as GUEST } from './guest.js';
import { TREE_OPERATIONS as TREE } from './tree.js';

export const SANDBOX_OPERATIONS = {
  prepare_sandbox: GUEST.prepare_sandbox,
  build_prepared_tree: TREE.build_prepared_tree,
  read_prepared_tree: TREE.read_prepared_tree,
  release_prepared_tree: TREE.release_prepared_tree,
  import_output: GUEST.import_output,
  read_sandbox: GUEST.read_sandbox,
  release_sandbox: GUEST.release_sandbox,
};

export type SandboxOperationId = keyof typeof SANDBOX_OPERATIONS;
export const SANDBOX_OPERATION_IDS = Object.keys(SANDBOX_OPERATIONS) as readonly SandboxOperationId[];
