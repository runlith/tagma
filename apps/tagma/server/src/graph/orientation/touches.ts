import { Clock, Effect, Layer } from 'effect';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { threadAgentLabel } from '@runlith/agent/collaboration/label';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { SignedSession, WriterRegister } from '../../platform/contract/service/writers.js';
import { NATIVE_HARNESS, type SessionIdentity, type SessionRef, sessionName } from '../../platform/contract/wire/session.js';
import { block, edge, source, touch } from '../store/tables.js';
import { session } from '../../platform/store/writers.js';
import { Act } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { ActState } from '../contract/service/transaction.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Selection } from '../contract/service/reads.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GraphScopes } from '../contract/service/serving.js';
import { lawForest } from './law.js';
import { codeLabel, reaches, sourced } from './reach.js';
import { blockName } from '../contract/wire/references.js';
import { tagPrompts, tagPromptText, textRevision } from './tagPrompts.js';
import { Touches, SessionNames, type FileTouch, type TouchBrief, type TouchRule, type TouchText } from '../contract/service/orientation.js';
import { writes } from '../../platform/contract/service/writes.js';
import { WORK } from '../contract/wire/tags/work.js';
import { EXPLANATION } from '../contract/wire/tags/explanation.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { carriesContract, contractAt, slotValue } from '../vocabulary/projection.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { deriveLaw } from './derived.js';
import type { ToolShown } from '@runlith/agent/tool';

const touchLaw = deriveLaw(
  Effect.fn('Touches.law')(function* (projectId: number) {
    const entries = yield* lawForest(projectId);
    return entries.flatMap(({ rule, reach }) => {
      if (reach.delivery !== 'code' || !sourced(reach)) return [];
      const label = codeLabel(reach.sources);
      return [
        {
          places: reach.places,
          rule: {
            name: blockName(rule.uuid),
            identity: rule.uuid,
            revision: textRevision(`${rule.title}\u0000${rule.body}\u0000${label}`),
            title: rule.title,
            body: rule.body,
            reach: label,
          } satisfies TouchRule,
          tags: rule.tags,
        },
      ];
    });
  }),
);

const touching = writes('Touches.record', [touch]);

const STRENGTH: Readonly<Record<ToolShown['as'], number>> = { found: 0, read: 1, wrote: 2 };

type HeldTask = { readonly id: number; readonly holder: number | null };

type ExplainingRow = {
  readonly id: number;
  readonly uuid: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly ref: string;
  readonly kind: string;
};

const covering = (place: string): string[] => {
  const parts = place === '.' ? [] : place.split('/');
  return ['.', ...parts.map((_, at) => parts.slice(0, at + 1).join('/'))];
};

export const touchesLayer: Layer.Layer<
  Touches,
  never,
  GraphStore | GraphUnits | Act | SessionNames | WriterRegister | Projects | GraphScopes | Selection | Tags | BlockRows
