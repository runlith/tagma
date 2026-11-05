import { createHash } from 'node:crypto';
import { Context, Effect } from 'effect';
import type { Instruction, InstructionChanges, InstructionDiff, InstructionSet } from '../contract/wire/instructions.js';
import { type ChangeActor, changeActorOf, changedBy } from '../../platform/contract/wire/actor.js';
import type { GraphEventOp } from '../contract/wire/journal.js';
import { GraphJournal } from '../contract/service/journal.js';
import { BlockNames } from '../contract/service/acts.js';
import { SessionNames } from '../contract/service/orientation.js';
import { OtherGraphs } from '../serving/policy.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { NATIVE_HARNESS, sessionHarness } from '../../platform/contract/wire/session.js';
import type { GateRefusal, OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { tagText } from '../voice/tags.js';
import { Tags, InstalledCatalogs } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { readsOf } from '../acts/reads.js';
import { deriveLaw } from './derived.js';
import { measuredRoot } from '../contract/service/serving.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
import { reaching } from '../../projects/contract/wire/project.js';
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
      entries.push({
        ...instructionOf('catalog', catalog.name, scope, `[catalog ${catalog.name} · ${scope}]\n${catalog.guidance}`, {
          guidance: catalog.guidance,
          tags: catalog.tags,
        }),
        origin: { projectId, block: catalog.name },
      });
    }
    for (const finding of yield* installed.findings(projectId)) {
      entries.push(instructionOf('catalog', `${finding.kind} ${finding.name}`, scope, `[${finding.kind} · ${scope}] ${finding.text}`));
    }
    for (const tag of table.tags) {
      const key = tag.name !== undefined && tag.name !== tag.id ? ` · key #${tag.id}` : '';
      const declaring = table.identities.typeOf(tag.id)?.declaration ?? null;
      entries.push({
        kind: 'tag',
        source: `#${tag.id}`,
        scope,
        text: tagText(table, tag, ` [${scope}${key}]`),
        revision: tagRevision(tag),
        origin: declaring === null || declaring.startsWith('#') ? undefined : { projectId, block: declaring },
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

const entryKey = (entry: Instruction): string => `${entry.kind}:${entry.source}`;

export function instructionChanges(set: InstructionSet, previous?: InstructionSet): InstructionChanges {
  const sameWorld = previous?.projectId === set.projectId && previous.audience === set.audience;
  const prior = new Map((sameWorld ? previous.entries : []).map((entry) => [entryKey(entry), entry]));
  const current = new Set(set.entries.map(entryKey));
  return {
    basis: previous === undefined ? 'none' : sameWorld ? 'same-world' : 'other-world',
    pending: set.entries.filter((entry) => {
      const before = prior.get(entryKey(entry));
      return !(before?.text === entry.text && before.scope === entry.scope);
    }),
    withdrawn: [...prior.values()].filter((entry) => !current.has(entryKey(entry))),
    by: new Map(),
  };
}

const byline = (actors: readonly ChangeActor[] | undefined, reader: string | null): string => changedBy(actors ?? [], reader);

export function instructionText(
  set: InstructionSet,
  previous?: InstructionSet,
  changes = instructionChanges(set, previous),
  reader: string | null = null,
): string {
  const parts = [
    changes.basis === 'none'
      ? `Project instructions — ${set.root}. Prompt rules bind their labelled project; code rules arrive when their sources are read or written.`
      : changes.basis === 'same-world'
        ? `Instruction changes — ${set.root}: replace matching entries in this project's set.`
        : `Previous project instructions no longer apply. Current set — ${set.root}.`,
  ];
  const known = new Set(changes.basis === 'same-world' ? (previous?.entries ?? []).map(entryKey) : []);
  for (const entry of changes.withdrawn) {
    parts.push(`Withdrawn${byline(changes.by.get(entryKey(entry)), reader)}: ${entry.kind} ${entry.source} [${entry.scope}].`);
  }
  for (const entry of changes.pending) {
    const by = byline(changes.by.get(entryKey(entry)), reader);
    parts.push(by === '' ? entry.text : `${known.has(entryKey(entry)) ? 'Changed' : 'Added'}${by}:\n${entry.text}`);
  }
  return changes.basis === 'same-world' && parts.length === 1 ? '' : parts.join('\n\n');
}

const CHANGE_OPS = [
  'create',
  'update',
  'anchor',
  'unanchor',
  'relocate',
  'supersede',
  'unsupersede',
  'delete',
  'restore',
  'depart',
  'enable',
  'disable',
] as const satisfies readonly GraphEventOp[];

type ChangeReading = GraphJournal | BlockNames | WriterRegister | SessionNames;

const actorsIn = Effect.fn('Orientation.changeActors')(function* (projectId: number, names: readonly string[], after: number) {
  const ids = yield* (yield* BlockNames).idsOfNames(names);
  const sessions = yield* (yield* GraphJournal).changedBy({ ids: [...ids.values()], after, ops: CHANGE_OPS });
  const writers = yield* (yield* WriterRegister).named([...new Set([...sessions.values()].flat())].filter((id) => id !== null));
  const byId = new Map(writers.map((row) => [row.id, row]));
  const threads = writers.flatMap((row) => (sessionHarness(row.harness) === NATIVE_HARNESS ? [row.key] : []));
  const called = yield* (yield* SessionNames).of(projectId, threads);
  const actorOf = (sessionId: number | null): ChangeActor | null => {
    if (sessionId === null) return changeActorOf(null);
    const row = byId.get(sessionId);
    if (row === undefined) return null;
    const named = called.get(row.key);
    return changeActorOf(row, named?.name ?? named?.title ?? null);
  };
  const actors = new Map<string, readonly ChangeActor[]>();
  for (const name of names) {
    const id = ids.get(name.toLowerCase().replaceAll('-', ''));
    const by = id === undefined ? [] : (sessions.get(id) ?? []).flatMap((sessionId) => actorOf(sessionId) ?? []);
    if (by.length > 0) actors.set(name, by);
  }
  return actors;
});

export const instructionsReads = Effect.fnUntraced(function* (law: LawReads) {
  const reads = readsOf(yield* GraphUnits);
  const projects = yield* Projects;
  const groups = yield* ProjectGroups;
  const { globalGraph, globalLaw, prompted, promptOf, ownGraph } = law;
  const here = yield* Effect.context<ChangeReading>();
  const graphAt = Effect.fnUntraced(function* (
    projectId: number,
    home: number,
  ): Effect.fn.Return<Context.Context<ChangeReading>, GateRefusal<OpenRefusal>> {
    if (projectId === home) return here;
    const reach = yield* OtherGraphs;
    return reach === null ? here : yield* reach(projectId);
  });
  const headAt = Effect.fnUntraced(function* (projectId: number, home: number) {
    const journal = Context.get(yield* graphAt(projectId, home), GraphJournal);
    return yield* journal.head();
  });
  const scoped = new WeakMap<LawEntry, Map<string, Instruction>>();
  const scopedInstruction = (entry: LawEntry, scope: string, graph: number) => {
    const variants = scoped.get(entry) ?? new Map<string, Instruction>();
    scoped.set(entry, variants);
    let instruction = variants.get(scope);
    if (instruction === undefined) {
      const name = blockName(entry.rule.uuid);
      instruction = { ...instructionOf('law', name, scope, ruleLine(entry, ` [${scope}]`)), origin: { projectId: graph, block: name } };
      variants.set(scope, instruction);
    }
    return instruction;
  };
  const locals = new WeakMap<LawEntry, Map<string, Instruction>>();
  const localInstruction = (entry: LawEntry, project: string, graph: number) => {
    const variants = locals.get(entry) ?? new Map<string, Instruction>();
    locals.set(entry, variants);
    let instruction = variants.get(project);
    if (instruction === undefined) {
      const scope = reachLabel(entry.reach.delivery, entry.reach.sources, project);
      const name = blockName(entry.rule.uuid);
      instruction = { ...instructionOf('law', name, scope, ruleLine(entry, ` [${scope}]`)), origin: { projectId: graph, block: name } };
      variants.set(project, instruction);
    }
    return instruction;
  };

  const instructions = reads(
    Effect.fn('Orientation.instructions')(function* (input: { projectId: number; audience: InstructionSet['audience'] }) {
      const proj = yield* projects.byId(input.projectId);
      const root = yield* measuredRoot(proj);
      if (input.audience === 'reader')
        return { projectId: input.projectId, audience: input.audience, root, complete: true, entries: [] } satisfies InstructionSet;
      const journal: Record<string, number> = {};
      const mark = Effect.fnUntraced(function* (projectId: number) {
        journal[String(projectId)] ??= yield* headAt(projectId, input.projectId);
      });
      yield* mark(input.projectId);
      const global = yield* globalGraph(input.projectId);
      if (global !== null) yield* mark(global);
      const cross = yield* globalLaw(input.projectId);
      const law = cross.rules.map((entry) => scopedInstruction(entry, cross.scope, cross.graph ?? input.projectId));
      const group = yield* groups.of(input.projectId);
      if (group !== undefined && group.graph.id !== input.projectId) {
        const scope = `prompt · ${group.graph.name}`;
        yield* mark(group.graph.id);
        for (const entry of yield* promptOf(group.graph.id)) law.push(scopedInstruction(entry, scope, group.graph.id));
        const giving = new Set(reaching(group, input.projectId, 'law').map((member) => member.id));
        for (const member of group.members) {
          if (member.id !== input.projectId && !giving.has(member.id)) continue;
          yield* mark(member.id);
          const entries = member.id === input.projectId ? yield* prompted(member.id) : yield* promptOf(member.id);
          for (const entry of entries) law.push(localInstruction(entry, member.name, member.id));
        }
      } else if (!cross.own)
        for (const entry of yield* prompted(input.projectId)) law.push(localInstruction(entry, proj.name, input.projectId));
      const vocabulary = input.audience === 'graph' ? yield* Effect.provide(vocabularyInstructions(input.projectId), ownGraph) : [];
      return {
        projectId: input.projectId,
        audience: input.audience,
        root,
        complete: true,
        entries: [...vocabulary, ...law],
        journal,
      } satisfies InstructionSet;
    }),
  );

  const changes = reads(
    Effect.fn('Orientation.changes')(function* (input: {
      projectId: number;
      audience: InstructionSet['audience'];
      previous: InstructionSet | undefined;
    }) {
      const set = yield* instructions(input);
      const diff = instructionChanges(set, input.previous);
      const since = input.previous?.journal ?? {};
      const now = set.journal ?? {};
      if (diff.basis !== 'same-world') return { set, changes: diff } satisfies InstructionDiff;
      const changed = [...diff.pending, ...diff.withdrawn].flatMap((entry) => {
        const origin = entry.origin;
        if (origin === undefined) return [];
        const after = since[String(origin.projectId)];
        return after === undefined || now[String(origin.projectId)] === undefined ? [] : [{ entry, origin, after }];
      });
      const graphs = new Map<number, { after: number; names: Set<string> }>();
      for (const { origin, after } of changed) {
        const graph = graphs.get(origin.projectId) ?? { after, names: new Set<string>() };
        graph.names.add(origin.block);
        graphs.set(origin.projectId, graph);
      }
      const found = new Map<number, ReadonlyMap<string, readonly ChangeActor[]>>();
      for (const [projectId, graph] of graphs) {
        const context = yield* graphAt(projectId, input.projectId);
        found.set(projectId, yield* Effect.provide(actorsIn(projectId, [...graph.names], graph.after), context));
      }
      const by = new Map<string, readonly ChangeActor[]>();
      for (const { entry, origin } of changed) {
        const actors = found.get(origin.projectId)?.get(origin.block);
        if (actors !== undefined) by.set(entryKey(entry), actors);
      }
      return { set, changes: { ...diff, by } } satisfies InstructionDiff;
    }),
  );
  return { instructions, changes };
});
