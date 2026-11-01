import { createHash } from 'node:crypto';
import { canonicalJson } from '@runlith/utils/object';
import type { Tag } from '../contract/wire/tags/declaration.js';
import type { TagPrompt } from '../contract/service/orientation.js';
import type { Instruction, InstructionSet } from '../contract/wire/instructions.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { tagPromptOf } from '../voice/tags.js';

export function textRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function tagRevision(tag: Tag): string {
  return textRevision(canonicalJson(tag));
}

const legacyRevisions = (tag: Tag): string[] => [
  textRevision(JSON.stringify(tag)),
  textRevision(
    JSON.stringify({ ...tag, fields: Object.fromEntries(Object.entries(tag.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }),
  ),
];

export function matchesLegacyTag(table: TagTable, id: string, entry: Instruction): boolean {
  const tag = table.tagById(id);
  const line = entry.text.split('\n').findLast((part) => part.startsWith('fields: '));
  if (tag === null || line === undefined) return false;
  const names = new Map(Object.keys(tag.fields).map((key) => [table.fieldNameOf(id, key), key]));
  if (names.size !== Object.keys(tag.fields).length) return false;
  const fields: [string, Tag['fields'][string]][] = [];
  let at = 'fields: '.length;
  while (at < line.length) {
    const open = line.indexOf(' (', at);
    if (open < 0) return false;
    const key = names.get(line.slice(at, open));
    if (key === undefined || tag.fields[key] === undefined) return false;
    fields.push([key, tag.fields[key]]);
    names.delete(line.slice(at, open));
    let depth = 1;
    let quote = false;
    let escaped = false;
    at = open + 2;
    while (at < line.length && depth > 0) {
      const char = line[at++]!;
      if (escaped) escaped = false;
      else if (quote && char === '\\') escaped = true;
      else if (char === '"') quote = !quote;
      else if (!quote && char === '(') depth += 1;
      else if (!quote && char === ')') depth -= 1;
    }
    if (depth !== 0 || (at < line.length && line.slice(at, at + 2) !== ', ')) return false;
    if (at < line.length) at += 2;
  }
  if (names.size !== 0) return false;
  return textRevision(JSON.stringify({ ...tag, fields: Object.fromEntries(fields) })) === entry.revision;
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
      identity: `${projectId}:${tag.id}@${tagRevision(tag)}`,
      aliases: legacyRevisions(tag).map((revision) => `${projectId}:${tag.id}@${revision}`),
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
  const fresh = prompts.filter((tag) => !delivered.has(tag.identity) && !tag.aliases?.some((alias) => delivered.has(alias)));
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