> = Layer.effect(
  Touches,
  Effect.gen(function* () {
    const store = yield* GraphStore;
    const units = yield* GraphUnits;
    const reads = readsOf(units);
    const { db } = store;
    const act = yield* Act;
    const sessions = yield* WriterRegister;
    const vocabulary = yield* Tags;
    const sessionNames = yield* SessionNames;
    const projects = yield* Projects;
    const scopes = yield* GraphScopes;
    const selection = yield* Selection;
    const ownGraph = yield* Effect.context<GraphStore | GraphUnits | Selection | Act | Tags | BlockRows>();

    const onFiles = reads(
      (input: { projectId: number; places: readonly string[] }): Effect.Effect<ReadonlyMap<string, FileTouch[]>, StoreFailure> =>
        Effect.gen(function* () {
          const table = yield* vocabulary.of(input.projectId);
          const rows = yield* db
            .select({
              place: touch.place,
              sessionId: touch.sessionId,
              harness: session.harness,
              key: session.key,
              wrote: touch.wrote,
              touchedAt: touch.touchedAt,
              taskId: block.id,
              taskUuid: block.uuid,
              title: block.title,
            })
            .from(touch)
            .innerJoin(block, eq(block.id, touch.taskId))
            .leftJoin(session, eq(session.id, touch.sessionId))
            .where(
              and(
                inArray(touch.place, [...input.places]),
                eq(block.projectId, input.projectId),
                contractAt(table, WORK, 'active', block.id),
                isNull(block.deletedAt),
              ),
            )
            .orderBy(desc(touch.touchedAt));
          const named = yield* sessionNames.of(
            input.projectId,
            rows.flatMap((row) => (row.harness === NATIVE_HARNESS && row.key !== null ? [row.key] : [])),
          );
          const byPlace = new Map<string, FileTouch[]>(input.places.map((place) => [place, []]));
          for (const row of rows) {
            byPlace.get(row.place)?.push({
              writer:
                row.sessionId === null || row.harness === null || row.key === null
                  ? null
                  : { id: row.sessionId, harness: row.harness, key: row.key },
              agentName: (row.key === null ? undefined : named.get(row.key)?.name) ?? null,
              task: { id: row.taskId, name: blockName(row.taskUuid ?? ''), title: row.title },
              wrote: row.wrote,
              touchedAt: row.touchedAt,
            });
          }
          return byPlace;
        }),
    );

    const explaining = Effect.fnUntraced(function* (projectId: number, places: readonly string[], table: TagTable) {
      const byPlace = new Map<string, ExplainingRow[]>();
      if (table.typesSupporting(EXPLANATION).length === 0) return byPlace;
      const rows = yield* db
        .select({
          id: block.id,
          uuid: block.uuid,
          title: block.title,
          body: block.body,
          tags: block.tags,
          ref: source.ref,
          kind: source.kind,
        })
        .from(source)
        .innerJoin(block, eq(block.id, source.blockId))
        .where(
          and(
            inArray(source.ref, [...new Set(places.flatMap(covering))]),
            eq(block.projectId, projectId),
            isNull(block.deletedAt),
            carriesContract(table, EXPLANATION, block.id),
            sql`not exists (select 1 from ${edge} s where s.kind = 'supersedes' and s.to_id = ${block.id})`,
          ),
        );
      for (const place of places) {
        const over = new Set(covering(place));
        const narrowest = new Map<number, ExplainingRow>();
        for (const row of rows) {
          if (!over.has(row.ref) || (row.ref !== place && row.kind !== 'dir')) continue;
          const held = narrowest.get(row.id);
          if (held === undefined || held.ref.length < row.ref.length) narrowest.set(row.id, row);
        }
        byPlace.set(
          place,
          [...narrowest.values()].sort((one, other) => other.ref.length - one.ref.length || one.id - other.id),
        );
      }
      return byPlace;
    });

    const tasksHeld = reads((input: { projectId: number; sessionId: number | null }) =>
      Effect.gen(function* () {
        const table = yield* vocabulary.of(input.projectId);
        const holderValue = sql`cast(${slotValue(table, HOLDER, HOLDER_SLOT, block.id)} as integer)`;
        const mine = input.sessionId === null ? sql`${holderValue} is null` : eq(holderValue, input.sessionId);
        return yield* db
          .select({ id: block.id, holder: sql<number | null>`${holderValue}` })
          .from(block)
          .where(
            and(
              eq(block.projectId, input.projectId),
              carriesContract(table, WORK, block.id),
              contractAt(table, WORK, 'active', block.id),
              isNull(block.deletedAt),
              mine,
            ),
          );
      }),
    );

    const recorded = (projectId: number, places: readonly { place: string; wrote: boolean }[], held: readonly HeldTask[]) =>
      held.length === 0 || places.length === 0
        ? Effect.void
        : act.unit(
            touching,
            Effect.gen(function* () {
              const now = new Date(yield* Clock.currentTimeMillis);
              for (const { place, wrote } of places) {
                for (const task of held) {
                  yield* db
                    .insert(touch)
                    .values({ taskId: task.id, sessionId: task.holder, place, wrote, touchedAt: now })
                    .onConflictDoUpdate({
                      target: [touch.taskId, touch.place],
                      set: { sessionId: task.holder, wrote: sql`${touch.wrote} or ${wrote ? 1 : 0}`, touchedAt: now },
                    });
                }
              }
            }),
          );

    const placed = Effect.fnUntraced(function* (projectId: number, shown: readonly ToolShown[]) {
      const strongest = new Map<string, ToolShown['as']>();
      for (const one of shown) {
        const at = yield* scopes.placeOf(projectId, one.path).pipe(
          Effect.map(({ place }) => place),
          Effect.catchTag('GateRefusal', (refusal) => (refusal.code === 'source-outside' ? Effect.succeed(null) : Effect.fail(refusal))),
        );
        if (at === null) continue;
        const held = strongest.get(at);
        if (held === undefined || STRENGTH[one.as] > STRENGTH[held]) strongest.set(at, one.as);
      }
      return strongest;
    });

    return Touches.of({
      of: (input) =>
        Effect.map(onFiles({ projectId: input.projectId, places: [input.place] }), (byPlace) => byPlace.get(input.place) ?? []),

      touch: Effect.fn('Touches.touch')(function* (input: { projectId: number; shown: readonly ToolShown[] }) {
        const seen = yield* placed(input.projectId, input.shown);
        if (seen.size === 0) return [];
        const caller = yield* SignedSession;
        const callerSession = caller === null ? null : yield* sessions.idOf(caller);
        const held =
          caller !== null && callerSession === null ? [] : yield* tasksHeld({ projectId: input.projectId, sessionId: callerSession });
        yield* recorded(
          input.projectId,
          [...seen].flatMap(([place, as]) => (as === 'found' ? [] : [{ place, wrote: as === 'wrote' }])),
          held,
        );
        const mine = new Set(held.map((task) => task.id));
        const places = [...seen.keys()];
        return yield* units.markReadOnly(
          Effect.gen(function* () {
            const law = yield* Effect.provide(touchLaw(input.projectId), ownGraph);
            const table = yield* vocabulary.of(input.projectId);
            const explained = yield* explaining(input.projectId, places, table);
            const here = yield* onFiles({ projectId: input.projectId, places });
            const briefs: TouchBrief[] = [];
            for (const [place, as] of seen) {
              const entries = as === 'found' ? [] : law.filter((entry) => reaches(entry.places, place));
              const notes = explained.get(place) ?? [];
              briefs.push({
                place,
                as,
                rules: entries.map((entry) => entry.rule),
                explanations: notes.map((row): TouchText => ({
                  name: blockName(row.uuid),
                  identity: row.uuid,
                  revision: textRevision(`${row.title}\u0000${row.body}`),
                  title: row.title,
                  body: row.body,
                })),
                tagPrompts: tagPrompts(table, input.projectId, [
                  ...entries.flatMap((entry) => entry.tags),
                  ...notes.flatMap((row) => row.tags),
                ]),
                touches: (here.get(place) ?? [])
                  .filter((row) => !mine.has(row.task.id))
                  .map(({ writer, agentName, task, wrote }) => ({
                    writer,
                    agentName,
                    task: { name: task.name, title: task.title },
                    wrote,
                  })),
              });
            }
            return briefs;
          }),
        );
      }),
      retire: Effect.fn('Touches.retire')(function* (taskId: number) {
        yield* ActState;
        yield* db.delete(touch).where(eq(touch.taskId, taskId));
      }),
    });
  }),
);

