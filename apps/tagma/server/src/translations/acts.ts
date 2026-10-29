import { activity, body, note } from '@runlith/activity/Activity';
import { activityKind, type ActivityBody } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import type { LLMError } from '@runlith/llm/schema/errors';
import { sumUsage, type LLMResponse, type Usage } from '@runlith/llm/schema/events';
import { Cause, Clock, Deferred, Effect, FiberMap, Option, PubSub, Semaphore, Stream } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { ModelAccess } from '../providers/contract/service/access.js';
import { Settings } from '../settings/contract/service/values.js';
import { makeRoads, type RoadRole } from '../threads/roads.js';
import {
  Translations,
  type ReferencedTitle,
  type StartRefusal,
  type Translated,
  type TranslationAsk,
} from './contract/service/translations.js';
import type { ActState, LanguageStanding, PartState, ProjectedPart, TranslationFrame } from './contract/wire/projection.js';
import { translationInstructions, translationLanguage, translationModel, translationReasoning } from './contract/wire/settings.js';
import { Projections, type ProjectionKey } from './store/projections.js';
import { answerOf, batchesOf, promptOf, systemOf, type Batch, type Brief } from './translator/batches.js';
import { titleHash, type Part, type Segmented } from './translator/parts.js';
import { segment } from './translator/segment.js';

export const TRANSLATION = activityKind<
  { readonly block: string; readonly language: string; readonly sending: number; readonly again: boolean },
  { readonly model?: string; readonly landed?: number; readonly failed?: number; readonly usage?: ModelCallUsage }
>('translation');

const TRANSLATION_ROLE: RoadRole = {
  configured: 'translation-model',
  model: translationModel,
  reasoning: translationReasoning,
  answers: 'text',
};

const IN_FLIGHT = 3;

const SEGMENTED = 32;

type Running = {
  readonly projectId: number;
  readonly name: string;
  readonly model: string;
  readonly rung: string | null;
  readonly sending: number;
  readonly pending: ReadonlySet<string>;
  landed: number;
};

type Started = {
  readonly status: 'translating';
  readonly joined: false;
  readonly model: string;
  readonly rung: string | null;
  readonly sending: number;
};

type Sent = { readonly landed: number; readonly failed: number; readonly reason: string | null };

type Published = { readonly projectId: number; readonly frame: TranslationFrame };

const utf8 = new TextEncoder();

const document = (kind: string, value: object): ActivityBody => ({
  kind,
  contentType: 'application/json',
  encoded: utf8.encode(JSON.stringify(value)),
});

const missing = () =>
  new GateRefusal('translation-model-missing', 'no model can translate: none is named, and no connected provider declares a light model', [
    'choose a model in the lens or set `translation.model`',
  ]);

const invalid = (reason: string) =>
  new GateRefusal('invalid-selection', reason, ['choose another model in the lens or in `translation.model`']);

const keyOf = (block: Translated, language: string): ProjectionKey => ({ projectId: block.projectId, block: block.uuid, language });

const idOf = (key: ProjectionKey) => `${key.projectId}\u0000${key.block}\u0000${key.language}`;

const sendable = (parts: readonly Part[]) => parts.filter((part) => part.kind !== 'kept');

