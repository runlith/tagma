import { createHash } from 'node:crypto';
import type { TagPrompt } from '../contract/service/orientation.js';
import type { InstructionSet } from '../contract/wire/instructions.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { tagPromptOf } from '../voice/tags.js';

export function textRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const prompts = new WeakMap<TagTable, Map<number, Map<string, TagPrompt>>>();

export const tagPrompts = (table: TagTable, projectId: number, ids: Iterable<string>): TagPrompt[] => {
  const projects = prompts.get(table) ?? new Map<number, Map<string, TagPrompt>>();
  prompts.set(table, projects);
  const known = projects.get(projectId) ?? new Map<string, TagPrompt>();
  projects.set(projectId, known);
  return [...new Set(ids)].flatMap((id) => {
    const held = known.get(id);
    if (held !== undefined) return [held];
    const tag = table.tagById(id);
    if (tag === null) return [];
    const prompt = {
      id: tag.id,
      name: tag.name,
      prompt: tagPromptOf(table, tag),
      identity: `${projectId}:${tag.id}@${textRevision(JSON.stringify(tag))}`,
    };
    known.set(id, prompt);
    return [prompt];
  });
};

export type PromptDelivery = { readonly text: string | null; readonly delivered: readonly string[] };

export function includeInstructions(delivered: Set<string>, snapshot: InstructionSet): void {
  for (const entry of snapshot.entries) {
    if (entry.kind === 'tag') delivered.add(`${snapshot.projectId}:${entry.source.slice(1)}@${entry.revision}`);
  }
}

export const tagPromptText = (prompts: readonly TagPrompt[], delivered: ReadonlySet<string>): PromptDelivery => {
  const fresh = prompts.filter((tag) => !delivered.has(tag.identity));
  if (fresh.length === 0) return { text: null, delivered: [] };
  return {
    text: ['Tag prompts for nodes this delivery reached:', ...fresh.map((tag) => `#${tag.name ?? tag.id}\n${tag.prompt}`)].join('\n\n'),
    delivered: fresh.map((tag) => tag.identity),
  };
};

export const appendTagPrompts = (
  text: string,
  table: TagTable,
  projectId: number,
  ids: Iterable<string>,
  delivered?: ReadonlySet<string>,
): { readonly text: string; readonly delivered: readonly string[] } => {
  if (delivered === undefined) return { text, delivered: [] };
  const prompts = tagPromptText(tagPrompts(table, projectId, ids), delivered);
  return prompts.text === null ? { text, delivered: [] } : { text: `${text}\n\n${prompts.text}`, delivered: prompts.delivered };
};
