import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import type { Instruction, InstructionSet } from '../contract/wire/instructions.js';
import { tagText } from '../voice/tags.js';
import { Tags, InstalledCatalogs } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { readsOf } from '../acts/reads.js';
import { deriveLaw } from './derived.js';
import { measuredRoot } from '../contract/service/serving.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
import { type LawEntry, type LawReads, ruleLine } from './law.js';
import { reachLabel } from '../contract/wire/tags/law.js';
import { tagRevision } from './tagPrompts.js';

export function instructionOf(kind: Instruction['kind'], source: string, scope: string, text: string, value: unknown = text): Instruction {
  return { kind, source, scope, text, revision: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

const vocabularyInstructions = deriveLaw(
  Effect.fn('Instructions.vocabulary')(function* (projectId: number) {
    const entries: Instruction[] = [];
    const scope = `project:${projectId}`;
    const table = yield* (yield* Tags).of(projectId);
    const installed = yield* InstalledCatalogs;
    for (const catalog of yield* installed.read(projectId)) {
      entries.push(
        instructionOf('catalog', catalog.name, scope, `[catalog ${catalog.name} · ${scope}]\n${catalog.guidance}`, {
          guidance: catalog.guidance,
          tags: catalog.tags,
        }),
      );
    }
    for (const finding of yield* installed.findings(projectId)) {
      entries.push(instructionOf('catalog', `${finding.kind} ${finding.name}`, scope, `[${finding.kind} · ${scope}] ${finding.text}`));
    }
    for (const tag of table.tags) {
      const key = tag.name !== undefined && tag.name !== tag.id ? ` · key #${tag.id}` : '';
      entries.push({
        kind: 'tag',
        source: `#${tag.id}`,
        scope,
        text: tagText(table, tag, ` [${scope}${key}]`),
        revision: tagRevision(tag),
      });
    }
    for (const unread of table.unreadable) {
      const named = unread.id === '' ? '' : ` #${unread.id}`;
      const text = `[tag ${unread.name} · ${scope}]${named} declaration unreadable; correct it before using this type: ${unread.reason}`;
      entries.push(instructionOf('tag', unread.name, scope, text, unread));
    }
    return entries;
  }),
);

export type InstructionChanges = {
  readonly basis: 'none' | 'other-world' | 'same-world';
  readonly pending: readonly Instruction[];
  readonly withdrawn: readonly Instruction[];
};

export function instructionChanges(set: InstructionSet, previous?: InstructionSet): InstructionChanges {
  const sameWorld = previous?.projectId === set.projectId && previous.audience === set.audience;
  const prior = new Map((sameWorld ? previous.entries : []).map((entry) => [`${entry.kind}:${entry.source}`, entry]));
  const current = new Set(set.entries.map((entry) => `${entry.kind}:${entry.source}`));
  return {
    basis: previous === undefined ? 'none' : sameWorld ? 'same-world' : 'other-world',
    pending: set.entries.filter((entry) => {
      const before = prior.get(`${entry.kind}:${entry.source}`);
      return !(before?.text === entry.text && before.scope === entry.scope);
    }),
    withdrawn: [...prior.values()].filter((entry) => !current.has(`${entry.kind}:${entry.source}`)),
  };
}

export function instructionText(set: InstructionSet, previous?: InstructionSet, changes = instructionChanges(set, previous)): string {
  const parts = [
    changes.basis === 'none'
      ? `Project instructions — ${set.root}. Prompt rules bind their labelled project; code rules arrive when their sources are read or written.`
      : changes.basis === 'same-world'
        ? `Instruction changes — ${set.root}: replace matching entries in this project's set.`
        : `Previous project instructions no longer apply. Current set — ${set.root}.`,
  ];
  for (const entry of changes.withdrawn) parts.push(`Withdrawn: ${entry.kind} ${entry.source} [${entry.scope}].`);
  for (const entry of changes.pending) parts.push(entry.text);
  return changes.basis === 'same-world' && parts.length === 1 ? '' : parts.join('\n\n');
}

export const instructionsReads = Effect.fnUntraced(function* (law: LawReads) {
  const reads = readsOf(yield* GraphUnits);
  const projects = yield* Projects;
  const groups = yield* ProjectGroups;
  const { globalLaw, prompted, promptOf, ownGraph } = law;
  const scoped = new WeakMap<LawEntry, Map<string, Instruction>>();
  const scopedInstruction = (entry: LawEntry, scope: string) => {
    const variants = scoped.get(entry) ?? new Map<string, Instruction>();
    scoped.set(entry, variants);
    let instruction = variants.get(scope);
    if (instruction === undefined) {
      instruction = instructionOf('law', blockName(entry.rule.uuid), scope, ruleLine(entry, ` [${scope}]`));
      variants.set(scope, instruction);
    }
    return instruction;
  };
  const locals = new WeakMap<LawEntry, Map<string, Instruction>>();
  const localInstruction = (entry: LawEntry, project: string) => {
    const variants = locals.get(entry) ?? new Map<string, Instruction>();
    locals.set(entry, variants);
    let instruction = variants.get(project);
    if (instruction === undefined) {
      const scope = reachLabel(entry.reach.delivery, entry.reach.sources, project);
      instruction = instructionOf('law', blockName(entry.rule.uuid), scope, ruleLine(entry, ` [${scope}]`));
      variants.set(project, instruction);
    }
    return instruction;
  };

  const instructions = reads(
    Effect.fn('Orientation.instructions')(function* (input: { projectId: number; audience: InstructionSet['audience'] }) {
      const proj = yield* projects.byId(input.projectId);
      const root = yield* measuredRoot(proj);
      const cross = yield* globalLaw(input.projectId);
      const law = cross.rules.map((entry) => scopedInstruction(entry, cross.scope));
      const group = yield* groups.of(input.projectId);
      if (group !== undefined && group.graph.id !== input.projectId) {
        const scope = `prompt · ${group.graph.name}`;
        for (const entry of yield* promptOf(group.graph.id)) law.push(scopedInstruction(entry, scope));
        for (const member of group.members) {
          const entries = member.id === input.projectId ? yield* prompted(member.id) : yield* promptOf(member.id);
          for (const entry of entries) law.push(localInstruction(entry, member.name));
        }
      } else if (!cross.own) for (const entry of yield* prompted(input.projectId)) law.push(localInstruction(entry, proj.name));
      const vocabulary = input.audience === 'graph' ? yield* Effect.provide(vocabularyInstructions(input.projectId), ownGraph) : [];
      return {
        projectId: input.projectId,
        audience: input.audience,
        root,
        complete: true,
        entries: [...vocabulary, ...law],
      } satisfies InstructionSet;
    }),
  );
  return instructions;
});
