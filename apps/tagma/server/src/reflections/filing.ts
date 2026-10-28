import { Effect } from 'effect';
import { placeAt } from '../projects/identity.js';
import { type ReflectionPayload } from '../graph/contract/wire/records.js';
import { type ProcessProvenance, provenanceLine } from '../platform/contract/wire/provenance.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { type BlockRecord, type BlockRow, type BlockWrite } from '../graph/contract/service/acts.js';
import { BlockAnswers, BlockNames } from '../graph/contract/service/acts.js';
import { BlockRows } from '../graph/acts/rows.js';
import { GraphSource, SourceProject, type SourceRefusal } from '../graph/contract/service/source.js';
import { Projects } from '../projects/contract/service/registry.js';
import { GraphScopes } from '../graph/contract/service/serving.js';
import { type BlockCreateRefusal, Blocks } from '../graph/contract/service/blocks.js';
import { OperationOwners } from '../platform/contract/service/operationOwners.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { REFLECTION, reflectionOf } from '../graph/contract/wire/tags/reflection.js';
import { Tags } from '../graph/contract/service/vocabulary.js';
import { Ranking } from '../graph/contract/service/reads.js';
import { blockName } from '../graph/contract/wire/references.js';
import { indexedWords } from '../graph/search/words.js';
import { spokenAnswer } from '../graph/work/filedReflections.js';
import { Reflections, type ReflectionEntry } from '../graph/contract/service/work.js';
import type { BlockPosition } from '../graph/contract/service/reads.js';

type OntoRefusal = BlockCreateRefusal | 'not-a-reflection' | 'already-answered';

export type ReflectionEcho = { readonly entry: BlockRecord; readonly shared: number };

export type FiledReflection = {
  readonly entry: ReflectionEntry;
  readonly written: BlockWrite;
  readonly already: readonly ReflectionEcho[];
  readonly receivedBy: ProcessProvenance | null;
  readonly unplaced: string | null;
};

const receivedBy = Effect.fn('Reflection.receivedBy')(function* () {
  return (yield* GraphSource).source ?? null;
});

const home = Effect.fn('Reflection.home')(function* (): Effect.fn.Return<
  BlockRow,
  StoreFailure | GateRefusal<'no-home' | 'no-root' | SourceRefusal>,
  SourceProject | GraphSource | GraphScopes | BlockRows
> {
  const found = yield* (yield* SourceProject).place();
  if (found !== undefined)
    return (
      (yield* (yield* GraphScopes).scopeByPlace(found.project.id, found.place)) ?? (yield* (yield* BlockRows).rootBlockOf(found.project.id))
    );
  const { sourcePath, originPath } = yield* GraphSource;
  return yield* new GateRefusal(
    'no-home',
    originPath === undefined
      ? `Tagma's own source (${sourcePath}) lies in no registered project, so there is no graph of Tagma to file into`
      : `neither this server's own directory (${sourcePath}) nor the checkout it was cut from (${originPath}) lies in a registered project, so there is no graph of Tagma to file into`,
    [
      "register the checkout that holds Tagma's source: friction lands in the graph that documents Tagma, and there is none until that repository is a project",
      ...(originPath === undefined
        ? [
            'a closure cut before its origin was recorded names no checkout: the next release records one, and this server files nowhere until then',
          ]
        : []),
    ],
  );
});

export type Filing = {
  readonly title: string;
  readonly command: string;
  readonly expected: string;
  readonly actual: string;
  readonly ontoId?: number | undefined;
  readonly body?: string | undefined;
  readonly project?: string | undefined;
  readonly cwd?: string | undefined;
};

const resolved = Effect.fn('Reflection.resolve')(function* (ref: string | undefined, cwd: string | undefined) {
  const here = ref === undefined || ref === '' ? yield* placeAt(cwd) : undefined;
  return yield* (yield* Projects).resolve(ref, here);
});

const provenance = Effect.fn('Reflection.provenance')(function* (place: string, prose: string | undefined) {
  const source = yield* receivedBy();
  const received = source === null ? '' : ` Received by a server ${provenanceLine(source)}.`;
  const line = `Filed from ${place}.${received}`;
  return prose === undefined || prose.length === 0 ? line : `${line}\n\n${prose}`;
});

const fileAt = Effect.fn('Reflection.fileAt')(function* (
  parent: BlockRow,
  title: string,
  place: string,
  facts: ReflectionPayload,
  body?: string,
) {
  const table = yield* (yield* Tags).of(parent.projectId);
  const tag = yield* table.creationType(REFLECTION);
  const binding = reflectionOf(tag);
  if (binding === null) return yield* Effect.die(`type ${tag.id} supports ${REFLECTION} without its binding`);
  return yield* (yield* Blocks).create({
    projectId: parent.projectId,
    parentId: parent.id,
    tags: [tag.id],
    title,
    body: yield* provenance(place, body?.trim()),
    fields: { [binding.command]: facts.command, [binding.expected]: facts.expected, [binding.actual]: facts.actual },
  });
});

