import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

const UNJOURNALED: ReadonlySet<string> = new Set(['touch_path', 'rewrite_graph_files', 'resolve_graph_conflict']);

export const graph = {
  id: 'graph',
  title: 'The graph',
  operations: async () => {
    const [
      { READ_OPERATIONS },
      { SOURCE_OPERATIONS },
      { WRITE_OPERATIONS },
      { WORK_OPERATIONS },
      { REFLECTION_OPERATIONS },
      { TREE_OPERATIONS },
      { OUTLINE_OPERATIONS },
      { ORIENTATION_OPERATIONS },
      { HISTORY_OPERATIONS },
      { REGISTRY_OPERATIONS },
      { GROUP_OPERATIONS },
      { REFUSAL_WORDS },
    ] = await Promise.all([
      import('./operations/reads.js'),
      import('./operations/sources.js'),
      import('./operations/writes.js'),
      import('./operations/work.js'),
      import('./operations/reflections.js'),
      import('./operations/tree.js'),
      import('./operations/outline.js'),
      import('./operations/orientation.js'),
      import('./operations/history.js'),
      import('./operations/registry.js'),
      import('./operations/groups.js'),
      import('./refusalWords.js'),
    ]);
    const declarations = mergeOperations(
      READ_OPERATIONS,
      SOURCE_OPERATIONS,
      WRITE_OPERATIONS,
      WORK_OPERATIONS,
      REFLECTION_OPERATIONS,
      TREE_OPERATIONS,
      OUTLINE_OPERATIONS,
      ORIENTATION_OPERATIONS,
      HISTORY_OPERATIONS,
      REGISTRY_OPERATIONS,
      GROUP_OPERATIONS,
    );
    return { declarations, journaled: Object.keys(declarations).filter((id) => !UNJOURNALED.has(id)), refusals: REFUSAL_WORDS } as const;
  },
} as const satisfies OperationManifest;