export type TouchLedger = {
  readonly delivered: Set<string>;
  readonly heard: Set<string>;
};

export function touchText(
  brief: TouchBrief,
  ledger: TouchLedger,
  identity: SessionIdentity['Service'],
  options: { deliveredTags?: Set<string> },
): string | null {
  const { delivered, heard } = ledger;
  const deliveryKey = (text: TouchText): string => `${text.identity}@${text.revision}`;
  const found = brief.as === 'found';
  const rules = brief.rules.filter((rule) => !delivered.has(deliveryKey(rule)));
  const unread = brief.explanations.filter((text) => !delivered.has(deliveryKey(text)));
  const pointerKey = (text: TouchText): string => `found:${deliveryKey(text)}`;
  const pointed = found ? unread.filter((text) => !heard.has(pointerKey(text))) : [];
  const explanations = found ? [] : unread;
  const promptLedger = options.deliveredTags ?? delivered;
  const prompts = tagPromptText(brief.tagPrompts, promptLedger);
  const who = (row: { writer: SessionRef | null }): string => (row.writer === null ? 'operator' : sessionName(row.writer, identity));
  const touchKey = (row: { writer: SessionRef | null; wrote: boolean }): string =>
    `touch:${brief.place}:${who(row)}:${row.wrote ? 'w' : 'r'}`;
  const others = found ? [] : brief.touches.filter((row) => !heard.has(touchKey(row)));
  const writing = others.filter((row) => row.wrote);
  if (rules.length === 0 && explanations.length === 0 && pointed.length === 0 && writing.length === 0 && prompts.text === null) return null;
  const lines: string[] = [];
  for (const rule of rules) {
    const body = rule.body.trim();
    lines.push(`Rule ${rule.name} ${rule.title} [${rule.reach}]${body.length === 0 ? '' : `: ${body}`}`);
  }
  for (const text of explanations) {
    const body = text.body.trim();
    lines.push(`Note ${text.name} ${text.title}${body.length === 0 ? '' : `: ${body}`}`);
  }
  for (const text of pointed) {
    heard.add(pointerKey(text));
    lines.push(`Note ${text.name} ${text.title} — read the file for its body`);
  }
  if (prompts.text !== null) lines.push(prompts.text);
  for (const identity of prompts.delivered) promptLedger.add(identity);
  for (const verb of ['writes', 'reads'] as const) {
    const rows = others.filter((row) => row.wrote === (verb === 'writes'));
    if (rows.length === 0) continue;
    const byWriter = new Map<string, { agentName: string | null; held: string[] }>();
    for (const row of rows) {
      heard.add(touchKey(row));
      const address = who(row);
      const current = byWriter.get(address) ?? { agentName: row.agentName, held: [] };
      current.held.push(row.task.title);
      byWriter.set(address, current);
    }
    lines.push(
      `another session ${verb} this file: ${[...byWriter]
        .map(([threadId, row]) => threadAgentLabel({ threadId, name: row.agentName }, row.held.join(', ')))
        .join(' · ')}`,
    );
  }
  for (const text of [...rules, ...explanations]) delivered.add(deliveryKey(text));
  return `<tagma over ${brief.place}>\n${lines.join('\n')}\n</tagma>`;
}
