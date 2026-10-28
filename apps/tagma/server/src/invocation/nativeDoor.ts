import {
  type Tool,
  type ToolEffectSettlement,
  type ToolMedia,
  type ToolPreparationCall,
  type ToolSettleCall,
  Tool as ToolKit,
  ToolFailed,
} from '@runlith/agent/tool';
import type { ToolCatalog } from '@runlith/agent/catalog';
import type { PermissionSubject, Raised } from '@runlith/agent/permissions';
import { Context, Effect, Schema } from 'effect';
import { OPEN_REFUSALS, refusalBody, type GateRefusal } from '../platform/contract/wire/refusal.js';
import type { RefusalWords } from '../platform/contract/wire/manifest.js';
import { knownAnswer, operationClaims, type Operation } from '../platform/contract/wire/operation.js';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { actorRefOf } from '../platform/contract/wire/actor.js';
import { rootedSubjects } from '../platform/contract/service/subjects.js';
import type { AgentNeed, CapabilityId } from '../platform/contract/wire/capability.js';
import { CapabilityOffers, type OfferedOperation, type OfferFacts, ThreadExecution } from '../native-harness/contract/service/execution.js';
import { OperationChecks } from './contract/service/operationChecks.js';
import type { NativeCall } from './contract/service/nativeCall.js';
import { instructionTags } from '../native-harness/turns/instructions.js';
import type { ThreadContext } from '../native-harness/turns/context.js';
import { withCalled } from '../native-harness/tools/projection.js';
import { operationText } from '../platform/contract/wire/operation.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import type { ServedGraphs } from '../graph/contract/service/serving.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import type { GraphStore } from '../platform/contract/service/store.js';
import { Touches } from '../graph/contract/service/orientation.js';
import { SignedSession } from '../platform/contract/service/writers.js';
import { callerAt, nativePlacement, type NativePreparation } from './nativePlace.js';
import { fileSubjectClaims } from './fileClaims.js';
import { worldOf } from './admission/identity.js';
import type { DynamicOperationFailure } from './contract/service/refusals.js';
import { operationGateAt } from './refusals.js';
import { journaled } from './journaled.js';
import { routedSeams } from '../graph/serving/routing.js';
import { answeredOutcome, triggered } from './perform.js';
import { admitOperation } from './admission/callers.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { inputParsing, inputRefusal } from './contract/service/input.js';
import { answerDisplay, presentationOf, refusalText, refusedAnswer, voiced } from './presentation.js';
import type { WorkingOrigins } from '../workspace/contract/service/places.js';

const unprepared = (gate: GateRefusal): ToolFailed =>
  new ToolFailed({ reason: gate.reason, code: gate.code, unblock: gate.unblock, words: gate.words?.text });

const unresolved = (id: OperationId, failure: DynamicOperationFailure): ToolFailed =>
  new ToolFailed({ reason: `${id} could not resolve what the act is about: ${saidBy(failure)} — nothing was done, so call it again.` });

const saidBy = (failure: DynamicOperationFailure): string => {
  if (failure instanceof Error) return failure.message;
  const shaped = failure as { readonly reason?: unknown; readonly _tag?: unknown };
  if (typeof shaped.reason === 'string') return shaped.reason;
  return typeof shaped._tag === 'string' ? shaped._tag : 'the owner gave no reason';
};

export const nativeTools =
  <Enforcement, Owners>(
    enforcement: Context.Context<Enforcement | OperationChecks | WorkingOrigins>,
    graphs: ServedGraphs['Service'] | null,
    catalog: OperationCatalog['Service'],
    lifetimes: (ctx: ThreadContext, graph: Context.Context<GraphServices | GraphStore>) => Effect.Effect<Context.Context<Owners>>,
  ): ThreadExecution['Service']['tools'] =>
  (ctx, ids) =>
    nativeCatalog(
      {
        catalog,
        caller: ctx.caller,
        places: ctx.places,
        place: { root: ctx.workingRoot, origin: ctx.origin },
        world: worldOf(ctx.thread.hostKind),
        standing: { world: ctx.world, projectRoot: ctx.projectRoot },
        project: ctx.project,
        vocabulary: ctx.vocabulary,
        graphRoot: ctx.graphRoot,
        owners: Effect.flatMap(ctx.graph, (graph) =>
          Effect.map(lifetimes(ctx, graph), (life) =>
            Context.merge(
              Context.merge(graph, Context.merge(life, enforcement)),
              graphs === null ? Context.empty() : routedSeams(graph, graphs),
            ),
          ),
        ),
      },
      ids,
    );

const needMet = (need: AgentNeed, facts: OfferFacts): boolean => {
  switch (need) {
    case 'shared':
      return facts.world.shared;
    case 'history':
      return facts.world.history;
    case 'forbids-comments':
      return facts.comments === 'forbid';
    case 'images':
      return facts.images;
  }
};

