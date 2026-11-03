import type { BlockSection } from '$lib/features/graph/block/sections.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { RulesRepo } from './Repo.js';
import RulePanel from './RulePanel.svelte';

export const blockSections: readonly BlockSection[] = [
  {
    id: 'rule',
    order: 0,
    payload: { component: RulePanel },
    ready: (app) => {
      const tags = app.resolve(TagCatalog);
      const repo = app.resolve(RulesRepo);
      return (read) => {
        if (!tags.enforced(read)) return true;
        const first = repo.engine.key({ rule: read.identity, focus: null });
        return first.data !== undefined || first.error !== undefined;
      };
    },
  },
];