export const makeTranslations = Effect.gen(function* () {
  const store = yield* Projections;
  const settings = yield* Settings;
  const models = yield* ModelAccess;
  const log = yield* ActivityLog;
  const roads = yield* makeRoads;
  const frames = yield* Effect.acquireRelease(PubSub.unbounded<Published>(), PubSub.shutdown);
  const acts = yield* FiberMap.make<string>();
  const admission = yield* Semaphore.make(1);
  const running = new Map<string, Running>();
  const faults = new Map<string, { readonly reason: string; readonly failed: number }>();
  const departed = new Set<number>();
  const segmented = new Map<string, Segmented & { readonly parts: readonly Part[] }>();

  const told = (key: ProjectionKey, state: ActState, live: Running) =>
    PubSub.publish(frames, {
      projectId: key.projectId,
      frame: { block: live.name, language: key.language, state, landed: live.landed, sending: live.sending },
    });

  const landed = Effect.fnUntraced(function* (key: ProjectionKey, live: Running, batch: Batch, text: string) {
    const read = answerOf(batch, text);
    if (read._tag === 'Unframed') {
      yield* body(document('response', { text, refused: read.reason }));
      return { landed: 0, failed: batch.parts.length, reason: `the answer was refused: ${read.reason}` } satisfies Sent;
    }
    yield* body(document('response', { text }));
    yield* store.land(key, read.texts);
    live.landed += batch.parts.length;
    yield* told(key, 'translating', live);
    return { landed: batch.parts.length, failed: 0, reason: null } satisfies Sent;
  });

  const sent = Effect.fn('Translations.batch')(function* (
    key: ProjectionKey,
    live: Running,
    batch: Batch,
    prompt: string,
    call: (prompt: string) => Effect.Effect<LLMResponse, LLMError>,
  ) {
    yield* body(document('input', { prompt }));
    return yield* call(prompt).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Effect.as(body(document('response', { failure: failure.message })), {
            landed: 0,
            failed: batch.parts.length,
            reason: `the model failed: ${failure.message}`,
          } satisfies Sent),
        onSuccess: (response) => landed(key, live, batch, response.text),
      }),
    );
  });

  const act = (
    key: ProjectionKey,
    block: Translated,
    ask: TranslationAsk,
    sending: readonly Part[],
    keep: readonly string[],
    started: Deferred.Deferred<Started, StartRefusal | StoreFailure>,
  ) => {
    let spent: Usage | undefined;
    let model: string | undefined;
    const refuse = (refusal: StartRefusal) => Effect.andThen(Deferred.fail(started, refusal), Effect.fail(refusal));
    const work = Effect.gen(function* () {
      const chosen = yield* roads.choose(TRANSLATION_ROLE, {
        asker: null,
        projectId: key.projectId,
        rejected: [],
        named: ask.model === undefined ? undefined : { model: ask.model, reasoning: ask.reasoning ?? null },
      });
      const road = chosen.road;
      yield* note({
        type: 'model-chosen',
        road: chosen.name,
        rejected: chosen.rejected,
        provider: road._tag === 'Model' ? road.option.provider : undefined,
        model: road._tag === 'Model' ? road.option.id : undefined,
        rung: road._tag === 'Model' ? road.reasoning : undefined,
        account: road._tag === 'Model' ? road.account : undefined,
      });
      if (road._tag === 'None') return yield* refuse(missing());
      if (road._tag !== 'Model')
        return yield* refuse(
          invalid(`${ask.model ?? 'the model `translation.model` names'} is not a text model of the catalog on the rung asked`),
        );
      const brief: Brief = {
        language: key.language,
        title: block.title,
        instructions: yield* settings.value(translationInstructions, key.projectId),
      };
      const request = models.request({
        ownerId: OPERATOR_PRINCIPAL,
        provider: road.option.provider,
        model: road.option.id,
        reasoning: road.reasoning,
        account: road.account ?? undefined,
        instructions: systemOf(brief),
        cache: 'none',
        reasoningOutput: false,
      });
      if (request.refusal !== undefined) return yield* refuse(invalid(`${road.option.key} cannot be called: ${request.refusal.message}`));
      model = road.option.key;
      const { batches, oversized } = batchesOf(sending, request.plannedOutputTokens);
      const live: Running = {
        projectId: key.projectId,
        name: block.name,
        model: road.option.key,
        rung: road.reasoning,
        sending: sending.length,
        pending: new Set(sending.map((part) => part.hash)),
        landed: 0,
      };
      yield* store.begin(key, { model: live.model, rung: live.rung, at: yield* Clock.currentTimeMillis });
      running.set(idOf(key), live);
      const begun: Started = { status: 'translating', joined: false, model: live.model, rung: live.rung, sending: live.sending };
      yield* Deferred.succeed(started, begun);
      yield* told(key, 'translating', live);
      const call = (prompt: string) =>
        request.text({ prompt }).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              spent = sumUsage(spent, response.usage);
            }),
          ),
        );
      const sentOut = yield* Effect.forEach(batches, (batch) => sent(key, live, batch, promptOf(batch, brief), call), {
        concurrency: IN_FLIGHT,
      });
      const outcomes: readonly Sent[] =
        oversized.length === 0
          ? sentOut
          : [
              ...sentOut,
              {
                landed: 0,
                failed: oversized.length,
                reason: `${oversized.length} ${oversized.length === 1 ? 'part is' : 'parts are'} longer than ${road.option.key} answers in one reply; choose a model with a larger output`,
              },
            ];
      const failed = outcomes.reduce((sum, one) => sum + one.failed, 0);
      const reason = outcomes.find((one) => one.reason !== null)?.reason ?? null;
      yield* store.end(key, { ending: failed === 0 ? 'done' : 'failed', reason, failed, keep });
      running.delete(idOf(key));
      yield* told(key, failed === 0 ? 'done' : 'failed', live);
      return { landed: live.landed, failed, reason };
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.suspend(() => {
          const live = running.get(idOf(key));
          running.delete(idOf(key));
          return live === undefined ? Effect.void : told(key, 'stopped', live);
        }),
      ),
      Effect.onError((cause) =>
        Effect.suspend(() => {
          const live = running.get(idOf(key));
          running.delete(idOf(key));
          const broke =
            live === undefined || Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.andThen(
                  Effect.sync(() =>
                    faults.set(idOf(key), { reason: `the act broke: ${Cause.squash(cause)}`, failed: live.sending - live.landed }),
                  ),
                  told(key, 'failed', live),
                );
          return Effect.andThen(broke, Deferred.failCause(started, cause));
        }),
      ),
    );
    return Effect.provideService(
      activity(
        TRANSLATION,
        { block: block.name, language: key.language, sending: sending.length, again: ask.again },
        work.pipe(Effect.withSpan('Translations.act', { root: true })),
        {
          project: key.projectId,
          ended: (exit) => {
            const usage = spent === undefined ? {} : { usage: spent };
            if (exit._tag === 'Success')
              return {
                outcome: exit.value.failed === 0 ? undefined : ('failed' as const),
                reason: exit.value.failed === 0 ? undefined : 'batch-failed',
                message: exit.value.reason ?? undefined,
                result: { ...usage, model, landed: exit.value.landed, failed: exit.value.failed },
              };
            const refused = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
            return refused instanceof GateRefusal
              ? { outcome: 'refused' as const, reason: refused.code, message: refused.reason, result: usage }
              : { result: { ...usage, model } };
          },
        },
      ),
      ActivityLog,
      log,
    );
  };

  const partsFor = Effect.fnUntraced(function* (block: Translated) {
    const id = `${block.projectId}\u0000${block.uuid}`;
    const held = segmented.get(id);
    if (held !== undefined && held.title === block.title && held.body === block.body) return held.parts;
    const parts = yield* Effect.orDie(segment({ title: block.title, body: block.body }));
    segmented.delete(id);
    segmented.set(id, { title: block.title, body: block.body, parts });
    for (const stale of segmented.keys()) {
      if (segmented.size <= SEGMENTED) break;
      segmented.delete(stale);
    }
    return parts;
  });

  const start = Effect.fn('Translations.start')(function* (block: Translated, ask: TranslationAsk) {
    const key = keyOf(block, ask.language);
    return yield* admission.withPermits(1)(
      Effect.gen(function* () {
        if (departed.has(key.projectId))
          return yield* new GateRefusal('project-retired', 'the project was removed while this call ran', ['add the project again']);
        const live = running.get(idOf(key));
        if (live !== undefined)
          return { status: 'translating' as const, joined: true, model: live.model, rung: live.rung, sending: live.sending };
        const parts = yield* partsFor(block);
        const stored = ask.again
          ? new Set<string>()
          : new Set((yield* store.parts(key.projectId, key.block)).filter((row) => row.language === key.language).map((row) => row.source));
        const sending = new Map<string, Part>();
        for (const part of sendable(parts)) if (!stored.has(part.hash)) sending.set(part.hash, part);
        if (sending.size === 0) return { status: 'current' as const };
        const started = yield* Deferred.make<Started, StartRefusal | StoreFailure>();
        faults.delete(idOf(key));
        yield* FiberMap.run(
          acts,
          idOf(key),
          act(
            key,
            block,
            ask,
            [...sending.values()],
            parts.map((part) => part.hash),
            started,
          ),
        );
        return yield* Deferred.await(started);
      }),
    );
  });

  const stateOf = (key: ProjectionKey, ending: 'done' | 'failed' | null): ActState =>
    running.has(idOf(key)) ? 'translating' : faults.has(idOf(key)) ? 'failed' : (ending ?? 'stopped');

  const read = Effect.fn('Translations.read')(function* (
    block: Translated,
    language: string | undefined,
    references: readonly ReferencedTitle[],
  ) {
    const parts = yield* partsFor(block);
    const acts = (yield* store.acts(block.projectId, block.uuid)).toSorted((left, right) => right.at - left.at);
    const rows = yield* store.parts(block.projectId, block.uuid);
    const texts = new Map<string, Map<string, string>>();
    for (const row of rows) texts.set(row.language, (texts.get(row.language) ?? new Map()).set(row.source, row.text));
    const projected = (tag: string) => {
      const own = texts.get(tag) ?? new Map<string, string>();
      const pending = running.get(idOf(keyOf(block, tag)))?.pending;
      const states = parts.map((part): PartState => {
        if (part.kind === 'kept') return 'kept';
        if (own.has(part.hash)) return 'translated';
        return pending?.has(part.hash) === true ? 'pending' : 'changed';
      });
      const count = (state: PartState) => states.filter((one) => one === state).length;
      return {
        parts: parts.map((part, at): ProjectedPart => ({
          kind: part.kind,
          source: part.source,
          state: states[at]!,
          text: own.get(part.hash) ?? null,
        })),
        counts: { translated: count('translated'), changed: count('changed'), pending: count('pending'), total: sendable(parts).length },
      };
    };
    const languages = acts.map((row): LanguageStanding => ({
      language: row.language,
      state: stateOf(keyOf(block, row.language), row.ending),
      ...projected(row.language).counts,
    }));
    const configured = yield* settings.value(translationLanguage, block.projectId);
    const preferred = configured !== '' ? configured : yield* store.last(block.projectId);
    const shown = language === undefined ? undefined : acts.find((row) => row.language === language);
    if (language === undefined || shown === undefined) return { preferred, languages, projection: null };
    const asks = references.map((ref) => ({ projectId: ref.projectId, block: ref.uuid, source: titleHash(ref.title) }));
    const titled = new Map(
      (yield* store.titles(asks, language)).map((row) => [`${row.projectId}\u0000${row.block}\u0000${row.source}`, row.text] as const),
    );
    const { parts: projectedParts, counts } = projected(language);
    const fault = faults.get(idOf(keyOf(block, language)));
    return {
      preferred,
      languages,
      projection: {
        language,
        state: stateOf(keyOf(block, language), shown.ending),
        model: shown.model,
        rung: shown.rung,
        at: new Date(shown.at).toISOString(),
        reason: fault?.reason ?? shown.reason,
        failed: fault?.failed ?? shown.failed,
        ...counts,
        parts: projectedParts,
        titles: references.flatMap((ref, at) => {
          const found = titled.get(`${ref.projectId}\u0000${ref.uuid}\u0000${asks[at]!.source}`);
          return found === undefined ? [] : [{ name: ref.name, title: found }];
        }),
      },
    };
  });

  const stop = Effect.fn('Translations.stop')(function* (block: Translated, language: string) {
    const id = idOf(keyOf(block, language));
    if (!running.has(id)) return false;
    yield* FiberMap.remove(acts, id);
    return true;
  });

  const forget = (projectId: number) =>
    admission.withPermits(1)(
      Effect.gen(function* () {
        departed.add(projectId);
        const ids = [...acts].map(([id]) => id).filter((id) => id.startsWith(`${projectId}\u0000`));
        yield* Effect.forEach(ids, (id) => FiberMap.remove(acts, id), { discard: true });
        for (const id of faults.keys()) if (id.startsWith(`${projectId}\u0000`)) faults.delete(id);
        yield* store.forget(projectId);
      }),
    );

  const projectChanges = yield* ProjectChanges;
  yield* Effect.acquireRelease(
    Effect.sync(() => projectChanges.removed.subscribe(({ projectId }) => Effect.orDie(forget(projectId)))),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

  return Translations.of({
    start,
    read,
    stop,
    changes: (projectId) =>
      Stream.fromPubSub(frames).pipe(
        Stream.filter((published) => published.projectId === projectId),
        Stream.map((published) => published.frame),
      ),
  });
});
