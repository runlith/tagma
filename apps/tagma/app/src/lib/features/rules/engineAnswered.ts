import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { RulesRepo } from './Repo.js';

export const useEngineAnswered = (read: () => BlockRead | null): (() => boolean) => {
  const tags = TagCatalog.use();
  const repo = RulesRepo.use();
  return () => {
    const rule = read();
    if (rule === null || !tags.enforced(rule)) return true;
    const first = repo.engine.key({ rule: rule.identity, focus: null });
    return first.data !== undefined || first.error !== undefined;
  };
};
