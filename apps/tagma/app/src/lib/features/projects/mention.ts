import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { projectMention } from '@tagma/server/projects/contract/wire/references';
import type { Mention } from '$lib/features/threads/MentionDrops.svelte.js';

export function mentionOf(project: Project): Mention {
  return { name: projectMention(project.id), title: project.name };
}