export const nativeOffers = (catalog: OperationCatalog['Service']): CapabilityOffers['Service'] => {
  const offered = new Map<CapabilityId, { readonly offer: OfferedOperation; readonly needs: readonly AgentNeed[] }[]>();
  for (const id of catalog.registry.ids) {
    const entry: Operation = catalog.registry.entry(id);
    const tool = entry.tool;
    if (tool === undefined || tool.runtime === true) continue;
    const standing = offered.get(tool.capability) ?? [];
    let definition: Tool | undefined;
    standing.push({
      offer: {
        id,
        meaning: entry.meaning,
        direct: tool.direct === true,
        get definition() {
          return (definition ??= ToolKit.make(nativeDeclaration(id, entry, catalog.refusals)));
        },
      },
      needs: tool.needs ?? [],
    });
    offered.set(tool.capability, standing);
  }
  return CapabilityOffers.of({
    offers: (capability, facts) =>
      (offered.get(capability) ?? []).filter(({ needs }) => needs.every((need) => needMet(need, facts))).map(({ offer }) => offer),
  });
};

export function nativeDoor<Enforcement, Owners>(
  enforcement: Context.Context<Enforcement | OperationChecks | WorkingOrigins>,
  graphs: ServedGraphs['Service'] | null,
  catalog: OperationCatalog['Service'],
  lifetimes: (ctx: ThreadContext, graph: Context.Context<GraphServices | GraphStore>) => Effect.Effect<Context.Context<Owners>>,
): ThreadExecution['Service'] {
  const tools = nativeTools(enforcement, graphs, catalog, lifetimes);
  const checks = Context.get(enforcement, OperationChecks);
  return ThreadExecution.of({
    tools,
    afterEdit: (ctx, tool) => checks.afterEdit(ctx, tool),
    touched: (ctx, at, shown) =>
      Effect.flatMap(Touches, (touches) => touches.touch({ projectId: at.projectId, shown })).pipe(
        Effect.provideService(SignedSession, ctx.session),
        Effect.provide(at.graph),
      ),
  });
}

export const nativeCatalog = <Owners>(call: NativeCall<Owners>, ids: readonly string[]): ToolCatalog => {
  const make = nativeSurface(call);
  const picked: Record<string, Tool> = {};
  for (const candidate of ids) {
    const id = call.catalog.registry.named(candidate);
    if (id === null) throw new Error(`The native catalog mounts no tool for ${candidate}.`);
    picked[id] ??= make(id);
  }
  return picked;
};

const phrasedRefusals = (id: OperationId, entry: Operation, words: RefusalWords): RefusalWords =>
  Object.fromEntries(
    [...entry.refusals, ...OPEN_REFUSALS].map((code) => {
      const said = words[code];
      if (said === undefined) throw new Error(`${id} declares the refusal ${code}, and no module gives its words.`);
      return [code, said];
    }),
  );

function nativeDeclaration(id: OperationId, entry: Operation, words: RefusalWords) {
  return {
    description: operationText(entry),
    parameters: entry.params,
    refusals: phrasedRefusals(id, entry, words),
    parseOptions: inputParsing,
    approval: entry.approval,
    display: () => ({ form: 'none' as const }),
    document: true as const,
  };
}