const onto = Effect.fn('Reflection.onto')(function* (
  at: BlockRow,
  ontoId: number,
  title: string,
  place: string,
  facts: ReflectionPayload,
  body?: string,
) {
  const blockRows = yield* BlockRows;
  const named = yield* blockRows.blockById(ontoId);
  const table = yield* (yield* Tags).of(at.projectId);
  let parent = named.parentId === null ? undefined : yield* blockRows.liveBlock(named.parentId);
  let belongs = named.id === at.id;
  while (parent !== undefined && !belongs) {
    belongs = parent.id === at.id;
    parent = parent.parentId === null ? undefined : yield* blockRows.liveBlock(parent.parentId);
  }
  if (named.projectId !== at.projectId || !table.supports(named, REFLECTION) || !belongs || (yield* blockRows.isSuperseded(ontoId))) {
    return yield* new GateRefusal<OntoRefusal>('not-a-reflection', `${blockName(named.uuid)} is not a reflection entry on record`, [
      'read_reflections — the entries standing here, newest first',
      'omit `ontoId`: a friction nobody filed becomes its own entry',
    ]);
  }
  const answer = yield* (yield* BlockAnswers).answerOf(ontoId);
  if (answer !== null) {
    const said = yield* spokenAnswer(answer);
    const source = yield* receivedBy();
    return yield* new GateRefusal<OntoRefusal>(
      'already-answered',
      `${blockName(named.uuid)} was answered by ${said.name}, so it no longer stands`,
      [
        'omit `ontoId`: an answered entry takes no more sightings, so these facts are their own entry',
        `${said.read}, and whether this server was already running by then`,
        ...(source === null ? [] : [`this server has been ${provenanceLine(source)}`]),
      ],
    );
  }
  const [keeper] = yield* (yield* Reflections).groups(at, [ontoId]);
  if (keeper === undefined) {
    return yield* new GateRefusal<OntoRefusal>('not-a-reflection', `${blockName(named.uuid)} is grouped under another reflection`, [
      'read_reflections — name the standing entry that groups these sightings',
    ]);
  }
  const written = yield* fileAt(named, title, place, facts, body);
  return { entry: { ...keeper, sightings: keeper.sightings + 1 }, written };
});

const already = Effect.fn('Reflection.already')(function* (at: BlockRow, text: string) {
  const ranking = yield* Ranking;
  const shared = new Map<string, number>();
  for (const word of indexedWords(text)) {
    const page = yield* ranking.firstPage({
      query: word,
      projectId: at.projectId,
      scopeId: at.id,
      selector: { kind: 'supports', contract: REFLECTION },
    });
    for (const hit of page.items) shared.set(hit.name, (shared.get(hit.name) ?? 0) + 1);
  }
  if (shared.size === 0) return [];
  const ids = yield* (yield* BlockNames).idsOfNames([...shared.keys()]);
  const filed = yield* (yield* Reflections).groups(at, [...ids.values()]);
  if (filed.length === 0) return [];
  const most = Math.max(...filed.map((row) => shared.get(blockName(row.uuid)) ?? 0));
  return filed
    .filter((row) => shared.get(blockName(row.uuid)) === most)
    .map((entry): ReflectionEcho => ({ entry, shared: most }))
    .sort((a, b) => b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime());
});

const where = Effect.fn('Reflection.where')(function* (projectRef: string | undefined, cwd: string | undefined) {
  const project = yield* resolved(projectRef, cwd);
  if (project === undefined) return 'outside every registered project';
  const scope = projectRef === undefined && cwd !== undefined ? yield* (yield* GraphScopes).scopeByPlace(project.id, cwd) : undefined;
  return scope === undefined ? `project \`${project.name}\`` : `project \`${project.name}\`, scope ${blockName(scope.uuid)} ${scope.title}`;
});

const declaring = Effect.fn('Reflection.declaring')(function* (at: BlockRow, command: string) {
  const owners = yield* OperationOwners;
  for (const word of command.match(/[a-z][a-z0-9_-]*/g) ?? []) {
    const operation = word.replace(/^mcp__[a-z0-9-]+__/, '');
    const module = owners.of(operation);
    if (module === null) continue;
    const card = (yield* (yield* Blocks).moduleCards(at.projectId)).find((one) => one.id === module);
    if (card === undefined) return { at, unplaced: `${operation} is declared by module \`${module}\`, which has no #module card here` };
    return { at: yield* (yield* BlockRows).blockById(card.block), unplaced: null };
  }
  return { at, unplaced: 'the command names no operation or tool of Tagma' };
});

export const fileReflection = Effect.fn('Reflection.file')(function* (input: Filing) {
  const at = yield* home();
  const received = yield* receivedBy();
  const facts: ReflectionPayload = { command: input.command, expected: input.expected, actual: input.actual };
  const place = yield* where(input.project, input.cwd);
  if (input.ontoId !== undefined) {
    return {
      ...(yield* onto(at, input.ontoId, input.title, place, facts, input.body)),
      already: [],
      receivedBy: received,
      unplaced: null,
    } satisfies FiledReflection;
  }
  const standing = yield* already(at, `${input.title} ${input.command}`);
  const placed = yield* declaring(at, input.command);
  const entry = yield* fileAt(placed.at, input.title, place, facts, input.body);
  return {
    entry: { ...entry, sightings: 1 },
    written: entry,
    already: standing,
    receivedBy: received,
    unplaced:
      placed.unplaced === null
        ? null
        : `${placed.unplaced}, so it stands under ${blockName(at.uuid)} ${at.title}: move it under the owner of the code it is about`,
  } satisfies FiledReflection;
});

export const filedReflections = Effect.fn('Reflection.filed')(function* (after: BlockPosition | undefined, rows: number) {
  return yield* (yield* Reflections).standing(yield* home(), after, rows);
});
