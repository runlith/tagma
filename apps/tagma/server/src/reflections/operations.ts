import { Effect, Schema } from 'effect';
import { said } from '../platform/contract/service/presentation.js';
import { pageRows } from '@runlith/paging';
import { walks } from '../platform/contract/wire/refusal.js';
import { pairsOf, routed } from '../platform/contract/service/routed.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { CallerAim } from '../platform/contract/service/place.js';
import { Projects } from '../projects/contract/service/registry.js';
import { BlockNames } from '../graph/contract/service/acts.js';
import { CurrentGraph, GraphCall } from '../graph/contract/service/serving.js';
import { REFLECTIONS } from './contract/wire/answers.js';
import { blockName } from '../graph/contract/wire/references.js';
import { blockSummary } from '../graph/operations/answers.js';
import { reflectionPlace } from '../graph/operations/crossing.js';
import { REFLECTION_FILING_OPERATIONS as OPS } from './contract/wire/operations.js';
import { type FiledReflection, fileReflection, filedReflections } from './filing.js';
import type { ReflectionEntry } from '../graph/contract/service/work.js';
import { filedDisplay, filedText, standingDisplay, standingText } from './voice.js';

const reflectionKey = (row: ReflectionEntry): readonly [number, number] => [row.createdAt.getTime(), row.id];

const REFLECTIONS_WALK = {
  operation: 'read_reflections',
  order: REFLECTIONS.order,
  selection: Schema.Struct({ projectId: Schema.Number, checkout: Schema.NullOr(Schema.String) }),
  key: Schema.Tuple([Schema.Number, Schema.Number]),
};

const FILING_ROUTED = {
  file_reflection: routed(OPS.file_reflection, {
    place: reflectionPlace,
    execute: Effect.fnUntraced(function* (input: (typeof OPS.file_reflection)['input']['Type'], _prepared: undefined, caller: Caller) {
      const filer =
        caller.actor.kind === 'thread' ? (yield* (yield* Projects).byId(caller.actor.projectId)).name : (yield* CallerAim)?.project;
      return yield* fileReflection({
        title: input.title,
        command: input.command,
        expected: input.expected,
        actual: input.actual,
        project: filer,
        ontoId: input.ontoId === undefined ? undefined : yield* (yield* BlockNames).idOfName(input.ontoId),
        body: input.body,
        storage: input.storage,
      });
    }),
    answer: (filed: FiledReflection) => ({
      status: 'ok' as const,
      block: blockSummary(filed.entry),
      sightings: filed.entry.sightings,
      receivedBy: filed.receivedBy,
      unplaced: filed.unplaced ?? undefined,
      already: filed.already.map((echo) => ({
        name: blockName(echo.entry.uuid),
        title: echo.entry.title,
        shared: echo.shared,
      })),
    }),
    voice: said(filedText),
    display: filedDisplay,
  }),

  read_reflections: routed(OPS.read_reflections, {
    place: reflectionPlace,
    execute: Effect.fnUntraced(function* (input: (typeof OPS.read_reflections)['input']['Type']) {
      const call = yield* yield* GraphCall;
      const cut = yield* walks.page({
        walk: REFLECTIONS_WALK,
        selection: { projectId: call.project.id, checkout: (yield* CurrentGraph)?.checkout ?? null },
        cursor: input.cursor,
        asked: pageRows(input.limit, REFLECTIONS, ceilingOf(REFLECTIONS)),
        keyOf: reflectionKey,
        read: filedReflections,
      });
      return { page: cut.rows, shown: cut.shown, total: cut.total, next: cut.next, complete: cut.complete };
    }),
    answer: (filed: {
      readonly page: readonly ReflectionEntry[];
      readonly shown: number;
      readonly total: number;
      readonly next: string | null;
      readonly complete: boolean;
    }) => ({
      status: 'ok' as const,
      blocks: filed.page.map((entry) => ({ ...blockSummary(entry), sightings: entry.sightings })),
      total: filed.total,
      shown: filed.shown,
      next: filed.next,
      complete: filed.complete,
    }),
    voice: said(standingText),
    display: standingDisplay,
  }),
};

export const FILING_PAIRS = pairsOf(FILING_ROUTED);