function nativeSurface<Owners>(ctx: NativeCall<Owners>) {
  const placement = nativePlacement(ctx);

  return (id: OperationId): Tool => {
    const entry: Operation = ctx.catalog.registry.entry(id);
    const bound = ctx.catalog.bound(id);
    if (bound === undefined) throw new Error(`No operation body is registered for ${id}.`);
    const said = bound.answer;
    const settle = bound.settle;
    const presentation = presentationOf(ctx.catalog, id);
    const document = entry.answer === undefined ? Schema.Unknown : knownAnswer(entry.answer);
    const told = (answer: unknown, input: unknown, caller: Caller) => voiced(presentation, document, id, answer, input, caller);
    const answered = (input: unknown, answer: unknown, text: string | undefined, media: readonly ToolMedia[]) =>
      new ToolKit.ToolAnswer(
        answer,
        answerDisplay(presentation, input, answer, media),
        refusedAnswer(answer)
          ? { text, media, refusal: { code: answer.code, reason: answer.reason, words: answer.words?.text } }
          : answeredOutcome(entry, answer) === 'negative'
            ? {
                text,
                media,
                refusal: {
                  code: 'negative',
                  reason: `${id} answered without doing what was asked; its answer says why`,
                  words: presentation.negative === null ? 'Not done' : presentation.negative(input, answer),
                },
              }
            : { text, media },
      );
    const judged = (input: unknown, prepared: NativePreparation): readonly PermissionSubject[] =>
      rootedSubjects(prepared.facts.place?.root, [
        ...entry.subjects(input, prepared.value, prepared.facts.caller.actor),
        ...(bound.files?.(input, prepared.facts.caller) ?? []),
      ]);
    const raisedBy = (input: unknown, prepared: NativePreparation): readonly Raised[] =>
      entry.raises?.(input, prepared.value, prepared.facts.caller.actor) ?? [];
    const declared = entry.claims;
    const claimsOf = (input: unknown, call: ToolPreparationCall) =>
      Effect.map(
        fileSubjectClaims(ctx.standing?.world.world.files, ctx.place?.root, bound.files?.(input, callerAt(ctx.caller, call.caller)) ?? []),
        (named) => [...(declared === undefined ? [] : operationClaims(declared, input)), ...named],
      );

    const tool = ToolKit.make({
      ...nativeDeclaration(id, entry, ctx.catalog.refusals),
      inputRefusal: (error) => {
        const gate = inputRefusal(error);
        return { detail: gate.reason, unblock: gate.unblock };
      },
      mutates: entry.mutates === true ? (true as const) : undefined,
      claims: declared === undefined && bound.files === undefined ? undefined : claimsOf,
      companions: entry.tool?.companions,
      confirmation: {
        prompt: (input, prepared) => entry.confirmation(input, (prepared as NativePreparation | undefined)?.value),
        confirmLabel: entry.confirmLabel,
        intent: entry.intent,
      },
      prepare: (input: unknown, call: ToolPreparationCall) =>
        placement.resolve(id, entry, bound, input, call.caller, call.toolCallId, true).pipe(
          Effect.map((prepared) => ({ subjects: judged(input, prepared), raised: raisedBy(input, prepared), prepared })),
          Effect.catch((failure) => {
            const gate = operationGateAt(failure);
            return Effect.fail(gate === null ? unresolved(id, failure) : unprepared(gate));
          }),
        ),
      execute: (input: unknown, call) => {
        const act = Effect.gen(function* () {
          const prepared =
            call.prepared === undefined
              ? yield* placement.resolve(id, entry, bound, input, call.caller, call.toolCallId, true)
              : yield* placement.refresh(call.prepared);
          const caller = prepared.facts.caller;
          const ledger = instructionTags(call.messages, prepared.place?.projectId ?? ctx.project.id);
          const at = {
            ...prepared,
            facts: { ...prepared.facts, graph: Effect.map(prepared.facts.graph, (graph) => ({ ...graph, deliveredTags: ledger })) },
          };
          return yield* placement
            .serve(
              at,
              call.toolCallId,
              Effect.andThen(
                admitOperation(id, caller, input),
                triggered(id, caller, bound.execute(prepared.facts.bodyInput ?? input, prepared.value, caller)),
              ),
              call.progress?.stage,
            )
            .pipe(
              Effect.map((value) => (said === undefined ? value : said(value, input))),
              Effect.flatMap((answer) =>
                placement.serve(
                  at,
                  call.toolCallId,
                  Effect.gen(function* () {
                    const recorded = yield* journaled(answer);
                    const media = bound.media === undefined ? [] : yield* bound.media(recorded);
                    return answered(input, recorded, call.json === true ? undefined : yield* told(recorded, input, caller), media);
                  }),
                ),
              ),
            );
        });
        const watching = Effect.sync(() => {
          if (entry.watches?.(input) === true) call.progress?.watch();
        });
        return Effect.andThen(watching, act).pipe(
          Effect.catch((failure) => {
            const gate = operationGateAt(failure);
            if (gate === null) return Effect.die(failure);
            const refused = { status: 'refused' as const, ...refusalBody(gate) };
            return Effect.succeed(answered(input, refused, call.json === true ? undefined : refusalText(refused), []));
          }),
        );
      },
      settleEffect:
        settle === undefined
          ? undefined
          : ({ toolCallId, toolInput, caller, json }: ToolSettleCall) => {
              if (ctx.caller.actor.kind === 'external') return Effect.succeed<ToolEffectSettlement>({ status: 'unknown' });
              return Effect.flatMap(placement.resolve(id, entry, bound, toolInput, caller, toolCallId, false), (prepared) => {
                const actorRef = actorRefOf(prepared.facts.caller.actor);
                if (actorRef === null) return Effect.succeed<ToolEffectSettlement>({ status: 'unknown' });
                return placement.serve(
                  prepared,
                  null,
                  Effect.gen(function* () {
                    const result = yield* settle({ actorRef, operation: id, key: toolCallId });
                    if (result.status === 'not-happened') return { status: 'aborted' } as const;
                    if (result.status === 'unknown') return { status: 'unknown' } as const;
                    const text = json === true ? undefined : yield* told(result.evidence, toolInput, prepared.facts.caller);
                    return { status: 'completed', output: answered(toolInput, result.evidence, text, []) } as const;
                  }),
                );
              }).pipe(
                Effect.mapError(
                  (failure) => new ToolFailed({ reason: `${id} could not read whether this call happened: ${saidBy(failure)}` }),
                ),
              );
            },
    });

    return presentation.called === null ? tool : withCalled(tool, presentation.called);
  };
}
