import { Context, Effect, Schema } from 'effect';
import { admitRight } from '../../../platform/contract/service/access.js';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { GateRefusal, type FieldRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RightKey } from '../../../platform/contract/wire/right.js';

type Run = (projectId: number) => Effect.Effect<void, GateRefusal<FieldRefusal> | StoreFailure, unknown>;

export interface CreationStep<A = unknown> {
  readonly id: string;
  readonly value: Schema.Decoder<A>;
  readonly right?: RightKey;
  step(projectId: number, value: A): Effect.Effect<void, GateRefusal<FieldRefusal> | StoreFailure, unknown>;
}

export const PROJECT_CREATION = new ContributionPoint<CreationStep>('graph/project-creation');

export type CreationSteps = {
  readonly take: (contributed: Readonly<Record<string, unknown>>) => Effect.Effect<Run, GateRefusal<'field-invalid' | 'right-missing'>>;
};

const taken = (one: CreationStep, value: unknown) =>
  Effect.andThen(
    Effect.mapError(admitRight(`The creation step "${one.id}"`, one.right, 'write'), (refused) => refused.about(one.id)),
    Schema.decodeUnknownEffect(one.value)(value).pipe(
      Effect.mapError((issue) =>
        new GateRefusal('field-invalid', `"${one.id}" is not a value this step takes: ${issue.message}`, [
          `correct "${one.id}" and create the project again`,
        ]).about(one.id),
      ),
      Effect.map((decoded) => ({ one, decoded })),
    ),
  );

export const creationSteps = (all: readonly CreationStep[]): CreationSteps => {
  const known = new Set(all.map((one) => one.id));
  return {
    take: Effect.fnUntraced(function* (contributed: Readonly<Record<string, unknown>>) {
      const stray = Object.keys(contributed).find((id) => !known.has(id));
      if (stray !== undefined)
        return yield* new GateRefusal('field-invalid', `no creation step of this server takes "${stray}"`, [
          `create the project without "${stray}", or through a build that takes it`,
        ]).about(stray);
      const decoded = yield* Effect.forEach(
        all.filter((one) => Object.hasOwn(contributed, one.id)),
        (one) => taken(one, contributed[one.id]),
      );
      const run: Run = (projectId) =>
        Effect.forEach(
          decoded,
          ({ one, decoded: value }) =>
            one.step(projectId, value).pipe(
              Effect.mapError((refused) => (refused instanceof GateRefusal ? refused.about(one.id) : refused)),
              Effect.withSpan('CreationSteps.run', { attributes: { entry: one.id } }),
            ),
          { discard: true },
        );
      return run;
    }),
  };
};

export const CreationSteps = Context.Reference<CreationSteps>('tagma/graph/CreationSteps', {
  defaultValue: () => creationSteps([]),
});
