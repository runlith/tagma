import { join, resolve } from 'node:path';
import type { WorkspaceBindings } from '@runlith/agent-tools/workspace';
import { witnessTuple } from '@runlith/files/witness';
import { encodeBinding as encode, type WorkingRoot } from '../contract/wire/place.js';
import { under } from './proof.js';

export function workingBindings(root: WorkingRoot | null, spelling: string): WorkspaceBindings {
  if (root === null) return { of: () => null };
  const base: readonly string[] = [
    'file',
    root.environment.environmentId,
    root.environment.kind,
    root.environment.namespaceId,
    ...witnessTuple(root.environment.identityWitness),
    root.root.path,
    ...witnessTuple(root.witness),
  ];
  return {
    of: (target, real) => {
      const at = resolve(target);
      const inside = under(resolve(spelling), at) ?? under(root.root.path, at);
      const address = inside === null ? at : join(root.root.path, inside);
      if (real !== address) return null;
      return encode([...base, root.root.namespaceId, address]);
    },
  };
}
