import { Effect, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { callAnnotation, endpointName } from '../../http/contract/wire/operations.js';
import { inputDecoder } from '../../invocation/contract/service/input.js';
import {
  ANSWER_HEADER,
  ANSWER_TEXT,
  type InlineMedia,
  MEDIA_HEADER,
  MEDIA_INLINE,
  OUTCOME_HEADER,
  type Outcome,
} from '../../invocation/contract/wire/headers.js';
import { GateRefusal, refusalBody } from '../../platform/contract/wire/refusal.js';
import type { CallNeeds } from '../../invocation/contract/service/performer.js';
import type { HttpPerformById } from './binding.js';
import { answeringRecorded, doorStep } from './answering.js';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import type { OperationId } from '../../platform/contract/wire/ids.js';
import { DOOR_FIELDS, doorAsked, type ToolMedia, withoutDoorFields } from '@runlith/agent/tool';
import { outcomeLines } from '@runlith/agent/door/outcomeText';
import { toJson } from '@runlith/utils/json';
import { refusing } from '../../platform/contract/service/body.js';
import { CallStanding, CurrentCaller } from '../../invocation/contract/service/admission.js';
import type { invocationAssembly } from '../../invocation/assembly.js';
import { externalRefusal } from '../../invocation/contract/service/refusals.js';
import type { CallerWorkspace } from '../../workspace/contract/service/places.js';
import type { Operation } from '../../platform/contract/wire/operation.js';

type Detach = ReturnType<typeof invocationAssembly.detaching>;

type Decoders = ReadonlyMap<string, (input: unknown) => Effect.Effect<unknown, GateRefusal<'body-shape'>>>;

const decodersOf = (registry: OperationCatalog['Service']['registry']): Decoders =>
  new Map(registry.ids.flatMap((id) => (socketOnly(registry, id) ? [] : [[id, inputDecoder(registry.entry(id).params)] as const])));

const socketOnly = (registry: OperationCatalog['Service']['registry'], id: OperationId): boolean =>
  registry.doors(id).every((door) => door === 'socket');

const encodeAnswer = Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Unknown));

const unknownOperation = (named: string) =>
  new GateRefusal('unknown-operation', `no operation is named ${named}`, ['read_operations — the ids this server performs']);

const channelRefusal = (id: OperationId) =>
  new GateRefusal('thread-channel', `${id} opens a run over the live thread channel; an HTTP response cannot carry that turn`, [
    'perform it over the live thread channel',
  ]);

const withMeta = (answer: unknown, media: readonly ToolMedia[], text: string | undefined): unknown => {
  if ((media.length === 0 && text === undefined) || typeof answer !== 'object' || answer === null || Array.isArray(answer)) return answer;
  const held = answer as { readonly _meta?: Readonly<Record<string, unknown>> };
  const inline: readonly InlineMedia[] = media.map((one) => ({ mimeType: one.mediaType, data: Buffer.from(one.bytes).toString('base64') }));
  return { ...held, _meta: { ...held._meta, ...(inline.length === 0 ? {} : { media: inline }), ...(text === undefined ? {} : { text }) } };
};

const performing = (performById: HttpPerformById, catalog: OperationCatalog['Service'], detach: Detach) => {
  const decoders = decodersOf(catalog.registry);
  return Effect.fnUntraced(function* (named: string, payload: unknown, needs: CallNeeds) {
    const { id, input } = yield* serverStep(decoded(catalog, decoders, named, payload));
    const performed = Effect.gen(function* () {
      const performedNow = yield* performById(id, input, needs);
      const encoded = yield* serverStep(Effect.orDie(encodeAnswer(performedNow.shaped.answer)));
      return { answer: withMeta(encoded, performedNow.media, performedNow.text), outcome: performedNow.shaped.outcome };
    });
    if (doorAsked(payload, 'background') !== true) return yield* performed;
    return yield* serverStep(
      Effect.gen(function* () {
        const actor = (yield* CurrentCaller).actor;
        const threadId = actor.kind === 'thread' ? actor.threadId : null;
        const standing = yield* CallStanding;
        const context = yield* Effect.context<CurrentCaller | CallerWorkspace>();
        const work = refusing(Effect.provide(performed, context));
        const answered = yield* detach({ threadId, runId: standing?.runId ?? null, name: id, input }, work, needs.text);
        const receipt = needs.text ? withMeta(answered, [], outcomeLines(toJson(answered)).join('\n')) : answered;
        return { answer: receipt, outcome: 'answer' as const };
      }),
    );
  });
};

const serverStep = doorStep('server call');

const decoded = Effect.fnUntraced(function* (catalog: OperationCatalog['Service'], decoders: Decoders, named: string, payload: unknown) {
  const id = catalog.registry.named(named);
  if (id === null) return yield* unknownOperation(named);
  const entry: Operation = catalog.registry.entry(id);
  if ((yield* CurrentCaller).actor.kind === 'external' && entry.external === undefined) return yield* externalRefusal(id, entry.meaning);
  if (socketOnly(catalog.registry, id)) return yield* channelRefusal(id);
  return { id, input: yield* decoders.get(id)!(withoutDoorFields(payload, DOOR_FIELDS)) };
});

const outcomeOf = (outcome: Outcome) => ({ [OUTCOME_HEADER]: outcome });

const performedId = (catalog: OperationCatalog['Service'], named: string): OperationId | undefined =>
  catalog.registry.named(named) ?? undefined;

export const operationsHandler = (performById: HttpPerformById, catalog: OperationCatalog['Service'], detach: Detach) => {
  const perform = performing(performById, catalog, detach);
  return HttpApiBuilder.group(Api, 'operations', (handlers) =>
    handlers.handle('perform', ({ params, payload, headers }) =>
      Effect.annotateLogs(
        answeringRecorded(
          perform(params.id, payload, { media: headers[MEDIA_HEADER] === MEDIA_INLINE, text: headers[ANSWER_HEADER] === ANSWER_TEXT }),
        ).pipe(
          Effect.match({
            onSuccess: ({ answer, outcome }) => HttpServerResponse.jsonUnsafe(answer, { headers: outcomeOf(outcome) }),
            onFailure: (refusal) => HttpServerResponse.jsonUnsafe(refusalBody(refusal), { status: 409, headers: outcomeOf('refusal') }),
          }),
          Effect.catchDefect((defect) =>
            HttpServerResponse.isHttpServerResponse(defect)
              ? Effect.succeed(HttpServerResponse.setHeaders(defect, outcomeOf('defect')))
              : Effect.die(defect),
          ),
        ),
        callAnnotation(endpointName('operations', 'perform'), performedId(catalog, params.id)),
      ),
    ),
  );
};
