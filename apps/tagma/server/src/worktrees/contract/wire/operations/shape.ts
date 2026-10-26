const DECLARED = {
  doors: { http: true },
  tool: { capability: 'worktrees', needs: ['shared'] },
  callers: 'any',
  subject: 'none',
  place: 'project',
  graph: 'none',
  waits: [],
  lifetimes: [],
} as const;

export const WORKTREE_READ = { ...DECLARED, effect: 'read', identity: 'none' } as const;

export const WORKTREE_WRITE = { ...DECLARED, effect: 'write', identity: { key: 'call' } } as const;
